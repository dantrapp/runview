import { Check, CircleDashed, Minus, X } from "lucide-react";
import type { Change } from "../core/compare.ts";
import { labels } from "../core/compare.ts";

export function Status({ status }: { status?: string }) {
  const Icon =
    status === "passed"
      ? Check
      : status === "failed"
        ? X
        : status === "skipped"
          ? Minus
          : CircleDashed;
  return (
    <span className={`status ${status ?? "unknown"}`}>
      <Icon size={14} aria-hidden="true" />
      {status?.replace("_", " ") ?? "not recorded"}
    </span>
  );
}
export function Changes({ changes }: { changes: Change[] }) {
  return (
    <span className="changes">
      {changes.map((change) => (
        <span key={change} className={`change ${change}`}>
          {labels[change]}
        </span>
      ))}
    </span>
  );
}
export function Value({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <pre className="value">
      {text?.length > 6000 ? (
        <details>
          <summary>{text.slice(0, 240)}… · expand</summary>
          {text}
        </details>
      ) : (
        text
      )}
    </pre>
  );
}
export function duration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}
export function time(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
