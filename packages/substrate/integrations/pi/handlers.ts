// Pi integration handlers. Host-agnostic logic over the typed service: no Pi
// imports here, so this module is unit testable with fake compaction events.
// Pi wiring lives in extension.ts. Every handler calls the canonical typed
// services directly — never execs sb and never parses terminal text.
// Host-owned checkpoint authority: handler output never self-certifies
// execution; entries record what the host observed, and the service validates
// shapes fail-closed.

import type { Summarizer } from "../../src/service/journal-service.ts";
import type { StoreCall } from "./backing.ts";
import { isTransportFailure } from "../../src/service/operations.ts";
import { isJournalKind, type SemanticCheckpoint } from "../../src/domain/journal.ts";
import { sameHolder } from "../../src/domain/claim.ts";
import { currentExecutionContext, enrichExecutionContext, type ExecutionContext } from "../../src/domain/execution-context.ts";
import type { ResolvedIssue } from "../../src/domain/issue.ts";
// Type-only: erased at compile time, so this module stays free of runtime Pi imports.
import type { Usage } from "@earendil-works/pi-ai";



// -- session bindings ----------------------------------------------------------
// In-session map (tool-recorded) with SUBSTRATE_ISSUE_REF env fallback so a
// fresh process can rebind. SUBSTRATE_ISSUE remains a compatibility alias.
// Values are issue refs; resolution happens at use, so a stale binding fails
// loudly at the service instead of pointing nowhere.

export interface SessionIdentity {
  ref: string;
  holder: string | null;
  activationId: string | null;
}

export class SessionBindings {
  private readonly map = new Map<string, SessionIdentity>();
  bind(sessionId: string, ref: string, identity?: { holder?: string | null; activationId?: string | null }): void {
    if (!sessionId.trim() || !ref.trim()) throw new Error("bind requires a session id and an issue ref");
    this.map.set(sessionId, { ref, holder: identity?.holder ?? null, activationId: identity?.activationId ?? null });
  }
  boundRef(sessionId: string | undefined): string | null {
    return this.identityFor(sessionId)?.ref ?? null;
  }
  /** Claim identity for a session: stored holder+activation win, env is the fallback. */
  identityFor(sessionId: string | undefined): SessionIdentity | null {
    const stored = sessionId ? (this.map.get(sessionId) ?? null) : null;
    const ref = stored?.ref ?? boundRefFromEnv();
    if (!ref) return null;
    return {
      ref,
      holder: stored?.holder ?? envHolder(),
      activationId: stored?.activationId ?? envActivation(),
    };
  }
}

function boundRefFromEnv(): string | null {
  // Converged names: SUBSTRATE_ISSUE_REF wins everywhere;
  // SUBSTRATE_ISSUE remains as a backcompat alias so existing operator
  // setups keep working.
  const ref = process.env["SUBSTRATE_ISSUE_REF"];
  if (ref && ref.trim()) return ref.trim();
  const env = process.env["SUBSTRATE_ISSUE"];
  return env && env.trim() ? env.trim() : null;
}

function envHolder(): string | null {
  const h = process.env["SUBSTRATE_HOLDER"];
  return h && h.trim() ? h.trim() : null;
}

function envActivation(): string | null {
  const a = process.env["SUBSTRATE_ACTIVATION_ID"];
  return a && a.trim() ? a.trim() : null;
}

// Trusted Pi execution context: host type + Pi session id are host-known
// (sessionManager/binding), the XTRM session id/name come from the exact Core
// launcher env contract only. An explicit trusted envelope wins field-by-field;
// nothing is parsed from prose.
function piExecutionContext(opts: {
  sessionId?: string | null;
  holder?: string | null;
  activationId?: string | null;
  executionContext?: ExecutionContext | null;
}): ExecutionContext | null {
  const base = opts.executionContext ?? undefined;
  // A host-only envelope suppresses the service fallback. Fill unstated
  // identity from the same ambient contract, preserving trusted facets.
  const ambient = currentExecutionContext();
  const activationId = base?.specialist?.activationId ?? opts.activationId ?? ambient?.specialist?.activationId;
  return enrichExecutionContext({
    actor: base?.actor ?? null,
    participantId: base?.participantId ?? opts.holder ?? ambient?.participantId ?? null,
    xtrmSessionId: base?.xtrmSessionId ?? null,
    xtrmSessionName: base?.xtrmSessionName ?? null,
    host: base?.host ?? (opts.sessionId ? { type: "pi", sessionId: opts.sessionId } : null),
    runId: base?.runId ?? null,
    chainRunId: base?.chainRunId ?? null,
    coordinator: base?.coordinator ?? null,
    specialist: activationId != null ? { ...base?.specialist, activationId } : base?.specialist ?? null,
    workspace: base?.workspace ?? null,
  });
}

