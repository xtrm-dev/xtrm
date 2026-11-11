import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// CORE-2612: run the substrate suite with one run-owned scratch root and fail
// when the run leaves entries behind.
//
// The suite used to leave 538 entries in the OS temp dir per run (measured
// 2026-11-11). Tests create their directories through tests/helpers.ts
// tempDir(), which honours SUBSTRATE_TEST_TMP; the wrapper owns that directory,
// so the count is exact and nothing else in /tmp is inspected. TMPDIR itself is
// not changed: the suite's spawned CLIs keep the environment CI gives them.
const runRoot = mkdtempSync(join(tmpdir(), 'substrate-suite-'));
const env = { ...process.env, SUBSTRATE_TEST_TMP: runRoot };

const result = spawnSync('npm', ['run', '--silent', 'test:suite'], {
  stdio: 'inherit',
  env,
});

const left = readdirSync(runRoot);
rmSync(runRoot, { recursive: true, force: true });

if (left.length > 0) {
  console.error(
    `\nsubstrate suite left ${left.length} entries in ${runRoot}: ${left.slice(0, 20).join(', ')}. `
    + 'Every mkdtemp must be removed in an afterAll/afterEach/finally hook, '
    + 'including when its test fails (CORE-2612).',
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
