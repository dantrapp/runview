import { assertions, canonical, latest } from "./evidence.ts";
import type { Assertion, Execution, Run, Test } from "./evidence.ts";

export type Change =
  | "regressed"
  | "recovered"
  | "expectation"
  | "operation"
  | "added"
  | "unobserved"
  | "absent"
  | "ambiguous";
export interface AssertionDelta {
  key: string;
  before?: Assertion;
  after?: Assertion;
  changes: Change[];
}
export interface TestDelta {
  key: string;
  name: string;
  before?: Test;
  after?: Test;
  changes: Change[];
  assertions: AssertionDelta[];
}
export interface Comparison {
  tests: TestDelta[];
  comparable: boolean;
  warning?: string;
}

const observationFields = new Set([
  "actual",
  "actualLength",
  "actualSize",
  "actualError",
  "observation",
  "completion",
  "attempts",
  "elapsedMs",
]);
export function expectation(assertion: Assertion): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(assertion.operation).filter(
      ([key]) => !observationFields.has(key),
    ),
  );
}
export function observation(assertion: Assertion): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(assertion.operation).filter(([key]) =>
      observationFields.has(key),
    ),
  );
}
function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const entries = result.get(id) ?? [];
    entries.push(item);
    result.set(id, entries);
  }
  return result;
}
export function compareAssertions(
  before: Execution | undefined,
  after: Execution | undefined,
): AssertionDelta[] {
  const key = (a: Assertion) => canonical([a.groupPath, a.description]);
  const left = group(assertions(before), key),
    right = group(assertions(after), key);
  return [
    ...new Set([...right.keys(), ...left.keys()]),
  ].flatMap<AssertionDelta>((id) => {
    const previous = left.get(id) ?? [],
      current = right.get(id) ?? [];
    if (previous.length > 1 || current.length > 1) {
      return [
        ...current.map((a, i) => ({
          key: `${id}:current:${i}`,
          after: a,
          changes: ["ambiguous"] as Change[],
        })),
        ...previous.map((a, i) => ({
          key: `${id}:baseline:${i}`,
          before: a,
          changes: ["ambiguous"] as Change[],
        })),
      ];
    }
    const a = previous[0],
      b = current[0],
      changes: Change[] = [];
    if (!a && b) changes.push("added");
    if (a && !b)
      changes.push(after?.status === "passed" ? "absent" : "unobserved");
    if (a && b) {
      if (a.operation._tag !== b.operation._tag) changes.push("operation");
      else if (canonical(expectation(a)) !== canonical(expectation(b)))
        changes.push("expectation");
      if (a.outcome._tag === "Passed" && b.outcome._tag === "Failed")
        changes.push("regressed");
      if (a.outcome._tag === "Failed" && b.outcome._tag === "Passed")
        changes.push("recovered");
    }
    return [{ key: id, before: a, after: b, changes }];
  });
}

export function compareRuns(before: Run | undefined, after: Run): Comparison {
  if (before && before.target !== after.target)
    return {
      tests: after.tests.map((test) => ({
        key: test.id,
        name: test.name,
        after: test,
        changes: [],
        assertions: assertions(latest(test)).map((a) => ({
          key: a.id,
          after: a,
          changes: [],
        })),
      })),
      comparable: false,
      warning:
        "These runs used different execution targets. Select a baseline with the same target to compare results.",
    };
  const left = group(before?.tests ?? [], (t) => t.name),
    right = group(after.tests, (t) => t.name);
  const tests = [
    ...new Set([...right.keys(), ...left.keys()]),
  ].flatMap<TestDelta>((name) => {
    const previous = left.get(name) ?? [],
      current = right.get(name) ?? [];
    if (previous.length > 1 || current.length > 1)
      return [
        ...current.map((t) => ({
          key: `current:${t.id}`,
          name,
          after: t,
          changes: ["ambiguous"] as Change[],
          assertions: assertions(latest(t)).map((a) => ({
            key: a.id,
            after: a,
            changes: [],
          })),
        })),
        ...previous.map((t) => ({
          key: `baseline:${t.id}`,
          name,
          before: t,
          changes: ["ambiguous"] as Change[],
          assertions: assertions(latest(t)).map((a) => ({
            key: a.id,
            before: a,
            changes: [],
          })),
        })),
      ];
    const a = previous[0],
      b = current[0],
      changes: Change[] = [];
    const oldExecution = latest(a),
      newExecution = latest(b);
    if (before) {
      if (!a && b) changes.push("added");
      if (a && !b) changes.push("absent");
      if (
        a &&
        b &&
        oldExecution?.status === "passed" &&
        newExecution?.status === "failed"
      )
        changes.push("regressed");
      if (
        a &&
        b &&
        oldExecution?.status === "failed" &&
        newExecution?.status === "passed"
      )
        changes.push("recovered");
      if (
        a &&
        b &&
        oldExecution?.status === "passed" &&
        newExecution?.status !== "passed" &&
        newExecution?.status !== "failed"
      )
        changes.push("unobserved");
    }
    const deltas = before
      ? compareAssertions(oldExecution, newExecution)
      : assertions(newExecution).map((a) => ({
          key: a.id,
          after: a,
          changes: [],
        }));
    for (const delta of deltas)
      for (const change of delta.changes)
        if (!changes.includes(change)) changes.push(change);
    return [
      { key: name, name, before: a, after: b, changes, assertions: deltas },
    ];
  });
  return { tests, comparable: true };
}

export const labels: Record<Change, string> = {
  regressed: "New failure",
  recovered: "Recovered",
  expectation: "Expected data changed",
  operation: "Assertion operation changed",
  added: "First observed",
  unobserved: "Not reached",
  absent: "Not recorded",
  ambiguous: "Ambiguous match",
};
export function needsReview(test: TestDelta): boolean {
  const execution = latest(test.after);
  return (
    test.changes.length > 0 ||
    execution?.status !== "passed" ||
    assertions(execution).some(
      (assertion) => assertion.outcome._tag === "Failed",
    ) ||
    (test.after?.executions.length ?? 0) > 1
  );
}
export function summarize(run: Run) {
  const executions = run.tests.map(latest);
  return {
    total: run.tests.length,
    passed: executions.filter((e) => e?.status === "passed").length,
    failed: executions.filter((e) => e?.status === "failed").length,
    incomplete: executions.filter(
      (e) => e?.status !== "passed" && e?.status !== "failed",
    ).length,
    assertions: executions.reduce((n, e) => n + assertions(e).length, 0),
    retried: run.tests.filter((t) => t.executions.length > 1).length,
  };
}