// Narrow structural input: a board row carries exactly these fields, so the
// projection feeds the same summary as a hydrated issue without a fabricated
// ResolvedIssue stand-in.
type SummaryInput = Pick<ResolvedIssue, "locator" | "humanRef" | "title" | "kind" | "lifecycleState" | "currentRevision">;

function summary(i: SummaryInput): Record<string, unknown> {
  return {
    locator: i.locator,
    humanRef: i.humanRef,
    title: i.title,
    kind: i.kind,
    lifecycleState: i.lifecycleState,
    revision: i.currentRevision,
  };
}

// -- model-facing tools (thin over the service) --------------------------------
// Every tool answers through the typed service, so one handler serves a local
// store and a server-owned one. The results keep the shapes the tools always
// returned: the wire adds a transport, not a dialect.

export async function toolIssueGet(backing: StoreCall, params: { ref: string }): Promise<Record<string, unknown>> {
  const resolved = await backing.call<{ id: string; currentRevision: number }>("issue.resolveRef", { ref: params.ref });
  const issue = await backing.call<SummaryInput & { id: string }>("issue.get", { issueId: resolved.id });
  const readiness = await backing.call<{ state: string; dispatchable: boolean; reasons: unknown }>("issue.getReadiness", {
    issueId: resolved.id,
  });
  const revision = await backing.call<{ contract: unknown }>("issue.getRevision", {
    issueId: resolved.id,
    revision: resolved.currentRevision,
  });
  return {
    ...summary(issue),
    contract: revision.contract,
    readinessState: readiness.state,
    dispatchable: readiness.dispatchable,
    reasons: readiness.reasons,
    attestation: await backing.call<unknown>("issue.latestAttestation", { issueId: resolved.id }),
    claim: await backing.call<unknown>("issue.getActiveClaim", { issueId: resolved.id }),
  };
}

export async function toolIssueSearch(
  backing: StoreCall,
  params: { project: string; query?: string; kind?: string },
): Promise<Array<Record<string, unknown>>> {
  // One bounded board read, filtered here exactly as before: title, humanRef and
  // locator all match, and the summary shape stays untouched.
  const q = (params.query ?? "").toLowerCase();
  const rows = await backing.call<
    Array<{
      locator: string;
      humanRef: string;
      title: string;
      kind: string;
      lifecycleState: string;
      revision: number;
    }>
  >("issue.queryAllIssues", { query: { project: params.project } });
  return rows
    .filter((r) => (params.kind ? r.kind === params.kind : true))
    .filter((r) => (q ? `${r.title} ${r.humanRef} ${r.locator}`.toLowerCase().includes(q) : true))
    .map((r) =>
      summary({
        locator: r.locator,
        humanRef: r.humanRef,
        title: r.title,
        kind: r.kind as SummaryInput["kind"],
        lifecycleState: r.lifecycleState as SummaryInput["lifecycleState"],
        currentRevision: r.revision,
      }),
    );
}

export async function toolIssueClaim(
  backing: StoreCall,
  bindings: SessionBindings,
  params: { ref: string; holder: string; activationId?: string; ttlMs?: number; sessionId?: string },
): Promise<Record<string, unknown>> {
  const resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: params.ref });
  const claim = await backing.call<{ issueId: string; holder: string; expiresAt: number; generation: number }>(
    "issue.claimIssue",
    { issueId: resolved.id, holder: params.holder, activationId: params.activationId, ttlMs: params.ttlMs },
  );
  if (params.sessionId) {
    bindings.bind(params.sessionId, resolved.id, { holder: params.holder, activationId: params.activationId });
  }
  return { issueId: claim.issueId, holder: claim.holder, expiresAt: claim.expiresAt, generation: claim.generation };
}

export async function toolIssueUpdate(
  backing: StoreCall,
  params: { ref: string; contract: unknown; expectedRevision?: number },
): Promise<Record<string, unknown>> {
  const resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: params.ref });
  const edited = await backing.call<{ issue: SummaryInput & { id: string }; created: number }>("issue.updateContract", {
    issueId: resolved.id,
    contract: params.contract,
    authoredBy: "pi-extension",
    opts: { expectedRevision: params.expectedRevision },
  });
  return { ...summary(edited.issue), revisionCreated: edited.created };
}

