// Claude MCP server (PRD §38): the MCP surface calls the Substrate
// library/service directly. Forbidden normal implementation:
//
//   MCP handler → exec("sb ...")
//
// This module imports no child_process and never shells out: every tool
// instantiates IssueService/JournalService/ResumeService in-process.
// Transport is stdio JSON-RPC (MCP-compatible: initialize, tools/list,
// tools/call). Hook processes (precompact/postcompact/session-start) are
// separate command adapters for lifecycle events Claude only exposes as
// hook processes.

import { openHandles } from "./runtime.ts";

export const MCP_TOOLS = [
  {
    name: "substrate_issue_resume",
    description: "Build the current Resume Capsule for an issue (contract + latest checkpoint + deltas).",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, dbPath: { type: "string" } }, required: ["ref"] },
  },
  {
    name: "substrate_journal_checkpoint",
    description: "Write a mechanical checkpoint (+ bounded semantic summary) for an issue. Never blocks on failure.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        sessionId: { type: "string" },
        participantId: { type: "string" },
        branch: { type: "string" },
        headCommit: { type: "string" },
        dbPath: { type: "string" },
      },
      required: ["ref"],
    },
  },
  {
    name: "substrate_journal_append",
    description: "Append a journal entry (finding/decision/handoff/milestone/blocker) with a semantic summary.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        kind: { type: "string" },
        summary: { type: "string" },
        sessionId: { type: "string" },
        dbPath: { type: "string" },
      },
      required: ["ref", "kind", "summary"],
    },
  },
  {
    name: "substrate_provenance_trace",
    description: "Event-spine trace for an issue (count + last marker). Full receipts/bundles are Phase 8; nothing is invented here.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, dbPath: { type: "string" } }, required: ["ref"] },
  },
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function strArg(args: Record<string, unknown>, field: string, required: boolean): string | undefined {
  const v = args[field];
  if (v === undefined || v === null) {
    if (required) throw new Error(`missing required argument: ${field}`);
    return undefined;
  }
  if (typeof v !== "string" || v.trim() === "") throw new Error(`argument ${field} must be a non-empty string`);
  return v;
}

// Direct library call per tool; each call opens and closes its own handle
// (MCP servers are long-lived; the WAL store is the shared authority).
// Dispatch order (xtrm-7wc.8.1): the tool name validates BEFORE any handle
// opens, so an unknown tool never touches the filesystem and its rejection
// cannot be masked by a database error on machines without ~/.xtrm/.
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!(MCP_TOOLS as readonly { name: string }[]).some((t) => t.name === name)) throw new Error(`unknown tool: ${name}`);
  const dbPath = args["dbPath"] !== undefined ? strArg(args, "dbPath", false) : undefined;
  const handles = openHandles(dbPath);
  try {
    switch (name) {
      case "substrate_issue_resume": {
        const ref = strArg(args, "ref", true) as string;
        const id = handles.svc.resolveRef(ref).id;
        const capsule = handles.resume.buildCapsule(id);
        return { capsule, rendered: handles.resume.renderCapsule(capsule) };
      }
      case "substrate_journal_checkpoint": {
        const ref = strArg(args, "ref", true) as string;
        const id = handles.svc.resolveRef(ref).id;
        const { createSemanticSummarizer } = await import("./semantic-service.ts");
        const result = await handles.journal.compactionCheckpoint(id, {
          kind: "checkpoint",
          sessionId: strArg(args, "sessionId", false),
          participantId: strArg(args, "participantId", false),
          branch: strArg(args, "branch", false),
          headCommit: strArg(args, "headCommit", false),
          summarizer: createSemanticSummarizer({}),
        });
        if (!result.entry) throw new Error(result.reason ?? "checkpoint write failed");
        return { entryId: result.entry.id, sequence: result.entry.sequence, degraded: result.degraded, reason: result.reason ?? null };
      }
      case "substrate_journal_append": {
        const ref = strArg(args, "ref", true) as string;
        const kind = strArg(args, "kind", true) as string;
        const summary = strArg(args, "summary", true) as string;
        const id = handles.svc.resolveRef(ref).id;
        const { isJournalKind } = await import("../../src/domain/journal.ts");
        if (!isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
        const entry = handles.journal.appendEntry(id, {
          kind,
          sessionId: strArg(args, "sessionId", false),
          semantic: { summary: summary.slice(0, 2000) },
        });
        return { entryId: entry.id, sequence: entry.sequence };
      }
      case "substrate_provenance_trace": {
        const ref = strArg(args, "ref", true) as string;
        const id = handles.svc.resolveRef(ref).id;
        const events = handles.svc.listEvents(id);
        const last = events[events.length - 1];
        return { issueId: id, eventCount: events.length, lastEventType: last?.type ?? null, lastEventAt: last?.createdAt ?? null };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } finally {
    try {
      handles.db.close();
    } catch {
      // best-effort
    }
  }
}

interface JsonRpc {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

function reply(id: number | string | null, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id: number | string | null, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } }) + "\n");
}

export async function serveStdio(): Promise<void> {
  let buf = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buf += chunk as string;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        continue;
      }
      const id = (msg.id ?? null) as number | string | null;
      try {
        if (msg.method === "initialize") {
          reply(id, { protocolVersion: "2024-11-05", serverInfo: { name: "substrate-claude", version: "0.1.0" } });
        } else if (msg.method === "tools/list") {
          reply(id, { tools: MCP_TOOLS });
        } else if (msg.method === "tools/call") {
          const p = (isRecord(msg.params) ? msg.params : {}) as Record<string, unknown>;
          const result = await callTool(String(p["name"]), isRecord(p["arguments"]) ? (p["arguments"] as Record<string, unknown>) : {});
          reply(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
        } else {
          replyError(id, `unknown method: ${msg.method ?? "?"}`);
        }
      } catch (err) {
        replyError(id, err instanceof Error ? err.message : String(err));
      }
    }
  }
}

const invokedAsMain = process.argv[1]?.endsWith("mcp-server.ts") ?? false;
if (invokedAsMain) {
  await serveStdio();
}
