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
// M1 (XTRM-252.10): this module owns the final MCP registration set and the
// normative tool descriptions (ADR §§62-66). Every description states what
// the tool changes, what it does not change, whether the Issue revision
// changes, whether readiness goes stale, when to use the Journal instead of
// a contract edit, and what actor/session/provenance context is added
// automatically. Op-discriminated tools (issue_claim with op claim|release,
// journal_query with op since|latest|timeline) keep the permanent name count
// minimal. MCP_TOOL_NAMES / MCP_TOOL_DESCRIPTIONS are the exported inventory
// the docs-drift gate consumes; tools/list order follows TOOL_DEFS order.

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { isJournalKind, JOURNAL_KINDS } from "../../src/domain/journal.ts";
import { CLOSURE_OUTCOMES } from "../../src/domain/closure.ts";
import { enrichExecutionContext } from "../../src/domain/execution-context.ts";
import type { IssueService } from "../../src/service/issue-service.ts";
import type { JournalEntry } from "../../src/domain/journal.ts";
import { ClosureService } from "../../src/service/closure-service.ts";
import { ProvenanceService } from "../../src/service/provenance-service.ts";
import { discoverRepository } from "../../src/domain/repository-discovery.ts";
import { attachMutationFeedback } from "../../src/presentation/operation-feedback.ts";
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
// A mutation additionally refuses a ref from another Project (the read-only
// tools may inspect across Projects by explicit ref, a write may not).
function textPayload(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(attachMutationFeedback(value)) }] };
}

