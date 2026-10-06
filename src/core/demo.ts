import type { Assertion, Bundle, Run, Test } from "./evidence.ts";

const sampleBodies = [
  '{"sample":true,"id":"workspace_demo","name":"Platform engineering"}',
  '{"sample":true,"id":"workspace_demo","name":"Platform engineering"}',
  '{"sample":true,"id":"workspace_demo","name":"Product engineering"}',
];
const sampleDigests = [
  "5d15e23e05e8e6721e7be21fd161fb8be505c84e862eb42db46f2c3f5f5057d1",
  "5d15e23e05e8e6721e7be21fd161fb8be505c84e862eb42db46f2c3f5f5057d1",
  "fbc1c5821b7c180c8bf7f103b5d629fc79fe28594a578c540d409e527cee2f32",
];

const cases: [string, string[]][] = [
  [
    "Workspace rename persists",
    [
      "Rename returns the requested name",
      "A separate read returns the renamed workspace",
      "Workspace identity is unchanged",
    ],
  ],
  [
    "Anonymous requests are rejected",
    [
      "Response has the expected status",
      "Response does not expose workspace data",
    ],
  ],
  [
    "Concurrent creates keep distinct identities",
    [
      "Every workspace receives a unique ID",
      "Every created workspace can be read",
    ],
  ],
  [
    "Archiving is idempotent",
    ["Workspace is archived", "Repeating archive preserves the timestamp"],
  ],
  [
    "Malformed workspace IDs are rejected",
    ["Malformed ID returns a validation error"],
  ],
  ["Missing workspaces return not found", ["Missing workspace returns 404"]],
];
function fixture(index: number): Run {
  const startedAt = `2026-10-06T${String(14 + index).padStart(2, "0")}:24:00.000Z`;
  const id = `sample-run-${index}`;
  const tests: Test[] = cases.map(([name, descriptions], t) => {
    const executionId = `test-execution_sample${index}_${t}`;
    const assertions: Assertion[] = descriptions.map((description, i) => ({
      id: `assertion_sample${index}_${t}_${i}`,
      testExecutionId: executionId,
      sequence: i,
      groupPath: [],
      description,
      startedAt,
      durationMs: i === 1 ? 143 : 12,
      operation:
        t === 1
          ? {
              _tag: "Equal",
              actual: i === 0 ? 401 : null,
              expected: i === 0 ? 401 : null,
            }
          : {
              _tag: "DeepEqual",
              actual: t === 0 ? "Platform engineering" : true,
              expected: t === 0 ? "Platform engineering" : true,
            },
      outcome: { _tag: "Passed" },
    }));
    let failed = false;
    if (index === 2 && t === 0) {
      const assertion = assertions[1]!;
      assertion.operation = {
        _tag: "DeepEqual",
        actual: "Product engineering",
        expected: "Platform engineering",
      };
      assertion.outcome = {
        _tag: "Failed",
        error: {
          name: "AssertionError",
          message: "The read returned the previous workspace name.",
          stack:
            'AssertionError: expected "Platform engineering", received "Product engineering"\n    at workspaceRename (workspace.test.ts:42:12)',
        },
      };
      assertions.splice(2);
      failed = true;
    }
    if (index === 2 && t === 1)
      assertions[0]!.operation = { _tag: "Equal", actual: 403, expected: 403 };
    return {
      id: `test_sample${index}_${t}`,
      name,
      registrationIndex: t,
      executions:
        index === 2 && t === 2
          ? [
              {
                _tag: "Skipped",
                id: executionId,
                attempt: 0,
                status: "skipped",
                finishedAt: startedAt,
              },
            ]
          : [
              {
                _tag: "Finished",
                id: executionId,
                attempt: 0,
                status: failed ? "failed" : "passed",
                startedAt,
                finishedAt: new Date(
                  Date.parse(startedAt) + 200 + t * 157,
                ).toISOString(),
                durationMs: 200 + t * 157,
                assertions,
                artifacts:
                  t === 0
                    ? [
                        {
                          id: `artifact_sample${index}`,
                          runId: id,
                          testExecutionId: executionId,
                          name: "workspace-response.json",
                          kind: "Json",
                          contentType: "application/json",
                          byteLength: sampleBodies[index]!.length,
                          createdAt: startedAt,
                        },
                      ]
                    : [],
                trace: {
                  _tag: "Completed",
                  provider: "axiom",
                  dataset: "sample-e2e",
                  traceId: "a".repeat(31) + index,
                },
              },
            ],
    };
  });
  return {
    id,
    target: "deployed",
    stage: "sample-preview",
    status: index === 2 ? "failed" : "passed",
    startedAt,
    timing: {
      _tag: "Finished",
      finishedAt: new Date(
        Date.parse(startedAt) + 2431 + index * 170,
      ).toISOString(),
      durationMs: 2431 + index * 170,
    },
    tests,
  };
}
export const demo: Bundle = {
  format: "runview",
  version: 1,
  exportedAt: "2026-10-06T16:25:00.000Z",
  runs: [2, 1, 0].map((index) => ({ run: fixture(index) })),
  artifacts: [2, 1, 0].map((index) => ({
    runId: `sample-run-${index}`,
    artifactId: `artifact_sample${index}`,
    base64: btoa(sampleBodies[index]!),
    sha256: sampleDigests[index]!,
  })),
  warnings: [],
};
