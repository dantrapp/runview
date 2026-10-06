import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordCommand, snapshotSource } from "../src/cli/source.ts";

const roots: string[] = [];
function checkout() {
  const path = mkdtempSync(join(tmpdir(), "runview-source-"));
  roots.push(path);
  const git = (args: string[]) =>
    execFileSync("git", ["-C", path, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  writeFileSync(join(path, "test.txt"), "one");
  writeFileSync(join(path, ".gitignore"), "*.ignored\n");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Runview Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Fixture",
  ]);
  return path;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("source observations", () => {
  it("detects tracked and untracked content changes but excludes ignored files", async () => {
    const root = checkout(),
      before = await snapshotSource(root);
    expect(before.dirty).toBe(false);
    writeFileSync(join(root, "cache.ignored"), "cache");
    expect(await snapshotSource(root)).toEqual(before);
    writeFileSync(join(root, "test.txt"), "two");
    const changed = await snapshotSource(root);
    expect(changed.tree).not.toBe(before.tree);
    expect(changed.commit).toBe(before.commit);
    expect(changed.dirty).toBe(true);
    writeFileSync(join(root, "new.txt"), "new");
    expect((await snapshotSource(root)).tree).not.toBe(changed.tree);
    rmSync(join(root, "test.txt"));
    expect((await snapshotSource(root)).tree).not.toBe(changed.tree);
  });
  it("hashes symlink targets without reading through them", async () => {
    const root = checkout();
    symlinkSync("/does-not-exist", join(root, "link"));
    await expect(snapshotSource(root)).resolves.toMatchObject({ dirty: true });
  });
  it("records nonzero exits and mutations made during the command", async () => {
    const root = checkout();
    const source = await recordCommand(
      [
        process.execPath,
        "-e",
        'require("node:fs").writeFileSync("test.txt","changed");process.exitCode=7',
      ],
      root,
    );
    expect(source.exitCode).toBe(7);
    expect(source.before.dirty).toBe(false);
    expect(source.after.dirty).toBe(true);
    expect(source.before.tree).not.toBe(source.after.tree);
    expect(Date.parse(source.finishedAt)).toBeGreaterThanOrEqual(
      Date.parse(source.startedAt),
    );
  });
  it("does not silently record a missing command as a successful run", async () => {
    await expect(recordCommand([], checkout())).rejects.toThrow("test command");
    await expect(
      recordCommand(["runview-command-that-does-not-exist"], checkout()),
    ).rejects.toThrow();
  });
});