export async function toolJournalAppend(
  backing: StoreCall,
  params: {
    ref: string;
    kind: string;
    sessionId?: string;
    participantId?: string;
    activationId?: string;
    runId?: string;
    executionContext?: ExecutionContext | null;
  },
): Promise<Record<string, unknown>> {
  if (!isJournalKind(params.kind)) throw new Error(`unknown journal kind: ${params.kind}`);
  const resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: params.ref });
  const entry = await backing.call<{ id: string; sequence: number; kind: string }>("journal.appendEntry", {
    issueId: resolved.id,
    input: {
      kind: params.kind,
      sessionId: params.sessionId,
      participantId: params.participantId,
      activationId: params.activationId,
      runId: params.runId,
      executionContext: piExecutionContext({
        sessionId: params.sessionId ?? null,
        holder: params.participantId ?? null,
        activationId: params.activationId ?? null,
        executionContext: params.executionContext ?? null,
      }),
    },
  });
  return { entryId: entry.id, sequence: entry.sequence, kind: entry.kind };
}

export async function toolJournalCheckpoint(
  backing: StoreCall,
  params: { ref: string; sessionId?: string; headCommit?: string; changedFiles?: string[]; executionContext?: ExecutionContext | null },
): Promise<Record<string, unknown>> {
  const resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: params.ref });
  const result = await backing.call<{ entry: { id: string; sequence: number }; degraded: boolean }>("journal.checkpoint", {
    issueId: resolved.id,
    input: {
      sessionId: params.sessionId,
      headCommit: params.headCommit,
      changedFiles: params.changedFiles,
      executionContext: piExecutionContext({
        sessionId: params.sessionId ?? null,
        executionContext: params.executionContext ?? null,
      }),
    },
  });
  return { entryId: result.entry.id, sequence: result.entry.sequence, degraded: result.degraded };
}

export async function toolIssueResume(backing: StoreCall, params: { ref: string }): Promise<string> {
  const resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: params.ref });
  const capsule = await backing.call<unknown>("resume.buildCapsule", { issueId: resolved.id });
  return backing.call<string>("resume.renderCapsule", { capsule });
}

/** Full canonical evidence spine; Pi and Claude consume the same provenance. */
export async function toolProvenanceTrace(backing: StoreCall, params: { ref: string }): Promise<unknown> {
  const resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: params.ref });
  return backing.call<unknown>("provenance.trace", { issueId: resolved.id });
}

// -- compaction ---------------------------------------------------------------
// Mechanical checkpoint first via the service seam; the optional secondary
// summarizer enriches it. Failure anywhere degrades to the host default — the
// durable checkpoint is never lost because it committed before the summarizer
// started. Returns the summary text for the host to render into ITS compaction;
// returning null means "use host default".

// A Pi summarizer may report the LLM usage it spent producing the checkpoint.
// Usage rides alongside the checkpoint but must never reach the journal's
// semantic-checkpoint schema, so it is stripped before the summarizer result
// is handed to the journal service (see runBeforeCompact below).
export type CompactSummarizer = (
  ...args: Parameters<Summarizer>
) => (SemanticCheckpoint & { usage?: Usage }) | Promise<SemanticCheckpoint & { usage?: Usage }>;

export interface BeforeCompactInput {
  issueRef: string;
  sessionId?: string;
  summarizer?: CompactSummarizer;
  executionContext?: ExecutionContext | null;
}

export interface BeforeCompactResult {
  entryId: string | null;
  sequence: number | null;
  degraded: boolean;
  fallbackToDefault: boolean;
  summary: string | null;
  usage: Usage | null;
}

