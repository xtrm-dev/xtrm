// Specialists dispatch gate over Substrate authority (Phase 9, bead
// xtrm-7wc.10; PRD §39). Replaces the Bead dispatch gate
// (docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md §12):
//
//   beadId                      → issueId (+ revision + contractHash binding)
//   Bead readiness gate         → shared Substrate readiness service
//   sourceBeadRevision pin      → immutable execution binding (§26)
//   prompt-arg supplementation  → impossible by construction: this gate takes
//                                 no prompt text, and requestedScope may only
//                                 NARROW the contract SCOPE, never widen it.
//
// Ordering per §49: check (read-only, before AgentSession creation) then
// dispatch (mutation at activation start, binding the live revision).

import { scopeCovers } from "../domain/readiness.ts";
import { sameHolder } from "../domain/claim.ts";
import { enrichExecutionContext, normalizeExecutionContext, type ExecutionContext } from "../domain/execution-context.ts";
import { IssueService } from "../service/issue-service.ts";
import { ProvenanceService } from "../service/provenance-service.ts";
import type { ExecutionBinding, ExpectedClaimPin } from "../domain/execution-binding.ts";
import type { ReadinessReport } from "../domain/readiness.ts";

export interface SpecialistDispatchRequest {
  ref: string;
  specialist: string;
  holder: string;
  activationId?: string;
  attemptId?: string;
  sessionId?: string;
  workspace: string;
  baseCommit?: string;
  claimId?: number;
  requestedScope?: string[];
  // Coordinator-supplied envelope (X1, ADR §37): parent/coordinator lineage
  // in, specialist child identity out. Trusted typed input only.
  executionContext?: ExecutionContext | null;
}

export interface DispatchCheck {
  issueId: string;
  revision: number;
  contractHash: string;
  report: ReadinessReport;
  // Pinned live claim observed at check time (id + generation), or null
  // when no live claim existed. Carried into provenance.dispatch and
  // re-verified atomically before INSERT; mismatch fails closed.
  expectedClaim: ExpectedClaimPin | null;
}

/**
 * Settlement-adapter gate for Specialist dispatch: the fail-closed
 * pre-activation check that stands between readiness authority and host
 * execution. Reads the IssueService authority (revision, readiness, live
 * claim) with no mutation and no durable side effects. Never moves the
 * revision; reports the pinned revision and contract hash the later binding
 * freezes, so a newer revision renders the check stale by construction.
 * Attaches no metadata itself (the returned pin feeds provenance.dispatch,
 * which stamps actor, session and envelope automatically). Pure and
 * idempotent per durable state; draft, unready, blocked, terminal, stale
 * scope and holder mismatch fail closed before any AgentSession exists.
 */
export function checkDispatch(issues: IssueService, req: SpecialistDispatchRequest): DispatchCheck {
  if (!req.specialist.trim()) throw new Error("dispatch rejected: specialist is required");
  if (!req.holder.trim()) throw new Error("dispatch rejected: holder is required");
  const id = issues.resolveRef(req.ref).id;
  // Gate mirrors provenance.dispatch: the pipeline is claim -> binding, so a
  // live claim already passed structure/attestation/blockers/scrutiny and
  // only records who holds the work. Draft/deferred/blocked/terminal refuse.
  const now = Date.now();
  const report = issues.getReadiness(id, { now });
  if (report.state !== "ready" && report.state !== "claimed") {
    throw new Error(`dispatch rejected: ${id} is ${report.state}: ${report.reasons.join("; ")}`);
  }
  // Claimed dispatch is fenced by the live claim: the request holder +
  // activation must be the live holder (sameHolder). Omitting claimId does
  // not bypass authority; omitting/mismatching identity fails closed.
  // Ready/unclaimed stays open for the claim-first flow.
  const active = issues.getActiveClaim(id, { now });
  if (report.state === "claimed" && !active) {
    throw new Error(`dispatch rejected: ${id} is claimed without a live claim (fail closed)`);
  }
  if (req.claimId !== undefined && req.claimId !== null) {
    if (!active || active.id !== req.claimId) throw new Error(`dispatch rejected: claim ${req.claimId} is not the live claim on ${id}`);
  }
  if (active) {
    if (!sameHolder(active, req.holder, req.activationId ?? null)) {
      throw new Error(`dispatch rejected: ${id} is live-held by ${active.holder}; holder/activation mismatch (anti-steal)`);
    }
  }
  if (req.requestedScope) {
    const revision = issues.getRevision(id, report.revision);
    const contract = revision.contract as { scope?: unknown };
    const contractScope = Array.isArray(contract.scope) ? (contract.scope as string[]) : [];
    const { ok, expanded } = scopeCovers(contractScope, req.requestedScope);
    if (!ok) throw new Error(`dispatch rejected: scope expansion outside contract SCOPE (§39.1): ${expanded.join(", ")}`);
  }
  const expectedClaim: ExpectedClaimPin | null = active ? { id: active.id, generation: active.generation } : null;
  return { issueId: id, revision: report.revision, contractHash: report.contractHash, report, expectedClaim };
}

