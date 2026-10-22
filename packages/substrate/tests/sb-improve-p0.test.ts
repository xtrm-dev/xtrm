// XTRM-669 (P0): hook outputs use shapes Claude Code reads, compaction
// records real text, and the resume capsule carries the latest handoff,
// claim expiry and a bounded child list.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { contract } from "./helpers.ts";
import { editGateHookOutput, evaluateEditState } from "../integrations/claude-code/edit-gate.ts";
import { commitCheckHookOutput } from "../integrations/claude-code/commit-check.ts";
import { handleStopGate, stopGateHookOutput } from "../integrations/claude-code/stop-gate.ts";
import { handlePostCompact } from "../integrations/claude-code/postcompact.ts";
import { summarizeMechanical, transcriptGist } from "../integrations/claude-code/semantic-service.ts";
import { feedbackForCommand } from "../src/presentation/terminal.ts";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-p0-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const mk = (title: string, parentId?: string) => {
    const i = svc.createIssue({ projectId: "prj_xtrm", title, kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "tester", parentId });
    svc.attestReadiness(i.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    return i;
  };
  const issue = mk("p0 work");
  db.close();
  return { dir, dbPath, issue, mk };
}

describe("XTRM-669 hook output shapes", () => {
  it("edit gate denies via hookSpecificOutput.permissionDecision and names the fix", () => {
    const r = evaluateEditState({ issueRef: "XTRM-1", claim: { holder: "wed-coord", activationId: null }, holder: null });
    assert.equal(r.allow, false);
    assert.match(r.reason ?? "", /export SUBSTRATE_HOLDER=wed-coord/);
    const out = editGateHookOutput(r) as { hookSpecificOutput: Record<string, string>; decision?: unknown };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /SUBSTRATE_HOLDER/);
    assert.equal(out.decision, undefined, "deprecated top-level decision is gone");
    assert.equal(editGateHookOutput({ allow: true, issueRef: "XTRM-1" }), null);
  });

  it("commit check nests additionalContext under hookSpecificOutput", () => {
    const out = commitCheckHookOutput({ intercept: true, allow: true, issueRef: "XTRM-1", nudge: "run sb provenance dispatch XTRM-1" }) as {
      hookSpecificOutput: Record<string, string>;
      additionalContext?: unknown;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(out.hookSpecificOutput.additionalContext, /sb provenance dispatch/);
    assert.equal(out.additionalContext, undefined);
    assert.equal(commitCheckHookOutput({ intercept: true, allow: true, issueRef: "XTRM-1", nudge: null }), null);
  });
});

describe("XTRM-669 stop gate notice", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => rmSync(s.dir, { recursive: true, force: true }));

  it("emits systemMessage only (never continues the turn) and dedupes unchanged signals per session", async () => {
    const db = openSubstrate(s.dbPath);
    try {
      new IssueService(db).claimIssue(s.issue.id, "op");
    } finally {
      db.close();
    }
    const r = await handleStopGate({ cwd: s.dir, session_id: "sess-1", issueRef: s.issue.humanRef, dbPath: s.dbPath, holder: "op" });
    assert.match(r.continuity ?? "", /turn ended/);
    assert.match(r.continuity ?? "", /--kind handoff --semantic/);
    const first = stopGateHookOutput(r, { sessionId: "sess-1", stateDir: s.dir }) as Record<string, unknown>;
    assert.ok(typeof first.systemMessage === "string");
    assert.equal(first.hookSpecificOutput, undefined, "Stop additionalContext would force continuation");
    assert.equal(first.additionalContext, undefined);
    assert.equal(stopGateHookOutput(r, { sessionId: "sess-1", stateDir: s.dir }), null, "same signal, same session: silent");
    assert.ok(stopGateHookOutput(r, { sessionId: "sess-2", stateDir: s.dir }), "other session still notified");
  });
});

describe("XTRM-669 compaction records", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => rmSync(s.dir, { recursive: true, force: true }));

  it("PostCompact reads Claude's compact_summary field", () => {
    const r = handlePostCompact({ session_id: "s", compact_summary: "Summary of the compacted work", issueRef: s.issue.humanRef, dbPath: s.dbPath });
    assert.ok(r.entryId, r.reason);
  });

  it("checkpoint summaries keep conversation text, never raw transcript JSON", () => {
    const tail = [
      '{"partial": "cut mid-rec',
      JSON.stringify({ type: "user", message: { content: "please fix the gate" }, requestId: "req_1" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Fixing it now." }, { type: "tool_use", name: "Edit" }] }, usage: { _input_tokens: 5 } }),
      JSON.stringify({ type: "system", subtype: "x" }),
    ].join("\n");
    assert.deepEqual(transcriptGist(tail), ["user: please fix the gate", "assistant: Fixing it now.", "tool: Edit"]);
    const sem = summarizeMechanical({ issueRevision: 1, contractHash: "abc".repeat(10) } as never, tail);
    assert.doesNotMatch(sem.summary, /requestId|_input_tokens|req_1/);
    assert.match(sem.summary, /please fix the gate/);
  });
});

describe("XTRM-669 resume capsule", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => rmSync(s.dir, { recursive: true, force: true }));

  it("shows the latest handoff, claim expiry and a bounded open-first child list", () => {
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      for (let i = 0; i < 15; i++) {
        svc.createIssue({ projectId: "prj_xtrm", title: `child ${i}`, kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "t", parentId: s.issue.id });
      }
      svc.claimIssue(s.issue.id, "wed-coord", { ttlMs: 3_600_000 });
      const journal = new JournalService(db, svc);
      journal.appendEntry(s.issue.id, { kind: "handoff", semantic: { summary: "old handoff" } });
      journal.appendEntry(s.issue.id, {
        kind: "handoff",
        semantic: { summary: "roster: helper on MMD-2; deploy pending", next: ["re-check deploy"] },
        executionContext: { version: 1, participantId: "wed-coord", timestamp: Date.now() },
      });
      const resume = new ResumeService(db, svc, journal);
      const capsule = resume.buildCapsule(s.issue.id);
      assert.equal(capsule.latestHandoff?.summary, "roster: helper on MMD-2; deploy pending");
      const text = resume.renderCapsule(capsule);
      assert.match(text, /LATEST HANDOFF\nseq\d+ by wed-coord/);
      assert.match(text, /- next: re-check deploy/);
      const handoffSection = text.split("LATEST HANDOFF")[1]?.split("\n\n")[0] ?? "";
      assert.doesNotMatch(handoffSection, /old handoff/, "only the newest handoff is the handoff section");
      assert.match(text, /claim held by wed-coord; expires in (59|60) min/);
      const childLines = text.split("\n").filter((l) => /^- XTRM-\d+/.test(l));
      assert.equal(childLines.length, 12);
      assert.match(text, /3 more open, 0 closed not listed; full list: sb issue children/);
      assert.equal(capsule.children.length, 15, "JSON capsule keeps every child");
    } finally {
      db.close();
    }
  });
});

describe("XTRM-669 CLI feedback", () => {
  it("issue close reports the outcome nested under closure, and flags legacy closes", () => {
    const withClosure = feedbackForCommand("issue.close", ["issue", "close", "XTRM-1"], { closure: { outcome: "completed" } });
    assert.match(withClosure.detail ?? "", /^outcome completed/);
    const legacy = feedbackForCommand("issue.close", ["issue", "close", "XTRM-1"], {});
    assert.match(legacy.detail ?? "", /legacy close/);
  });
});
