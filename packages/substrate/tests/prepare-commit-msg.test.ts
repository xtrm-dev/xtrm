import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { withoutNodeSqliteWarning } from "./hermetic-env.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { IntegrationService } from "../src/service/integration-service.ts";
import { contract } from "./helpers.ts";

const HOOK = fileURLToPath(new URL("../hooks/prepare-commit-msg.ts", import.meta.url));

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function setupIssue(dbPath: string): { id: string; humanRef: string } {
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "work",
    kind: "task",
    contract: contract({ problem: "p", success: "s" }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  db.close();
  return { id: issue.id, humanRef: issue.humanRef };
}

function runHook(
  repo: string,
  dbPath: string,
  env: Record<string, string>,
  message: string,
): { code: number; stderr: string; rawStderr: string; message: string } {
  const file = join(repo, "msg.txt");
  writeFileSync(file, message);
  // Tests/hermetic-env.ts does not clear XTRM_RECEIPT_ID: every xt activation
  // exports one, and the receipt path would win over the trailer path here.
  const base: NodeJS.ProcessEnv = { ...process.env, SUBSTRATE_DB: dbPath };
  delete base["XTRM_RECEIPT_ID"];
  const res = spawnSync(process.execPath, [HOOK, file], { cwd: repo, encoding: "utf8", env: { ...base, ...env } });
  // XTRM-824: the hook imports node:sqlite; Node v25 warns on the first import.
  // The filer applies to every assertion in this file, which is deliberate: the
  // hook path opens a local database, so Node v25 prints the sqlite notice on any
  // invocation. `rawStderr` stays available for a test that must see the whole
  // stream, so the convenience does not become a blind spot (XTRM-824 review).
  const rawStderr = res.stderr ?? "";
  return { code: res.status ?? 1, stderr: withoutNodeSqliteWarning(rawStderr), rawStderr, message: readFileSync(file, "utf8") };
}

describe("prepare-commit-msg issue trailers (XTRM-684)", () => {
  let dir: string;
  let repo: string;
  let dbPath: string;
  let issueId: string;
  let issueRef: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "substrate-hook-"));
    repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
    dbPath = join(dir, "state.db");
    const issue = setupIssue(dbPath);
    issueId = issue.id;
    issueRef = issue.humanRef;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves from SUBSTRATE_ISSUE_REF", () => {
    const r = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: issueRef }, "work\n");
    assert.equal(r.code, 0);
    assert.match(r.message, new RegExp(`XTRM-Issue: ${issueId}`));
    assert.match(r.message, /XTRM-Issue-Revision: 1/);
  });

  it("resolves xtrm.issue from the repository config (the form a person types)", () => {
    // `git config --worktree` is fatal without extensions.worktreeConfig, and this
    // project always has several worktrees; the reader uses plain `--get`.
    execFileSync("git", ["config", "xtrm.issue", issueRef], { cwd: repo });
    const r = runHook(repo, dbPath, {}, "work\n");
    assert.equal(r.code, 0);
    assert.match(r.message, new RegExp(`XTRM-Issue: ${issueId}`));
  });

  it("resolves from the branch name", () => {
    git(repo, ["checkout", "-q", "-b", `feature/${issueRef}-work`]);
    const r = runHook(repo, dbPath, {}, "work\n");
    assert.equal(r.code, 0);
    assert.match(r.message, new RegExp(`XTRM-Issue: ${issueId}`));
  });

  it("reads a ref out of the branch name, not out of a word that merely contains one", () => {
    git(repo, ["checkout", "-q", "-b", `xt/abc${issueRef}`]);
    const embedded = runHook(repo, dbPath, {}, "work\n");
    assert.equal(embedded.code, 0);
    assert.equal(embedded.message, "work\n", "an embedded ref is not a branch ref");

    git(repo, ["checkout", "-q", "-b", "fix/HTTP-200-check"]);
    const foreign = runHook(repo, dbPath, {}, "work\n");
    assert.equal(foreign.code, 0);
    assert.equal(foreign.message, "work\n", "a ref-shaped word that names no Issue adds no trailer");
    assert.equal(foreign.stderr.trim(), "", "a branch-derived guess that misses stays silent: every commit on such a branch would otherwise warn");
  });

  it("names the Jira key when the Issue carries a jira binding", () => {
    const db = openSubstrate(dbPath);
    new IntegrationService(db, new IssueService(db)).bindExternal(issueId, {
      provider: "jira",
      remoteScope: "PRG",
      remoteId: "10042",
      remoteKey: "PRG-7",
      mode: "projection",
    });
    db.close();
    const r = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: issueRef }, "work\n");
    assert.equal(r.code, 0);
    assert.match(r.message, /Jira: PRG-7/, "the key, not the numeric id");
  });

  it("leaves the message unchanged when there is no binding", () => {
    const r = runHook(repo, dbPath, {}, "work\n");
    assert.equal(r.code, 0);
    assert.equal(r.message, "work\n");
  });

  it("leaves the message unchanged and exits 0 for an unknown ref", () => {
    // An explicit ref is a deliberate statement, so a miss is reported.
    const r = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: "XTRM-999999" }, "work\n");
    assert.equal(r.code, 0);
    assert.equal(r.message, "work\n");
    assert.match(r.stderr, /unresolvable ref/);
  });

  it("does not duplicate trailers on amend", () => {
    const first = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: issueRef }, "work\n");
    assert.match(first.message, /XTRM-Issue:/, "the first run must attach a trailer, or the comparison proves nothing");
    const second = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: issueRef }, first.message);
    assert.equal(second.code, 0);
    assert.equal(second.message, first.message);
  });
});
