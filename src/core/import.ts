import { parseEvidence } from "./evidence.ts";
import type { Bundle } from "./evidence.ts";

export function mergeBundles(bundles: Bundle[]): Bundle {
  const runs = new Map<string, Bundle["runs"][number]>();
  const bodies = new Map<string, Bundle["artifacts"]>();
  const warnings = new Set<string>();
  for (const bundle of bundles) {
    const artifacts = new Map<string, Bundle["artifacts"]>();
    for (const body of bundle.artifacts) {
      const group = artifacts.get(body.runId) ?? [];
      group.push(body);
      artifacts.set(body.runId, group);
    }
    // A newer import replaces the whole snapshot, including its artifact bodies.
    for (const entry of bundle.runs) {
      runs.set(entry.run.id, entry);
      bodies.set(entry.run.id, artifacts.get(entry.run.id) ?? []);
    }
    for (const warning of bundle.warnings) warnings.add(warning);
  }
  return parseEvidence(
    JSON.stringify({
      format: "runview",
      version: 1,
      exportedAt: new Date().toISOString(),
      runs: [...runs.values()].sort(
        (a, b) => Date.parse(b.run.startedAt) - Date.parse(a.run.startedAt),
      ),
      artifacts: [...bodies.values()].flat(),
      warnings: [...warnings],
    }),
  );
}
