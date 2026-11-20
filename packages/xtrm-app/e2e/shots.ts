import { join } from "node:path";
import { test } from "@playwright/test";

/**
 * Where a review screenshot goes (XTRM-918). Unset, it lands in the run's own output directory
 * (`e2e/.results`, gitignored), so a routine run cannot dirty the tracked evidence set under
 * `docs/screenshots`. The committed set is produced on purpose, one surface at a time:
 *
 *   WORKERS_SHOTS_DIR=docs/screenshots/project-workers npx playwright test e2e/project-workers.spec.ts
 *
 * The variable is named per surface so two specs that share a directory (`screens` and
 * `details-naming` both write `agent-half`) still write only when asked for.
 */
export function shots(env: string): (name: string) => string {
  const dir = process.env[env];
  return (name) => (dir ? join(dir, name) : test.info().outputPath(name));
}
