// Pi integration handlers (Phase 6, bead xtrm-7wc.7). Host-agnostic logic
// over the typed service: no Pi imports here, so this module is unit
// testable with fake compaction events. Pi wiring lives in extension.ts.
// Library-first (§6.1): every handler calls IssueService / JournalService /
// ResumeService directly. Host-owned checkpoint authority: handler output
// never self-certifies execution (§5, §28.3 analogue) — entries record what
// the host observed, and the service validates shapes fail-closed.

import { openSubstrate } from "../../src/store/sqlite.ts";
import { IssueService } from "../../src/service/issue-service.ts";
import { JournalService, type Summarizer } from "../../src/service/journal-service.ts";
import { ResumeService } from "../../src/service/resume-service.ts";
import { isJournalKind } from "../../src/domain/journal.ts";
import { sameHolder } from "../../src/domain/claim.ts";
import type { ResolvedIssue } from "../../src/domain/issue.ts";

export interface SubstrateServices {
  db: ReturnType<typeof openSubstrate>;
  issues: IssueService;
  journal: JournalService;
  resume: ResumeService;
  close(): void;
}

export function openServices(dbPath: string): SubstrateServices {
  const db = openSubstrate(dbPath);
  const issues = new IssueService(db);
  const journal = new JournalService(db, issues);
  const resume = new ResumeService(db, issues, journal);
  return { db, issues, journal, resume, close: () => db.close() };
}

// -- session bindings ----------------------------------------------------------
// In-session map (tool-recorded) with SUBSTRATE_ISSUE env fallback so a fresh
// process can rebind. Values are issue refs; resolution happens at use, so a
// stale binding fails loudly at the service instead of pointing nowhere.

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
  // Converged names (bead xtrm-iip.9): SUBSTRATE_ISSUE_REF wins everywhere;
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

