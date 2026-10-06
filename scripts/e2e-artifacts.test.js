import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("E2E evidence includes hidden Playwright traces, HTML and JSON reports even on failure", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/e2e-tests.yaml", import.meta.url),
    "utf8",
  );
  const upload = workflow.slice(
    workflow.indexOf("- name: Upload test results"),
  );
  for (const directory of ["result", "html", "json"]) {
    assert.ok(upload.includes(`devops/testpack/.playwright/${directory}/`));
  }
  assert.match(upload, /include-hidden-files: true/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(
    upload,
    /if: always\(\) && \(steps.browser.outcome == 'success' \|\| steps.browser.outcome == 'failure'\)/,
  );
  assert.match(workflow, /name: Run E2E tests\s+id: browser/);
  assert.doesNotMatch(upload, /test-results\/|playwright-report\//);
});
