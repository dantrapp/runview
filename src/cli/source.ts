import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { Source } from "../core/evidence.ts";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
export async function snapshotSource(cwd: string): Promise<Source["before"]> {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const files = [
    ...new Set(
      git(root, [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ])
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    const path = join(root, file);
    hash.update(JSON.stringify(file));
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        hash.update(":deleted\0");
        continue;
      }
      throw error;
    }
    if (info.isDirectory())
      throw new Error(
        "Source capture does not support submodules. Export the run without source metadata instead.",
      );
    if (info.isSymbolicLink()) {
      hash.update(`:link:${await readlink(path)}\0`);
      continue;
    }
    if (!info.isFile())
      throw new Error("Source capture encountered a non-regular file.");
    totalBytes += info.size;
    if (totalBytes > 1024 * 1024 * 1024)
      throw new Error("Source capture exceeds the 1 GiB content limit.");
    hash.update(`:${info.mode & 0o111}:${info.size}:`);
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    hash.update("\0");
  }
  if (
    commit !== git(root, ["rev-parse", "HEAD"]).trim() ||
    status !==
      git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  )
    throw new Error(
      "Source state changed during capture. Retry when the checkout is idle.",
    );
  return { commit, tree: hash.digest("hex"), dirty: status.length > 0 };
}

export async function recordCommand(
  command: string[],
  cwd: string,
): Promise<Source> {
  const executable = command[0];
  if (!executable) throw new Error("Provide a test command after --.");
  const before = await snapshotSource(cwd);
  const startedAt = new Date().toISOString();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, command.slice(1), {
      cwd,
      stdio: "inherit",
      shell: false,
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      resolve(code ?? (signal === "SIGINT" ? 130 : 143));
    });
  });
  const finishedAt = new Date().toISOString();
  const after = await snapshotSource(cwd);
  return { kind: "observed", startedAt, finishedAt, before, after, exitCode };
}
