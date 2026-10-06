import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FlaskConical,
  FolderInput,
  Layers3,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { demo } from "../core/demo.ts";
import upstreamProbeData from "../../examples/overseer-probe.json";
import { mergeBundles } from "../core/import.ts";
import { latest, MAX_IMPORT_BYTES, parseEvidence } from "../core/evidence.ts";
import type { Bundle } from "../core/evidence.ts";
import { compareRuns, needsReview, summarize } from "../core/compare.ts";
import { SourceEvidence } from "./Evidence.tsx";
import { TestDetail } from "./TestDetail.tsx";
import { Changes, download, duration, Status, time } from "./shared.tsx";

const upstreamProbe = parseEvidence(JSON.stringify(upstreamProbeData));

function MetricCard({
  label,
  value,
  baseline,
  description,
  tone = "",
}: {
  label: string;
  value: number;
  baseline?: number;
  description: string;
  tone?: string;
}) {
  const scale = Math.max(value, baseline ?? 0, 1);
  return (
    <section className={`metric-card ${tone}`} aria-label={label}>
      <h3>{label}</h3>
      <strong className="metric-value">{value}</strong>
      <p>{description}</p>
      <div className="metric-bars">
        {baseline !== undefined && (
          <div className="metric-bar-row">
            <span>Before</span>
            <div className="metric-track">
              <div
                className="metric-bar before"
                style={{ width: `${(baseline / scale) * 100}%` }}
              />
            </div>
            <strong>{baseline}</strong>
          </div>
        )}
        <div className="metric-bar-row">
          <span>{baseline !== undefined ? "After" : "Current"}</span>
          <div className="metric-track">
            <div
              className="metric-bar after"
              style={{ width: `${(value / scale) * 100}%` }}
            />
          </div>
          <strong>{value}</strong>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [bundle, setBundle] = useState<Bundle>(demo);
  const [origin, setOrigin] = useState<"sample" | "probe" | "imported">(
    "sample",
  );
  const sample = origin !== "imported";
  const [currentId, setCurrentId] = useState(demo.runs[0]?.run.id);
  const [baselineId, setBaselineId] = useState(demo.runs[1]?.run.id ?? "");
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<"all" | "review">("all");
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
  const baselineSummary = useMemo(
    () =>
      baseline && comparison.comparable ? summarize(baseline.run) : undefined,
    [baseline, comparison.comparable],
  );
  const reviewCount = comparison.tests.filter(needsReview).length;
  const filtered = comparison.tests.filter(
    (test) =>
      (filter === "all" || needsReview(test)) &&
      test.name.toLowerCase().includes(search),
  );
  const active = filtered.find((test) => test.key === selected) ?? filtered[0];

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
      setFilter("all");
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
    setFilter("all");
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
      <aside className="sidebar">
        <a href="#main" className="brand">
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>
          runview<span className="version">LOCAL</span>
        </a>
        <div className="sidebar-heading">
          EVIDENCE LIBRARY <span>{bundle.runs.length}</span>
        </div>
        <button
          className="import-button"
          disabled={loading}
          onClick={() => input.current?.click()}
        >
          <FolderInput size={16} aria-hidden="true" />
          {loading ? "Reading evidence…" : "Import evidence"}
          <span>+</span>
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".json,application/json"
          className="file-input"
          aria-label="Import evidence files"
          onChange={(event) => void importFiles(event.target.files)}
        />
        <nav aria-label="Runs" className="runs">
          {bundle.runs.map(({ run }) => (
            <button
              key={run.id}
              className={`run-button ${run.id === current.run.id ? "selected" : ""}`}
              aria-current={run.id === current.run.id ? "true" : undefined}
              onClick={() => {
                setCurrentId(run.id);
                setSelected("");
              }}
            >
              <span className="run-line">
                <Status status={run.status} />
                <span>{run.target}</span>
              </span>
              <strong>{run.stage}</strong>
              <small>{time(run.startedAt)}</small>
              <code>{run.id}</code>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={17} />
          <div>
            <strong>Stays on this device</strong>
            <p>
              Files are held in memory.
              <br />
              Reload to clear imported evidence.
            </p>
          </div>
        </div>
        {!sample && (
          <button
            className="clear-button"
            onClick={() => loadExample("sample")}
          >
            <X size={13} />
            Clear imports
          </button>
        )}
      </aside>
      <main id="main">
        <header className="topbar">
          <div className="breadcrumb">
            Evidence <span>/</span> Run comparison
          </div>
          <button onClick={exportReport}>
            <ArrowDownToLine size={15} aria-hidden="true" />
            Export review
          </button>
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
                ? "Recorded by Overseer’s evidence modules with controlled inputs. No API deployment or trace export."
                : "Synthetic runs demonstrate a regression, changed expected data, and skipped test."}
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
            <div>
              <div className="eyebrow">RUN COMPARISON</div>
              <h1>
                Run <span>comparison</span>
              </h1>
              <p className="subtitle">
                Compare results, then open a test to inspect its evidence.
              </p>
            </div>
            <Status status={current.run.status} />
          </div>
          <div className="selectors">
            <label>
              Baseline
              <select
                value={baseline?.run.id ?? ""}
                onChange={(event) => {
                  setBaselineId(event.target.value);
                  setSelected("");
                }}
              >
                <option value="">No baseline</option>
                {bundle.runs
                  .filter((entry) => entry !== current)
                  .map(({ run }) => (
                    <option key={run.id} value={run.id}>
                      {run.stage} · {time(run.startedAt)}
                    </option>
                  ))}
              </select>
            </label>
            <ArrowRight size={18} aria-hidden="true" />
            <div className="current-label">
              <span>Current</span>
              <strong>{current.run.stage}</strong>
              <small>
                {time(current.run.startedAt)} · {current.run.target}
              </small>
            </div>
            <div className="run-duration">
              <span>Duration</span>
              <strong>
                {current.run.timing._tag === "Finished"
                  ? duration(current.run.timing.durationMs)
                  : "In progress"}
              </strong>
            </div>
          </div>
          <div className="metrics-heading">
            <h2>At a glance</h2>
            {baselineSummary && (
              <div className="comparison-legend" aria-label="Chart legend">
                <span>
                  <i className="before" /> Before
                </span>
                <span>
                  <i className="after" /> After
                </span>
              </div>
            )}
          </div>
          <div className="metrics">
            <MetricCard
              label="Tests"
              value={summary.total}
              baseline={baselineSummary?.total}
              description="Tests recorded in each run."
            />
            <MetricCard
              label="Passed"
              value={summary.passed}
              baseline={baselineSummary?.passed}
              description="Latest attempt reported a pass."
              tone="green"
            />
            <MetricCard
              label="Failed"
              value={summary.failed}
              baseline={baselineSummary?.failed}
              description="Latest attempt reported a failure."
              tone={summary.failed ? "red" : ""}
            />
            <MetricCard
              label="Incomplete / skipped"
              value={summary.incomplete}
              baseline={baselineSummary?.incomplete}
              description="Tests without a completed pass or failure."
            />
            <MetricCard
              label="Assertions"
              value={summary.assertions}
              baseline={baselineSummary?.assertions}
              description="Recorded checks across latest attempts."
            />
            <section className="metric-card review-card" aria-label="To review">
              <h3>To review</h3>
              <strong className="metric-value">{reviewCount}</strong>
              <p>Changes, failures, retries, or incomplete results.</p>
              <a href="#tests" onClick={() => setFilter("review")}>
                Review tests <ArrowRight size={16} aria-hidden="true" />
              </a>
            </section>
          </div>
          <SourceEvidence entry={current} />
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
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                >
                  All tests <span>{comparison.tests.length}</span>
                </button>
                <button
                  aria-pressed={filter === "review"}
                  onClick={() => setFilter("review")}
                >
                  To review <span>{reviewCount}</span>
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
              {filtered.map((test) => (
                <button
                  key={test.key}
                  aria-pressed={active?.key === test.key}
                  className={`test-row ${active?.key === test.key ? "active" : ""}`}
                  onClick={() => setSelected(test.key)}
                >
                  <Status status={latest(test.after)?.status} />
                  <strong>{test.name}</strong>
                  <Changes changes={test.changes} />
                  <small>
                    {test.assertions.length} assertions
                    {(test.after?.executions.length ?? 0) > 1
                      ? ` · ${test.after?.executions.length} attempts`
                      : ""}
                  </small>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="empty">No matching tests.</div>
              )}
            </div>
          </section>
          {active ? (
            <TestDetail
              key={`${current.run.id}:${baseline?.run.id}:${active.key}`}
              test={active}
              bundle={bundle}
            />
          ) : (
            <div className="empty grow">
              Select a test to inspect its evidence.
            </div>
          )}
        </div>
        <footer>
          OVERSEER EVIDENCE{" "}
          <span>
            Matched by test name, assertion group, and description. Ambiguous
            matches are kept separate.
          </span>
        </footer>
      </main>
    </div>
  );
}
