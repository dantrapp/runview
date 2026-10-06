import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { exportEvidence } from "../src/cli/export.ts";
import { compareRuns } from "../src/core/compare.ts";
import { decodeArtifact } from "../src/core/artifacts.ts";
import { artifacts, assertions, latest } from "../src/core/evidence.ts";
import { mergeBundles } from "../src/core/import.ts";

const [checkoutArgument, outputArgument] = process.argv.slice(2);
if (!checkoutArgument || !outputArgument)
  throw new Error(
    "Usage: node scripts/test-overseer.mjs <overseer-checkout> <new-output-directory>",
  );
const checkout = resolve(checkoutArgument),
  output = resolve(outputArgument);
const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.equal(
  revision,
  "9810d13bb930144ba92a00bc99401fcb886cb8e7",
  "Review the adapter contract before changing the tested upstream revision",
);
assert.equal(
  execFileSync("git", ["-C", checkout, "diff", "HEAD", "--"], {
    encoding: "utf8",
  }),
  "",
  "Upstream producers must be unmodified",
);
mkdirSync(output);
const requireUpstream = createRequire(join(checkout, "package.json"));
const upstream = (file) => import(pathToFileURL(join(checkout, file)).href);
const { DateTime, Effect, Layer, Schema, Duration } = await import(
  pathToFileURL(requireUpstream.resolve("effect")).href
);
const evidenceRoot = "apps/api/test/e2e/evidence/";
const { TestAssert } = await upstream(`${evidenceRoot}test-assert.ts`);
const { TestEvidence } = await upstream(`${evidenceRoot}test-evidence.ts`);
const { TestEvidenceRecorder } = await upstream(
  `${evidenceRoot}test-evidence-recorder.ts`,
);
const { testExecutionEvidenceLayer } = await upstream(
  `${evidenceRoot}test-execution-evidence.ts`,
);
const { TestRunStorage } = await upstream(`${evidenceRoot}test-run-storage.ts`);
const { LocalTestRunStorageDirectory, testRunStorageLocalLayerAt } =
  await upstream(`${evidenceRoot}test-run-storage-local.ts`);
const { TestRun } = await upstream(`${evidenceRoot}test-run.ts`);
const { TestExecutionId, TestId } = await upstream(
  `${evidenceRoot}test-evidence-identity.ts`,
);
const { TestRunId, TestStage } = await upstream(
  "apps/api/src/overseer-e2e-trace-identity.ts",
);
const { deriveTestRunStatus, testExecutionStatusFromCause } = await upstream(
  `${evidenceRoot}test-run-lifecycle.ts`,
);
const evidenceDirectory = join(output, "evidence");
const storageLayer = testRunStorageLocalLayerAt(
  LocalTestRunStorageDirectory.make(evidenceDirectory),
);
const runs = [];
const captures = [];

// Controlled scenarios exercise the real assertion recorder and storage without deploying an API.
const cases = [
  {
    name: "Probe: stable response policy",
    execute(check, candidate) {
      if (candidate)
        check.oneOf("Response status satisfies the policy", 200, [200, 500]);
      else check.equal("Response status satisfies the policy", 200, 200);
    },
  },
  {
    name: "Probe: fail-fast persistence checks",
    execute(check, candidate) {
      check.equal(
        "Write response contains the requested name",
        "renamed",
        "renamed",
      );
      check.equal(
        "Separate read contains the requested name",
        candidate ? "original" : "renamed",
        "renamed",
      );
      check.equal(
        "Identity survives the rename",
        "workspace_fixed",
        "workspace_fixed",
      );
    },
  },
  {
    name: "Probe: generated data across healthy runs",
    execute(check, candidate) {
      const generated = {
        id: candidate ? "workspace_b" : "workspace_a",
        createdAt: candidate ? "2026-10-06T12:00:00Z" : "2026-10-06T11:00:00Z",
      };
      check.deepEqual(
        "A separate read returns the created record",
        { ...generated },
        generated,
      );
    },
  },
  {
    name: "Probe: grouped and eventual assertions",
    execute(check) {
      check.each("Rows", [1, 2], (value) =>
        check.greaterThan("Value is positive", value, 0),
      );
      check.isUndefined("Missing property remains undefined", undefined);
      check.equal(
        "Large integer round-trips",
        9007199254740993n,
        9007199254740993n,
      );
      return check.eventuallyEqual(
        "Service becomes ready",
        Effect.succeed("ready"),
        "ready",
        { timeout: Duration.millis(200), interval: Duration.millis(1) },
      );
    },
  },
];

