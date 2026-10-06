import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEvidence } from "../src/core/evidence.ts";
import { decodeArtifact } from "../src/core/artifacts.ts";
import { demo } from "../src/core/demo.ts";
import { artifacts, latest } from "../src/core/evidence.ts";
import { fixture, finished, fail } from "./fixtures.ts";

describe("evidence validation", () => {
  it("verifies all bundled sample artifacts", async () => {
    for (const entry of demo.runs) {
      const ref = artifacts(latest(entry.run.tests[0]))[0]!;
      const body = demo.artifacts.find((body) => body.runId === entry.run.id)!;
      expect(
        JSON.parse(new TextDecoder().decode(await decodeArtifact(ref, body))),
      ).toHaveProperty("sample", true);
    }
  });
  it("decodes an artifact at the export size limit without a regex stack overflow", async () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024, 65);
    const ref = {
      id: "large",
      runId: "run",
      testExecutionId: "execution",
      name: "large.txt",
      kind: "Text" as const,
      contentType: "text/plain",
      byteLength: bytes.length,
      createdAt: "2026-10-06T10:00:00Z",
    };
    const body = {
      runId: ref.runId,
      artifactId: ref.id,
      base64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    expect((await decodeArtifact(ref, body)).length).toBe(bytes.length);
  });
  it("imports raw snapshots without inventing source metadata", () => {
    const bundle = parseEvidence(JSON.stringify(fixture()));
    expect(bundle.runs[0]!.source).toBeUndefined();
    expect(bundle.runs).toHaveLength(1);
  });
  it("rejects duplicate attempts and cross-execution assertion ownership", () => {
    const run = fixture();
    finished(run).assertions[0]!.testExecutionId = "unrelated";
    expect(() => parseEvidence(JSON.stringify(run))).toThrow(
      "another execution",
    );
    const duplicate = fixture();
    duplicate.tests[0]!.executions.push({
      _tag: "Pending",
      id: "second",
      attempt: 0,
      status: "pending",
    });
    expect(() => parseEvidence(JSON.stringify(duplicate))).toThrow(
      "Duplicate attempt",
    );
  });
  it("rejects duplicate assertion sequence but retains runner outcomes independently of assertion outcomes", () => {
    const run = fixture();
    finished(run).assertions[1]!.sequence = 0;
    expect(() => parseEvidence(JSON.stringify(run))).toThrow(
      "Duplicate assertion sequence",
    );
    const invalid = fixture();
    fail(invalid);
    finished(invalid).status = "passed";
    expect(parseEvidence(JSON.stringify(invalid)).runs[0]!.run).toEqual(
      invalid,
    );
  });
  it("rejects unknown formats, duplicate runs, and artifact bodies without references", () => {
    const bundle = parseEvidence(JSON.stringify(fixture()));
    expect(() =>
      parseEvidence(JSON.stringify({ ...bundle, version: 2 })),
    ).toThrow("Unsupported evidence");
    expect(() =>
      parseEvidence(
        JSON.stringify({ ...bundle, runs: [...bundle.runs, ...bundle.runs] }),
      ),
    ).toThrow("duplicate run");
    expect(() =>
      parseEvidence(
        JSON.stringify({
          ...bundle,
          artifacts: [
            {
              runId: "run-a",
              artifactId: "orphan",
              base64: "",
              sha256: "a".repeat(64),
            },
          ],
        }),
      ),
    ).toThrow("no matching reference");
  });
  it("checks both the SHA-256 and length before artifact preview or download", async () => {
    const bytes = Buffer.from("<script>untrusted</script>");
    const reference = {
      id: "artifact-a",
      runId: "run-a",
      testExecutionId: "execution-a",
      name: "log.html",
      kind: "Text" as const,
      contentType: "text/html",
      byteLength: bytes.length,
      createdAt: "2026-10-06T10:00:00Z",
    };
    const body = {
      runId: reference.runId,
      artifactId: reference.id,
      base64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    expect(
      new TextDecoder().decode(await decodeArtifact(reference, body)),
    ).toBe(bytes.toString());
    await expect(
      decodeArtifact(reference, { ...body, sha256: "a".repeat(64) }),
    ).rejects.toThrow("digest mismatch");
    await expect(
      decodeArtifact({ ...reference, byteLength: 1 }, body),
    ).rejects.toThrow("length mismatch");
    await expect(
      decodeArtifact(reference, { ...body, base64: "?no" }),
    ).rejects.toThrow("encoding");
    await expect(
      decodeArtifact(reference, { ...body, artifactId: "other" }),
    ).rejects.toThrow("identity");
  });
});
