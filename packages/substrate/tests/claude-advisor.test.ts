// XTRM-672: Claude Code adapter over the shared advisories — identity export
// through CLAUDE_ENV_FILE, claim roster at SessionStart, PostToolUse advisories
// after sb/MCP calls, and the Stop handoff continuation.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { contract } from "./helpers.ts";
import {
  advisorHookOutput,
  combineStopOutputs,
  handlePostToolAdvisor,
  handleSessionAdvisor,
  handleStopAdvisor,
  substrateCall,
} from "../integrations/claude-code/advisor.ts";

const HOUR = 3_600_000;

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-advisor-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({ projectId: "prj_xtrm", title: "advisor work", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "t" });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  return { dir, dbPath, db, svc, journal: new JournalService(db, svc), issue };
}

describe("XTRM-672 substrateCall", () => {
  it("recognises sb commands and substrate MCP tools, ignores everything else", () => {
    assert.equal(substrateCall("Bash", { command: "ls -la" }), null);
    assert.equal(substrateCall("Bash", { command: "echo sbx issue" }), null);
    assert.deepEqual(substrateCall("Bash", { command: "sb journal append XTRM-7 --kind note --semantic '{}'" })?.write, "journal");
    const close = substrateCall("Bash", { command: "cd x && sb issue close XTRM-7 --outcome completed --reason r" });
    assert.deepEqual(close, { refs: ["XTRM-7"], write: "close", closeFlags: { outcome: "completed", evidence: 0 } });
    assert.deepEqual(substrateCall("mcp__plugin_substrate_substrate__issue_get", { ref: "XTRM-7" }), { refs: ["XTRM-7"], write: null, closeFlags: undefined });
    assert.equal(substrateCall("mcp__other__issue_get", { ref: "XTRM-7" }), null);
  });
});