export async function runBeforeCompact(backing: StoreCall, input: BeforeCompactInput): Promise<BeforeCompactResult> {
  const fallback = { entryId: null, sequence: null, degraded: true, fallbackToDefault: true, summary: null, usage: null };
  let resolved: { id: string };
  try {
    resolved = await backing.call<{ id: string }>("issue.resolveRef", { ref: input.issueRef });
  } catch {
    return fallback;
  }
  const executionContext = piExecutionContext({
    sessionId: input.sessionId ?? null,
    executionContext: input.executionContext ?? null,
  });
  // The mechanical row is written where the store lives. The summarizer cannot
  // travel: a function does not cross a pipe, so it runs here and the semantic
  // layer is attached afterwards — the same order the journal service uses.
  const checkpoint = await backing.call<{
    entry: { id: string; sequence: number } | null;
    degraded: boolean;
    fallbackToDefault: boolean;
  }>("journal.compactionCheckpoint", {
    issueId: resolved.id,
    input: { kind: "compaction", sessionId: input.sessionId, executionContext },
  });
  if (!checkpoint.entry) return fallback;

  let usage: Usage | null = null;
  let degraded = checkpoint.degraded;
  if (input.summarizer) {
    try {
      const entry = await backing.call<Record<string, unknown>>("journal.getEntry", { entryId: checkpoint.entry.id });
      const summarizerAsService: Summarizer = input.summarizer as unknown as Summarizer;
      const produced = (await summarizerAsService(entry as never, (entry as { mechanical?: unknown }).mechanical as never)) as
        | (SemanticCheckpoint & { usage?: Usage })
        | SemanticCheckpoint;
      const { usage: reported, ...semantic } = produced as SemanticCheckpoint & { usage?: Usage };
      usage = reported ?? null;
      await backing.call("journal.enrichEntry", { entryId: checkpoint.entry.id, semantic });
      degraded = false;
    } catch {
      // Enrichment failure degrades to the mechanical checkpoint: resumability is
      // never lost because a summary failed.
      degraded = true;
    }
  }

  if (degraded) {
    return {
      entryId: checkpoint.entry.id,
      sequence: checkpoint.entry.sequence,
      degraded: true,
      fallbackToDefault: true,
      summary: null,
      usage: null,
    };
  }

  const entry = await backing.call<Record<string, unknown>>("journal.getEntry", { entryId: checkpoint.entry.id });
  const rendered = await backing.call<string>("journal.renderCheckpoint", { entry });
  const capsule = await backing.call<unknown>("resume.buildCapsule", { issueId: resolved.id });
  const renderedCapsule = await backing.call<string>("resume.renderCapsule", { capsule });
  const summaryText = `${rendered}\n\n${renderedCapsule}`;
  // Recorded after the summary is built: the absence note must never leak into
  // this compaction's summary content.
  if (input.summarizer && usage === null) {
    await recordMissingUsage(backing, resolved.id, input, checkpoint.entry.id);
  }
  return {
    entryId: checkpoint.entry.id,
    sequence: checkpoint.entry.sequence,
    degraded: false,
    fallbackToDefault: false,
    summary: summaryText,
    usage,
  };
}

// Best-effort note: a missing usage report must never block compaction, so a
// failure here is swallowed (mirrors the degraded-checkpoint pattern above).
async function recordMissingUsage(
  backing: StoreCall,
  issueId: string,
  input: BeforeCompactInput,
  checkpointEntryId: string,
): Promise<void> {
  try {
    await backing.call("journal.appendEntry", {
      issueId,
      input: {
        kind: "note",
        sessionId: input.sessionId,
        semantic: {
          summary: `compaction summarizer reported no usage; CompactionResult.usage omitted (checkpoint ${checkpointEntryId}, session ${input.sessionId ?? "unknown"})`,
        },
        executionContext: piExecutionContext({
          sessionId: input.sessionId ?? null,
          executionContext: input.executionContext ?? null,
        }),
      },
    });
  } catch {
    // Absence-of-usage is informational; never lose the checkpoint over it.
  }
}

// Renders the host-facing Pi compaction payload from a Substrate result;
// undefined means "use host default" (fallback or no summary).
export function toPiCompaction(
  preparation: { firstKeptEntryId: string; tokensBefore: number },
  result: BeforeCompactResult,
): { compaction: { summary: string; firstKeptEntryId: string; tokensBefore: number; usage?: Usage } } | undefined {
  if (result.fallbackToDefault || !result.summary) return undefined;
  return {
    compaction: {
      summary: result.summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      ...(result.usage ? { usage: result.usage } : {}),
    },
  };
}

// -- gates --------------------------------------------------------------------
// Host-agnostic evaluations over plain resolved state. Claude-side enforcement
// lives in integrations/claude-code/{edit,commit,stop}-*; Pi production
// enforcement is the tool_call handler in extension.ts.

export interface EditGateState {
  issueRef: string | null;
  claim?: { holder: string; activationId: string | null } | null;
  claimed?: boolean;
  holder?: string | null;
  activationId?: string | null;
}

