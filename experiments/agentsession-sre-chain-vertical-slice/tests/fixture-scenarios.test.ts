/**
 * Fixture determinism tests (Requirement 2).
 *
 * The setup-fixture.sh script must build two deterministic git-history
 * variants of the same tiny-repo. These tests spawn the script into a
 * throwaway copy of the fixture and assert that git history matches the
 * required semantics for each scenario.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const REPO_ROOT = path.resolve(new URL("../", import.meta.url).pathname);
const SCRIPT = path.join(REPO_ROOT, "scripts", "setup-fixture.sh");

async function stamp(scenario: "true-regression" | "false-premise") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `svs-fix-${scenario}-`));
  // Copy the tracked fixture tree into a scratch experiment dir mirroring
  // the layout the script expects: <scratch>/scripts/setup-fixture.sh
  // and <scratch>/fixtures/tiny-repo/.
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.mkdirSync(path.join(tmp, "fixtures", "tiny-repo", "svc-a"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "fixtures", "tiny-repo", "svc-b"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(tmp, "scripts", "setup-fixture.sh"));
  fs.chmodSync(path.join(tmp, "scripts", "setup-fixture.sh"), 0o755);
  // Seed pre-existing tracked files so mv-style edits can operate.
  fs.writeFileSync(path.join(tmp, "fixtures", "tiny-repo", "svc-a", "config.yml"), "healthy: true\n");
  fs.writeFileSync(
    path.join(tmp, "fixtures", "tiny-repo", "svc-b", "config.yml"),
    "memory_limit: 64Mi\nworker_count: 8\n",
  );
  fs.writeFileSync(path.join(tmp, "fixtures", "tiny-repo", "README.md"), "# Tiny SRE Fixture\n");
  await pexec("bash", [path.join(tmp, "scripts", "setup-fixture.sh"), scenario], { cwd: tmp });
  return path.join(tmp, "fixtures", "tiny-repo");
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await pexec("git", args, { cwd });
  return stdout;
}

describe("fixture — deterministic scenarios", () => {
  test("true-regression: two commits, HEAD changes svc-b memory_limit 512Mi -> 64Mi", async () => {
    const fix = await stamp("true-regression");
    const log = (await git(fix, ["log", "--oneline"])).trim().split("\n");
    expect(log.length).toBe(2);
    const diff = await git(fix, ["show", "--pretty=", "HEAD", "--", "svc-b/config.yml"]);
    expect(diff).toMatch(/-memory_limit: 512Mi/);
    expect(diff).toMatch(/\+memory_limit: 64Mi/);
    const readme = fs.readFileSync(path.join(fix, "README.md"), "utf8");
    expect(readme).toMatch(/scenario: true-regression/);
  });

  test("false-premise: HEAD diff removes only a comment; svc-b memory_limit is 64Mi at BOTH commits", async () => {
    const fix = await stamp("false-premise");
    const log = (await git(fix, ["log", "--oneline"])).trim().split("\n");
    expect(log.length).toBe(2);
    const diff = await git(fix, ["show", "--pretty=", "HEAD", "--", "svc-b/config.yml"]);
    // No transition of the actual value on this commit.
    expect(diff).not.toMatch(/^\+memory_limit: 64Mi/m);
    expect(diff).not.toMatch(/^-memory_limit: 512Mi/m);
    // The only substantive change is the comment removal.
    expect(diff).toMatch(/-# recent change/);
    // Both commits carry memory_limit: 64Mi
    const parent = await git(fix, ["show", "HEAD~1:svc-b/config.yml"]);
    const head = await git(fix, ["show", "HEAD:svc-b/config.yml"]);
    expect(parent).toMatch(/^memory_limit: 64Mi/m);
    expect(head).toMatch(/^memory_limit: 64Mi/m);
    const readme = fs.readFileSync(path.join(fix, "README.md"), "utf8");
    expect(readme).toMatch(/scenario: false-premise/);
  });

  test("same-scenario second call is a no-op", async () => {
    const fix = await stamp("true-regression");
    const before = await git(fix, ["log", "--oneline"]);
    // Re-invoke the SAME copied script against the SAME stamped fixture;
    // the scenario stamp in README.md should short-circuit the rebuild.
    const scratchRoot = path.resolve(fix, "..", "..");
    const scriptCopy = path.join(scratchRoot, "scripts", "setup-fixture.sh");
    await pexec("bash", [scriptCopy, "true-regression"], { cwd: scratchRoot });
    const after = await git(fix, ["log", "--oneline"]);
    expect(after).toBe(before);
  });
});
