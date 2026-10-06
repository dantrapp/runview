import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FlaskConical,
  FolderInput,
  Layers3,
  Search,
  X,
} from "lucide-react";
import { demo } from "../core/demo.ts";
import upstreamProbeData from "../../examples/overseer-probe.json";
import { mergeBundles } from "../core/import.ts";
import { MAX_IMPORT_BYTES, parseEvidence } from "../core/evidence.ts";
import type { Bundle } from "../core/evidence.ts";
import { compareRuns, summarize } from "../core/compare.ts";
import { indexArtifacts } from "../core/artifacts.ts";
import { reviewItems } from "./review.ts";
import { SourceEvidence } from "./Evidence.tsx";
import { TestDetail } from "./TestDetail.tsx";
import { Changes, download, duration, Status, time } from "./shared.tsx";

const upstreamProbe = parseEvidence(JSON.stringify(upstreamProbeData));

export function App() {
  const [bundle, setBundle] = useState<Bundle>(demo);
  const [origin, setOrigin] = useState<"sample" | "probe" | "imported">(
    "sample",
  );
  const sample = origin !== "imported";
  const [currentId, setCurrentId] = useState(demo.runs[0]?.run.id);
  const [baselineId, setBaselineId] = useState(demo.runs[1]?.run.id ?? "");
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<"all" | "review">("review");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.toLowerCase());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current =
    bundle.runs.find((entry) => entry.run.id === currentId) ?? bundle.runs[0]!;
  const baseline = bundle.runs.find(
    (entry) => entry.run.id === baselineId && entry !== current,
  );
  const comparison = useMemo(
    () => compareRuns(baseline?.run, current.run),
    [baseline, current],
  );
  const summary = useMemo(() => summarize(current.run), [current]);
  const items = useMemo(() => reviewItems(comparison.tests), [comparison]);
  const toReview = useMemo(() => items.filter((item) => item.review), [items]);
  const filtered = useMemo(
    () =>
      (filter === "review" ? toReview : items).filter(({ test }) =>
        test.name.toLowerCase().includes(search),
      ),
    [filter, toReview, items, search],
  );
  const active =
    filtered.find(({ test }) => test.key === selected)?.test ??
    filtered[0]?.test;
  const artifactBodies = useMemo(
    () => indexArtifacts(bundle.artifacts),
    [bundle.artifacts],
  );

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    setError("");
    try {
      if (
        Array.from(files).reduce((bytes, file) => bytes + file.size, 0) >
        MAX_IMPORT_BYTES
      )
        throw new Error("Select at most 32 MiB of evidence at a time.");
      const incoming = await Promise.all(
        Array.from(files, async (file) => parseEvidence(await file.text())),
      );
      const checked = mergeBundles([...(sample ? [] : [bundle]), ...incoming]);
      setBundle(checked);
      setOrigin("imported");
      setCurrentId(checked.runs[0]?.run.id);
      setBaselineId(checked.runs[1]?.run.id ?? "");
      setSelected("");
      setQuery("");
      setFilter("review");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import evidence.",
      );
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  }
  function loadExample(kind: "sample" | "probe") {
    const data = kind === "sample" ? demo : upstreamProbe;
    setBundle(data);
    setOrigin(kind);
    setCurrentId(data.runs[0]?.run.id);
    setBaselineId(data.runs[1]?.run.id ?? "");
    setSelected("");
    setError("");
    setQuery("");
    setFilter("review");
  }
  function exportReport() {
    download(
      "runview-comparison.json",
      new Blob(
        [
          JSON.stringify(
            {
              format: "runview-comparison",
              version: 1,
              sample,
              evidenceOrigin: origin,
              exportedAt: new Date().toISOString(),
              baseline: baseline ?? null,
              current,
              comparison,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
  }

  return (
    <div className="app">
      <main id="main">
        <header className="topbar">
          <a href="#main" className="brand">
            <Layers3 size={21} aria-hidden="true" /> runview
          </a>
          <div className="header-actions">
            {!sample && (
              <button onClick={() => loadExample("sample")}>
                Clear imports
              </button>
            )}
            <button onClick={exportReport}>
              <ArrowDownToLine size={15} aria-hidden="true" /> Export review
            </button>
            <button
              className="import-button"
              disabled={loading}
              onClick={() => input.current?.click()}
            >
              <FolderInput size={16} aria-hidden="true" />
              {loading ? "Reading files…" : "Import evidence"}
            </button>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept=".json,application/json"
            className="file-input"
            aria-label="Import evidence files"
            onChange={(event) => void importFiles(event.target.files)}
          />
        </header>
        {sample && (
          <div className="sample-banner">
            <FlaskConical size={16} aria-hidden="true" />
            <strong>
              {origin === "probe"
                ? "Upstream integration probe"
                : "Sample evidence"}
            </strong>
            <span>
              {origin === "probe"
                ? "Recorded with Overseer’s code and controlled inputs. No deployed API or exported traces."
                : "Synthetic runs include a failure, changed expected data, and a skipped test."}
            </span>
            <button
              onClick={() =>
                loadExample(origin === "probe" ? "sample" : "probe")
              }
            >
              {origin === "probe" ? "Load sample" : "Load upstream probe"}
            </button>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={14} />
            </button>
          </div>
        )}
        <section className="overview">
          <div className="overview-title">
            <h1>
              Compare <span>test runs</span>
            </h1>
            <Status status={current.run.status} />
          </div>
          <div className="selectors">
            <label>
              Before
              <select
                value={baseline?.run.id ?? ""}
                onChange={(event) => {
                  setBaselineId(event.target.value);
                  setSelected("");
                }}
              >
                <option value="">No comparison</option>
                {bundle.runs
                  .filter((entry) => entry !== current)
                  .map(({ run }) => (
                    <option key={run.id} value={run.id}>
                      {run.stage} · {time(run.startedAt)} · {run.target}
                    </option>
                  ))}
              </select>
            </label>
            <ArrowRight size={18} aria-hidden="true" />
            <label>
              Current run
              <select
                value={current.run.id}
                onChange={(event) => {
                  setCurrentId(event.target.value);
                  setSelected("");
                }}
              >
                {bundle.runs.map(({ run }) => (
                  <option key={run.id} value={run.id}>
                    {run.stage} · {time(run.startedAt)} · {run.target}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="run-summary" aria-label="Current run results">
            <span>
              <strong>{summary.total}</strong> tests
            </span>
            <span className="green">
              <strong>{summary.passed}</strong> passed
            </span>
            <span className={summary.failed ? "red" : ""}>
              <strong>{summary.failed}</strong> failed
            </span>
            <span>
              <strong>{summary.incomplete}</strong> incomplete / skipped
            </span>
            <details className="run-details">
              <summary>Run details</summary>
              <dl>
                <dt>Run ID</dt>
                <dd>
                  <code>{current.run.id}</code>
                </dd>
                <dt>Target</dt>
                <dd>{current.run.target}</dd>
                <dt>Duration</dt>
                <dd>
                  {current.run.timing._tag === "Finished"
                    ? duration(current.run.timing.durationMs)
                    : "In progress"}
                </dd>
                <dt>Assertions</dt>
                <dd>{summary.assertions}</dd>
              </dl>
              <SourceEvidence entry={current} />
            </details>
          </div>
        </section>
        {comparison.warning && <p className="notice">{comparison.warning}</p>}
        {baseline && baseline.run.stage !== current.run.stage && (
          <p className="comparison-note">
            Stages differ: <code>{baseline.run.stage}</code> →{" "}
            <code>{current.run.stage}</code>. Confirm these environments are
            comparable.
          </p>
        )}
        {bundle.warnings.length > 0 && (
          <details className="notice">
            <summary>{bundle.warnings.length} export warnings</summary>
            <ul>
              {bundle.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="workbench" id="tests">
          <section className="test-list" aria-label="Tests">
            <div className="list-toolbar">
              <div className="filters">
                <button
                  aria-pressed={filter === "review"}
                  onClick={() => setFilter("review")}
                >
                  To review <span>{toReview.length}</span>
                </button>
                <button
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                >
                  All tests <span>{items.length}</span>
                </button>
              </div>
              <label className="search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search tests"
                  placeholder="Find a test…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            <div className="test-rows">
              {filtered.map(({ test, status, failedAssertion, retried }) => (
                <button
                  key={test.key}
                  aria-pressed={active?.key === test.key}
                  className={`test-row ${active?.key === test.key ? "active" : ""}`}
                  onClick={() => setSelected(test.key)}
                >
                  <Status status={status} />
                  <strong>{test.name}</strong>
                  <span className="changes">
                    <Changes changes={test.changes} />
                    {failedAssertion && status === "passed" && (
                      <span className="change regressed">Failed assertion</span>
                    )}
                    {retried && (
                      <span className="change expectation">Retried</span>
                    )}
                  </span>
                  <small>{test.assertions.length} assertions</small>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="empty">
                  {search
                    ? "No matching tests."
                    : filter === "review"
                      ? "No tests need review."
                      : "No tests recorded."}
                  {filter === "review" && !search && (
                    <button onClick={() => setFilter("all")}>
                      Show all tests
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
          {active ? (
            <TestDetail
              key={`${current.run.id}:${baseline?.run.id}:${active.key}`}
              test={active}
              artifactBodies={artifactBodies}
              comparisonEnabled={Boolean(baseline && comparison.comparable)}
            />
          ) : (
            <div className="empty grow">
              Choose a test from the list to see its results.
            </div>
          )}
        </div>
        <footer>
          <span>
            Files stay on this device. Reload to clear imported evidence.
          </span>
          <span>Latest attempts shown. Earlier attempts remain available.</span>
        </footer>
      </main>
    </div>
  );
}
