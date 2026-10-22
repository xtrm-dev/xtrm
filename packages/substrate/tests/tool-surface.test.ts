// XTRM-674: the Claude MCP server and the Pi extension expose one minimal,
// shared tool surface. These tests pin the contract: same names, same keys,
// bounded text, and the behaviours the consolidation exists for.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import registerSubstrate from "../integrations/pi/extension.ts";
import { callMcpTool, MCP_INPUT_SCHEMAS } from "../integrations/claude-code/mcp-server.ts";
import { piToolName, surfaceTextLength, TOOL_NAMES, TOOL_SPECS, type ToolName } from "../integrations/tool-surface.ts";
import { contract } from "./helpers.ts";

const ENV_KEYS = ["SUBSTRATE_DB", "SUBSTRATE_PROJECT", "SUBSTRATE_ISSUE_REF", "SUBSTRATE_ISSUE", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID", "XTRM_SESSION_ID", "XTRM_SESSION_NAME"];
const SUMMARY = "recorded through the shared tool surface with evidence and next step";
const TEXT_BUDGET = 5000;

interface PiTool {
  name: string;
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  execute: (...args: any[]) => Promise<{ content: Array<{ text: string }> }>;
}

function captureTools(): Map<string, PiTool> {
  const tools = new Map<string, PiTool>();
  registerSubstrate({ registerTool: (t: PiTool) => tools.set(t.name, t), registerCommand: () => {}, on: () => {} } as never);
  return tools;
}

const ctxAt = (cwd: string): never => ({ cwd, sessionManager: { getSessionId: () => "pi-sess" }, ui: { notify: () => {} } }) as never;

async function callPi(tools: Map<string, PiTool>, name: ToolName, args: Record<string, unknown>, cwd: string) {
  const tool = tools.get(piToolName(name));
  assert.ok(tool, `${name} registered on Pi`);
  const res = await tool.execute("id", args, undefined, undefined, ctxAt(cwd));
  return JSON.parse(res.content[0]!.text) as Record<string, any>;
}

async function callMcp(name: ToolName, args: Record<string, unknown>) {
  const res = await callMcpTool(name, args);
  return JSON.parse(res.content[0]!.text) as Record<string, any>;
}

function descriptionsIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(descriptionsIn);
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) => (k === "description" && typeof v === "string" ? [v] : descriptionsIn(v)));
}

