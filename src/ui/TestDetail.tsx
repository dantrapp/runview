import { useState } from "react";
import { ArrowRight, ChevronRight, Clock3 } from "lucide-react";
import { artifacts, assertions, latest } from "../core/evidence.ts";
import type { Bundle } from "../core/evidence.ts";
import {
  compareAssertions,
  expectation,
  observation,
} from "../core/compare.ts";
import type { AssertionDelta, TestDelta } from "../core/compare.ts";
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
          <div className="value-grid">
            <section>
              <h4>
                {delta.after ? "Current expectation" : "Baseline expectation"}
              </h4>
              <Value value={expectation(assertion)} />
            </section>
            <section>
              <h4>
                {delta.after ? "Current observation" : "Baseline observation"}
              </h4>
              <Value value={observation(assertion)} />
            </section>
          </div>
          {delta.changes.includes("expectation") && (
            <p className="muted">
              Expected operands differ. Generated IDs, timestamps, and fixture
              values can change between healthy runs; this alone does not
              establish a changed test rule.
            </p>
          )}
          {delta.changes.includes("operation") && (
            <p className="muted">
              Recorded operation: <code>{delta.before?.operation._tag}</code> →{" "}
              <code>{delta.after?.operation._tag}</code>. Compare both
              expectations before accepting the result.
            </p>
          )}
          {delta.before && delta.after && (
            <details className="previous">
              <summary>
                Baseline values <ArrowRight size={12} aria-hidden="true" />
              </summary>
              <div className="value-grid">
                <Value value={expectation(delta.before)} />
                <Value value={observation(delta.before)} />
              </div>
            </details>
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
  bundle,
}: {
  test: TestDelta;
  bundle: Bundle;
}) {
  const newest = latest(test.after);
  const [attempt, setAttempt] = useState(newest?.id);
  const execution =
    test.after?.executions.find((e) => e.id === attempt) ?? newest;
  const previousAttempt = execution?.id !== newest?.id;
  const deltas = previousAttempt
    ? compareAssertions(latest(test.before), execution)
    : test.assertions;
  const refs = artifacts(execution);
  return (
    <section className="test-detail" aria-label="Test evidence">
      <header className="detail-header">
        <div className="eyebrow">TEST EVIDENCE</div>
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
              onChange={(event) => setAttempt(event.target.value)}
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
          <span>{deltas.length} recorded or compared</span>
        </div>
        {deltas.length === 0 ? (
          <div className="empty compact">
            No assertion evidence in this execution.
          </div>
        ) : (
          deltas.map((delta) => (
            <AssertionRow key={`${execution?.id}:${delta.key}`} delta={delta} />
          ))
        )}
        <div className="section-label lower">
          <h3>Artifacts</h3>
          <span>{refs.length} references</span>
        </div>
        {refs.length > 0 ? (
          refs.map((ref) => (
            <ArtifactEvidence
              key={ref.id}
              reference={ref}
              body={bundle.artifacts.find(
                (body) =>
                  body.runId === ref.runId && body.artifactId === ref.id,
              )}
            />
          ))
        ) : (
          <p className="muted">No artifacts recorded.</p>
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
