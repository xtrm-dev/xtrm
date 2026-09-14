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
// the existing typed service; E4 (xtrm-iip.4) owns the tool surface
// content — E3 registers one thin read (issue_get) to prove the end-to-end
// path. E1 mounts this module at the contracted plugin entry
// (scripts/substrate-mcp.ts); buildServer() is the reuse seam.

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { isJournalKind } from "../../src/domain/journal.ts";
import { enrichExecutionContext } from "../../src/domain/execution-context.ts";
import { ProvenanceService } from "../../src/service/provenance-service.ts";
import { discoverRepository } from "../../src/domain/repository-discovery.ts";
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

const dbPathSchema = z.string().optional();

// Every handler opens and closes its own handle per call (the WAL store is
// the shared authority; E2 resolution lives inside openHandles). No
// business logic here: parse, call the typed service, render JSON.
//
// Project resolution is repository-relative (ADR §§4-5): the process cwd is
// discovered as a Git repository and the derived repositoryKey is handed to
// the resolver, so an uninitialized repository fails closed with the
// `sb init` guidance instead of falling back to a single global Project.
// `null` discovery (not a Git checkout) also fails closed in the resolver.
function textPayload(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function issueSummaryJson(i: {
  id: string;
  locator: string;
  humanRef: string;
  title: string;
  kind: string;
  lifecycleState: string;
  currentRevision: number;
}): Record<string, unknown> {
  return {
    id: i.id,
    locator: i.locator,
    humanRef: i.humanRef,
    title: i.title,
    kind: i.kind,
    lifecycleState: i.lifecycleState,
    revision: i.currentRevision,
  };
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SUBSTRATE_SERVER_NAME, version: SUBSTRATE_SERVER_VERSION },
    // Static tool list: listChanged stays false (brief K — do not advertise
    // subscriptions that do not exist).
    { capabilities: { tools: { listChanged: false } } },
  );
  // Deterministic registration order (stable tools/list for client and
  // prompt-cache stability, brief P). E6 wake/event tools are out of scope.
  server.registerTool(
    "issue_get",
    {
      description: "Resolve an issue ref to its summary plus readiness state.",
      inputSchema: z.object({ ref: z.string().min(1), dbPath: dbPathSchema }),
    },
    async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const i = handles.svc.resolveRef(ref);
        const readiness = handles.svc.getReadiness(i.id);
        return textPayload({
          ...issueSummaryJson(i),
          readinessState: readiness.state,
          dispatchable: readiness.dispatchable,
        });
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "issue_list",
    {
      description: "List issue summaries for a project (explicit project, SUBSTRATE_PROJECT, or this repository's binding; fails closed for an uninitialized repository).",
      inputSchema: z.object({ project: z.string().optional(), dbPath: dbPathSchema }),
    },
    async ({ project, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const repo = discoverRepository();
        const projectId = handles.svc.resolveProject({
          explicit: project ?? undefined,
          env: process.env["SUBSTRATE_PROJECT"],
          gitRoot: repo.gitRoot,
          repositoryKey: repo.identity?.repositoryKey ?? null,
        }).projectId;
        return textPayload(handles.svc.listIssues(projectId).map(issueSummaryJson));
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "issue_ready",
    {
      description: "List dispatchable-ready issues for a project (same resolution as issue_list).",
      inputSchema: z.object({ project: z.string().optional(), dbPath: dbPathSchema }),
    },
    async ({ project, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const repo = discoverRepository();
        const projectId = handles.svc.resolveProject({
          explicit: project ?? undefined,
          env: process.env["SUBSTRATE_PROJECT"],
          gitRoot: repo.gitRoot,
          repositoryKey: repo.identity?.repositoryKey ?? null,
        }).projectId;
        const out = [];
        for (const i of handles.svc.listIssues(projectId)) {
          const r = handles.svc.getReadiness(i.id);
          if (r.dispatchable) out.push({ ...issueSummaryJson(i), readinessState: r.state, dispatchable: true });
        }
        return textPayload(out);
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "journal_append",
    {
      description: "Append a journal entry (finding/decision/handoff/milestone/blocker) with a semantic summary. The ref must belong to this repository's Project unless an explicit project override is passed; fails closed for an uninitialized repository.",
      inputSchema: z.object({
        ref: z.string().min(1),
        kind: z.string().min(1),
        summary: z.string().min(1),
        sessionId: z.string().optional(),
        project: z.string().optional(),
        dbPath: dbPathSchema,
      }),
    },
    async ({ ref, kind, summary, sessionId, project, dbPath }) => {
      if (!isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
      const handles = openHandles(dbPath);
      try {
        // A journal append is a mutation, so it resolves the effective
        // repository context and refuses a ref from another Project (ADR §§4-5,
        // 85): the read-only tools may inspect across Projects by explicit ref,
        // a write may not.
        const repo = discoverRepository();
        const projectId = handles.svc.resolveProject({
          explicit: project ?? undefined,
          env: process.env["SUBSTRATE_PROJECT"],
          gitRoot: repo.gitRoot,
          repositoryKey: repo.identity?.repositoryKey ?? null,
        }).projectId;
        const issue = handles.svc.resolveRefInProject(ref, projectId);
        const entry = handles.journal.appendEntry(issue.id, {
          kind,
          sessionId: sessionId ?? undefined,
          semantic: { summary: summary.slice(0, 2000) },
          executionContext: enrichExecutionContext({
            host: sessionId ? { type: "claude", sessionId } : null,
          }),
        });
        return textPayload({ entryId: entry.id, sequence: entry.sequence });
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "journal_show",
    {
      description: "Show journal entries for an issue, newest last (full bodies).",
      inputSchema: z.object({ ref: z.string().min(1), limit: z.number().int().positive().optional(), dbPath: dbPathSchema }),
    },
    async ({ ref, limit, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const id = handles.svc.resolveRef(ref).id;
        return textPayload(
          handles.journal.listEntries(id, limit !== undefined ? { limit } : undefined).map((e) => ({
            id: e.id,
            sequence: e.sequence,
            kind: e.kind,
            sessionId: e.sessionId,
            mechanical: e.mechanical,
            semantic: e.semantic,
            createdAt: e.createdAt,
          })),
        );
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "provenance_trace",
    {
      description: "Full ProvenanceService trace for an issue (bindings, receipts with artifacts, attestation, claims). Read-model only.",
      inputSchema: z.object({ ref: z.string().min(1), dbPath: dbPathSchema }),
    },
    async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const id = handles.svc.resolveRef(ref).id;
        const provenance = new ProvenanceService(handles.db, handles.svc, handles.journal);
        return textPayload(provenance.trace(id));
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "provenance_session",
    {
      description: "Session-centric provenance: what did this session touch (issues, bindings, receipts, artifacts, result count). Read-model only.",
      inputSchema: z.object({ sessionId: z.string().min(1), dbPath: dbPathSchema }),
    },
    async ({ sessionId, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const provenance = new ProvenanceService(handles.db, handles.svc, handles.journal);
        return textPayload(provenance.sessionDetail(sessionId));
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "provenance_activation",
    {
      description: "Activation-centric provenance: what did this activation produce (issues, bindings, receipts, artifacts). Read-model only.",
      inputSchema: z.object({ activationId: z.string().min(1), dbPath: dbPathSchema }),
    },
    async ({ activationId, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const provenance = new ProvenanceService(handles.db, handles.svc, handles.journal);
        return textPayload(provenance.activationDetail(activationId));
      } finally {
        handles.db.close();
      }
    },
  );
  server.registerTool(
    "resume_capsule",
    {
      description: "Build the Resume Capsule for an issue (contract + latest checkpoint + deltas) with its rendering.",
      inputSchema: z.object({ ref: z.string().min(1), dbPath: dbPathSchema }),
    },
    async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const id = handles.svc.resolveRef(ref).id;
        const capsule = handles.resume.buildCapsule(id);
        return textPayload({ capsule, rendered: handles.resume.renderCapsule(capsule) });
      } finally {
        handles.db.close();
      }
    },
  );
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
