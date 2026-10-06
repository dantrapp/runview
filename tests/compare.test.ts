import { describe, expect, it } from "vitest";
import {
  compareRuns,
  expectation,
  needsReview,
  summarize,
} from "../src/core/compare.ts";
import { demo } from "../src/core/demo.ts";
import { latest, parseEvidence } from "../src/core/evidence.ts";
import { fail, finished, fixture } from "./fixtures.ts";

describe("evidence comparisons", () => {
  it("keeps retries and failed assertion records in review even when the latest attempt passes", () => {
    const run = fixture();
    fail(run);
    finished(run).status = "passed";
    expect(needsReview(compareRuns(undefined, run).tests[0]!)).toBe(true);
    const retry = fixture();
    retry.tests[0]!.executions.push({
      _tag: "Pending",
      id: "older-attempt",
      attempt: 0,
      status: "pending",
    });
    finished(retry).attempt = 1;
    expect(needsReview(compareRuns(undefined, retry).tests[0]!)).toBe(true);
  });
  it("does not call assertions deleted when a test stops at its first failure", () => {
    const before = fixture(),
      after = fixture("next");
    fail(after, 1);
    finished(after).assertions.splice(2);
    const test = compareRuns(before, after).tests[0]!;
    expect(test.assertions.map((a) => a.changes)).toEqual([
      [],
      ["regressed"],
      ["unobserved"],
    ]);
    expect(test.changes).not.toContain("absent");
  });
  it("distinguishes an absent assertion in a passed execution", () => {
    const before = fixture(),
      after = fixture("next");
    finished(after).assertions.pop();
    expect(compareRuns(before, after).tests[0]!.assertions[2]!.changes).toEqual(
      ["absent"],
    );
  });
  it("flags weakened or otherwise changed expectations even when both runs pass", () => {
    const before = fixture(),
      after = fixture("next");
    finished(after).assertions[0]!.operation = {
      _tag: "Equal",
      actual: 403,
      expected: 403,
    };
    expect(compareRuns(before, after).tests[0]!.assertions[0]!.changes).toEqual(
      ["expectation"],
    );
  });
  it("does not mistake a changed observation or JSON key order for a changed expectation", () => {
    const before = fixture(),
      after = fixture("next");
    finished(after).assertions[0]!.operation = {
      expected: 200,
      actual: 201,
      _tag: "Equal",
    };
    expect(compareRuns(before, after).tests[0]!.changes).toEqual([]);
  });
  it("retains unknown operation fields as expectations and strips polling observations", () => {
    const assertion = finished(fixture()).assertions[0]!;
    assertion.operation = {
      _tag: "Eventually",
      expectation: { tag: "ready" },
      timeoutMs: 1000,
      intervalMs: 50,
      elapsedMs: 70,
      attempts: 2,
      observation: "ready",
    };
    expect(expectation(assertion)).toEqual({
      _tag: "Eventually",
      expectation: { tag: "ready" },
      timeoutMs: 1000,
      intervalMs: 50,
    });
  });
  it("keeps duplicate assertion labels separate instead of pairing by array order", () => {
    const before = fixture(),
      after = fixture("next");
    finished(after).assertions[1]!.description =
      finished(after).assertions[0]!.description;
    const deltas = compareRuns(before, after).tests[0]!.assertions;
    expect(deltas.filter((d) => d.changes.includes("ambiguous"))).toHaveLength(
      3,
    );
    expect(
      deltas.every(
        (d) => !(d.before && d.after) || !d.changes.includes("ambiguous"),
      ),
    ).toBe(true);
  });
  it("keeps duplicate test names separate", () => {
    const before = fixture(),
      after = fixture("next");
    after.tests.push({ ...structuredClone(after.tests[0]!), id: "duplicate" });
    const tests = compareRuns(before, after).tests;
    expect(tests).toHaveLength(3);
    expect(tests.every((t) => t.changes.includes("ambiguous"))).toBe(true);
  });
  it("selects the greatest attempt, not whichever is last in storage", () => {
    const run = fixture(),
      retry = structuredClone(finished(run));
    retry.attempt = 2;
    retry.id = "retry";
    retry.status = "failed";
    run.tests[0]!.executions.unshift(retry);
    expect(latest(run.tests[0])?.id).toBe("retry");
    expect(summarize(run)).toMatchObject({ failed: 1, passed: 0, retried: 1 });
  });
  it("does not turn skipped, pending, running, interrupted, or timed out runs into passes", () => {
    for (const state of [
      "skipped",
      "pending",
      "running",
      "interrupted",
      "timed_out",
    ] as const) {
      const before = fixture(),
        after = fixture("next"),
        execution = finished(after);
      after.tests[0]!.executions =
        state === "pending"
          ? [{ _tag: "Pending", id: execution.id, attempt: 0, status: state }]
          : state === "skipped"
            ? [
                {
                  _tag: "Skipped",
                  id: execution.id,
                  attempt: 0,
                  status: state,
                  finishedAt: execution.finishedAt,
                },
              ]
            : state === "running"
              ? [
                  {
                    ...execution,
                    _tag: "Running",
                    status: state,
                    assertions: [],
                  },
                ]
              : [{ ...execution, status: state, assertions: [] }];
      expect(summarize(after).incomplete).toBe(1);
      expect(compareRuns(before, after).tests[0]!.changes).toContain(
        "unobserved",
      );
    }
  });
  it("does not compare local and deployed executions", () => {
    const before = fixture(),
      after = fixture("next");
    after.target = "deployed";
    fail(after);
    const result = compareRuns(before, after);
    expect(result.comparable).toBe(false);
    expect(result.warning).toContain("different execution targets");
    expect(result.tests[0]!.changes).toEqual([]);
  });
  it("reports recovery and new tests; no-baseline inspection does not invent changes", () => {
    const before = fixture(),
      after = fixture("next");
    fail(before);
    expect(compareRuns(before, after).tests[0]!.changes).toContain("recovered");
    after.tests[0]!.name = "Another test";
    expect(compareRuns(before, after).tests.map((t) => t.changes[0])).toEqual([
      "added",
      "absent",
    ]);
    expect(compareRuns(undefined, after).tests[0]!.changes).toEqual([]);
  });
  it("keeps the synthetic demo valid and shows its three distinct review cases", () => {
    const bundle = parseEvidence(JSON.stringify(demo));
    const comparison = compareRuns(bundle.runs[1]!.run, bundle.runs[0]!.run);
    expect(comparison.tests.slice(0, 3).map((test) => test.changes)).toEqual([
      ["regressed", "unobserved"],
      ["expectation"],
      ["unobserved"],
    ]);
  });
});
