// Substrate MCP server, closeout E3 (bead xtrm-iip.3): official
// @modelcontextprotocol/server v2 over the modern stdio entry, strict
// protocol revision 2026-07-28, modern-only (legacy initialize-era
// openings are rejected). This REPLACES the handwritten initialize-era
// server: no initialize/initialized, no Mcp-Session-Id, no
// connection-scoped state.
//
// Statelessness is structural: serveStdio builds one McpServer per serving
// unit from buildServer(), every request carries its own _meta envelope
// (protocol revision + client capabilities + client info, read per request
// from ctx.mcpReq.envelope — never remembered), and each tool handler opens
// and closes its own database handle per call (the WAL store is the shared
// authority; E2 resolves explicit override else SUBSTRATE_DB else
// ~/.xtrm/state.db inside openHandles).
//
// Scope: transport/protocol layer only. Tool handlers are thin calls into
// the existing typed service; E1 mounts this module at the contracted
// plugin entry (scripts/substrate-mcp.mjs); buildServer() is the reuse seam.
//
// XTRM-674: the tool set, names and text come from integrations/tool-surface.ts
// (shared with Pi); behaviour from integrations/tool-core.ts. This module only
// adapts zod schemas and the MCP envelope. MCP_TOOL_NAMES / MCP_TOOL_DESCRIPTIONS
// stay exported for the docs-drift gate.

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { currentExecutionContext, enrichExecutionContext } from "../../src/domain/execution-context.ts";
import { resolveIdentity } from "../../src/presentation/advisories.ts";
import { attachMutationFeedback } from "../../src/presentation/operation-feedback.ts";
import { runTool, type ToolContext, type WriteIdentity } from "../tool-core.ts";
import {
  CLAIM_OPS,
  CLOSURE_OUTCOMES,
  ISSUE_LIST_STATUSES,
  WRITABLE_JOURNAL_KINDS,
  JOURNAL_READ_MODES,
  paramDoc,
  TOOL_NAMES,
  TOOL_SPECS,
  type ToolName,
} from "../tool-surface.ts";
import { openHandles } from "./runtime.ts";

export const SUBSTRATE_SERVER_NAME = "substrate";
export const SUBSTRATE_SERVER_VERSION = "0.1.0";
export const SUBSTRATE_PROTOCOL_REVISION = "2026-07-28";

// Direct-execution entry as a callable (closeout E1): the packaged plugin
// mounts the server through serveMain() instead of importing the SDK
// itself, so the whole serving graph comes from substrate's own ESM
// imports. Importing @modelcontextprotocol/server a second time through a
// require-anchored seam loads the CJS build beside the ESM build, and the
// dual-instance mix crashes modern requests (CJS installDiscoverHandler
// reads an uninitialized _supportedProtocolVersions). One graph, one build.
export function serveMain(): void {
  serveStdio(() => buildServer(), {
    legacy: "reject",
    onerror: (err) => {
      console.error(`[substrate-mcp] ${err.message}`);
    },
  });
}


// Per-call handles: the WAL store is the shared authority (E2 resolution lives
// inside openHandles). Project resolution is repository-relative (ADR §§4-5):
// an uninitialized repository fails closed with the `sb init` guidance.
function textPayload(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(attachMutationFeedback(value)) }] };
}

// XTRM-435 / XTRM-672: unstated participant fills from the process ambient,
// then the xt worktree name (the MCP process never sees CLAUDE_ENV_FILE
// exports). Nothing is invented when both are empty.
function mcpIdentity(participant?: string): WriteIdentity {
  const ambient = currentExecutionContext();
  const participantId =
    participant ?? ambient?.participantId ?? resolveIdentity(process.env, process.cwd()).holder ?? undefined;
  return {
    participantId,
    executionContext: enrichExecutionContext({
      host: null,
      participantId: participantId ?? null,
      runId: null,
      specialist: ambient?.specialist ?? null,
    }),
  };
}

const MCP_CONTEXT: ToolContext = { author: "mcp", guardProject: true, identity: mcpIdentity };

const doc = (tool: ToolName, key: string) => paramDoc(tool, key);
const s = (tool: ToolName, key: string) => z.string().min(1).describe(doc(tool, key));
const int = (tool: ToolName, key: string) => z.number().int().describe(doc(tool, key));
const strings = (tool: ToolName, key: string) => z.array(z.string()).describe(doc(tool, key));