/**
 * Settlement-adapter dispatch: gates through checkDispatch, then writes the
 * host-owned execution binding that settles a Specialist activation onto the
 * pinned revision under the IssueService authority. Side effects are limited
 * to the binding row insert; the binding row itself is durable in the WAL store; the frozen
 * revision, hash and coordinator-to-specialist lineage make later contract
 * edits bind anew instead of silently re-authorizing. Dispatch never edits
 * the contract and never appends journal entries; settlement evidence lands
 * afterwards as bounded journal result entries cited by close. Readiness is
 * consumed, not changed, and the binding goes stale on any newer revision.
 * Automatic metadata: participant, activation, attempt, session and workspace
 * envelope attached at bind time. Dispatch is not idempotent across calls
 * (each call binds a new execution); gate-then-bind is one transaction, and
 * stale pins, holder mismatch and scope expansion fail closed.
 */
export function dispatchToSpecialist(
  issues: IssueService,
  provenance: ProvenanceService,
  req: SpecialistDispatchRequest,
): { check: DispatchCheck; binding: ExecutionBinding } {
  const check = checkDispatch(issues, req);
  // Coordinator → Specialist lineage (ADR §§34, 37) with no dual
  // semantics. The top-level participant is ALWAYS the current specialist
  // participant (req.holder, gate-verified against the live claim), so the
  // flat participant_id column and the envelope agree by construction. The
  // parent coordinator identity moves to the closed coordinator leg: a
  // parent participant that differs from the holder, and the coordinator
  // session that performed this dispatch (the parent execution's provider
  // session — the only parent session the envelope knows). The parent host
  // leg is NOT inherited: host.sessionId names the session of the execution
  // the envelope describes, and the child's session is unknown until
  // activation (S1 territory). Likewise the child actor is always
  // specialist — inheriting a parent `coordinator` actor would mislabel the
  // child. The XTRM session stays shared. Retry/resume keeps one activation
  // across distinct attempt ids — both stay queryable (§97).
  const base = normalizeExecutionContext(req.executionContext ?? null) ?? undefined;
  const parentParticipant = base?.participantId ?? null;
  const coordinator = {
    participantId:
      base?.coordinator?.participantId ??
      (parentParticipant !== null && parentParticipant !== req.holder ? parentParticipant : null),
    sessionId: base?.coordinator?.sessionId ?? base?.host?.sessionId ?? null,
  };
  const specialist = {
    name: base?.specialist?.name ?? req.specialist,
    activationId: base?.specialist?.activationId ?? req.activationId ?? null,
    attemptId: base?.specialist?.attemptId ?? req.attemptId ?? null,
    agentSessionId: base?.specialist?.agentSessionId ?? null,
  };
  const executionContext = enrichExecutionContext({
    actor: { type: "specialist" },
    participantId: req.holder,
    xtrmSessionId: base?.xtrmSessionId ?? null,
    xtrmSessionName: base?.xtrmSessionName ?? null,
    host: null,
    runId: base?.runId ?? null,
    chainRunId: base?.chainRunId ?? null,
    coordinator:
      coordinator.participantId !== null || coordinator.sessionId !== null ? coordinator : null,
    specialist,
    // The execution checkout IS known at the gate (req.workspace/baseCommit),
    // so the envelope carries it instead of leaving the authority
    // location-blind while only the flat column knows the path (X1 review
    // P1-2). A coordinator envelope with a location still wins; any
    // disagreement with the flat column fails closed downstream.
    workspace:
      base?.workspace ??
      (req.workspace ? { worktree: req.workspace, ...(req.baseCommit ? { baseCommit: req.baseCommit } : {}) } : null),
  });
  const binding = provenance.dispatch(check.issueId, {
    claimId: req.claimId ?? null,
    participantId: req.holder,
    activationId: req.activationId ?? null,
    attemptId: req.attemptId ?? null,
    sessionId: req.sessionId ?? null,
    workspace: req.workspace,
    baseCommit: req.baseCommit ?? null,
    executionContext,
  }, { expectedClaim: check.expectedClaim, expectedRevision: check.revision, expectedContractHash: check.contractHash });
  if (binding.issueRevision !== check.revision || binding.contractHash !== check.contractHash) {
    throw new Error("dispatch rejected: binding diverged from the gated revision (concurrent edit; repair and retry)");
  }
  // Binding identity cannot diverge from the gated request: claim pin,
  // participant, and activation must match what checkDispatch fenced.
  if (req.claimId !== undefined && req.claimId !== null && binding.claimId !== req.claimId) {
    throw new Error("dispatch rejected: binding diverged from the pinned claim (concurrent claim change; repair and retry)");
  }
  if (binding.participantId !== req.holder || (binding.activationId ?? null) !== (req.activationId ?? null)) {
    throw new Error("dispatch rejected: binding diverged from the dispatch identity (concurrent claim change; repair and retry)");
  }
  return { check, binding };
}

// Narrow-vs-expand boundary probe for adversarial fixtures: returns the
// rejected entries without dispatching.
export function scopeExpansion(issues: IssueService, ref: string, requestedScope: string[]): string[] {
  const id = issues.resolveRef(ref).id;
  const revision = issues.getRevision(id, issues.getIssue(id).currentRevision);
  const contract = revision.contract as { scope?: unknown };
  const contractScope = Array.isArray(contract.scope) ? (contract.scope as string[]) : [];
  return scopeCovers(contractScope, requestedScope).expanded;
}
