// Shared execution of the tool surface (XTRM-674). Both adapters (Claude MCP,
// Pi) parse their own schema, then call runTool(); the behaviour, defaults,
// warnings and mutation feedback live here once. Host differences enter only
// through ToolContext.

import { existsSync, readFileSync } from "node:fs";
import { assessJournalEntry, isJournalKind, previewText, type JournalEntry, type SemanticCheckpoint } from "../src/domain/journal.ts";
import { CLOSURE_OUTCOMES } from "../src/domain/closure.ts";
import type { ExecutionContext } from "../src/domain/execution-context.ts";
import type { LifecycleState } from "../src/domain/issue.ts";
import type { OperationalState } from "../src/domain/readiness.ts";
import { discoverRepository } from "../src/domain/repository-discovery.ts";
import { resolveIdentity } from "../src/presentation/advisories.ts";
import {
  attachMutationFeedback,
  noopFeedback,
  successFeedback,
  withFeedback,
  withWarnings,
  type OperationFeedback,
} from "../src/presentation/operation-feedback.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import type { IssueService } from "../src/service/issue-service.ts";
import type { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import type { ResumeService } from "../src/service/resume-service.ts";
import type { openSubstrate } from "../src/store/sqlite.ts";
import type { ToolName } from "./tool-surface.ts";

const DEFAULT_LIST_LIMIT = 100;
const CLAIMED_BY_GRACE_MS = 2 * 60 * 60 * 1000;
const HANDOFF_PREVIEW = 200;

export interface ToolHandles {
  db: ReturnType<typeof openSubstrate>;
  svc: IssueService;
  journal: JournalService;
  resume: ResumeService;
}

/** Identity a write carries; the adapter owns host/session facets. */
export interface WriteIdentity {
  sessionId?: string;
  participantId?: string;
  activationId?: string;
  runId?: string;
  executionContext: ExecutionContext | null;
}

export interface ToolContext {
  /** Author label stored on contract revisions. */
  author: string;
  /** MCP refuses refs outside the resolved project on writes; Pi does not. */
  guardProject: boolean;
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Adapter-built identity for journal and closure writes; participant is already resolved when known. */
  identity(participant?: string): WriteIdentity;
  onClaim?(issueId: string, holder: string, activationId?: string): void;
}

type Args = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);

function ambientHolder(ctx: ToolContext): string | null {
  return resolveIdentity(ctx.env ?? process.env, ctx.cwd ?? process.cwd()).holder;
}

function requireHolder(tool: string, explicit: string | undefined, ctx: ToolContext): string {
  const holder = explicit ?? ambientHolder(ctx);
  if (!holder) throw new Error(`${tool}: no holder; pass it or set SUBSTRATE_HOLDER`);
  return holder;
}

function projectIdFor(h: ToolHandles, explicit?: string): string {
  const repo = discoverRepository();
  return h.svc.resolveProject({
    explicit,
    env: process.env["SUBSTRATE_PROJECT"],
    gitRoot: repo.gitRoot,
    repositoryKey: repo.identity?.repositoryKey ?? null,
  }).projectId;
}

function resolveRead(h: ToolHandles, ref: string) {
  return h.svc.resolveRef(ref);
}

function resolveWrite(h: ToolHandles, ctx: ToolContext, ref: string) {
  return ctx.guardProject ? h.svc.resolveRefInProject(ref, projectIdFor(h)) : h.svc.resolveRef(ref);
}

function summaryOf(i: { id: string; locator: string; humanRef: string; title: string; kind: string; lifecycleState: string; currentRevision: number }) {
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
    issueRevision: e.issueRevision,
    participantId: e.participantId,
    activationId: e.activationId,
    sessionId: e.sessionId,
    mechanical: e.mechanical,
    semantic: e.semantic,
    result: e.result,
    createdAt: e.createdAt,
  };
}

/** Adds warnings to the feedback the shared inference chose (or an explicit one). */
function finish(data: Record<string, unknown>, warnings: string[], feedback?: OperationFeedback): Record<string, unknown> {
  const out = feedback ? withFeedback(data, feedback) : (attachMutationFeedback(data) as Record<string, unknown> & { feedback: OperationFeedback });
  return warnings.length > 0 ? { ...out, feedback: withWarnings(out["feedback"] as OperationFeedback, warnings) } : out;
}

// -- reads --------------------------------------------------------------------

