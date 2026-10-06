import { build } from "esbuild";
import { chmod } from "node:fs/promises";
await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist-cli/index.js",
  banner: { js: "#!/usr/bin/env node" },
});
await chmod("dist-cli/index.js", 0o755);