describe("shared tool surface (XTRM-674)", () => {
  let dir = "";
  let dbPath = "";
  let ref = "";
  let prior: Record<string, string | undefined> = {};
  let priorCwd = "";
  let tools: Map<string, PiTool>;

  beforeEach(() => {
    prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    priorCwd = process.cwd();
    for (const k of ENV_KEYS) delete process.env[k];
    dir = mkdtempSync(join(tmpdir(), "substrate-surface-"));
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_surf", prefix: "SURF", name: "surface" });
      const issue = svc.createIssue({ projectId: "prj_surf", title: "surface work", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "test" });
      svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "test" });
      ref = issue.humanRef;
    } finally {
      db.close();
    }
    process.env["SUBSTRATE_DB"] = dbPath;
    process.env["SUBSTRATE_PROJECT"] = "prj_surf";
    tools = captureTools();
  });

  afterEach(() => {
    process.chdir(priorCwd);
    for (const k of ENV_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const rows = <T>(sql: string, ...params: string[]): T[] => {
    const db = openSubstrate(dbPath);
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  };

  // -- (a) identical names and parameter keys ---------------------------------

  it("MCP and Pi expose the same base names and the same parameter keys", () => {
    assert.deepEqual([...tools.keys()], TOOL_NAMES.map(piToolName), "Pi registers exactly the shared names, prefixed");
    assert.deepEqual(Object.keys(MCP_INPUT_SCHEMAS), [...TOOL_NAMES]);
    for (const spec of TOOL_SPECS) {
      const keys = Object.keys(spec.params).sort();
      const required = Object.entries(spec.params).filter(([, p]) => p.required).map(([k]) => k).sort();
      const mcp = MCP_INPUT_SCHEMAS[spec.name];
      assert.deepEqual(Object.keys(mcp.shape).sort(), keys, `${spec.name}: MCP keys`);
      assert.deepEqual(Object.keys(mcp.shape).filter((k) => !mcp.shape[k]!.isOptional()).sort(), required, `${spec.name}: MCP required`);
      const pi = tools.get(piToolName(spec.name))!;
      assert.deepEqual(Object.keys(pi.parameters.properties).sort(), keys, `${spec.name}: Pi keys`);
      assert.deepEqual([...(pi.parameters.required ?? [])].sort(), required, `${spec.name}: Pi required`);
      assert.equal(pi.description, spec.description, `${spec.name}: Pi description is the shared text`);
    }
  });

  // -- (b) measured text budget ----------------------------------------------

  it("description plus parameter-doc text stays under the budget on every surface", () => {
    const shared = surfaceTextLength();
    const mcp = TOOL_SPECS.reduce(
      (n, s) => n + s.description.length + descriptionsIn(z.toJSONSchema(MCP_INPUT_SCHEMAS[s.name])).reduce((m, d) => m + d.length, 0),
      0,
    );
    const pi = [...tools.values()].reduce((n, t) => n + t.description.length + descriptionsIn(t.parameters).reduce((m, d) => m + d.length, 0), 0);
    console.log(`tool surface text: shared=${shared} mcp=${mcp} pi=${pi} (budget ${TEXT_BUDGET})`);
    for (const [label, size] of [["shared", shared], ["mcp", mcp], ["pi", pi]] as const) {
      assert.ok(size < TEXT_BUDGET, `${label} tool text is ${size} chars, budget ${TEXT_BUDGET}`);
    }
  });

  // -- (c) Pi journal entries carry content -----------------------------------

  it("Pi journal_append persists a non-empty entry with the summary", async () => {
    const out = await callPi(tools, "journal_append", { ref, kind: "finding", summary: SUMMARY, next: ["verify"] }, dir);
    assert.equal(out["kind"], "finding");
    assert.equal(out["feedback"].code, "journal_written");
    const [row] = rows<{ semantic_json: string }>("SELECT semantic_json FROM issue_journal WHERE id = ?", out["entryId"]);
    assert.deepEqual(JSON.parse(row!.semantic_json), { summary: SUMMARY, next: ["verify"] });
    await assert.rejects(callPi(tools, "journal_append", { ref, kind: "finding" }, dir), /requires a summary/);
    const cp = await callPi(tools, "journal_append", { ref, kind: "checkpoint" }, dir);
    assert.equal(cp["kind"], "checkpoint");
    assert.equal(cp["degraded"], false);
    const result = await callPi(tools, "journal_append", { ref, kind: "result", result: { summary: "shipped the surface with validation evidence attached" } }, dir);
    assert.equal(result["kind"], "result");
  });

  it("weak summaries still persist but come back with a warning", async () => {
    const out = await callMcp("journal_append", { ref, kind: "note", summary: "done" });
    assert.ok(out["feedback"].warnings.some((w: string) => /placeholder/.test(w)));
  });

  // -- (d) renew ---------------------------------------------------------------

  it("claim op renew extends expiresAt; release ends the lease", async () => {
    for (const call of [
      (args: Record<string, unknown>) => callMcp("issue_claim", args),
      (args: Record<string, unknown>) => callPi(tools, "issue_claim", args, dir),
    ]) {
      const first = await call({ ref, holder: "worker", ttlMs: 60_000 });
      assert.equal(first["op"], "claim");
      await new Promise((r) => setTimeout(r, 15));
      const renewed = await call({ ref, op: "renew", holder: "worker", ttlMs: 3_600_000 });
      assert.ok(renewed["claim"].expiresAt > first["claim"].expiresAt + 3_000_000, "renew extends the lease");
      assert.equal(renewed["feedback"].code, "claim_renewed");
      const released = await call({ ref, op: "release", holder: "worker" });
      assert.equal(released["feedback"].code, "issue_released");
    }
  });

  // -- (e) holder defaults -----------------------------------------------------

  it("holder defaults from SUBSTRATE_HOLDER and from an xt worktree cwd", async () => {
    const worktree = join(dir, ".xtrm", "worktrees", "repo-xt-claude-wtname");
    mkdirSync(worktree, { recursive: true });

    process.env["SUBSTRATE_HOLDER"] = "env-holder";
    assert.equal((await callPi(tools, "issue_claim", { ref }, dir))["claim"].holder, "env-holder");
    await callPi(tools, "issue_claim", { ref, op: "release" }, dir);
    assert.equal((await callMcp("issue_claim", { ref }))["claim"].holder, "env-holder");
    await callMcp("issue_claim", { ref, op: "release" });

    delete process.env["SUBSTRATE_HOLDER"];
    assert.equal((await callPi(tools, "issue_claim", { ref }, worktree))["claim"].holder, "wtname");
    await callPi(tools, "issue_claim", { ref, op: "release", holder: "wtname" }, worktree);
    process.chdir(worktree);
    assert.equal((await callMcp("issue_claim", { ref }))["claim"].holder, "wtname");
    await callMcp("issue_claim", { ref, op: "release" });

    process.chdir(dir);
    await assert.rejects(callMcp("issue_claim", { ref }), /SUBSTRATE_HOLDER/);
    await assert.rejects(callPi(tools, "issue_claim", { ref }, dir), /SUBSTRATE_HOLDER/);
  });

  // -- (f) close records the participant ---------------------------------------

  it("issue_close records the participant and warns when completed cites no refs", async () => {
    process.env["SUBSTRATE_HOLDER"] = "closer";
    const closed = await callMcp("issue_close", { ref, outcome: "completed", reason: "surface shipped" });
    assert.equal(closed["participantId"], "closer");
    assert.match(closed["feedback"].warnings[0], /completed without/);
    const [closure] = rows<{ actor: string }>("SELECT actor FROM issue_closures");
    assert.equal(closure?.actor, "closer");
  });

  it("issue_close with an explicit participant and refs carries no warning", async () => {
    const entry = await callPi(tools, "journal_append", { ref, kind: "result", result: { summary: "shipped the surface with validation evidence attached" } }, dir);
    const closed = await callPi(tools, "issue_close", { ref, outcome: "completed", reason: "done", participant: "explicit", journalResultRefs: [entry["entryId"]] }, dir);
    assert.equal(closed["participantId"], "explicit");
    assert.equal(closed["feedback"].warnings, undefined);
    assert.equal(rows<{ actor: string }>("SELECT actor FROM issue_closures")[0]?.actor, "explicit");
  });

  // -- merged read tools -------------------------------------------------------

  it("issue_list statuses, claimedBy and journal_read modes agree on both adapters", async () => {
    process.env["SUBSTRATE_HOLDER"] = "reader";
    const ready = await callMcp("issue_list", { status: "ready" });
    assert.equal(ready["issues"].length, 1);
    assert.equal((await callPi(tools, "issue_list", { status: "blocked" }, dir))["issues"].length, 0);
    await callMcp("issue_claim", { ref });
    await callMcp("journal_append", { ref, kind: "handoff", summary: "handing over with evidence recorded and the next step named" });
    const mine = (await callPi(tools, "issue_list", { claimedBy: "me" }, dir)) as unknown as { holder: string; issues: Array<Record<string, any>> };
    assert.equal(mine.holder, "reader");
    assert.equal(mine.issues[0]?.["ref"], ref);
    assert.equal(mine.issues[0]?.["latestHandoff"].sequence, 1);
    assert.equal(typeof mine.issues[0]?.["claim"].acquiredAt, "number");
    for (const mode of ["latest", "since", "timeline", "show"] as const) {
      const out = await callPi(tools, "journal_read", { ref, mode, cursor: 0 }, dir);
      assert.ok(JSON.stringify(out).includes("handing over with evidence"), `${mode} returns the full body`);
    }
    await assert.rejects(callMcp("provenance", { ref, sessionId: "x" }), /exactly one/);
    assert.equal((await callMcp("provenance", { ref }))["humanRef"], ref);
  });
});
