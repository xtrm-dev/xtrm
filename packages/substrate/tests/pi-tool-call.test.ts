// Pi tool_call production wiring (§§38-39, bead xtrm-6qu.6): the handler
// registered by the extension blocks/allows built-in edit+write calls
// against live claim authority — exercised here through the real
// registered handler, not the pure decision function alone.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import registerSubstrate from "../integrations/pi/extension.ts";
import { contract } from "./helpers.ts";

const ENV_KEYS = ["SUBSTRATE_DB", "SUBSTRATE_ISSUE_REF", "SUBSTRATE_ISSUE", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"];

interface CapturedTool {
  name: string;
  execute: (...args: any[]) => Promise<any>;
}

function fakePi(): { pi: any; handlers: Map<string, any[]>; tools: CapturedTool[] } {
  const handlers = new Map<string, any[]>();
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (t: CapturedTool) => {
      tools.push(t);
    },
    registerCommand: () => {},
    on: (event: string, handler: any) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  return { pi, handlers, tools };
}

function fakeCtx(sessionId: string | undefined, cwd?: string): any {
  return {
    cwd: cwd ?? process.cwd(),
    sessionManager: { getSessionId: () => sessionId },
    ui: { notify: () => {} },
  };
}

const editEvent = (): any => ({ type: "tool_call", toolCallId: "t1", toolName: "edit", input: { path: "file.txt", edits: [] } });
const writeEvent = (): any => ({ type: "tool_call", toolCallId: "t2", toolName: "write", input: { path: "file.txt", content: "x" } });
const readEvent = (): any => ({ type: "tool_call", toolCallId: "t3", toolName: "read", input: { path: "file.txt" } });

describe("Pi tool_call edit/write gate (live wired handler)", () => {
  let dir = "";
  let dbPath = "";
  let issueId = "";
  let humanRef = "";
  let prior: Record<string, string | undefined> = {};
  let toolCall!: (event: any, ctx: any) => Promise<any>;
  let tools: CapturedTool[] = [];

  beforeEach(() => {
    prior = {};
    for (const k of ENV_KEYS) {
      prior[k] = process.env[k];
      delete process.env[k];
    }
    dir = mkdtempSync(join(tmpdir(), "substrate-pi-gate-"));
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_pi", prefix: "PI", name: "pi" });
      const issue = svc.createIssue({ projectId: "prj_pi", title: "gated work", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "test" });
      svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "test" });
      issueId = issue.id;
      humanRef = issue.humanRef;
    } finally {
      db.close();
    }
    process.env["SUBSTRATE_DB"] = dbPath;
    const { pi, handlers: seen, tools: seenTools } = fakePi();
    registerSubstrate(pi);
    const fns = seen.get("tool_call") ?? [];
    tools = seenTools;
    assert.equal(fns.length, 1, "extension registers exactly one tool_call handler");
    toolCall = fns[0];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function claim(holder: string, activationId?: string): void {
    const db = openSubstrate(dbPath);
    try {
      new IssueService(db).claimIssue(issueId, holder, { activationId });
    } finally {
      db.close();
    }
  }

  function boundAs(holder: string, activationId?: string): void {
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    process.env["SUBSTRATE_HOLDER"] = holder;
    if (activationId === undefined) delete process.env["SUBSTRATE_ACTIVATION_ID"];
    else process.env["SUBSTRATE_ACTIVATION_ID"] = activationId;
  }

  it("unbound sessions edit freely; non-mutating tools are ignored", async () => {
    assert.equal(await toolCall(editEvent(), fakeCtx("sess-1")), undefined);
    assert.equal(await toolCall(writeEvent(), fakeCtx("sess-1")), undefined);
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    assert.equal(await toolCall(readEvent(), fakeCtx("sess-1")), undefined, "read is never gated even when bound without claim");
  });

  it("bound issue without claim blocks edit and write", async () => {
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    assert.equal((await toolCall(editEvent(), fakeCtx("sess-1")))?.block, true);
    assert.equal((await toolCall(writeEvent(), fakeCtx("sess-1")))?.block, true);
  });

  it("claim holder allows; intruder and missing holder are fail-closed", async () => {
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    claim("op");
    process.env["SUBSTRATE_HOLDER"] = "op";
    assert.equal(await toolCall(editEvent(), fakeCtx("sess-1")), undefined);
    process.env["SUBSTRATE_HOLDER"] = "intruder";
    assert.equal((await toolCall(editEvent(), fakeCtx("sess-1")))?.block, true, "holder B may not mutate holder A's claim");
    delete process.env["SUBSTRATE_HOLDER"];
    assert.equal((await toolCall(editEvent(), fakeCtx("sess-1")))?.block, true, "missing holder is fail-closed on a live claim");
  });

  it("same holder under a different activation is blocked", async () => {
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    claim("op", "act-1");
    process.env["SUBSTRATE_HOLDER"] = "op";
    process.env["SUBSTRATE_ACTIVATION_ID"] = "act-2";
    assert.equal((await toolCall(editEvent(), fakeCtx("sess-1")))?.block, true);
    process.env["SUBSTRATE_ACTIVATION_ID"] = "act-1";
    assert.equal(await toolCall(editEvent(), fakeCtx("sess-1")), undefined);
  });

  it("substrate_issue_claim binds holder+activation to the session", async () => {
    const claimTool = tools.find((t) => t.name === "substrate_issue_claim");
    assert.ok(claimTool, "extension registers substrate_issue_claim");
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    await claimTool.execute("id", { ref: humanRef, holder: "op", activationId: "act-1" }, undefined, undefined, fakeCtx("sess-1"));
    // No env holder: sess-1 carries its stored identity and is allowed,
    // while an unknown session is fail-closed on the same live claim.
    assert.equal(await toolCall(editEvent(), fakeCtx("sess-1")), undefined);
    assert.equal((await toolCall(editEvent(), fakeCtx("sess-2")))?.block, true);
  });

  it("substrate_journal_append exposes and persists the entry text (XTRM-720)", async () => {
    const appendTool = tools.find((t) => t.name === "substrate_journal_append") as CapturedTool & { parameters?: unknown };
    assert.ok(appendTool, "extension registers substrate_journal_append");
    assert.match(JSON.stringify(appendTool.parameters ?? {}), /summary/, "the tool schema names the text field");
    const text = "handoff: text survives the registered tool surface";
    await appendTool.execute("id", { ref: humanRef, kind: "handoff", summary: text }, undefined, undefined, fakeCtx("sess-1"));
    const db = openSubstrate(dbPath);
    try {
      const entry = new JournalService(db, new IssueService(db)).listEntries(issueId)[0];
      assert.deepEqual(entry.semantic, { summary: text });
    } finally {
      db.close();
    }
  });

  it("unreadable database fails open so Pi is never bricked", async () => {
    process.env["SUBSTRATE_ISSUE_REF"] = humanRef;
    process.env["SUBSTRATE_DB"] = join(dir, "no-such-dir", "state.db");
    assert.equal(await toolCall(editEvent(), fakeCtx("sess-1")), undefined);
  });
});
