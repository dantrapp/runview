# Overseer integration

Runview reads the evidence hierarchy described in Overseer's [recording specification](https://github.com/dmmulroy/overseer/blob/9810d13bb930144ba92a00bc99401fcb886cb8e7/docs/evidence-assertion-recording-spec.md#L1170-L1172). At the inspected revision, the spec marks the viewer as [future work](https://github.com/dmmulroy/overseer/blob/9810d13bb930144ba92a00bc99401fcb886cb8e7/docs/evidence-assertion-recording-spec.md#L3) and lists it as [implementation step 13](https://github.com/dmmulroy/overseer/blob/9810d13bb930144ba92a00bc99401fcb886cb8e7/docs/evidence-assertion-recording-spec.md#L1146).

The existing runner uses Vitest for test outcomes, persists assertion operands and attachments in SQLite, and provides Axiom trace references. Runview adds local inspection and comparison of those retained records. It does not replace the test runner or Axiom, and it does not implement Overseer's complete backend-neutral CRUD interface.

## Reproduce the integration check

Use Node 24+ and pnpm 11. The validation script imports modules from a separate, unmodified upstream checkout. No upstream implementation is bundled with Runview.

```sh
git clone https://github.com/dmmulroy/overseer.git ../overseer
git -C ../overseer checkout 9810d13bb930144ba92a00bc99401fcb886cb8e7
pnpm --dir ../overseer install --frozen-lockfile --ignore-scripts
pnpm --dir ../overseer exec vp test run apps/api/test/e2e/evidence
npm run test:overseer -- ../overseer /tmp/runview-overseer-proof
```

The output directory must not already exist. The check executes upstream `TestAssert`, `TestEvidenceRecorder`, `TestEvidence`, `testExecutionEvidenceLayer`, run lifecycle functions, Effect Schema codecs, and `testRunStorageLocalLayerAt`. Assertions and artifacts are produced by these upstream implementations, then exported and decoded by Runview. The SQLite file's digest is compared before and after export.

The upstream evidence suite passed **22 tests**. The integration check produced **19 assertion records across two runs**, verified **8 artifact bodies captured in per-run exports**, and confirmed that export left the database unchanged. The compact result is saved in [overseer-result.json](./overseer-result.json).

| Controlled scenario                                                                        | Runner result                           | Runview result                                             |
| ------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------- |
| `equal(actual, 200)` becomes `oneOf(actual, [200, 500])`, with actual still 200            | Pass in both runs                       | Assertion operation changed: `Equal` → `OneOf`             |
| A separate read returns an old name after a successful write                               | Candidate fails at the second assertion | New failure; the third assertion is marked not reached     |
| Generated IDs and timestamps change while read-back equality holds                         | Pass in both runs                       | Expected data changed; no claim that the test rule changed |
| Grouped assertions, undefined, a large integer, and an eventual assertion remain unchanged | Pass in both runs                       | No comparison changes                                      |

Select **Load upstream probe** in Runview to inspect the captured result. [The bundled capture](../examples/overseer-probe.json) retains the recorded values; absolute machine paths in the failure stack have been replaced with `<overseer>` and `<runview>`. The generated `overseer-probe.runview.json` can also be imported. All scenarios are labeled **Probe**. These are controlled assertion/storage integration cases, not results from a deployed Overseer API. Required trace references are placeholders; no spans are exported. No Cloudflare or Axiom resource is created by this check.

## Expected values are not test definitions

Overseer's [Workspace lifecycle suite](https://github.com/dmmulroy/overseer/blob/9810d13bb930144ba92a00bc99401fcb886cb8e7/apps/api/test/e2e/suites/workspace-test-suite.ts#L43-L75) compares generated identifiers, complete records, and timestamps. Those expected operands legitimately vary between runs with identical test source.

Runview therefore distinguishes **Assertion operation changed** from **Expected data changed**. Neither is an automated verdict about whether a test was weakened. The reviewer can inspect the recorded operators and both sets of operands. The evidence format does not retain the expression or source location that produced an expectation, so source-level intent cannot be reconstructed from these records alone.

## Historical artifact availability

The probe also checks reuse of execution identities across runs, matching the harness's [registration-derived identity pattern](https://github.com/dmmulroy/overseer/blob/9810d13bb930144ba92a00bc99401fcb886cb8e7/apps/api/test/e2e/harness/overseer-test-harness.ts#L309-L321). Artifact IDs derive from execution identity and sequence. The local store [upserts by artifact ID](https://github.com/dmmulroy/overseer/blob/9810d13bb930144ba92a00bc99401fcb886cb8e7/apps/api/test/e2e/evidence/test-run-storage-local.ts#L347-L361), including replacing the owning run ID.

In the probe, the second run replaces four artifact rows still referenced by the first run's snapshot. A later export of both runs can retrieve only four bodies. Runview now emits four explicit missing-record warnings, preserving the earlier references without attaching the later run's bytes to them.

Exporting each run with `--artifacts --limit 1` immediately after completion retains all eight bodies in the two separate bundles. The validation check merges those captures and verifies every digest. This does not recover historical artifacts already absent from storage and does not repair upstream storage behavior.

## Validation boundary

This check establishes compatibility with the real evidence producer and demonstrates the comparison behavior above. It does not establish deployed API correctness, browser layout quality, measured review-time savings, or adoption by the Overseer maintainer. The full Overseer acceptance suite provisions Cloudflare infrastructure and performs Axiom trace acceptance; it was not run for this integration check.