// Parameter keys must equal TOOL_SPECS[].params (asserted in tests/tool-surface.test.ts).
export const MCP_INPUT_SCHEMAS: Record<ToolName, z.ZodObject> = {
  issue_get: z.object({ ref: s("issue_get", "ref") }),
  issue_list: z.object({
    project: s("issue_list", "project").optional(),
    status: z.enum(ISSUE_LIST_STATUSES).describe(doc("issue_list", "status")).optional(),
    query: s("issue_list", "query").optional(),
    kind: s("issue_list", "kind").optional(),
    limit: int("issue_list", "limit").positive().optional(),
    claimedBy: s("issue_list", "claimedBy").optional(),
  }),
  issue_claim: z.object({
    ref: s("issue_claim", "ref"),
    op: z.enum(CLAIM_OPS).describe(doc("issue_claim", "op")).optional(),
    holder: s("issue_claim", "holder").optional(),
    ttlMs: int("issue_claim", "ttlMs").positive().optional(),
    activationId: s("issue_claim", "activationId").optional(),
  }),
  issue_update: z.object({
    ref: s("issue_update", "ref"),
    title: s("issue_update", "title").optional(),
    priority: int("issue_update", "priority").optional(),
    contract: z.record(z.string(), z.unknown()).describe(doc("issue_update", "contract")).optional(),
  }),
  issue_close: z.object({
    ref: s("issue_close", "ref"),
    outcome: z.enum(CLOSURE_OUTCOMES).describe(doc("issue_close", "outcome")),
    reason: s("issue_close", "reason"),
    journalResultRefs: strings("issue_close", "journalResultRefs").optional(),
    validationRefs: strings("issue_close", "validationRefs").optional(),
    receiptRefs: strings("issue_close", "receiptRefs").optional(),
    artifactRefs: strings("issue_close", "artifactRefs").optional(),
    participant: s("issue_close", "participant").optional(),
  }),
  journal_append: z.object({
    ref: s("journal_append", "ref"),
    kind: z.enum(WRITABLE_JOURNAL_KINDS as [string, ...string[]]).describe(doc("journal_append", "kind")),
    summary: s("journal_append", "summary").optional(),
    summaryFile: s("journal_append", "summaryFile").optional(),
    next: strings("journal_append", "next").optional(),
    details: z.record(z.string(), z.unknown()).describe(doc("journal_append", "details")).optional(),
    result: z.record(z.string(), z.unknown()).describe(doc("journal_append", "result")).optional(),
  }),
  journal_read: z.object({
    ref: s("journal_read", "ref"),
    mode: z.enum(JOURNAL_READ_MODES).describe(doc("journal_read", "mode")),
    kind: s("journal_read", "kind").optional(),
    cursor: int("journal_read", "cursor").min(0).optional(),
    limit: int("journal_read", "limit").positive().optional(),
  }),
  resume_capsule: z.object({ ref: s("resume_capsule", "ref") }),
  provenance: z.object({
    ref: s("provenance", "ref").optional(),
    sessionId: s("provenance", "sessionId").optional(),
    activationId: s("provenance", "activationId").optional(),
  }),
};

// Exported registration inventory: the docs-drift gate and tests consume it.
export const MCP_TOOL_NAMES: string[] = [...TOOL_NAMES];
export const MCP_TOOL_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  TOOL_SPECS.map((t) => [t.name, t.description]),
);

export async function callMcpTool(name: ToolName, args: Record<string, unknown>) {
  const handles = openHandles();
  try {
    return textPayload(await runTool(name, args, handles, MCP_CONTEXT));
  } finally {
    handles.db.close();
  }
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SUBSTRATE_SERVER_NAME, version: SUBSTRATE_SERVER_VERSION },
    // Static tool list: listChanged stays false (brief K — do not advertise
    // subscriptions that do not exist).
    { capabilities: { tools: { listChanged: false } } },
  );
  // Deterministic registration order (stable tools/list for client and
  // prompt-cache stability).
  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: MCP_INPUT_SCHEMAS[spec.name] },
      async (args) => callMcpTool(spec.name, args as Record<string, unknown>),
    );
  }
  return server;
}

// Direct execution (development, tests, and the pre-E1 plugin wiring):
// serve the modern era on process stdio, rejecting legacy openings.
const invokedAsMain =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
      return false;
    }
  })();
if (invokedAsMain) {
  serveMain();
}
