import { expect, it } from "vitest";
import { mergeBundles } from "../src/core/import.ts";
import { parseEvidence } from "../src/core/evidence.ts";
import { fixture } from "./fixtures.ts";

it("combines separate exports and replaces repeated run snapshots without duplicating tests", () => {
  const first = parseEvidence(JSON.stringify(fixture("older"))),
    second = parseEvidence(JSON.stringify(fixture("newer")));
  second.runs[0]!.run.startedAt = "2026-10-07T10:00:00.000Z";
  first.warnings = ["A body was omitted"];
  second.warnings = ["A body was omitted"];
  const replacement = structuredClone(first);
  replacement.runs[0]!.run.stage = "updated";
  const merged = mergeBundles([first, second, replacement]);
  expect(merged.runs.map((entry) => entry.run.id)).toEqual(["newer", "older"]);
  expect(merged.runs[1]!.run.stage).toBe("updated");
  expect(merged.warnings).toHaveLength(1);
});
it("rejects an aggregate above the run limit even when each import is individually valid", () => {
  const bundles = Array.from({ length: 101 }, (_, i) =>
    parseEvidence(JSON.stringify(fixture(`run-${i}`))),
  );
  expect(() => mergeBundles(bundles)).toThrow("Unsupported evidence");
});
