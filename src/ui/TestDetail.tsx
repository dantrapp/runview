import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Clock3 } from "lucide-react";
import { artifacts, assertions, latest } from "../core/evidence.ts";
import type { ArtifactIndex } from "../core/artifacts.ts";
import { expectation, observation } from "../core/compare.ts";
import type { AssertionDelta, TestDelta } from "../core/compare.ts";
import { attemptAssertions } from "./review.ts";
import { ArtifactEvidence, TraceEvidence } from "./Evidence.tsx";
import { Changes, duration, Status, Value } from "./shared.tsx";

function AssertionRow({ delta }: { delta: AssertionDelta }) {
  const assertion = delta.after ?? delta.before;
  const failure =
    delta.after?.outcome._tag === "Failed"
      ? delta.after.outcome.error
      : undefined;
  const [open, setOpen] = useState(
    Boolean(
      failure ||
      delta.changes.includes("expectation") ||
      delta.changes.includes("operation"),
    ),
  );
  if (!assertion) return null;
  return (
    <article className={`assertion ${failure ? "has-failure" : ""}`}>
      <button
        className="assertion-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={open ? "rotated" : ""}
          size={16}
          aria-hidden="true"
        />
        <span className="assertion-number">
          {String(assertion.sequence + 1).padStart(2, "0")}
        </span>
        <span className="grow">
          {assertion.groupPath.length > 0 && (
            <small>{assertion.groupPath.join(" / ")}</small>
          )}
          <strong>{assertion.description}</strong>
          <Changes changes={delta.changes} />
        </span>
        <Status
          status={
            delta.after
              ? delta.after.outcome._tag === "Passed"
                ? "passed"
                : "failed"
              : undefined
          }
        />
      </button>
      {open && (
        <div className="assertion-body">
          <div className="assertion-meta">
            <code>{assertion.operation._tag}</code>
            <span>
              <Clock3 size={12} aria-hidden="true" />{" "}
              {duration(assertion.durationMs)}
            </span>
          </div>
          {delta.before &&
          delta.after &&
          (delta.changes.includes("expectation") ||
            delta.changes.includes("operation")) ? (
            <>
              <div className="value-grid comparison-values">
                <section>
                  <h4>Before · expected</h4>
                  <Value value={expectation(delta.before)} />
                </section>
                <section>
                  <h4>Current · expected</h4>
                  <Value value={expectation(delta.after)} />
                </section>
              </div>
              <details className="previous">
                <summary>Recorded results</summary>
                <div className="value-grid">
                  <section>
                    <h4>Before · actual</h4>
                    <Value value={observation(delta.before)} />
                  </section>
                  <section>
                    <h4>Current · actual</h4>
                    <Value value={observation(delta.after)} />
                  </section>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="value-grid">
                <section>
                  <h4>
                    {delta.after ? "Current · expected" : "Before · expected"}
                  </h4>
                  <Value value={expectation(assertion)} />
                </section>
                <section>
                  <h4>
                    {delta.after ? "Current · actual" : "Before · actual"}
                  </h4>
                  <Value value={observation(assertion)} />
                </section>
              </div>
              {delta.before && delta.after && (
                <details className="previous">
                  <summary>
                    Before <ArrowRight size={12} aria-hidden="true" />
                  </summary>
                  <div className="value-grid">
                    <section>
                      <h4>Expected</h4>
                      <Value value={expectation(delta.before)} />
                    </section>
                    <section>
                      <h4>Actual</h4>
                      <Value value={observation(delta.before)} />
                    </section>
                  </div>
                </details>
              )}
            </>
          )}
          {delta.changes.includes("expectation") && (
            <p className="muted">
              Expected values changed. Generated IDs and timestamps can differ
              between runs without a change to the test.
            </p>
          )}
          {delta.changes.includes("operation") && (
            <p className="muted">
              Check changed: <code>{delta.before?.operation._tag}</code> →{" "}
              <code>{delta.after?.operation._tag}</code>.
            </p>
          )}
          {failure && (
            <div className="failure">
              <strong>{failure.name}</strong>
              <p>{failure.message}</p>
              <details>
                <summary>Stack trace</summary>
                <pre>{failure.stack}</pre>
              </details>
            </div>
          )}
          {!delta.after && (
            <p className="muted">
              No matching assertion was recorded in the selected execution. Its
              baseline result is not evidence that it passed here.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export function TestDetail({
  test,
  artifactBodies,
  comparisonEnabled = false,
}: {
  test: TestDelta;
  artifactBodies: ArtifactIndex;
  comparisonEnabled?: boolean;
}) {
  const newest = latest(test.after);
  const [attempt, setAttempt] = useState(newest?.id);
  const execution =
    test.after?.executions.find((e) => e.id === attempt) ?? newest;
  const previousAttempt = execution?.id !== newest?.id;
  const deltas = useMemo((): AssertionDelta[] => {
    if (!previousAttempt) return test.assertions;
    return attemptAssertions(test.before, execution, comparisonEnabled);
  }, [previousAttempt, comparisonEnabled, test, execution]);
  const [showAllAssertions, setShowAllAssertions] = useState(false);
  const flagged = useMemo(
    () =>
      deltas.filter(
        (delta) =>
          delta.changes.length > 0 || delta.after?.outcome._tag === "Failed",
      ),
    [deltas],
  );
  const visible = showAllAssertions || flagged.length === 0 ? deltas : flagged;
  const refs = artifacts(execution);
  return (
    <section className="test-detail" aria-label="Test evidence">
      <header className="detail-header">
        <h2>{test.name}</h2>
        <div className="detail-meta">
          <Status status={execution?.status} />
          <Changes changes={previousAttempt ? [] : test.changes} />
          {execution && "durationMs" in execution && (
            <span className="muted">{duration(execution.durationMs)}</span>
          )}
        </div>
        {(test.after?.executions.length ?? 0) > 1 && (
          <label className="attempt-label">
            Attempt
            <select
              value={execution?.id}
              onChange={(event) => {
                setAttempt(event.target.value);
                setShowAllAssertions(false);
              }}
            >
              {test.after?.executions
                .toSorted((a, b) => b.attempt - a.attempt)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.attempt + 1} · {e.status}
                    {e.id === newest?.id ? " · latest" : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        {previousAttempt && (
          <p className="notice">
            Viewing an earlier attempt. The run summary uses the latest attempt.
          </p>
        )}
        {execution?.status === "passed" &&
          assertions(execution).some((a) => a.outcome._tag === "Failed") && (
            <p className="notice">
              The runner reports a pass, but this attempt contains failed
              assertion records. Inspect the assertion outcomes before accepting
              the result.
            </p>
          )}
      </header>
      <div className="detail-content">
        <div className="section-label">
          <h3>Assertions</h3>
          {flagged.length > 0 && flagged.length < deltas.length ? (
            <div className="filters" aria-label="Assertion filter">
              <button
                aria-pressed={!showAllAssertions}
                onClick={() => setShowAllAssertions(false)}
              >
                To review <span>{flagged.length}</span>
              </button>
              <button
                aria-pressed={showAllAssertions}
                onClick={() => setShowAllAssertions(true)}
              >
                All <span>{deltas.length}</span>
              </button>
            </div>
          ) : (
            <span>{deltas.length} recorded or compared</span>
          )}
        </div>
        {deltas.length === 0 ? (
          <div className="empty compact">
            No assertion evidence in this execution.
          </div>
        ) : (
          visible.map((delta) => (
            <AssertionRow key={`${execution?.id}:${delta.key}`} delta={delta} />
          ))
        )}
        {refs.length > 0 && (
          <details className="supporting-evidence">
            <summary>
              Saved files <span>{refs.length}</span>
            </summary>
            {refs.map((ref) => (
              <ArtifactEvidence
                key={ref.id}
                reference={ref}
                body={artifactBodies.get(ref.runId)?.get(ref.id)}
              />
            ))}
          </details>
        )}
        {execution &&
          "trace" in execution &&
          execution.trace._tag === "Completed" && (
            <TraceEvidence trace={execution.trace} />
          )}
      </div>
    </section>
  );
}
