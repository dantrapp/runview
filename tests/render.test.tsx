import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { App } from "../src/ui/App.tsx";
import { TestDetail } from "../src/ui/TestDetail.tsx";
import { compareRuns } from "../src/core/compare.ts";
import { parseEvidence } from "../src/core/evidence.ts";
import { fixture, finished, fail } from "./fixtures.ts";

it("renders sample evidence as synthetic and displays the failed assertion", () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain("Sample evidence");
  expect(html).toContain("Synthetic runs");
  expect(html).toContain("The read returned the previous workspace name.");
  expect(html).toContain("Not reached");
});
it("escapes imported assertion content instead of rendering HTML", () => {
  const run = fixture();
  finished(run).assertions[0]!.description = '<script>alert("x")</script>';
  fail(run);
  const bundle = parseEvidence(JSON.stringify(run));
  const test = compareRuns(undefined, run).tests[0]!;
  const html = renderToStaticMarkup(<TestDetail test={test} bundle={bundle} />);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
