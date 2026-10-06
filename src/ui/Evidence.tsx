import { useState } from "react";
import {
  Download,
  FileText,
  Fingerprint,
  GitCommitHorizontal,
  Link2,
} from "lucide-react";
import type { Artifact, Bundle, RunEntry } from "../core/evidence.ts";
import { decodeArtifact } from "../core/artifacts.ts";
import { download, Value } from "./shared.tsx";

export function SourceEvidence({ entry }: { entry: RunEntry }) {
  const source = entry.source;
  const changed =
    source &&
    (source.before.commit !== source.after.commit ||
      source.before.tree !== source.after.tree);
  return (
    <details className="source">
      <summary>
        <GitCommitHorizontal size={16} aria-hidden="true" />
        <strong>Source observation</strong>
        <span>
          {source
            ? changed
              ? "Changed during command"
              : source.before.dirty
                ? "Unchanged · dirty checkout"
                : "Unchanged · clean checkout"
            : "Not captured"}
        </span>
      </summary>
      {source ? (
        <>
          <p>
            Git state observed before and after the command. This does not prove
            which source a deployed service executed, or exclude changes between
            observations.
          </p>
          <dl>
            <dt>Before commit</dt>
            <dd>{source.before.commit}</dd>
            <dt>After commit</dt>
            <dd>{source.after.commit}</dd>
            <dt>Before tree digest</dt>
            <dd>{source.before.tree}</dd>
            <dt>After tree digest</dt>
            <dd>{source.after.tree}</dd>
            <dt>Command exit code</dt>
            <dd>{source.exitCode}</dd>
          </dl>
        </>
      ) : (
        <p>
          This run has no source observation. Use <code>runview record</code>{" "}
          when running tests to capture the local checkout before and after the
          command.
        </p>
      )}
    </details>
  );
}

export function ArtifactEvidence({
  reference,
  body,
}: {
  reference: Artifact;
  body?: Bundle["artifacts"][number];
}) {
  const [preview, setPreview] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const text =
    reference.kind === "Text" ||
    reference.kind === "Json" ||
    reference.contentType.startsWith("text/") ||
    reference.contentType === "application/json";
  async function read(save: boolean) {
    if (!body) return;
    setBusy(true);
    setMessage("");
    try {
      const bytes = await decodeArtifact(reference, body);
      if (save)
        download(
          reference.name.replace(/[/\\]/g, "_"),
          new Blob([bytes], { type: "application/octet-stream" }),
        );
      else setPreview(new TextDecoder().decode(bytes.slice(0, 64 * 1024)));
      setMessage(
        `SHA-256 verified${!save && bytes.length > 64 * 1024 ? " · preview limited to 64 KiB" : ""}`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not read artifact.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="artifact">
      <div className="artifact-row">
        <FileText size={18} aria-hidden="true" />
        <div className="grow">
          <strong>{reference.name}</strong>
          <small>
            {reference.contentType} · {reference.byteLength.toLocaleString()}{" "}
            bytes
          </small>
        </div>
        {body ? (
          <>
            {text && (
              <button disabled={busy} onClick={() => void read(false)}>
                Preview
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => void read(true)}
              aria-label={`Download ${reference.name}`}
            >
              <Download size={15} />
            </button>
          </>
        ) : (
          <small>Body not included</small>
        )}
      </div>
      {message && (
        <output className="artifact-message">
          <Fingerprint size={13} aria-hidden="true" />
          {message}
        </output>
      )}
      {preview !== undefined && (
        <pre className="artifact-preview">{preview}</pre>
      )}
    </div>
  );
}

export function TraceEvidence({
  trace,
}: {
  trace: { provider: string; dataset: string; traceId: string };
}) {
  return (
    <div className="trace">
      <Link2 size={16} aria-hidden="true" />
      <div>
        <strong>Trace reference</strong>
        <p>
          {trace.provider} / {trace.dataset}
        </p>
        <code>{trace.traceId}</code>
        <small>
          Reference only. Open this trace in your observability provider.
        </small>
      </div>
      <details>
        <summary>Reference JSON</summary>
        <Value value={trace} />
      </details>
    </div>
  );
}
