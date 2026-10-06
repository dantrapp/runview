import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { exportEvidence } from "../src/cli/export.ts";
import type { Source } from "../src/core/evidence.ts";
import { database, fixture } from "./fixtures.ts";

const directories: string[] = [];
function temporary() {
  const path = mkdtempSync(join(tmpdir(), "runview-export-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe("read-only SQLite adapter", () => {
  it("exports a snapshot and verified blob without changing the database", () => {
    const root = temporary(),
      run = fixture();
    const { body } = database(root, run);
    const before = readFileSync(join(root, "test-runs.sqlite"));
    const bundle = exportEvidence(root, { includeArtifacts: true });
    expect(bundle.runs[0]!.run).toEqual(run);
    expect(Buffer.from(bundle.artifacts[0]!.base64, "base64")).toEqual(body);
    expect(readFileSync(join(root, "test-runs.sqlite"))).toEqual(before);
    expect(bundle.warnings).toEqual([]);
    expect(exportEvidence(root).artifacts).toEqual([]);
  });
  it("omits corrupt bodies rather than serving them as trusted artifacts", () => {
    const root = temporary();
    const { digest, body } = database(root, fixture());
    writeFileSync(join(root, "blobs", digest), Buffer.alloc(body.length, 97));
    const bundle = exportEvidence(root, { includeArtifacts: true });
    expect(bundle.artifacts).toEqual([]);
    expect(bundle.warnings[0]).toContain("digest mismatch");
  });
  it("does not follow blob symlinks or a symlinked blob directory outside the evidence root", () => {
    const root = temporary(),
      outside = temporary();
    const { digest, body } = database(root, fixture());
    const path = join(root, "blobs", digest);
    rmSync(path);
    writeFileSync(join(outside, digest), body);
    symlinkSync(join(outside, digest), path);
    expect(
      exportEvidence(root, { includeArtifacts: true }).warnings[0],
    ).toContain("outside the blob");
    rmSync(join(root, "blobs"), { recursive: true });
    symlinkSync(outside, join(root, "blobs"));
    expect(
      exportEvidence(root, { includeArtifacts: true }).warnings[0],
    ).toContain("outside the evidence");
  });
  it("rejects mismatched metadata and respects the artifact size budget", () => {
    const root = temporary();
    const { reference } = database(root, fixture());
    const db = new DatabaseSync(join(root, "test-runs.sqlite"));
    db.prepare("UPDATE test_artifacts SET ref_json = ?").run(
      JSON.stringify({ ...reference, name: "different.json" }),
    );
    db.close();
    expect(() => exportEvidence(root, { includeArtifacts: true })).toThrow(
      "metadata does not match",
    );
    const big = temporary();
    database(big, fixture(), Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(
      exportEvidence(big, { includeArtifacts: true }).warnings[0],
    ).toContain("size limit");
  });
  it("does not expose local paths when a blob is missing", () => {
    const root = temporary();
    const { digest } = database(root, fixture());
    renameSync(join(root, "blobs", digest), join(root, "missing"));
    const warning = exportEvidence(root, { includeArtifacts: true })
      .warnings[0];
    expect(warning).toContain("file unavailable");
    expect(warning).not.toContain(root);
  });
  it("attaches source observations only to finished runs within the captured command window", () => {
    const root = temporary();
    database(root, fixture());
    const state = {
      commit: "a".repeat(40),
      tree: "b".repeat(64),
      dirty: false,
    };
    const source: Source = {
      kind: "observed",
      startedAt: "2026-10-06T09:59:59.000Z",
      finishedAt: "2026-10-06T10:00:02.000Z",
      before: state,
      after: state,
      exitCode: 0,
    };
    expect(exportEvidence(root, { source }).runs[0]!.source).toEqual(source);
    expect(
      exportEvidence(root, {
        source: { ...source, startedAt: "2026-10-06T10:00:00.500Z" },
      }).runs[0]!.source,
    ).toBeUndefined();
    expect(
      exportEvidence(root, {
        source: { ...source, finishedAt: "2026-10-06T10:00:00.500Z" },
      }).runs[0]!.source,
    ).toBeUndefined();
  });
  it("rejects invalid limits", () => {
    for (const limit of [0, -1, 101, 1.5, NaN])
      expect(() => exportEvidence("unused", { limit })).toThrow("Run limit");
  });
});
