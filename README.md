# Runview

Inspect and compare [Overseer](https://github.com/dmmulroy/overseer) test evidence locally. Review assertions, changed assertion operations and expected data, retry attempts, artifact contents, and trace references across runs.

Runview reads existing evidence. It does not run assertions again, generate verdicts with a model, or upload imported files. No API key is required.

## Start

Node.js 24 or later and Git are required. Node's built-in SQLite API may print an experimental warning.

```sh
npm ci
npm run build
node dist-cli/index.js serve
```

Open `http://127.0.0.1:4318`. The initial screen contains **synthetic sample evidence**, including a failed read, a changed expectation in a passing test, and a skipped test. Importing a file replaces the samples. Select **Load upstream probe** to inspect records produced by Overseer’s actual evidence modules with controlled inputs. Further imports add runs; importing the same run ID replaces its snapshot and artifact bodies. Reloading the page clears all imported evidence.

For development, use `npm run dev`.

## Import Overseer evidence

Export the directory configured by Overseer's `OVERSEER_EVIDENCE_DIRECTORY`:

```sh
node dist-cli/index.js export \
  --directory /path/to/evidence \
  --out review.runview.json \
  --artifacts
```

Select **Import evidence** in the workbench and choose the exported file. Raw serialized Overseer run JSON is also accepted. Multiple files can be imported together.

The exporter opens `test-runs.sqlite` read-only. It reads the latest 20 runs by default; `--limit` accepts 1–100. Artifact bodies are omitted unless `--artifacts` is set. Included bodies are resolved from `blobs/<sha256>` and checked against their declared size and SHA-256. Database `content_path` values are never followed. Referenced artifacts without a matching storage row produce an explicit warning. At the validated upstream revision, reused execution IDs can replace earlier runs’ artifact records; [the integration check reproduces this](docs/overseer-integration.md#historical-artifact-availability). Export each run immediately with `--artifacts --limit 1` to retain its current bodies. Missing, corrupt, oversized, or externally linked blobs produce export warnings.

Limits are 32 MiB per imported collection, 4 MiB per exported artifact, and 100 runs. Output files are created with owner-only permissions and existing output paths are refused. Evidence can contain application data, logs, and secrets; exported JSON retains those contents.

## Record a local source observation

Run this command from the Git checkout containing the tests. Use the absolute path to Runview's built CLI:

```sh
node /path/to/runview/dist-cli/index.js record \
  --directory /path/to/evidence \
  --out review.runview.json \
  --artifacts \
  -- your-test-command --your-test-flag
```

`record` observes the commit, working-tree content digest, and dirty state before and after the command. After a successful export, it preserves the command's exit code. Source observations are attached only to completed evidence whose timestamps fall inside that command window. Other runs remain unbound.

These are local observations, not execution attestations. They do not identify the source of a deployed service, prove that a particular process produced a run, exclude transient edits between observations, or prevent another test process from writing evidence during the same window. Use a dedicated evidence directory and one test process per recording.

The digest covers tracked and non-ignored untracked files, executable bits, deleted files, and symlink targets. Ignored files and file contents behind symlinks are excluded. Submodules and captures exceeding 1 GiB are rejected. Keep generated evidence and bundles in ignored paths so they do not appear as source changes.

## Comparison rules

| Evidence                                                  | Review behavior                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Previously passing assertion fails                        | New failure                                                                  |
| Previously failing assertion passes                       | Recovered                                                                    |
| Assertion operator changes                                | Assertion operation changed, even if the assertion passes                    |
| Expected operands change                                  | Expected data changed; generated values may vary without a changed test rule |
| Assertion missing after an incomplete or failed execution | Not reached; no deletion claim                                               |
| Assertion absent from a passed execution                  | Not recorded; no source deletion claim                                       |
| Duplicate test names or assertion identities              | Ambiguous match; records stay separate                                       |
| Multiple attempts                                         | Latest attempt in summary; earlier attempts remain inspectable               |
| Local versus deployed runs                                | Comparison disabled                                                          |
| Different stage names                                     | Comparison permitted with an environment warning                             |

Tests match by exact name. Assertions match by group path and description. Run-scoped IDs and sequence numbers are not treated as stable cross-run identities. Renamed tests appear as separate records. Missing records describe the available evidence, not the contents of the source code.

Operations retain their structured values. Runview separates recorded observations from expectations; it does not re-evaluate operations. Generated IDs and timestamps can change expected operands between healthy runs; Runview does not infer a changed test rule from that alone. Unknown operation fields remain visible and participate in expectation comparison. Tests with failed assertion records or multiple attempts remain in **To review**, even if the runner reports a pass. A “passed” label reflects the imported runner result, not an independent certification of correctness.

Text artifacts preview as escaped text. Other artifact types can be downloaded; HTML, SVG, and scripts are never executed inside a preview. Artifact bytes are checked again before preview or download. A matching digest detects corruption, not authenticity. Trace references show the provider, dataset, and trace ID; Runview does not fetch spans or claim to display a trace waterfall.

**Export review** saves the selected runs and their comparison as JSON. Review reports include assertion contents and metadata but omit artifact bodies. They are reports, not import bundles.

## Compatibility and verification

The adapter targets Overseer's SQLite schema v2 and serialized evidence contracts inspected at commit [`9810d13`](https://github.com/dmmulroy/overseer/tree/9810d13bb930144ba92a00bc99401fcb886cb8e7):

- `apps/api/test/e2e/evidence/test-run-storage-local.ts`
- `apps/api/test/e2e/evidence/test-run.ts`
- `apps/api/test/e2e/evidence/test-assertion.ts`
- `apps/api/test/e2e/evidence/test-artifact.ts`

Runview is a separate implementation. Its application does not bundle Overseer code. The optional integration check imports upstream modules from a separate checkout. The MIT license applies to Runview's code, not the upstream repository.

```sh
npm run check
npm test
npm run build
npm run test:cli
```

Tests cover comparison semantics, malformed evidence, artifact integrity and path containment, read-only export, source observations, escaped rendering, and loopback serving. The compiled CLI smoke test creates a temporary Git checkout and SQLite database, records a command, exports evidence, and checks exit-code and source-window behavior. The upstream integration check also executes Overseer’s unmodified assertion, recording, schema, lifecycle, and SQLite modules. It verifies two controlled runs with 19 assertions and 8 artifact bodies captured before subsequent writes. See [integration results and reproduction commands](docs/overseer-integration.md). The full deployed API acceptance suite was not run.

The production server binds only to `127.0.0.1`, serves the built UI, and blocks network connections from the page with Content Security Policy. The app has no persistence, analytics, model calls, or backend evidence upload endpoint.
