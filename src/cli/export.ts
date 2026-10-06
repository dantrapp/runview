import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import {
  artifactSchema,
  canonical,
  MAX_IMPORT_BYTES,
  parseEvidence,
  runSchema,
} from "../core/evidence.ts";
import type { Bundle, Source } from "../core/evidence.ts";

const rowSchema = z.object({ snapshot_json: z.string() });
const artifactRow = z.object({
  ref_json: z.string(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

export function exportEvidence(
  directory: string,
  options: { limit?: number; includeArtifacts?: boolean; source?: Source } = {},
): Bundle {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Run limit must be between 1 and 100.");
  const root = realpathSync(directory);
  const database = new DatabaseSync(join(root, "test-runs.sqlite"), {
    readOnly: true,
    allowExtension: false,
  });
  try {
    database.exec("BEGIN");
    const rows = database
      .prepare(
        "SELECT snapshot_json FROM test_runs ORDER BY started_at_ms DESC LIMIT ?",
      )
      .all(limit);
    if (rows.length === 0)
      throw new Error("The evidence database contains no runs.");
    const bundle: Bundle = {
      format: "runview",
      version: 1,
      exportedAt: new Date().toISOString(),
      runs: [],
      artifacts: [],
      warnings: [],
    };
    let bytes = 0;
    for (const row of rows) {
      const { snapshot_json: json } = rowSchema.parse(row);
      bytes += Buffer.byteLength(json);
      if (bytes > MAX_IMPORT_BYTES / 2)
        throw new Error(
          "Run metadata exceeds the export budget. Use --limit to export fewer runs.",
        );
      const run = runSchema.parse(JSON.parse(json));
      const source =
        options.source &&
        run.timing._tag === "Finished" &&
        Date.parse(run.startedAt) >= Date.parse(options.source.startedAt) &&
        Date.parse(run.timing.finishedAt) <=
          Date.parse(options.source.finishedAt)
          ? options.source
          : undefined;
      bundle.runs.push({ run, source });
      if (!options.includeArtifacts) continue;
      const references = new Map(
        run.tests
          .flatMap((t) =>
            t.executions.flatMap((e) => ("artifacts" in e ? e.artifacts : [])),
          )
          .map((ref) => [ref.id, ref]),
      );
      const artifactRows = database
        .prepare(
          "SELECT ref_json, content_sha256 FROM test_artifacts WHERE run_id = ?",
        )
        .all(run.id);
      for (const raw of artifactRows) {
        const stored = artifactRow.parse(raw);
        const ref = artifactSchema.parse(JSON.parse(stored.ref_json));
        const expected = references.get(ref.id);
        if (!expected || canonical(expected) !== canonical(ref))
          throw new Error("Artifact metadata does not match its run snapshot.");
        references.delete(ref.id);
        if (
          ref.byteLength > MAX_ARTIFACT_BYTES ||
          bytes + ref.byteLength * 1.4 > MAX_IMPORT_BYTES * 0.8
        ) {
          bundle.warnings.push(
            `Artifact ${ref.name} omitted: export size limit.`,
          );
          continue;
        }
        try {
          // Resolve content by its digest; database paths never authorize arbitrary file reads.
          const blobRoot = realpathSync(join(root, "blobs"));
          const blobRelative = relative(root, blobRoot);
          if (blobRelative.startsWith("..") || isAbsolute(blobRelative))
            throw new Error(
              "Blob directory points outside the evidence directory",
            );
          const path = realpathSync(join(blobRoot, stored.content_sha256));
          const rel = relative(blobRoot, path);
          if (rel.startsWith("..") || isAbsolute(rel))
            throw new Error("Artifact points outside the blob directory");
          if (statSync(path).size !== ref.byteLength)
            throw new Error("Artifact length does not match metadata");
          const body = readFileSync(path);
          if (
            createHash("sha256").update(body).digest("hex") !==
            stored.content_sha256
          )
            throw new Error("Artifact digest mismatch");
          bytes += body.length * 1.4;
          bundle.artifacts.push({
            runId: run.id,
            artifactId: ref.id,
            base64: body.toString("base64"),
            sha256: stored.content_sha256,
          });
        } catch (error) {
          const reason =
            error instanceof Error && !("code" in error)
              ? error.message
              : "file unavailable";
          bundle.warnings.push(`Artifact ${ref.name} omitted: ${reason}.`);
        }
      }
      for (const ref of references.values()) {
        bundle.warnings.push(
          `Artifact ${ref.name} (${run.id}, ${ref.id}) omitted: storage record missing for this run.`,
        );
      }
    }
    database.exec("COMMIT");
    return parseEvidence(JSON.stringify(bundle));
  } finally {
    database.close();
  }
}