function issueGet(h: ToolHandles, a: Args): Record<string, unknown> {
  const i = resolveRead(h, a["ref"] as string);
  const readiness = h.svc.getReadiness(i.id);
  return {
    ...summaryOf(i),
    contract: h.svc.getRevision(i.id, i.currentRevision).contract,
    readinessState: readiness.state,
    dispatchable: readiness.dispatchable,
    reasons: readiness.reasons,
    attestation: h.svc.latestAttestation(i.id),
    claim: h.svc.getActiveClaim(i.id),
  };
}

const READINESS_STATUS: Record<string, OperationalState> = {
  ready: "ready",
  in_progress: "claimed",
  blocked: "blocked",
  draft: "draft",
  deferred: "deferred",
};
const LIFECYCLE_STATUS: readonly string[] = ["open", "done", "cancelled"];

// {holder, issues} like the plain listing, so a reader (the Claude mod band,
// the Pi widget) learns who "me" resolved to; an unresolved "me" is an empty
// listing with holder null, not an error, so the band can flag it.
function claimedByRows(h: ToolHandles, ctx: ToolContext, claimedBy: string): { holder: string | null; total: number; issues: Record<string, unknown>[] } {
  let holder: string | null = claimedBy;
  if (claimedBy === "me") {
    try {
      holder = requireHolder("issue_list claimedBy=me", undefined, ctx);
    } catch {
      holder = null;
    }
  }
  if (!holder) return { holder: null, total: 0, issues: [] };
  const issues = h.svc.listClaimsByHolder(holder, { graceMs: CLAIMED_BY_GRACE_MS }).map((claim) => {
    const issue = h.svc.getIssue(claim.issueId);
    const handoff = h.journal.latest(issue.id, { kind: "handoff" });
    const text = handoff?.semantic?.summary ?? null;
    return {
      ref: issue.humanRef,
      title: issue.title,
      lifecycleState: issue.lifecycleState,
      readiness: h.svc.getReadiness(issue.id).state,
      claim: { holder: claim.holder, acquiredAt: claim.acquiredAt, expiresAt: claim.expiresAt },
      latestHandoff: handoff && text !== null ? { sequence: handoff.sequence, summary: previewText(text, HANDOFF_PREVIEW, "full text: journal_read") } : null,
    };
  });
  return { holder, total: issues.length, issues };
}

function issueList(h: ToolHandles, ctx: ToolContext, a: Args): unknown {
  const claimedBy = str(a["claimedBy"]);
  if (claimedBy) return claimedByRows(h, ctx, claimedBy);
  const status = str(a["status"]);
  const readiness = status ? READINESS_STATUS[status] : undefined;
  if (status && !readiness && !LIFECYCLE_STATUS.includes(status)) throw new Error(`unknown status: ${status}`);
  const kind = str(a["kind"]);
  const rows = h.svc.queryAllIssues({
    project: projectIdFor(h, str(a["project"])),
    ...(readiness ? { readiness: [readiness] } : {}),
    ...(status && !readiness ? { lifecycle: [status as LifecycleState] } : {}),
    ...(kind ? { kind: [kind as never] } : {}),
    search: str(a["query"]) ?? null,
  });
  const limit = num(a["limit"]) ?? DEFAULT_LIST_LIMIT;
  return {
    total: rows.length,
    issues: rows.slice(0, limit).map((r) => ({
      id: r.id,
      locator: r.locator,
      humanRef: r.humanRef,
      title: r.title,
      kind: r.kind,
      lifecycleState: r.lifecycleState,
      revision: r.revision,
      readinessState: r.readinessState,
      dispatchable: r.dispatchable,
    })),
  };
}

