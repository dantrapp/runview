import { expect, it } from "vitest";
import { indexArtifacts } from "../src/core/artifacts.ts";

it("indexes artifact bodies by both run and artifact identity", () => {
  const first = {
    runId: "run-one",
    artifactId: "shared",
    base64: "YQ==",
    sha256: "a".repeat(64),
  };
  const second = { ...first, runId: "run-two", base64: "Yg==" };
  const index = indexArtifacts([first, second]);
  expect(index.get("run-one")?.get("shared")).toBe(first);
  expect(index.get("run-two")?.get("shared")).toBe(second);
  expect(index.get("missing")?.get("shared")).toBeUndefined();
});
