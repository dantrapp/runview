import { compareAssertions } from "../core/compare.ts";
import type { Test, Execution } from "../core/evidence.ts";
import type { TestDelta } from "../core/compare.ts";
import { latest } from "../core/evidence.ts";

export function reviewItems(tests: TestDelta[]) {
  return tests
    .map((test) => {
      const status = latest(test.after)?.status;
      const failedAssertion = test.assertions.some(
        (delta) => delta.after?.outcome._tag === "Failed",
      );
      const retried = (test.after?.executions.length ?? 0) > 1;
      const review =
        test.changes.length > 0 ||
        status !== "passed" ||
        failedAssertion ||
        retried;
      let priority = 6;
      if (status === "failed" || failedAssertion) priority = 0;
      else if (test.changes.includes("operation")) priority = 1;
      else if (status !== "passed" || test.changes.includes("ambiguous"))
        priority = 2;
      else if (test.changes.includes("expectation")) priority = 3;
      else if (retried) priority = 4;
      else if (review) priority = 5;
      return { test, status, failedAssertion, retried, review, priority };
    })
    .sort((a, b) => a.priority - b.priority);
}

export function attemptAssertions(
  before: Test | undefined,
  execution: Execution | undefined,
  comparisonEnabled: boolean,
) {
  return comparisonEnabled
    ? compareAssertions(latest(before), execution)
    : (execution && "assertions" in execution ? execution.assertions : []).map(
        (assertion) => ({
          key: assertion.id,
          after: assertion,
          changes: [],
        }),
      );
}