function journalRead(h: ToolHandles, a: Args): unknown {
  const id = resolveRead(h, a["ref"] as string).id;
  const kind = str(a["kind"]);
  if (kind !== undefined && !isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
  const limit = num(a["limit"]);
  switch (a["mode"]) {
    case "since": {
      const cursor = num(a["cursor"]);
      if (cursor === undefined) throw new Error('journal_read mode "since" requires a cursor (0 reads all)');
      const delta = h.journal.since(id, cursor);
      return { ...delta, entries: delta.entries.map(entryJson) };
    }
    case "latest": {
      const entry = h.journal.latest(id, kind ? { kind: kind as never } : undefined);
      if (!entry) throw new Error(`no journal entry${kind ? ` (kind ${kind})` : ""} for this issue`);
      return entryJson(entry);
    }
    case "timeline":
      return h.journal.timeline(id, { kind: kind as never, limit }).map(entryJson);
    case "show":
      return h.journal.listEntries(id, { kind: kind as never, limit }).map(entryJson);
    default:
      throw new Error(`journal_read: mode must be latest|since|timeline|show, got ${JSON.stringify(a["mode"])}`);
  }
}

function provenance(h: ToolHandles, a: Args): unknown {
  const selectors = (["ref", "sessionId", "activationId"] as const).filter((k) => str(a[k]) !== undefined);
  if (selectors.length !== 1) throw new Error("provenance: pass exactly one of ref, sessionId, activationId");
  const prov = new ProvenanceService(h.db, h.svc, h.journal);
  if (selectors[0] === "sessionId") return prov.sessionDetail(a["sessionId"] as string);
  if (selectors[0] === "activationId") return prov.activationDetail(a["activationId"] as string);
  return prov.trace(resolveRead(h, a["ref"] as string).id);
}

function resumeCapsule(h: ToolHandles, a: Args): { capsule: unknown; rendered: string } {
  const capsule = h.resume.buildCapsule(resolveRead(h, a["ref"] as string).id);
  return { capsule, rendered: h.resume.renderCapsule(capsule) };
}

// -- mutations ----------------------------------------------------------------

function issueClaim(h: ToolHandles, ctx: ToolContext, a: Args): Record<string, unknown> {
  const op = str(a["op"]) ?? "claim";
  const holder = requireHolder("issue_claim", str(a["holder"]), ctx);
  const activationId = str(a["activationId"]);
  const ttlMs = num(a["ttlMs"]);
  const issue = resolveWrite(h, ctx, a["ref"] as string);
  const base = { op, issueId: issue.id, ref: issue.humanRef, participantId: holder };
  if (op === "release") {
    const claim = h.svc.releaseClaim(issue.id, holder, { activationId });
    return finish({ ...base, claim }, [], claim
      ? successFeedback("issue_released", `Released ${issue.humanRef}`)
      : noopFeedback("claim_absent", `No live claim to release on ${issue.humanRef}`));
  }
  if (op === "renew") {
    const claim = h.svc.renewClaim(issue.id, holder, { activationId, ttlMs });
    return finish({ ...base, claim }, [], successFeedback("claim_renewed", `Renewed ${issue.humanRef}`, `expires ${new Date(claim.expiresAt).toISOString()}`));
  }
  if (op !== "claim") throw new Error(`issue_claim: op must be claim|renew|release, got ${op}`);
  const claim = h.svc.claimIssue(issue.id, holder, { activationId, ttlMs });
  ctx.onClaim?.(issue.id, holder, activationId);
  return finish({ ...base, claim }, [], successFeedback("issue_claimed", `Claimed ${issue.humanRef}`, `holder ${holder}`));
}

function issueUpdate(h: ToolHandles, ctx: ToolContext, a: Args): Record<string, unknown> {
  const title = str(a["title"]);
  const priority = num(a["priority"]);
  const contract = a["contract"];
  if (title === undefined && priority === undefined && contract === undefined) {
    throw new Error("nothing to update: pass title, priority or contract");
  }
  const before = resolveWrite(h, ctx, a["ref"] as string);
  let id = before.id;
  if (title !== undefined) id = h.svc.setTitle(id, title).id;
  if (priority !== undefined) id = h.svc.setPriority(id, priority).id;
  let revisionCreated = false;
  if (contract !== undefined) {
    const r = h.svc.updateContract(id, contract as never, ctx.author);
    id = r.issue.id;
    revisionCreated = r.created;
  }
  const after = h.svc.getIssue(id);
  const metadataChanged = after.title !== before.title || (priority !== undefined && priority !== (before as { priority?: number }).priority);
  const participantId = ctx.identity().participantId ?? null;
  const ref = after.humanRef;
  const feedback = revisionCreated
    ? successFeedback("issue_updated", `Updated ${ref}`, "new revision created; readiness must be revalidated")
    : metadataChanged
      ? successFeedback("issue_updated", `Updated ${ref}`, "metadata only; revision unchanged")
      : noopFeedback("issue_unchanged", `${ref} already has this state`, "no new revision created");
  return finish({ ...summaryOf(after), revisionCreated, participantId }, [], feedback);
}

function issueClose(h: ToolHandles, ctx: ToolContext, a: Args): Record<string, unknown> {
  const identity = ctx.identity(str(a["participant"]));
  const participant = identity.participantId ?? ambientHolder(ctx);
  if (!participant) throw new Error("issue_close: no participant; pass participant or set SUBSTRATE_HOLDER");
  const outcome = a["outcome"] as (typeof CLOSURE_OUTCOMES)[number];
  const refs = {
    journalResultRefs: strList(a["journalResultRefs"]),
    validationRefs: strList(a["validationRefs"]),
    receiptRefs: strList(a["receiptRefs"]),
    artifactRefs: strList(a["artifactRefs"]),
  };
  const issue = resolveWrite(h, ctx, a["ref"] as string);
  const closure = new ClosureService(h.db, h.svc).closeIssue(issue.id, {
    outcome,
    reason: a["reason"] as string,
    actor: participant,
    executionContext: identity.executionContext,
    ...refs,
  });
  const warnings: string[] = [];
  if (outcome === "completed" && Object.values(refs).every((r) => !r || r.length === 0)) {
    warnings.push("completed without journalResultRefs, validationRefs or receiptRefs; cite a result entry so the close has evidence");
  }
  return finish(
    {
      closureId: closure.closureId,
      issueId: closure.issueId,
      ref: issue.humanRef,
      outcome: closure.outcome,
      terminalState: closure.terminalState,
      issueRevision: closure.issueRevision,
      participantId: participant,
    },
    warnings,
  );
}

// XTRM-678: long text arrives from a file instead of being cut on the way in.
function summaryText(a: Args): string | undefined {
  const file = str(a["summaryFile"]);
  if (file === undefined) return str(a["summary"]);
  if (str(a["summary"]) !== undefined) throw new Error("pass summary or summaryFile, not both");
  if (!existsSync(file)) throw new Error(`summaryFile not found: ${file}`);
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") throw new Error(`summaryFile is empty: ${file}`);
  return text;
}

function buildSemantic(a: Args, summary: string | undefined): SemanticCheckpoint | undefined {
  if (summary === undefined) return undefined;
  const details = (a["details"] ?? {}) as Record<string, unknown>;
  const next = strList(a["next"]);
  return { ...details, summary, ...(next ? { next } : {}) } as SemanticCheckpoint;
}

async function journalAppend(h: ToolHandles, ctx: ToolContext, a: Args): Promise<Record<string, unknown>> {
  const kind = a["kind"];
  if (!isJournalKind(kind) || kind === "compaction") throw new Error(`unknown journal kind for this tool: ${String(kind)}`);
  const result = a["result"];
  if (kind === "result" && result === undefined) throw new Error('journal kind "result" requires a bounded result payload');
  if (kind !== "result" && result !== undefined) throw new Error(`journal kind "${kind}" does not carry a result payload`);
  const resultSummary = (result as { summary?: unknown } | undefined)?.summary;
  const summary = summaryText(a) ?? (typeof resultSummary === "string" ? resultSummary : undefined);
  if (kind !== "checkpoint" && summary === undefined) throw new Error(`journal kind "${kind}" requires a summary`);
  const issue = resolveWrite(h, ctx, a["ref"] as string);
  const identity = ctx.identity();
  const semantic = buildSemantic(a, summary);
  const warnings = assessJournalEntry({ kind, semantic, result }).warnings;
  if (!identity.participantId) warnings.push("no participant recorded; set SUBSTRATE_HOLDER so entries carry an author");

  if (kind === "checkpoint") {
    const r = await h.journal.checkpoint(issue.id, {
      ...identity,
      summarizer: semantic ? () => semantic : undefined,
    });
    return finish(
      { ref: issue.humanRef, entryId: r.entry.id, sequence: r.entry.sequence, kind, degraded: r.degraded, ...(r.reason ? { reason: r.reason } : {}), participantId: r.entry.participantId },
      warnings,
    );
  }
  const entry = h.journal.appendEntry(issue.id, { kind, ...identity, semantic, result: result as never });
  return finish({ ref: issue.humanRef, entryId: entry.id, sequence: entry.sequence, kind, participantId: entry.participantId }, warnings);
}

/** Runs one tool. Throws on invalid input; adapters render errors for their host. */
export async function runTool(name: ToolName, args: Args, h: ToolHandles, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case "issue_get":
      return issueGet(h, args);
    case "issue_list":
      return issueList(h, ctx, args);
    case "issue_claim":
      return issueClaim(h, ctx, args);
    case "issue_update":
      return issueUpdate(h, ctx, args);
    case "issue_close":
      return issueClose(h, ctx, args);
    case "journal_append":
      return journalAppend(h, ctx, args);
    case "journal_read":
      return journalRead(h, args);
    case "resume_capsule":
      return resumeCapsule(h, args);
    case "provenance":
      return provenance(h, args);
  }
}
