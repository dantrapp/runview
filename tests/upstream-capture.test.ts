import { expect, it } from "vitest";
import capture from "../examples/overseer-probe.json";
import {
  artifacts,
  assertions,
  latest,
  parseEvidence,
} from "../src/core/evidence.ts";
import { decodeArtifact } from "../src/core/artifacts.ts";
import { compareRuns } from "../src/core/compare.ts";

it("retains the upstream-produced capture and verifies its embedded artifacts", async () => {
  const bundle = parseEvidence(JSON.stringify(capture));
  expect(
    bundle.runs.flatMap((entry) =>
      entry.run.tests.flatMap((test) => assertions(latest(test))),
    ),
  ).toHaveLength(19);
  const result = compareRuns(bundle.runs[1]!.run, bundle.runs[0]!.run);
  expect(result.tests.map((test) => test.changes)).toEqual([
    ["operation"],
    ["regressed", "unobserved"],
    ["expectation"],
    [],
  ]);
  for (const entry of bundle.runs)
    for (const test of entry.run.tests)
      for (const ref of artifacts(latest(test))) {
        const body = bundle.artifacts.find(
          (body) => body.runId === ref.runId && body.artifactId === ref.id,
        );
        expect(body).toBeDefined();
        expect(
          JSON.parse(
            new TextDecoder().decode(await decodeArtifact(ref, body!)),
          ),
        ).toHaveProperty("controlledProbe", true);
      }
  expect(JSON.stringify(capture)).not.toContain("/Users/");
});
