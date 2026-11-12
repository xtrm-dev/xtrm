import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
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

function runHook(repo: string, dbPath: string, env: Record<string, string>, message: string): { code: number; stderr: string; message: string } {
  const file = join(repo, "msg.txt");
  writeFileSync(file, message);
  const res = spawnSync(process.execPath, [HOOK, file], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, SUBSTRATE_DB: dbPath, ...env },
  });
  return { code: res.status ?? 1, stderr: res.stderr ?? "", message: readFileSync(file, "utf8") };
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

  it("resolves from git config --worktree xtrm.issue", () => {
    execFileSync("git", ["config", "--worktree", "xtrm.issue", issueId], { cwd: repo });
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

  it("leaves the message unchanged when there is no binding", () => {
    const r = runHook(repo, dbPath, {}, "work\n");
    assert.equal(r.code, 0);
    assert.equal(r.message, "work\n");
  });

  it("leaves the message unchanged and exits 0 for an unknown ref", () => {
    const r = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: "XTRM-999999" }, "work\n");
    assert.equal(r.code, 0);
    assert.equal(r.message, "work\n");
    assert.match(r.stderr, /unresolvable ref/);
  });

  it("does not duplicate trailers on amend", () => {
    const first = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: issueRef }, "work\n");
    const second = runHook(repo, dbPath, { SUBSTRATE_ISSUE_REF: issueRef }, first.message);
    assert.equal(second.code, 0);
    assert.equal(second.message, first.message);
  });
});
