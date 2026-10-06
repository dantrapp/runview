import { parseArgs } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportEvidence } from "./export.ts";
import { recordCommand } from "./source.ts";
import { serve } from "./server.ts";

const help = `Runview — inspect Overseer test evidence

runview export --directory <evidence-dir> --out <file.runview.json> [--artifacts] [--limit 20]
runview record --directory <evidence-dir> --out <file.runview.json> [--artifacts] -- <test command>
runview serve [--port 4318]

Export opens test-runs.sqlite read-only. Artifact bytes are included only with --artifacts.
Record captures Git source state before and after the command; it does not isolate execution.
Serve binds to 127.0.0.1. Import a bundle or a raw Overseer run in the workbench.
`;
async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === "--help" || command === "help") {
    console.log(help);
    return;
  }
  const split = args.indexOf("--");
  const child = split >= 0 ? args.slice(split + 1) : [];
  const { values } = parseArgs({
    args: split >= 0 ? args.slice(0, split) : args,
    options: {
      directory: { type: "string" },
      out: { type: "string" },
      limit: { type: "string", default: "20" },
      artifacts: { type: "boolean", default: false },
      port: { type: "string", default: "4318" },
    },
  });
  if (command === "serve") {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Port must be between 1 and 65535.");
    await serve(fileURLToPath(new URL("../dist", import.meta.url)), port);
    console.log(`Runview is available at http://127.0.0.1:${port}`);
    return;
  }
  if (command !== "export" && command !== "record")
    throw new Error(`Unknown command: ${command}`);
  if (!values.directory || !values.out)
    throw new Error("Both --directory and --out are required.");
  if (existsSync(resolve(values.out)))
    throw new Error("Output already exists. Choose a new --out path.");
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Run limit must be between 1 and 100.");
  const source =
    command === "record"
      ? await recordCommand(child, process.cwd())
      : undefined;
  const bundle = exportEvidence(resolve(values.directory), {
    limit,
    includeArtifacts: values.artifacts,
    source,
  });
  writeFileSync(resolve(values.out), JSON.stringify(bundle, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    `Exported ${bundle.runs.length} runs and ${bundle.artifacts.length} artifact bodies to ${values.out}`,
  );
  for (const warning of bundle.warnings) console.error(warning);
  if (source) process.exitCode = source.exitCode;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runview failed.");
  process.exitCode = 1;
});
