import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Run, Execution } from "../src/core/evidence.ts";

export function finished(run: Run): Extract<Execution, { _tag: "Finished" }> {
  const execution = run.tests[0]?.executions[0];
  if (execution?._tag !== "Finished")
    throw new Error("Fixture requires a finished execution");
  return execution;
}
export function fixture(id = "run-a"): Run {
  return {
    id,
    target: "local",
    stage: "test",
    status: "passed",
    startedAt: "2026-10-06T10:00:00.000Z",
    timing: {
      _tag: "Finished",
      finishedAt: "2026-10-06T10:00:01.000Z",
      durationMs: 1000,
    },
    tests: [
      {
        id: `test-${id}`,
        name: "Resource persists",
        registrationIndex: 0,
        executions: [
          {
            _tag: "Finished",
            id: `execution-${id}`,
            attempt: 0,
            status: "passed",
            startedAt: "2026-10-06T10:00:00.000Z",
            finishedAt: "2026-10-06T10:00:01.000Z",
            durationMs: 1000,
            assertions: [0, 1, 2].map((sequence) => ({
              id: `assertion-${id}-${sequence}`,
              testExecutionId: `execution-${id}`,
              sequence,
              groupPath: ["Read"],
              description: [
                "Status matches",
                "Name matches",
                "Identity matches",
              ][sequence]!,
              startedAt: "2026-10-06T10:00:00.000Z",
              durationMs: 3,
              operation: { _tag: "Equal", actual: 200, expected: 200 },
              outcome: { _tag: "Passed" },
            })),
            artifacts: [],
            trace: {
              _tag: "Completed",
              provider: "axiom",
              dataset: "fixture",
              traceId: "a".repeat(32),
            },
          },
        ],
      },
    ],
  };
}
export function fail(run: Run, index = 0) {
  run.status = "failed";
  const execution = finished(run);
  execution.status = "failed";
  execution.assertions[index]!.outcome = {
    _tag: "Failed",
    error: {
      name: "AssertionError",
      message: "Mismatch",
      stack: "AssertionError: mismatch",
    },
  };
}
export function database(
  directory: string,
  run: Run,
  body = Buffer.from('{"ok":true}'),
) {
  mkdirSync(join(directory, "blobs"), { recursive: true });
  const digest = createHash("sha256").update(body).digest("hex");
  const reference = {
    id: `artifact-${run.id}`,
    runId: run.id,
    testExecutionId: finished(run).id,
    name: "response.json",
    kind: "Json" as const,
    contentType: "application/json",
    byteLength: body.length,
    createdAt: run.startedAt,
  };
  finished(run).artifacts = [reference];
  writeFileSync(join(directory, "blobs", digest), body);
  const db = new DatabaseSync(join(directory, "test-runs.sqlite"));
  db.exec(
    "CREATE TABLE test_runs (id TEXT PRIMARY KEY, started_at_ms INTEGER, snapshot_json TEXT); CREATE TABLE test_artifacts (id TEXT PRIMARY KEY, run_id TEXT, ref_json TEXT, content_sha256 TEXT, content_path TEXT);",
  );
  db.prepare("INSERT INTO test_runs VALUES (?, ?, ?)").run(
    run.id,
    Date.parse(run.startedAt),
    JSON.stringify(run),
  );
  db.prepare("INSERT INTO test_artifacts VALUES (?, ?, ?, ?, ?)").run(
    reference.id,
    run.id,
    JSON.stringify(reference),
    digest,
    "/never-read-this-path",
  );
  db.close();
  return { digest, reference, body };
}
