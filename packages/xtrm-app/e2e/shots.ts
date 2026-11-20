import { join } from "node:path";
import type { TestInfo } from "@playwright/test";

/**
 * Where a review-evidence screenshot goes (XTRM-931).
 *
 * A routine run, the CI job included, writes every shot into the test's own output dir
 * (`e2e/.results`, gitignored), so a run cannot dirty the committed set under `docs/screenshots`.
 * Regenerate the committed evidence on purpose by naming the root:
 *
 *   XTRM_SCREENSHOTS_DIR=docs/screenshots npx playwright test e2e/project-jira.spec.ts
 *
 * `dir` is the subdirectory below that root, for example `project-jira`.
 */
export function shotPath(testInfo: TestInfo, dir: string, name: string): string {
  const root = process.env.XTRM_SCREENSHOTS_DIR;
  return root ? join(root, dir, name) : testInfo.outputPath(join(dir, name));
}
