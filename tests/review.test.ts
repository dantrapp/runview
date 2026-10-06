import { expect, it } from "vitest";
import { compareRuns, needsReview } from "../src/core/compare.ts";
import { demo } from "../src/core/demo.ts";
import { attemptAssertions, reviewItems } from "../src/ui/review.ts";
import { fail, finished, fixture } from "./fixtures.ts";

it("puts failures ahead of changed expected data and unchanged passes", () => {
  const before = demo.runs[1]!.run;
  const current = demo.runs[0]!.run;
  const items = reviewItems(compareRuns(before, current).tests.toReversed());
  expect(items[0]!.test.name).toBe("Workspace rename persists");
  expect(
    items.findIndex(
      (item) => item.test.name === "Anonymous requests are rejected",
    ),
  ).toBeLessThan(
    items.findIndex((item) => item.test.name === "Archiving is idempotent"),
  );
  for (const item of items) expect(item.review).toBe(needsReview(item.test));
});

it("keeps failed assertions in a reported pass ahead of other review items", () => {
  const run = fixture();
  fail(run);
  finished(run).status = "passed";
  const test = compareRuns(undefined, run).tests[0]!;
  const items = reviewItems([
    {
      ...test,
      key: "changed",
      name: "Changed expectation",
      changes: ["expectation"],
      assertions: [],
    },
    test,
  ]);
  expect(items[0]).toMatchObject({
    test: { key: test.key },
    status: "passed",
    failedAssertion: true,
    review: true,
  });
});

it("retains retry, missing, and ambiguous results without inventing changes", () => {
  const run = fixture();
  run.tests[0]!.executions.push({
    _tag: "Pending",
    id: "previous",
    attempt: 0,
    status: "pending",
  });
  finished(run).attempt = 1;
  const retry = compareRuns(undefined, run).tests[0]!;
  const missing = {
    ...retry,
    key: "missing",
    after: undefined,
    changes: ["absent" as const],
  };
  const ambiguous = {
    ...retry,
    key: "ambiguous",
    changes: ["ambiguous" as const],
  };
  for (const item of reviewItems([retry, missing, ambiguous])) {
    expect(item.review).toBe(needsReview(item.test));
  }
  expect(reviewItems([retry])[0]).toMatchObject({
    retried: true,
    review: true,
  });
  const clean = reviewItems(compareRuns(undefined, fixture()).tests)[0]!;
  expect(clean.review).toBe(false);
  expect(clean.test.changes).toEqual([]);
});

it("does not invent comparison changes for earlier attempts without a compatible baseline", () => {
  const before = fixture(),
    after = fixture("next");
  fail(after);
  const execution = finished(after);
  execution.assertions[0]!.operation = {
    _tag: "OneOf",
    expected: [200, 500],
    actual: 200,
  };
  const unpaired = attemptAssertions(before.tests[0], execution, false);
  expect(unpaired.every((delta) => delta.changes.length === 0)).toBe(true);
  expect(unpaired[0]!.after!.outcome._tag).toBe("Failed");
  expect(
    attemptAssertions(before.tests[0], execution, true)[0]!.changes,
  ).toContain("operation");
});
