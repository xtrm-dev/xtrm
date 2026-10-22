// Pi integration handlers. Host-agnostic logic over the typed service: no Pi
// imports here, so this module is unit testable with fake compaction events.
// Pi wiring lives in extension.ts. Every handler calls the canonical typed
// services directly — never execs sb and never parses terminal text.
// Host-owned checkpoint authority: handler output never self-certifies
// execution; entries record what the host observed, and the service validates
// shapes fail-closed.

import { openSubstrate } from "../../src/store/sqlite.ts";
import { IssueService } from "../../src/service/issue-service.ts";
import { JournalService, type Summarizer } from "../../src/service/journal-service.ts";
import { ResumeService } from "../../src/service/resume-service.ts";
import { ProvenanceService } from "../../src/service/provenance-service.ts";
import { type SemanticCheckpoint } from "../../src/domain/journal.ts";
import { sameHolder } from "../../src/domain/claim.ts";
import { currentExecutionContext, enrichExecutionContext, type ExecutionContext } from "../../src/domain/execution-context.ts";
import { resolveIdentity } from "../../src/presentation/advisories.ts";
import type { ToolContext, ToolHandles } from "../tool-core.ts";
// Type-only: erased at compile time, so this module stays free of runtime Pi imports.
import type { Usage } from "@earendil-works/pi-ai";

export interface SubstrateServices {
  db: ReturnType<typeof openSubstrate>;
  issues: IssueService;
  journal: JournalService;
  resume: ResumeService;
  provenance: ProvenanceService;
  close(): void;
}

export function openServices(dbPath: string): SubstrateServices {
  const db = openSubstrate(dbPath);
  const issues = new IssueService(db);
  const journal = new JournalService(db, issues);
  const resume = new ResumeService(db, issues, journal);
  const provenance = new ProvenanceService(db, issues, journal);
  return { db, issues, journal, resume, provenance, close: () => db.close() };
}

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

// -- tool surface adapter -------------------------------------------------------
// The model-facing tools live in integrations/tool-core.ts (shared with the
// Claude MCP server). These two helpers only bind Pi's host facts to it.

export function toolHandles(svc: SubstrateServices): ToolHandles {
  return { db: svc.db, svc: svc.issues, journal: svc.journal, resume: svc.resume };
}

export function piToolContext(
  bindings: SessionBindings,
  opts: { sessionId?: string; cwd?: string; executionContext?: ExecutionContext | null } = {},
): ToolContext {
  const cwd = opts.cwd ?? process.cwd();
  return {
    author: "pi-extension",
    guardProject: false,
    cwd,
    identity: (participant) => {
      const holder = participant ?? resolveIdentity(process.env, cwd).holder ?? undefined;
      const executionContext = piExecutionContext({
        sessionId: opts.sessionId ?? null,
        holder: holder ?? null,
        executionContext: opts.executionContext ?? null,
      });
      return {
        sessionId: opts.sessionId,
        participantId: executionContext?.participantId ?? undefined,
        activationId: executionContext?.specialist?.activationId ?? undefined,
        executionContext,
      };
    },
    onClaim: (issueId, holder, activationId) => {
      if (opts.sessionId) bindings.bind(opts.sessionId, issueId, { holder, activationId });
    },
  };
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

export async function runBeforeCompact(svc: SubstrateServices, input: BeforeCompactInput): Promise<BeforeCompactResult> {
  const fallback = { entryId: null, sequence: null, degraded: true, fallbackToDefault: true, summary: null, usage: null };
  let resolved;
  try {
    resolved = svc.issues.resolveRef(input.issueRef);
  } catch {
    return fallback;
  }
  // Captured as a side effect of the wrapped summarizer, since the journal
  // service only ever sees the stripped-down SemanticCheckpoint.
  let usage: Usage | null = null;
  const summarizer: Summarizer | undefined = input.summarizer
    ? async (...args: Parameters<Summarizer>) => {
        const { usage: reported, ...checkpoint } = await input.summarizer!(...args);
        usage = reported ?? null;
        return checkpoint;
      }
    : undefined;
  const checkpoint = await svc.journal.compactionCheckpoint(resolved.id, {
    kind: "compaction",
    sessionId: input.sessionId,
    summarizer,
    executionContext: piExecutionContext({ sessionId: input.sessionId ?? null, executionContext: input.executionContext ?? null }),
  });
  if (!checkpoint.entry) {
    return fallback;
  }
  if (checkpoint.fallbackToDefault) {
    return {
      entryId: checkpoint.entry.id,
      sequence: checkpoint.entry.sequence,
      degraded: true,
      fallbackToDefault: true,
      summary: null,
      usage: null,
    };
  }
  const capsule = svc.resume.buildCapsule(resolved.id);
  const summary = `${svc.journal.renderCheckpoint(checkpoint.entry)}\n\n${svc.resume.renderCapsule(capsule)}`;
  // Recorded after the summary is built: the absence note must never leak
  // into this compaction's summary content (non-goal: changing summary content).
  if (input.summarizer && usage === null) {
    recordMissingUsage(svc, resolved.id, input, checkpoint.entry.id);
  }
  return { entryId: checkpoint.entry.id, sequence: checkpoint.entry.sequence, degraded: false, fallbackToDefault: false, summary, usage };
}

// Best-effort note: a missing usage report must never block compaction, so a
// failure here is swallowed (mirrors the degraded-checkpoint pattern above).
function recordMissingUsage(svc: SubstrateServices, issueId: string, input: BeforeCompactInput, checkpointEntryId: string): void {
  try {
    svc.journal.appendEntry(issueId, {
      kind: "note",
      sessionId: input.sessionId,
      semantic: {
        summary: `compaction summarizer reported no usage; CompactionResult.usage omitted (checkpoint ${checkpointEntryId}, session ${input.sessionId ?? "unknown"})`,
      },
      executionContext: piExecutionContext({ sessionId: input.sessionId ?? null, executionContext: input.executionContext ?? null }),
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

export function decidePiEditCall(
  svc: SubstrateServices,
  bindings: SessionBindings,
  opts: { sessionId?: string; workspace?: string } = {},
): { allow: boolean; reason?: string; issueRef: string | null } {
  try {
    const identity = bindings.identityFor(opts.sessionId);
    if (!identity) return { allow: true, issueRef: null };
    let issueId: string;
    try {
      issueId = svc.issues.resolveRef(identity.ref).id;
    } catch {
      return { allow: true, issueRef: identity.ref };
    }
    const claim = svc.issues.getActiveClaim(issueId);
    const decision = evaluateEditGate({
      issueRef: identity.ref,
      claim: claim ? { holder: claim.holder, activationId: claim.activationId } : null,
      claimed: claim !== null,
      holder: identity.holder,
      activationId: identity.activationId,
    });
    return { ...decision, issueRef: identity.ref };
  } catch {
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

export function resumeForSession(svc: SubstrateServices, bindings: SessionBindings, sessionId: string | undefined): string | null {
  const ref = bindings.boundRef(sessionId);
  if (!ref) return null;
  const resolved = svc.issues.resolveRef(ref);
  return svc.resume.renderCapsule(svc.resume.buildCapsule(resolved.id));
}
