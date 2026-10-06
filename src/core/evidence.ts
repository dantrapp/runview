import { z } from "zod";

export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const text = z.string().min(1).max(16_384);
const timestamp = z.iso.datetime({ offset: true });
const natural = z.number().int().nonnegative();
const operation = z.object({ _tag: text }).catchall(z.json());
export const assertionSchema = z.object({
  id: text,
  testExecutionId: text,
  sequence: natural,
  groupPath: z.array(text).max(100),
  description: text,
  startedAt: timestamp,
  durationMs: natural,
  operation,
  outcome: z.discriminatedUnion("_tag", [
    z.object({ _tag: z.literal("Passed") }),
    z.object({
      _tag: z.literal("Failed"),
      error: z.object({ name: text, message: z.string(), stack: z.string() }),
    }),
  ]),
});
export const artifactSchema = z.object({
  id: text,
  runId: text,
  testExecutionId: text,
  name: text,
  kind: z.enum(["File", "Screenshot", "Video", "Text", "Json"]),
  contentType: text,
  byteLength: natural,
  createdAt: timestamp,
});
const trace = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Pending") }),
  z.object({
    _tag: z.literal("Completed"),
    provider: text,
    dataset: text,
    traceId: text,
  }),
]);
const executionFields = { id: text, attempt: natural };
const observedFields = {
  startedAt: timestamp,
  assertions: z.array(assertionSchema).max(20_000),
  artifacts: z.array(artifactSchema).max(1000),
  trace,
};
export const executionSchema = z.discriminatedUnion("_tag", [
  z.object({
    ...executionFields,
    _tag: z.literal("Pending"),
    status: z.literal("pending"),
  }),
  z.object({
    ...executionFields,
    ...observedFields,
    _tag: z.literal("Running"),
    status: z.literal("running"),
  }),
  z.object({
    ...executionFields,
    ...observedFields,
    _tag: z.literal("Finished"),
    status: z.enum(["passed", "failed", "interrupted", "timed_out"]),
    finishedAt: timestamp,
    durationMs: natural,
  }),
  z.object({
    ...executionFields,
    _tag: z.literal("Skipped"),
    status: z.literal("skipped"),
    finishedAt: timestamp,
  }),
]);
const testSchema = z.object({
  id: text,
  name: text,
  registrationIndex: natural,
  executions: z.array(executionSchema).max(1000),
});
export const runSchema = z
  .object({
    id: text,
    target: z.enum(["local", "deployed"]),
    stage: text,
    status: z.enum(["running", "passed", "failed", "interrupted", "timed_out"]),
    startedAt: timestamp,
    timing: z.discriminatedUnion("_tag", [
      z.object({ _tag: z.literal("Running") }),
      z.object({
        _tag: z.literal("Finished"),
        finishedAt: timestamp,
        durationMs: natural,
      }),
    ]),
    tests: z.array(testSchema).max(10_000),
  })
  .superRefine((run, ctx) => {
    const seen = new Set<string>();
    const unique = (id: string) => {
      if (seen.has(id))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate evidence identity: ${id}`,
        });
      seen.add(id);
    };
    for (const test of run.tests) {
      unique(test.id);
      const attempts = new Set<number>();
      for (const execution of test.executions) {
        unique(execution.id);
        if (attempts.has(execution.attempt))
          ctx.addIssue({
            code: "custom",
            message: `Duplicate attempt in ${test.name}`,
          });
        attempts.add(execution.attempt);
        if ("assertions" in execution) {
          const sequences = new Set<number>();
          for (const assertion of execution.assertions) {
            unique(assertion.id);
            if (sequences.has(assertion.sequence))
              ctx.addIssue({
                code: "custom",
                message: "Duplicate assertion sequence",
              });
            sequences.add(assertion.sequence);
            if (assertion.testExecutionId !== execution.id)
              ctx.addIssue({
                code: "custom",
                message: "Assertion belongs to another execution",
              });
          }
          for (const artifact of execution.artifacts) {
            unique(artifact.id);
            if (
              artifact.runId !== run.id ||
              artifact.testExecutionId !== execution.id
            )
              ctx.addIssue({
                code: "custom",
                message: "Artifact belongs to another execution",
              });
          }
        }
      }
    }
  });

export const sourceSchema = z.object({
  kind: z.literal("observed"),
  startedAt: timestamp,
  finishedAt: timestamp,
  before: z.object({
    commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    tree: z.string().regex(/^[a-f0-9]{64}$/),
    dirty: z.boolean(),
  }),
  after: z.object({
    commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    tree: z.string().regex(/^[a-f0-9]{64}$/),
    dirty: z.boolean(),
  }),
  exitCode: z.number().int(),
});
export const bundleSchema = z.object({
  format: z.literal("runview"),
  version: z.literal(1),
  exportedAt: timestamp,
  runs: z
    .array(z.object({ run: runSchema, source: sourceSchema.optional() }))
    .min(1)
    .max(100),
  artifacts: z
    .array(
      z.object({
        runId: text,
        artifactId: text,
        base64: z.string().max(8 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(10_000)
    .default([]),
  warnings: z.array(z.string()).max(1000).default([]),
});
export type Assertion = z.infer<typeof assertionSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type Test = z.infer<typeof testSchema>;
export type Run = z.infer<typeof runSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type RunEntry = Bundle["runs"][number];
export type Source = z.infer<typeof sourceSchema>;

export function parseEvidence(input: string): Bundle {
  if (new TextEncoder().encode(input).length > MAX_IMPORT_BYTES)
    throw new Error(
      "Evidence exceeds the 32 MiB import limit. Export fewer runs or omit artifacts.",
    );
  const value: unknown = JSON.parse(input);
  const parsed = bundleSchema.safeParse(value);
  if (parsed.success) {
    const ids = parsed.data.runs.map((entry) => entry.run.id);
    if (new Set(ids).size !== ids.length)
      throw new Error("Bundle contains duplicate run IDs.");
    const bodies = new Set<string>();
    const refs = new Set(
      parsed.data.runs.flatMap((entry) =>
        entry.run.tests.flatMap((test) =>
          test.executions.flatMap((exec) =>
            "artifacts" in exec
              ? exec.artifacts.map((ref) => canonical([ref.runId, ref.id]))
              : [],
          ),
        ),
      ),
    );
    for (const body of parsed.data.artifacts) {
      const key = canonical([body.runId, body.artifactId]);
      if (bodies.has(key))
        throw new Error("Bundle contains duplicate artifact bodies.");
      bodies.add(key);
      if (!refs.has(key))
        throw new Error("Artifact body has no matching reference.");
    }
    return parsed.data;
  }
  const run = runSchema.safeParse(value);
  if (run.success)
    return {
      format: "runview",
      version: 1,
      exportedAt: new Date().toISOString(),
      runs: [{ run: run.data }],
      artifacts: [],
      warnings: [],
    };
  const issue = (
    typeof value === "object" && value !== null && "format" in value
      ? parsed.error
      : run.error
  ).issues[0];
  throw new Error(
    `Unsupported evidence: ${issue?.path.join(".") || "root"} — ${issue?.message || "invalid run"}`,
  );
}

export function latest(test?: Test): Execution | undefined {
  return test?.executions.reduce<Execution | undefined>(
    (result, next) =>
      !result || next.attempt > result.attempt ? next : result,
    undefined,
  );
}
export function assertions(execution?: Execution): Assertion[] {
  return execution && "assertions" in execution ? execution.assertions : [];
}
export function artifacts(execution?: Execution): Artifact[] {
  return execution && "artifacts" in execution ? execution.artifacts : [];
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
