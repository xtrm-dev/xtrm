// XTRM-673: Claude and Pi surface the same advisories for the same sequence
// of Substrate operations, because both map one host-neutral advisor.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { contract } from "./helpers.ts";
import { advisorHookOutput, handlePostToolAdvisor, handleStopAdvisor } from "../integrations/claude-code/advisor.ts";
import { registerAdvisor } from "../integrations/pi/advisor.ts";

const HOUR = 3_600_000;
const CODES = /\((\w+)\)/g;

function codesIn(text: string | undefined): string[] {
  return [...(text ?? "").matchAll(CODES)].map((m) => m[1] as string);
}

// Minimal ExtensionAPI double: records handlers, notifications and messages.
function fakePi() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const notes: string[] = [];
  const messages: Array<{ content: string; options: unknown }> = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
    sendMessage: (m: { content: string }, options: unknown) => messages.push({ content: m.content, options }),
  };
  const ctx = (sessionId: string, cwd: string) => ({
    cwd,
    hasUI: true,
    ui: { notify: (m: string) => notes.push(m) },
    sessionManager: { getSessionId: () => sessionId },
  });
  return { pi, handlers, notes, messages, ctx };
}

describe("XTRM-673 Claude/Pi advisor parity", () => {
  let dir: string;
  let dbPath: string;
  let ref: string;
  let savedHolder: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "substrate-parity-adv-"));
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "parity", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "t" });
    svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "t" });
    svc.claimIssue(issue.id, "op", { ttlMs: 4 * HOUR, now: Date.now() - HOUR });
    const journal = new JournalService(db, svc);
    for (let i = 0; i < 3; i++) journal.appendEntry(issue.id, { kind: "note", semantic: { summary: `step ${i} of the work` } });
    ref = issue.humanRef;
    db.close();
    savedHolder = process.env["SUBSTRATE_HOLDER"];
    process.env["SUBSTRATE_HOLDER"] = "op";
  });
  afterEach(() => {
    if (savedHolder === undefined) delete process.env["SUBSTRATE_HOLDER"];
    else process.env["SUBSTRATE_HOLDER"] = savedHolder;
    rmSync(dir, { recursive: true, force: true });
  });

  it("same tool result and end-of-turn advisories on both hosts", async () => {
    const cwd = "/tmp/plain";
    // Claude: PostToolUse after `sb journal append`, then Stop.
    const claudeDeps = { dbPath, env: { SUBSTRATE_HOLDER: "op" }, stateDir: join(dir, "claude") };
    rmSync(claudeDeps.stateDir, { recursive: true, force: true });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(claudeDeps.stateDir);
    const cmd = `sb journal append ${ref} --kind note --semantic '{"summary":"x"}'`;
    const claudeTool = handlePostToolAdvisor({ tool_name: "Bash", tool_input: { command: cmd }, session_id: "s", cwd }, claudeDeps);
    const claudeStop = advisorHookOutput("Stop", handleStopAdvisor({ session_id: "s", cwd }, claudeDeps)) as Record<string, unknown>;

    // Pi: the same events through the registered handlers (cooldown files are
    // per session id, so a distinct id keeps the two hosts independent).
    // Pi has no stateDir hook: cooldowns land in the OS tmpdir, so the session id must be unique per run.
    const piSession = `p-${dir.split("/").pop()}`;
    const f = fakePi();
    registerAdvisor(f.pi as never, { dbPath: () => dbPath });
    const piTool = (await f.handlers.get("tool_result")!(
      { toolName: "bash", input: { command: cmd }, content: [{ type: "text", text: "ok" }] },
      f.ctx(piSession, cwd),
    )) as { content: Array<{ text: string }> };
    await f.handlers.get("agent_end")!({ messages: [] }, f.ctx(piSession, cwd));

    const piToolText = piTool.content.map((c) => c.text).join("\n");
    assert.deepEqual(codesIn(piToolText), codesIn(claudeTool?.additionalContext), "tool-result advisories match");
    assert.ok(codesIn(piToolText).length > 0, "the fixture produces at least one advisory");
    assert.equal(claudeStop["decision"], "block");
    assert.equal(f.messages.length, 1, "Pi sends one turn-triggering follow-up where Claude blocks Stop");
    assert.deepEqual(codesIn(f.messages[0]?.content), codesIn(String(claudeStop["reason"])));
    assert.deepEqual((f.messages[0]?.options as { triggerTurn?: boolean }).triggerTurn, true);
    assert.ok(f.notes.length >= 1, "operator notified on Pi like systemMessage on Claude");

    // The follow-up turn ends: no second continuation (stop_hook_active parity).
    await f.handlers.get("agent_end")!({ messages: [] }, f.ctx(piSession, cwd));
    assert.equal(f.messages.length, 1);
  });
});

describe("XTRM-675 Pi status widget lines", () => {
  it("shows holder, claims with TTL and handoff, flags missing identity, hides when idle", async () => {
    const { statusLines } = await import("../integrations/pi/advisor.ts");
    const now = 1_800_000_000_000;
    const lines = statusLines({ holder: "wed-coord", source: "worktree" }, [
      { ref: "MMD-2331", title: "Wednesday coordination", expiresAt: now + 30 * 60_000, handoffSeq: 515 },
      { ref: "MMD-2616", title: "options loader", expiresAt: now - 5 * 60_000, handoffSeq: null },
    ], now);
    assert.deepEqual(lines, [
      "substrate · wed-coord (worktree)",
      "  MMD-2331 Wednesday coordination · expires in 30m · handoff seq515",
      "  MMD-2616 options loader · EXPIRED 5m ago · no handoff",
    ]);
    assert.deepEqual(statusLines({ holder: null, source: "none" }, [], now), ["substrate · no SUBSTRATE_HOLDER: writes are anonymous"]);
    assert.deepEqual(statusLines({ holder: "op", source: "env" }, [], now), []);
  });
});
