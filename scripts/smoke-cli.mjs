import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist-cli/index.js", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "runview-cli-"));
const execute = (args) =>
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  writeFileSync(join(root, ".gitignore"), "evidence/\n*.runview.json\n");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Runview Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Fixture",
  ]);
  const command = `
    const fs = require('node:fs'); const {DatabaseSync} = require('node:sqlite');
    fs.mkdirSync('evidence', {recursive: true});
    const db = new DatabaseSync('evidence/test-runs.sqlite');
    db.exec('CREATE TABLE test_runs(id TEXT PRIMARY KEY, started_at_ms INTEGER, snapshot_json TEXT)');
    const now = new Date().toISOString();
    const run = {id:'cli-run',target:'local',stage:'fixture',status:'passed',startedAt:now,timing:{_tag:'Finished',finishedAt:now,durationMs:0},tests:[]};
    db.prepare('INSERT INTO test_runs VALUES (?,?,?)').run(run.id,Date.parse(now),JSON.stringify(run)); db.close();
  `;
  assert.match(execute(["--help"]), /read-only/);
  assert.match(
    execute([
      "record",
      "--directory",
      "evidence",
      "--out",
      "recorded.runview.json",
      "--",
      process.execPath,
      "-e",
      command,
    ]),
    /Exported 1 runs/,
  );
  const recorded = JSON.parse(
    readFileSync(join(root, "recorded.runview.json"), "utf8"),
  );
  assert.equal(recorded.runs[0].source.exitCode, 0);
  assert.equal(
    recorded.runs[0].source.before.tree,
    recorded.runs[0].source.after.tree,
  );
  execute([
    "export",
    "--directory",
    "evidence",
    "--out",
    "historical.runview.json",
  ]);
  const historical = JSON.parse(
    readFileSync(join(root, "historical.runview.json"), "utf8"),
  );
  assert.equal(historical.runs[0].source, undefined);
  assert.throws(
    () =>
      execute([
        "export",
        "--directory",
        "evidence",
        "--out",
        "historical.runview.json",
      ]),
    /Output already exists/,
  );
  try {
    execute([
      "record",
      "--directory",
      "evidence",
      "--out",
      "failed.runview.json",
      "--",
      process.execPath,
      "-e",
      "process.exitCode=7",
    ]);
    assert.fail("Expected nonzero exit");
  } catch (error) {
    assert.equal(error.status, 7);
  }
  const failed = JSON.parse(
    readFileSync(join(root, "failed.runview.json"), "utf8"),
  );
  assert.equal(
    failed.runs[0].source,
    undefined,
    "Historical run must not inherit a later command observation",
  );
  console.log(
    "CLI smoke passed: compiled record, export, overwrite refusal, source window, and exit code.",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
