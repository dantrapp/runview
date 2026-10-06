import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { indexArtifacts } from "../src/core/artifacts.ts";
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
  const html = renderToStaticMarkup(
    <TestDetail
      test={test}
      artifactBodies={indexArtifacts(bundle.artifacts)}
    />,
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});

it("starts with review items and keeps unchanged tests out of the initial list", () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain("Anonymous requests are rejected");
  expect(html).not.toContain("Archiving is idempotent");
});

it("shows both expectations before collapsed results when the assertion operation changes", () => {
  const before = fixture(),
    after = fixture("after");
  finished(after).assertions[0]!.operation = {
    _tag: "OneOf",
    expected: [200, 500],
    actual: 200,
  };
  const test = compareRuns(before, after).tests[0]!;
  const html = renderToStaticMarkup(
    <TestDetail test={test} artifactBodies={new Map()} />,
  );
  const comparison = html.slice(
    html.indexOf('class="value-grid comparison-values"'),
    html.indexOf('<details class="previous"'),
  );
  expect(comparison).toContain("Before · expected");
  expect(comparison).toContain("Current · expected");
  expect(comparison).toContain("Equal");
  expect(comparison).toContain("OneOf");
  expect(comparison).toContain("500");
});