export function evaluateEditGate(state: EditGateState): { allow: boolean; reason?: string } {
  if (!state.issueRef) return { allow: true };
  const claim = state.claim ?? null;
  const claimed = claim !== null || state.claimed === true;
  if (!claimed) return { allow: false, reason: `no live claim on ${state.issueRef}; claim first` };
  if (claim) {
    if (!state.holder) return { allow: false, reason: `live claim on ${state.issueRef} held by ${claim.holder}; no current holder supplied` };
    if (!sameHolder(claim, state.holder, state.activationId ?? null)) {
      return { allow: false, reason: `live claim on ${state.issueRef} held by ${claim.holder}; holder ${state.holder} may not mutate` };
    }
  }
  return { allow: true };
}

export async function decidePiEditCall(
  backing: StoreCall,
  bindings: SessionBindings,
  opts: { sessionId?: string; workspace?: string } = {},
): Promise<{ allow: boolean; reason?: string; issueRef: string | null }> {
  try {
    const identity = bindings.identityFor(opts.sessionId);
    if (!identity) return { allow: true, issueRef: null };
    let issueId: string;
    try {
      issueId = (await backing.call<{ id: string }>("issue.resolveRef", { ref: identity.ref })).id;
    } catch (error) {
      // The store answered "no such ref" -> allow, as before. The store could not
      // be reached at all -> the caller must block (XTRM-712).
      if (isTransportFailure(error)) throw error;
      return { allow: true, issueRef: identity.ref };
    }
    const claim = await backing.call<{ holder: string; activationId: string | null } | null>("issue.getActiveClaim", { issueId });
    const decision = evaluateEditGate({
      issueRef: identity.ref,
      claim: claim ? { holder: claim.holder, activationId: claim.activationId } : null,
      claimed: claim !== null,
      holder: identity.holder,
      activationId: identity.activationId,
    });
    return { ...decision, issueRef: identity.ref };
  } catch (error) {
    // Same rule at the outer boundary: a local failure stays fail-open, a
    // transport failure reaches the gate so it can block and name the code.
    if (isTransportFailure(error)) throw error;
    return { allow: true, issueRef: null };
  }
}

export interface StopContinuityState {
  issueRef: string | null;
  claimed: boolean;
  holder?: string | null;
  checkpointsSinceClaim: number;
  blockers: number;
  handoffs: number;
  resultsSinceClaim?: number;
  pendingAsks?: string[];
  closureReady?: boolean;
}

export type PiStopAction = "silent" | "checkpointed" | "continuity" | "closure-ready";

export function evaluateStopContinuity(state: StopContinuityState): {
  needsCheckpoint: boolean;
  continuity: string | null;
  action: PiStopAction;
} {
  if (!state.issueRef || !state.claimed) return { needsCheckpoint: false, continuity: null, action: "silent" };
  const needsCheckpoint = state.checkpointsSinceClaim === 0;
  const results = state.resultsSinceClaim ?? 0;
  const asks = state.pendingAsks ?? [];
  const action: PiStopAction = state.closureReady
    ? "closure-ready"
    : needsCheckpoint
      ? "checkpointed"
      : "continuity";
  const bits =
    `live claim on ${state.issueRef} (holder ${state.holder ?? "unknown"}): ` +
    `${state.checkpointsSinceClaim} checkpoint(s), ${state.blockers} blocker(s), ${state.handoffs} handoff(s), ${results} result(s) since claim. `;
  const next = state.closureReady
    ? `closure-ready: result → validation/provenance → close; the gate never closes for you. `
    : `${results === 0 ? "no result recorded since claim; ending now is fine, work stays open. " : ""}${asks.length > 0 ? `pending asks: ${asks.join("; ")}. ` : ""}` +
      `work stays open; resume with \`sb issue resume ${state.issueRef}\`.`;
  return { needsCheckpoint, continuity: bits + next, action };
}

// -- session start ------------------------------------------------------------
// Pi session_start carries no injection channel, so resume delivery is bound
// issue → capsule text for the host to surface (notify + resume command), never
// a silent context edit. Returns null when unbound.

export async function resumeForSession(
  backing: StoreCall,
  bindings: SessionBindings,
  sessionId: string | undefined,
): Promise<string | null> {
  const ref = bindings.boundRef(sessionId);
  if (!ref) return null;
  try {
    return await toolIssueResume(backing, { ref });
  } catch {
    // An unreachable remote must not break a session-start hint; the error is
    // raised when a tool is actually used, where the operator can act on it.
    return null;
  }
}