function resolveProjectId(svc: IssueService, explicit?: string): string {
  const repo = discoverRepository();
  return svc.resolveProject({
    explicit,
    env: process.env["SUBSTRATE_PROJECT"],
    gitRoot: repo.gitRoot,
    repositoryKey: repo.identity?.repositoryKey ?? null,
  }).projectId;
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

function entryJson(e: JournalEntry): Record<string, unknown> {
  return {
    id: e.id,
    sequence: e.sequence,
    kind: e.kind,
    sessionId: e.sessionId,
    mechanical: e.mechanical,
    semantic: e.semantic,
    result: e.result,
    createdAt: e.createdAt,
  };
}

function journalIdentity(args: {
  sessionId?: string;
  participantId?: string;
  activationId?: string;
  runId?: string;
}): {
  sessionId?: string;
  participantId?: string;
  activationId?: string;
  runId?: string;
  executionContext: ReturnType<typeof enrichExecutionContext>;
} {
  return {
    sessionId: args.sessionId ?? undefined,
    participantId: args.participantId ?? undefined,
    activationId: args.activationId ?? undefined,
    runId: args.runId ?? undefined,
    executionContext: enrichExecutionContext({
      host: args.sessionId ? { type: "claude", sessionId: args.sessionId } : null,
      participantId: args.participantId ?? null,
      runId: args.runId ?? null,
      specialist: args.activationId ? { activationId: args.activationId } : null,
    }),
  };
}

const KIND_GLOSSARY =
  "Journal kinds: note (generic useful annotation), finding (material discovered fact), " +
  "decision (chosen course plus rationale), blocker (unresolved condition preventing progress), " +
  "milestone (meaningful progress boundary), handoff (bounded continuation state), " +
  "result (bounded participant outcome with a versioned payload, required for meaningful settlement), " +
  "checkpoint (resumability boundary, mechanical row required), " +
  "compaction (conversation checkpoint, mechanical row required).";

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "issue_get",
    description:
      "Changes: nothing; this is a read-only lookup. " +
      "Does not change: no Issue field, no Journal, no claim, no provenance row. " +
      "Revision: the Issue revision never changes. " +
      "Readiness: never stale; readiness is derived live from the current revision, state, attestation and blockers. " +
      "Use the Journal instead: never for progress, findings, decisions, handoffs or results — append a Journal entry for those; " +
      "use issue_update only to change execution-authoritative Issue fields. " +
      "Automatic context: none is added; the caller supplies only the ref.",
    schema: z.object({ ref: z.string().min(1), dbPath: dbPathSchema }),
    handler: async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const i = handles.svc.resolveRef(ref as string);
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
  },
  {
    name: "issue_list",
    description:
      "Changes: nothing; this is a read-only project listing (the search surface alongside issue_ready). " +
      "Does not change: no Issue field, no Journal, no claim, no provenance row. " +
      "Revision: no Issue revision changes. " +
      "Readiness: never stale; per-issue readiness is derived live when requested via issue_get or issue_ready. " +
      "Use the Journal instead: never for progress or findings — list only locates work, journal entries record it. " +
      "Automatic context: none is added; the Project resolves explicit project else SUBSTRATE_PROJECT else this repository binding, " +
      "and an uninitialized repository fails closed with the sb init guidance.",
    schema: z.object({ project: z.string().optional(), dbPath: dbPathSchema }),
    handler: async ({ project, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        return textPayload(handles.svc.listIssues(projectId).map(issueSummaryJson));
      } finally {
        handles.db.close();
      }
    },
  },
  {
    name: "issue_ready",
    description:
      "Changes: nothing; this is a read-only dispatchability filter over the project listing. " +
      "Does not change: no Issue field, no Journal, no claim, no provenance row. " +
      "Revision: no Issue revision changes. " +
      "Readiness: never stale; dispatchability is derived live per Issue from state, structural validity, attestation currency and blockers. " +
      "Use the Journal instead: never for progress or findings — ready only selects work, journal entries record it. " +
      "Automatic context: none is added; the Project resolves exactly as issue_list, and an uninitialized repository fails closed.",
    schema: z.object({ project: z.string().optional(), dbPath: dbPathSchema }),
    handler: async ({ project, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
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
  },
  {
    name: "issue_claim",
    description:
      "Changes: the Issue claim lease only (op claim takes the lease for holder, op release surrenders it). " +
      "Does not change: no Issue field, no contract, no Journal entry, no provenance row. " +
      "Revision: the Issue revision never changes; a later contract edit still binds a new revision. " +
      "Readiness: never stale from the lease alone, but a claim does not attest readiness — dispatchability still derives from state, " +
      "attestation currency and blockers, and claiming a non-dispatchable Issue fails closed. " +
      "Use the Journal instead: for progress, findings, decisions, handoffs and results — the claim only says who owns the work, " +
      "the Journal says what happened. " +
      "Automatic context: the claim row records holder, activation id, generation and expiry automatically; " +
      "same-holder reclaim is idempotent, stealing another live holder fails closed, and expiry closes the old generation first.",
    schema: z.object({
      op: z.enum(["claim", "release"]),
      ref: z.string().min(1),
      holder: z.string().min(1),
      activationId: z.string().optional(),
      ttlMs: z.number().int().positive().optional(),
      project: z.string().optional(),
      dbPath: dbPathSchema,
    }),
    handler: async ({ op, ref, holder, activationId, ttlMs, project, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        const issue = handles.svc.resolveRefInProject(ref as string, projectId);
        if (op === "claim") {
          const claim = handles.svc.claimIssue(issue.id, holder as string, {
            activationId: (activationId as string | undefined) ?? undefined,
            ttlMs: (ttlMs as number | undefined) ?? undefined,
          });
          return textPayload({ op, issueId: issue.id, claim });
        }
        const claim = handles.svc.releaseClaim(issue.id, holder as string, {
          activationId: (activationId as string | undefined) ?? undefined,
        });
        return textPayload({ op, issueId: issue.id, claim });
      } finally {
        handles.db.close();
      }
    },
  },
  {
    name: "issue_update",
    description:
      "Changes: execution-authoritative Issue fields. Title and priority are metadata writes; " +
      "contract, ownership, context-refs and scrutiny are revision-bearing writes. " +
      "Does not change: the Journal (no entry is appended), claims, provenance rows, or lifecycle state. " +
      "Revision: metadata writes keep the revision and retain readiness; revision-bearing writes create a new revision " +
      "and invalidate prior readiness and attestation. Identical contracts are a no-op. " +
      "Readiness: goes stale exactly when a new revision is created — re-validate and re-attest before dispatch. " +
      "Use the Journal instead: for progress, findings, decisions, blockers, handoffs and results — " +
      "do not use this tool for progress; use the Journal for those. " +
      "Automatic context: the revision row records author, contract hash and timestamp automatically; " +
      "actor/session/provenance enrichment rides Journal entries and execution bindings, not this tool.",
    schema: z.object({
      ref: z.string().min(1),
      title: z.string().min(1).optional(),
      priority: z.number().int().optional(),
      contract: z.record(z.string(), z.unknown()).optional(),
      ownership: z.unknown().optional(),
      contextRefs: z.array(z.unknown()).optional(),
      scrutiny: z.string().optional(),
      expectedRevision: z.number().int().optional(),
      project: z.string().optional(),
      dbPath: dbPathSchema,
    }),
    handler: async ({ ref, title, priority, contract, ownership, contextRefs, scrutiny, expectedRevision, project, dbPath }) => {
      if (title === undefined && priority === undefined && contract === undefined && ownership === undefined && contextRefs === undefined && scrutiny === undefined) {
        throw new Error("nothing to update: pass title, priority, contract, ownership, contextRefs, or scrutiny");
      }
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        const resolved = handles.svc.resolveRefInProject(ref as string, projectId);
        let id = resolved.id;
        let revisionCreated = false;
        if (title !== undefined) id = handles.svc.setTitle(id, title as string).id;
        if (priority !== undefined) id = handles.svc.setPriority(id, priority as number).id;
        if (contract !== undefined || ownership !== undefined || contextRefs !== undefined) {
          const base = contract !== undefined ? (contract as never) : (handles.svc.getRevision(id, handles.svc.getIssue(id).currentRevision).contract as never);
          const { issue, created } = handles.svc.updateContract(id, base, "mcp", {
            expectedRevision: (expectedRevision as number | undefined) ?? undefined,
            ownership: ownership !== undefined ? ownership : undefined,
            contextRefs: contextRefs !== undefined ? (contextRefs as unknown[]) : undefined,
          });
          id = issue.id;
          revisionCreated = revisionCreated || created;
        }
        if (scrutiny !== undefined) {
          const before = handles.svc.getIssue(id).currentRevision;
          const next = handles.svc.setScrutiny(id, scrutiny as string);
          revisionCreated = revisionCreated || next.currentRevision !== before;
          id = next.id;
        }
        const issue = handles.svc.getIssue(id);
        return textPayload({ ...issueSummaryJson(issue), revisionCreated });
      } finally {
        handles.db.close();
      }
    },
  },
  {
    name: "issue_note",
    description:
      "Changes: appends one append-only Journal entry (the sb issue note fast path). " +
      "Does not change: no Issue field, no contract, no claim, no provenance row. " +
      "Revision: the Issue revision never changes; notes never bump it. " +
      "Readiness: never goes stale; notes carry no execution authority. " +
      "Use the Journal instead: this IS the Journal fast path — use it (not issue_update) for notes, findings, decisions, " +
      "blockers, milestones, handoffs, and bounded results; a progress note or a contract edit must not be used " +
      "in place of a result. " +
      "Automatic context: the entry records issue revision, sequence, timestamp and the shared versioned execution envelope " +
      "(actor, participant, session, host, run, workspace) automatically; kind result requires a bounded result payload " +
      "and checkpoint/compaction kinds are not accepted here — use journal_append or journal_checkpoint for those. " +
      "Accepted kinds: note (generic useful annotation), finding (material discovered fact), decision (chosen course plus rationale), " +
      "blocker (unresolved condition preventing progress), milestone (meaningful progress boundary), " +
      "handoff (bounded continuation state), result (bounded participant outcome with a versioned payload).",
    schema: z.object({
      ref: z.string().min(1), kind: z.enum(["note", "finding", "decision", "blocker", "milestone", "handoff", "result"]),
      summary: z.string().min(1), result: z.unknown().optional(), sessionId: z.string().optional(), participantId: z.string().optional(),
      activationId: z.string().optional(), runId: z.string().optional(), project: z.string().optional(), dbPath: dbPathSchema,
    }),
    handler: async ({ ref, kind, summary, result, sessionId, participantId, activationId, runId, project, dbPath }) => {
      if (!isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
      if (kind === "result" && result === undefined) throw new Error('journal kind "result" requires a bounded result payload (§29)');
      if (kind !== "result" && result !== undefined) throw new Error(`journal kind "${kind}" does not carry a result payload`);
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        const issue = handles.svc.resolveRefInProject(ref as string, projectId);
        const entry = handles.journal.appendEntry(issue.id, {
          kind: kind as "note",
          ...journalIdentity({ sessionId: sessionId as string | undefined, participantId: participantId as string | undefined, activationId: activationId as string | undefined, runId: runId as string | undefined }),
          semantic: { summary: (summary as string).slice(0, 2000) },
          result: result !== undefined ? (result as never) : undefined,
        });
        return textPayload({ entryId: entry.id, sequence: entry.sequence });
      } finally { handles.db.close(); }
    },
  },
  {
    name: "issue_close",
    description:
      "Changes: writes one immutable Closure row (outcome, reason, actor, revision, contract hash, refs) and rests the lifecycle on done (cancelled only for the cancelled outcome). " +
      "Does not change: history — Closure rows are never edited; a mistaken close reopens, it never rewrites. " +
      "Revision: the Issue revision never changes; the Closure pins the current revision and contract hash as evidence. " +
      "Readiness: terminal — dispatchability ends at close; after reopen the Issue must re-validate and re-attest. " +
      "Use the Journal instead: for the settlement evidence itself — a meaningful close cites journal result refs and validation/receipt refs; a progress note or a contract edit must not be used in place of a result; the bounded result payload is required. " +
      "Automatic context: the Closure records actor, execution envelope (session, participant, run, workspace), closed-at timestamp and provenance refs automatically; outcome must be one of completed|superseded|duplicate|wont_fix|invalid|cancelled|abandoned, and reason is required (it lives in the row, never only in git log).",
    schema: z.object({
      ref: z.string().min(1), outcome: z.enum(CLOSURE_OUTCOMES), reason: z.string().min(1), actor: z.string().min(1),
      validationRefs: z.array(z.string()).optional(), journalResultRefs: z.array(z.string()).optional(), receiptRefs: z.array(z.string()).optional(), artifactRefs: z.array(z.string()).optional(),
      sessionId: z.string().optional(), participantId: z.string().optional(), activationId: z.string().optional(), runId: z.string().optional(), project: z.string().optional(), dbPath: dbPathSchema,
    }),
    handler: async ({ ref, outcome, reason, actor, validationRefs, journalResultRefs, receiptRefs, artifactRefs, sessionId, participantId, activationId, runId, project, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        const issue = handles.svc.resolveRefInProject(ref as string, projectId);
        const closures = new ClosureService(handles.db, handles.svc);
        const closure = closures.closeIssue(issue.id, {
          outcome: outcome as (typeof CLOSURE_OUTCOMES)[number], reason: reason as string, actor: actor as string,
          executionContext: enrichExecutionContext({
            host: (sessionId as string | undefined) ? { type: "claude", sessionId: sessionId as string } : null,
            participantId: (participantId as string | undefined) ?? null,
            runId: (runId as string | undefined) ?? null,
            specialist: (activationId as string | undefined) ? { activationId: activationId as string } : null,
          }),
          validationRefs: (validationRefs as string[] | undefined) ?? undefined,
          journalResultRefs: (journalResultRefs as string[] | undefined) ?? undefined,
          receiptRefs: (receiptRefs as string[] | undefined) ?? undefined,
          artifactRefs: (artifactRefs as string[] | undefined) ?? undefined,
        });
        return textPayload({ closureId: closure.closureId, issueId: closure.issueId, outcome: closure.outcome, terminalState: closure.terminalState, issueRevision: closure.issueRevision });
      } finally { handles.db.close(); }
    },
  },
  {
    name: "journal_append",
    description:
      "Changes: appends one append-only Journal entry of any of the nine kinds. " +
      "Does not change: no Issue field, no contract, no claim, no provenance row, and never the lifecycle state. " +
      "Revision: the Issue revision never changes; the entry pins the current revision for correlation only. " +
      "Readiness: never goes stale; journal entries carry continuity, never execution authority — only a contract edit invalidates readiness. " +
      "Use the Journal instead: this IS the Journal — use it (not issue_update) for progress, findings, decisions, blockers, milestones, handoffs, results and checkpoints. " +
      "Automatic context: the entry records issue revision, sequence, timestamp and the shared versioned execution envelope (actor, participant, session, host, run, workspace) automatically; checkpoint and compaction kinds require a mechanical row, kind result requires a bounded versioned result payload (never a plain note), and other kinds reject a result payload. " + KIND_GLOSSARY,
    schema: z.object({
      ref: z.string().min(1), kind: z.enum(JOURNAL_KINDS), summary: z.string().min(1).optional(), mechanical: z.unknown().optional(), semantic: z.unknown().optional(), result: z.unknown().optional(), refs: z.array(z.unknown()).optional(),
      sessionId: z.string().optional(), participantId: z.string().optional(), activationId: z.string().optional(), runId: z.string().optional(), project: z.string().optional(), dbPath: dbPathSchema,
    }),
    handler: async ({ ref, kind, summary, mechanical, semantic, result, refs, sessionId, participantId, activationId, runId, project, dbPath }) => {
      if (!isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
      if ((kind === "checkpoint" || kind === "compaction") && mechanical === undefined) throw new Error(`journal kind "${kind}" requires a mechanical checkpoint (§20.4) — use journal_checkpoint for the collected default`);
      if (kind !== "checkpoint" && kind !== "compaction" && summary === undefined && semantic === undefined) throw new Error(`journal kind "${kind}" requires a summary (or an explicit semantic payload)`);
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        const issue = handles.svc.resolveRefInProject(ref as string, projectId);
        const entry = handles.journal.appendEntry(issue.id, {
          kind: kind as "note",
          ...journalIdentity({ sessionId: sessionId as string | undefined, participantId: participantId as string | undefined, activationId: activationId as string | undefined, runId: runId as string | undefined }),
          mechanical: mechanical !== undefined ? (mechanical as never) : undefined,
          semantic: semantic !== undefined ? (semantic as never) : summary !== undefined ? ({ summary: (summary as string).slice(0, 2000) } as never) : undefined,
          result: result !== undefined ? (result as never) : undefined,
          refs: refs !== undefined ? (refs as never) : undefined,
        });
        return textPayload({ entryId: entry.id, sequence: entry.sequence });
      } finally { handles.db.close(); }
    },
  },
  {
    name: "journal_checkpoint",
    description:
      "Changes: appends one mechanical-first checkpoint entry (the collected resumability boundary). " +
      "Does not change: no Issue field, no contract, no claim, no provenance row, and never the lifecycle state. " +
      "Revision: the Issue revision never changes; the mechanical row pins revision and contract hash for correlation only. " +
      "Readiness: never goes stale; checkpoints carry resumability, never execution authority. " +
      "Use the Journal instead: this IS the Journal checkpoint path — checkpoint now so a later session resumes from mechanical state, and record decisions, progress notes and outcomes as separate entries rather than editing the contract; a progress note or a contract edit must not be used in place of a result — record outcomes as kind result entries. " +
      "Automatic context: the mechanical row is collected automatically (revision, contract hash, claim, workspace, branch, commits where available) and the shared versioned execution envelope is attached automatically; an optional semantic summary enriches the entry afterwards without risking the committed mechanical state. " + KIND_GLOSSARY,
    schema: z.object({
      ref: z.string().min(1), summary: z.string().min(1).optional(), workspace: z.string().optional(), branch: z.string().optional(), baseCommit: z.string().optional(), headCommit: z.string().optional(),
      sessionId: z.string().optional(), participantId: z.string().optional(), activationId: z.string().optional(), runId: z.string().optional(), project: z.string().optional(), dbPath: dbPathSchema,
    }),
    handler: async ({ ref, summary, workspace, branch, baseCommit, headCommit, sessionId, participantId, activationId, runId, project, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const projectId = resolveProjectId(handles.svc, project as string | undefined);
        const issue = handles.svc.resolveRefInProject(ref as string, projectId);
        const identity = journalIdentity({ sessionId: sessionId as string | undefined, participantId: participantId as string | undefined, activationId: activationId as string | undefined, runId: runId as string | undefined });
        const mechanical = handles.journal.collectMechanical(issue.id, {
          ...identity, workspace: (workspace as string | undefined) ?? undefined, branch: (branch as string | undefined) ?? undefined,
          baseCommit: (baseCommit as string | undefined) ?? undefined, headCommit: (headCommit as string | undefined) ?? undefined,
        });
        const entry = handles.journal.appendEntry(issue.id, { kind: "checkpoint", ...identity, mechanical });
        if (summary === undefined) return textPayload({ entryId: entry.id, sequence: entry.sequence, degraded: false });
        try {
          const enriched = handles.journal.enrichEntry(entry.id, { summary: (summary as string).slice(0, 2000) });
          return textPayload({ entryId: enriched.id, sequence: enriched.sequence, degraded: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          handles.svc.appendEvent(issue.id, "journal.checkpoint_degraded", { entry: entry.id, sequence: entry.sequence, reason });
          return textPayload({ entryId: entry.id, sequence: entry.sequence, degraded: true, reason });
        }
      } finally { handles.db.close(); }
    },
  },
  {
    name: "journal_show",
    description:
      "Changes: nothing; this is the full-body Journal read (entries in sequence order, oldest first). " +
      "Does not change: no Issue field, no Journal entry, no claim, no provenance row. " +
      "Revision: the Issue revision never changes. " +
      "Readiness: never stale; reads derive from current durable state. " +
      "Use the Journal instead: reads never substitute for writing — record progress with journal_append, journal_checkpoint or issue_note, never by editing the contract; for bounded windows use journal_query (since, latest, timeline). " +
      "Automatic context: none is added; entries arrive with the revision, sequence, timestamp and execution envelope stored at append time. " + KIND_GLOSSARY,
    schema: z.object({ ref: z.string().min(1), limit: z.number().int().positive().optional(), dbPath: dbPathSchema }),
    handler: async ({ ref, limit, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const id = handles.svc.resolveRef(ref as string).id;
        return textPayload(handles.journal.listEntries(id, limit !== undefined ? { limit: limit as number } : undefined).map(entryJson));
      } finally { handles.db.close(); }
    },
  },
  {
    name: "journal_query",
    description:
      "Changes: nothing; this is the op-discriminated bounded Journal read (op since returns the compact delta after a sequence cursor, op latest returns the newest entry optionally of one kind, op timeline returns the bounded recent window). " +
      "Does not change: no Issue field, no Journal entry, no claim, no provenance row. " +
      "Revision: the Issue revision never changes. " +
      "Readiness: never stale; reads derive from current durable state. " +
      "Use the Journal instead: reads never substitute for writing — record progress with journal_append, journal_checkpoint or issue_note, never by editing the contract; for full bodies use journal_show. " +
      "Automatic context: none is added; entries arrive with the revision, sequence, timestamp and execution envelope stored at append time. " + KIND_GLOSSARY,
    schema: z.object({ op: z.enum(["since", "latest", "timeline"]), ref: z.string().min(1), kind: z.enum(JOURNAL_KINDS).optional(), limit: z.number().int().positive().optional(), cursor: z.number().int().min(0).optional(), dbPath: dbPathSchema }),
    handler: async ({ op, ref, kind, limit, cursor, dbPath }) => {
      if (kind !== undefined && !isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
      const handles = openHandles(dbPath as string | undefined);
      try {
        const id = handles.svc.resolveRef(ref as string).id;
        if (op === "since") {
          if (cursor === undefined) throw new Error('journal_query op "since" requires a sequence cursor (0 reads all)');
          return textPayload(handles.journal.since(id, cursor as number));
        }
        if (op === "latest") {
          const entry = handles.journal.latest(id, kind !== undefined ? { kind: kind as "note" } : undefined);
          if (!entry) throw new Error(`no journal entry${kind !== undefined ? ` (kind ${kind})` : ""} for this issue`);
          return textPayload(entryJson(entry));
        }
        return textPayload(handles.journal.timeline(id, { kind: (kind as "note" | undefined) ?? undefined, limit: (limit as number | undefined) ?? undefined }).map(entryJson));
      } finally { handles.db.close(); }
    },
  },
  {
    name: "provenance_trace",
    description:
      "Changes: nothing; this is the read-only lineage spine (bindings, receipts with artifacts, attestation, claims, closure view). " +
      "Does not change: no Issue field, no Journal entry, no binding, no receipt, no closure. " +
      "Revision: the Issue revision never changes; the trace reports the revision each link was bound to. " +
      "Readiness: never stale; the trace derives from current durable state. " +
      "Use the Journal instead: for recording what happened — the trace only shows the evidence spine; progress and outcomes belong in Journal entries, and the contract must not be edited to narrate history. " +
      "Automatic context: none is added; each spine element carries the actor, session and execution envelope stored when it was written.",
    schema: z.object({ ref: z.string().min(1), dbPath: dbPathSchema }),
    handler: async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const id = handles.svc.resolveRef(ref as string).id;
        const provenance = new ProvenanceService(handles.db, handles.svc, handles.journal);
        return textPayload(provenance.trace(id));
      } finally { handles.db.close(); }
    },
  },
  {
    name: "provenance_session",
    description:
      "Changes: nothing; session-centric read-model of what one session touched (issues, bindings, receipts, artifacts, result count). " +
      "Does not change: no Issue field, no Journal entry, no binding, no receipt, no closure. " +
      "Revision: the Issue revision never changes; each returned link reports the revision it was bound to. " +
      "Readiness: never stale; the view derives from current durable state. " +
      "Use the Journal instead: for recording what the session did — this view only reads the stored spine. " +
      "Automatic context: none is added; the session id is the XTRM session recorded on the underlying rows.",
    schema: z.object({ sessionId: z.string().min(1), dbPath: dbPathSchema }),
    handler: async ({ sessionId, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const provenance = new ProvenanceService(handles.db, handles.svc, handles.journal);
        return textPayload(provenance.sessionDetail(sessionId as string));
      } finally { handles.db.close(); }
    },
  },
  {
    name: "provenance_activation",
    description:
      "Changes: nothing; activation-centric read-model of what one Specialist activation produced (issues, bindings, receipts, artifacts). " +
      "Does not change: no Issue field, no Journal entry, no binding, no receipt, no closure. " +
      "Revision: the Issue revision never changes; each returned link reports the revision it was bound to. " +
      "Readiness: never stale; the view derives from current durable state. " +
      "Use the Journal instead: for recording what the activation did — this view only reads the stored spine. " +
      "Automatic context: none is added; the activation, attempt and AgentSession identity come from the stored execution envelope.",
    schema: z.object({ activationId: z.string().min(1), dbPath: dbPathSchema }),
    handler: async ({ activationId, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const provenance = new ProvenanceService(handles.db, handles.svc, handles.journal);
        return textPayload(provenance.activationDetail(activationId as string));
      } finally { handles.db.close(); }
    },
  },
  {
    name: "resume_capsule",
    description:
      "Changes: nothing; the capsule is derived live from the Issue, latest checkpoint, deltas, blockers, claim and provenance — never a stored source of truth. " +
      "Does not change: no Issue field, no Journal entry, no claim, no provenance row. " +
      "Revision: the Issue revision never changes; the capsule reports the revision it was built from, and a newer revision renders a prior capsule stale — rebuild after every contract edit. " +
      "Readiness: never stale from the read, but the capsule carries the readiness computed at build time — re-validate before dispatch. " +
      "Use the Journal instead: for recording continuation state — checkpoint and handoff entries are what the next capsule is built from; never edit the contract to leave a note to the next session. " +
      "Automatic context: none is added; the capsule assembles the actor, session and execution context already stored on the underlying rows.",
    schema: z.object({ ref: z.string().min(1), dbPath: dbPathSchema }),
    handler: async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath as string | undefined);
      try {
        const id = handles.svc.resolveRef(ref as string).id;
        const capsule = handles.resume.buildCapsule(id);
        return textPayload({ capsule, rendered: handles.resume.renderCapsule(capsule) });
      } finally { handles.db.close(); }
    },
  },
];

export const MCP_TOOL_NAMES: string[] = TOOL_DEFS.map((d) => d.name);
export const MCP_TOOL_DESCRIPTIONS: Record<string, string> = Object.fromEntries(TOOL_DEFS.map((d) => [d.name, d.description]));

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SUBSTRATE_SERVER_NAME, version: SUBSTRATE_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } },
  );
  for (const def of TOOL_DEFS) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.schema }, async (args) => def.handler(args as Record<string, unknown>));
  }
  return server;
}

const invokedAsMain =
  process.argv[1] !== undefined &&
  (() => {
    try { return import.meta.url === pathToFileURL(process.argv[1]).href; }
    catch { return false; }
  })();
if (invokedAsMain) serveMain();