await Effect.runPromise(
  Effect.gen(function* () {
    const storage = yield* TestRunStorage;
    for (const candidate of [false, true]) {
      const runId = TestRunId.make(
        `test-run_runview-probe-${candidate ? "candidate" : "baseline"}`,
      );
      const startedAt = DateTime.nowUnsafe();
      const initial = TestRun.make({
        id: runId,
        target: "local",
        stage: TestStage.make("test-runview-probe"),
        status: "running",
        startedAt,
        timing: { _tag: "Running" },
        tests: [],
      });
      yield* storage.createTestRun(initial);
      const tests = [];
      for (const [index, scenario] of cases.entries()) {
        const executionId = TestExecutionId.make(
          `test-execution_probe_${index}_0`,
        );
        const execution = yield* Effect.gen(function* () {
          const check = yield* TestAssert,
            recorder = yield* TestEvidenceRecorder,
            attachment = yield* TestEvidence;
          const executionStart = DateTime.nowUnsafe();
          yield* attachment.attachJson({
            name: "probe-input.json",
            value: {
              controlledProbe: true,
              candidate,
              scenario: scenario.name,
            },
          });
          const exit = yield* Effect.exit(
            Effect.suspend(
              () => scenario.execute(check, candidate) ?? Effect.void,
            ),
          );
          const finishedAt = DateTime.nowUnsafe();
          const snapshot = recorder.snapshot();
          return {
            _tag: "Finished",
            id: executionId,
            attempt: 0,
            status:
              exit._tag === "Success"
                ? "passed"
                : testExecutionStatusFromCause(exit.cause),
            startedAt: executionStart,
            finishedAt,
            durationMs: Math.max(
              0,
              DateTime.toEpochMillis(finishedAt) -
                DateTime.toEpochMillis(executionStart),
            ),
            ...snapshot,
            // The persisted schema requires a trace reference. This probe does not export spans.
            trace: {
              _tag: "Completed",
              provider: "axiom",
              dataset: "overseer-e2e-traces",
              traceId: "0".repeat(32),
            },
          };
        }).pipe(
          Effect.provide(
            testExecutionEvidenceLayer({
              runId,
              testExecutionId: executionId,
            }).pipe(Layer.provide(storageLayer)),
          ),
        );
        tests.push({
          id: TestId.make(`test_${index}`),
          name: scenario.name,
          registrationIndex: index,
          executions: [execution],
        });
      }
      const finishedAt = DateTime.nowUnsafe();
      const run = TestRun.make({
        ...initial,
        status: deriveTestRunStatus(tests, { infrastructure: "ready" }),
        tests,
        timing: {
          _tag: "Finished",
          finishedAt,
          durationMs: Math.max(
            0,
            DateTime.toEpochMillis(finishedAt) -
              DateTime.toEpochMillis(startedAt),
          ),
        },
      });
      yield* storage.updateTestRun(run);
      runs.push(Schema.encodeSync(Schema.fromJsonString(TestRun))(run));
      captures.push(
        exportEvidence(evidenceDirectory, { includeArtifacts: true, limit: 1 }),
      );
    }
  }).pipe(Effect.provide(storageLayer)),
);

const beforeDatabase = createHash("sha256")
  .update(readFileSync(join(evidenceDirectory, "test-runs.sqlite")))
  .digest("hex");
const historical = exportEvidence(evidenceDirectory, {
  includeArtifacts: true,
});
assert.equal(
  historical.artifacts.length,
  4,
  "Reused upstream execution IDs replace the earlier artifact rows",
);
assert.equal(historical.warnings.length, 4);
assert.ok(
  historical.warnings.every((warning) =>
    warning.includes("storage record missing for this run"),
  ),
);
const bundle = mergeBundles(captures);
const afterDatabase = createHash("sha256")
  .update(readFileSync(join(evidenceDirectory, "test-runs.sqlite")))
  .digest("hex");
assert.equal(beforeDatabase, afterDatabase);
const baseline = bundle.runs.find((entry) =>
  entry.run.id.endsWith("baseline"),
)?.run;
const candidate = bundle.runs.find((entry) =>
  entry.run.id.endsWith("candidate"),
)?.run;
assert.ok(baseline && candidate);
assert.deepEqual(baseline, JSON.parse(runs[0]));
assert.deepEqual(candidate, JSON.parse(runs[1]));
assert.equal(baseline.status, "passed");
assert.equal(candidate.status, "failed");
const comparison = compareRuns(baseline, candidate);
const policy = comparison.tests[0],
  persistence = comparison.tests[1],
  generated = comparison.tests[2];
assert.equal(latest(policy.after).status, "passed");
assert.equal(policy.assertions[0].before.operation._tag, "Equal");
assert.equal(policy.assertions[0].after.operation._tag, "OneOf");
assert.ok(policy.changes.includes("operation"));
assert.deepEqual(
  persistence.assertions.map((delta) => delta.changes),
  [[], ["regressed"], ["unobserved"]],
);
assert.equal(latest(generated.after).status, "passed");
assert.deepEqual(generated.changes, ["expectation"]);
for (const entry of bundle.runs)
  for (const test of entry.run.tests)
    for (const ref of artifacts(latest(test))) {
      const body = bundle.artifacts.find(
        (body) => body.runId === ref.runId && body.artifactId === ref.id,
      );
      assert.ok(body);
      const decoded = JSON.parse(
        new TextDecoder().decode(await decodeArtifact(ref, body)),
      );
      assert.equal(decoded.controlledProbe, true);
    }
assert.equal(bundle.artifacts.length, 8);
assert.deepEqual(bundle.warnings, []);
const report = {
  upstreamRevision: revision,
  environment: {
    node: process.version,
    effect: JSON.parse(
      readFileSync(join(checkout, "node_modules/effect/package.json"), "utf8"),
    ).version,
    upstreamLockfileSha256: createHash("sha256")
      .update(readFileSync(join(checkout, "pnpm-lock.yaml")))
      .digest("hex"),
  },
  scope:
    "Unmodified upstream assertion, recording, schema, lifecycle, and SQLite modules; controlled probe inputs; no API deployment or trace export",
  baselineStatus: baseline.status,
  candidateStatus: candidate.status,
  assertionsRecorded: bundle.runs.map((entry) => ({
    run: entry.run.id,
    count: entry.run.tests.reduce(
      (n, test) => n + assertions(latest(test)).length,
      0,
    ),
  })),
  verifiedArtifactBodies: bundle.artifacts.length,
  databaseUnchangedByExport: beforeDatabase === afterDatabase,
  historicalArtifactRowsMissing: historical.warnings.length,
  comparisons: comparison.tests.map((test) => ({
    name: test.name,
    status: latest(test.after)?.status,
    changes: test.changes,
  })),
};
writeFileSync(
  join(output, "overseer-probe.runview.json"),
  JSON.stringify(bundle, null, 2) + "\n",
  { mode: 0o600 },
);
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