describe("XTRM-672 adapter over a scratch DB", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    s.db.close();
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("SessionStart derives identity from the xt worktree, exports it, and lists the session's claims with the latest handoff", () => {
    s.svc.claimIssue(s.issue.id, "wed-coord", { ttlMs: HOUR });
    s.journal.appendEntry(s.issue.id, { kind: "handoff", semantic: { summary: "loader running; check builds at 10:45Z" } });
    const envFile = join(s.dir, "env.sh");
    writeFileSync(envFile, "");
    const out = handleSessionAdvisor(
      { source: "startup", cwd: "/p/market-data/.xtrm/worktrees/market-data-xt-claude-wed-coord", envFile },
      { dbPath: s.dbPath, env: { XTRM_SESSION_ID: "$1" } },
    );
    assert.equal(readFileSync(envFile, "utf8"), "export SUBSTRATE_HOLDER='wed-coord'\n");
    assert.match(out.additionalContext ?? "", /identity: wed-coord \(derived from the xt worktree/);
    assert.match(out.additionalContext ?? "", new RegExp(`- ${s.issue.humanRef} advisor work — expires in (59|60) min`));
    assert.match(out.additionalContext ?? "", /latest handoff seq1: loader running/);
    const json = advisorHookOutput("SessionStart", out) as { hookSpecificOutput: { hookEventName: string } };
    assert.equal(json.hookSpecificOutput.hookEventName, "SessionStart");
  });

  it("SessionStart warns the operator when an xt session has no identity", () => {
    const out = handleSessionAdvisor({ source: "startup", cwd: "/tmp/plain" }, { dbPath: s.dbPath, env: { XTRM_SESSION_ID: "$1" } });
    assert.match(out.systemMessage ?? "", /no SUBSTRATE_HOLDER/);
    assert.equal(handleSessionAdvisor({ source: "startup", cwd: "/tmp/plain" }, { dbPath: s.dbPath, env: {} }).systemMessage, undefined);
  });

  it("PostToolUse flags an anonymous journal write and dedupes the issue advisory per session", (t) => {
    s.svc.claimIssue(s.issue.id, "op", { ttlMs: HOUR });
    // The service fills participant from an ambient SUBSTRATE_HOLDER; this case needs anonymous rows.
    const ambient = process.env["SUBSTRATE_HOLDER"];
    delete process.env["SUBSTRATE_HOLDER"];
    t.after(() => {
      if (ambient !== undefined) process.env["SUBSTRATE_HOLDER"] = ambient;
    });
    for (let i = 0; i < 3; i++) s.journal.appendEntry(s.issue.id, { kind: "note", semantic: { summary: `investigated the loader, step ${i}` } });
    const input = {
      tool_name: "Bash",
      tool_input: { command: `sb journal append ${s.issue.humanRef} --kind note --semantic '{}'` },
      session_id: "sess-1",
      cwd: "/tmp/plain",
    };
    const deps = { dbPath: s.dbPath, env: {}, stateDir: s.dir };
    const first = handlePostToolAdvisor(input, deps);
    assert.match(first?.systemMessage ?? "", /recorded with no author/);
    assert.match(first?.additionalContext ?? "", /identity_missing/);
    const json = advisorHookOutput("PostToolUse", first) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    assert.equal(json.hookSpecificOutput.hookEventName, "PostToolUse");
    // Issue-level rules drip one per call: the shown one cools down, the next surfaces, none repeats.
    const issueLines = (o: ReturnType<typeof handlePostToolAdvisor>) =>
      (o?.additionalContext ?? "").split("\n").filter((l) => !/recorded with no author/.test(l));
    assert.match(issueLines(first).join("\n"), /\(identity_missing\)/);
    assert.match(issueLines(handlePostToolAdvisor(input, deps)).join("\n"), /\(checkpoint_due\)/);
    const third = handlePostToolAdvisor(input, deps);
    assert.deepEqual(issueLines(third), [], "all issue rules cooling; only the write fact reports");
    assert.match(third?.systemMessage ?? "", /recorded with no author/);
  });

  it("PostToolUse flags a completed close without evidence", () => {
    const out = handlePostToolAdvisor(
      { tool_name: "Bash", tool_input: { command: `sb issue close ${s.issue.humanRef} --outcome completed --reason done` }, cwd: "/tmp/plain" },
      { dbPath: s.dbPath, env: { SUBSTRATE_HOLDER: "op" } },
    );
    assert.match(out?.additionalContext ?? "", /close_without_result/);
  });

  it("SUBSTRATE_ADVISORIES=off silences PostToolUse and Stop", () => {
    s.svc.claimIssue(s.issue.id, "op", { ttlMs: HOUR });
    const input = { tool_name: "Bash", tool_input: { command: `sb issue show ${s.issue.humanRef}` }, cwd: "/tmp/plain" };
    assert.equal(handlePostToolAdvisor(input, { dbPath: s.dbPath, env: { SUBSTRATE_ADVISORIES: "off" } }), null);
    assert.equal(handleStopAdvisor({ cwd: "/tmp/plain" }, { dbPath: s.dbPath, env: { SUBSTRATE_HOLDER: "op", SUBSTRATE_ADVISORIES: "off" } }), null);
  });

  it("Stop blocks once for a missing handoff, never when stop_hook_active, never with additionalContext", () => {
    // Claimed an hour ago, no journal entries: only the stop-phase handoff rule applies.
    s.svc.claimIssue(s.issue.id, "op", { ttlMs: 4 * HOUR, now: Date.now() - HOUR });
    const deps = { dbPath: s.dbPath, env: { SUBSTRATE_HOLDER: "op" }, stateDir: s.dir };
    const looping = handleStopAdvisor({ session_id: "a", cwd: "/tmp/plain", stop_hook_active: true }, deps);
    assert.equal(looping?.block, undefined, "stop_hook_active never blocks again");
    const out = handleStopAdvisor({ session_id: "b", cwd: "/tmp/plain" }, deps);
    assert.match(out?.block ?? "", /handoff_due/);
    const json = advisorHookOutput("Stop", out) as Record<string, unknown>;
    assert.equal(json["decision"], "block");
    assert.equal(json["hookSpecificOutput"], undefined);
    assert.equal(handleStopAdvisor({ session_id: "b", cwd: "/tmp/plain" }, deps), null, "cooled down for this session");
    const merged = combineStopOutputs({ systemMessage: "gate" }, json) as Record<string, unknown>;
    assert.equal(merged["decision"], "block");
    assert.match(String(merged["systemMessage"]), /^gate\nSubstrate · /);
  });
});