function summary(i: ResolvedIssue): Record<string, unknown> {
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

export function toolIssueGet(svc: SubstrateServices, params: { ref: string }): Record<string, unknown> {
  const resolved = svc.issues.resolveRef(params.ref);
  const readiness = svc.issues.getReadiness(resolved.id);
  const revision = svc.issues.getRevision(resolved.id, resolved.currentRevision);
  return {
    ...summary(resolved),
    contract: revision.contract,
    readinessState: readiness.state,
    dispatchable: readiness.dispatchable,
    reasons: readiness.reasons,
    attestation: svc.issues.latestAttestation(resolved.id),
    claim: svc.issues.getActiveClaim(resolved.id),
  };
}

export function toolIssueSearch(
  svc: SubstrateServices,
  params: { project: string; query?: string; kind?: string },
): Array<Record<string, unknown>> {
  const q = (params.query ?? "").toLowerCase();
  return svc.issues
    .listIssues(params.project)
    .filter((i) => (params.kind ? i.kind === params.kind : true))
    .filter((i) => (q ? `${i.title} ${i.humanRef} ${i.locator}`.toLowerCase().includes(q) : true))
    .map(summary);
}

export function toolIssueClaim(
  svc: SubstrateServices,
  bindings: SessionBindings,
  params: { ref: string; holder: string; activationId?: string; ttlMs?: number; sessionId?: string },
): Record<string, unknown> {
  const resolved = svc.issues.resolveRef(params.ref);
  const claim = svc.issues.claimIssue(resolved.id, params.holder, {
    activationId: params.activationId,
    ttlMs: params.ttlMs,
  });
  if (params.sessionId) bindings.bind(params.sessionId, resolved.id, { holder: params.holder, activationId: params.activationId });
  return { issueId: claim.issueId, holder: claim.holder, expiresAt: claim.expiresAt, generation: claim.generation };
}

export function toolIssueUpdate(
  svc: SubstrateServices,
  params: { ref: string; contract: unknown; expectedRevision?: number },
): Record<string, unknown> {
  const resolved = svc.issues.resolveRef(params.ref);
  const { issue, created } = svc.issues.updateContract(resolved.id, params.contract as never, "pi-extension", {
    expectedRevision: params.expectedRevision,
  });
  return { ...summary(svc.issues.getIssue(issue.id)), revisionCreated: created };
}

export function toolJournalAppend(
  svc: SubstrateServices,
  params: { ref: string; kind: string; sessionId?: string; participantId?: string; activationId?: string; runId?: string },
): Record<string, unknown> {
  if (!isJournalKind(params.kind)) throw new Error(`unknown journal kind: ${params.kind}`);
  const resolved = svc.issues.resolveRef(params.ref);
  const entry = svc.journal.appendEntry(resolved.id, {
    kind: params.kind,
    sessionId: params.sessionId,
    participantId: params.participantId,
    activationId: params.activationId,
    runId: params.runId,
  });
  return { entryId: entry.id, sequence: entry.sequence, kind: entry.kind };
}

export async function toolJournalCheckpoint(
  svc: SubstrateServices,
  params: { ref: string; sessionId?: string; headCommit?: string; changedFiles?: string[] },
): Promise<Record<string, unknown>> {
  const resolved = svc.issues.resolveRef(params.ref);
  const r = await svc.journal.checkpoint(resolved.id, {
    sessionId: params.sessionId,
    headCommit: params.headCommit,
    changedFiles: params.changedFiles,
  });
  return { entryId: r.entry.id, sequence: r.entry.sequence, degraded: r.degraded };
}

export function toolIssueResume(svc: SubstrateServices, params: { ref: string }): string {
  const resolved = svc.issues.resolveRef(params.ref);
  return svc.resume.renderCapsule(svc.resume.buildCapsule(resolved.id));
}

// ProvenanceTrace surface before Phase 8 owns receipts: the event spine
// (revision, attestation, claim, checkpoints, commits observed) with an
// explicit note, never invented receipt authority.
export function toolProvenanceTrace(svc: SubstrateServices, params: { ref: string }): Record<string, unknown> {
  const resolved = svc.issues.resolveRef(params.ref);
  const events = svc.issues.listEvents(resolved.id);
  const checkpoints = svc.journal.listEntries(resolved.id, { kind: "checkpoint" });
  return {
    issueId: resolved.id,
    humanRef: resolved.humanRef,
    revision: resolved.currentRevision,
    contractHash: resolved.currentContractHash,
    attestation: svc.issues.latestAttestation(resolved.id),
    claim: svc.issues.getActiveClaim(resolved.id),
    checkpointRefs: checkpoints.map((c) => `${c.id}#${c.sequence}`),
    eventTypes: events.map((e) => e.type),
    note: "receipt-backed trace lands in Phase 8; this spine reconstructs revision/attestation/claim/checkpoint lineage only",
  };
}

// -- compaction (PRD §23.1) ------------------------------------------------------
// Mechanical checkpoint first via the service seam; the optional secondary
// summarizer enriches it. Failure anywhere degrades to the host default —
// the durable checkpoint is never lost because it committed before the
// summarizer started (D22/D23). Returns the summary text for the host to
// render into ITS compaction; returning null means "use host default" (D26).

export interface BeforeCompactInput {
  issueRef: string;
  sessionId?: string;
  summarizer?: Summarizer;
}

export interface BeforeCompactResult {
  entryId: string | null;
  sequence: number | null;
  degraded: boolean;
  fallbackToDefault: boolean;
  summary: string | null;
}

export async function runBeforeCompact(svc: SubstrateServices, input: BeforeCompactInput): Promise<BeforeCompactResult> {
  // Any host-side failure (dead DB handle included) falls back to the host
  // default — overflow-recovery compaction is never blocked (§§23.2/24.3).
  const fallback = { entryId: null, sequence: null, degraded: true, fallbackToDefault: true, summary: null };
  let resolved;
  try {
    resolved = svc.issues.resolveRef(input.issueRef);
  } catch {
    return fallback;
  }
  const checkpoint = await svc.journal.compactionCheckpoint(resolved.id, {
    kind: "compaction",
    sessionId: input.sessionId,
    summarizer: input.summarizer,
  });
  if (!checkpoint.entry) {
    return fallback;
  }
  if (checkpoint.fallbackToDefault) {
    // Mechanical row is durable; the host default summary proceeds.
    return {
      entryId: checkpoint.entry.id,
      sequence: checkpoint.entry.sequence,
      degraded: true,
      fallbackToDefault: true,
      summary: null,
    };
  }
  const capsule = svc.resume.buildCapsule(resolved.id);
  const summary = `${svc.journal.renderCheckpoint(checkpoint.entry)}\n\n${svc.resume.renderCapsule(capsule)}`;
  return { entryId: checkpoint.entry.id, sequence: checkpoint.entry.sequence, degraded: false, fallbackToDefault: false, summary };
}

// -- gates ported from Beads (§§38-39, bead xtrm-6qu.6) -----------------------------
// Host-agnostic evaluations over plain resolved state. Claude-side
// enforcement lives in integrations/claude-code/{edit,commit,stop}-*; Pi
// production enforcement is the tool_call handler in extension.ts, which
// routes edit/write calls through decidePiEditCall below.

export interface EditGateState {
  issueRef: string | null;
  claim?: { holder: string; activationId: string | null } | null;
  claimed?: boolean;
  holder?: string | null;
  activationId?: string | null;
  leaseHeldByOther: boolean;
  leaseHolder?: string | null;
}

export function evaluateEditGate(state: EditGateState): { allow: boolean; reason?: string } {
  if (!state.issueRef) return { allow: true };
  if (state.leaseHeldByOther) {
    return { allow: false, reason: `workspace writer lease held by ${state.leaseHolder ?? "another holder"}` };
  }
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

// Production decision for the Pi tool_call gate (extension.ts): resolve the
// session binding to its Issue plus claim identity, then apply the same
// holder+activation authority as the Claude edit gate. Fail-closed on a
// resolved live claim with missing/mismatched holder; fail-open on
// unreadable state (unknown ref, dead DB handle) so a corrupt gate never
// bricks the session.
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
    let leaseHeldByOther = false;
    let leaseHolder: string | null | undefined;
    try {
      const lease = svc.issues.getWriterLease(opts.workspace ?? process.cwd());
      if (lease && !(identity.holder && sameHolder(lease, identity.holder, identity.activationId))) {
        leaseHeldByOther = true;
        leaseHolder = lease.holder;
      }
    } catch {
      // lease unreadable: the claim decision below still enforces authority.
    }
    const decision = evaluateEditGate({
      issueRef: identity.ref,
      claim: claim ? { holder: claim.holder, activationId: claim.activationId } : null,
      claimed: claim !== null,
      holder: identity.holder,
      activationId: identity.activationId,
      leaseHeldByOther,
      leaseHolder,
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
}

export function evaluateStopContinuity(state: StopContinuityState): { needsCheckpoint: boolean; continuity: string | null } {
  if (!state.issueRef || !state.claimed) return { needsCheckpoint: false, continuity: null };
  return {
    needsCheckpoint: state.checkpointsSinceClaim === 0,
    continuity:
      `live claim on ${state.issueRef} (holder ${state.holder ?? "unknown"}): ` +
      `${state.checkpointsSinceClaim} checkpoint(s), ${state.blockers} blocker(s), ${state.handoffs} handoff(s) since claim. ` +
      `work stays open; resume with \`sb issue resume ${state.issueRef}\`.`,
  };
}

// -- session start ---------------------------------------------------------------
// Pi 0.84 session_start carries no injection channel, so "resume injection"
// is: bound issue → capsule text for the host to surface (notify + resume
// command), never a silent context edit. Returns null when unbound.

export function resumeForSession(svc: SubstrateServices, bindings: SessionBindings, sessionId: string | undefined): string | null {
  const ref = bindings.boundRef(sessionId);
  if (!ref) return null;
  return toolIssueResume(svc, { ref });
}
