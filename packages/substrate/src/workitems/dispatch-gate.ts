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

// Fail-closed pre-activation check: no mutation, no AgentSession yet. Throws
// on draft/unready/blocked/non-dispatchable, on stale scope, and on any
// requestedScope outside the contract SCOPE (§39.1).
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

// Full dispatch: gate first, then the host-owned execution binding. The
// binding freezes revision/hash/context; later contract edits bind anew.
export function dispatchToSpecialist(
  issues: IssueService,
  provenance: ProvenanceService,
  req: SpecialistDispatchRequest,
): { check: DispatchCheck; binding: ExecutionBinding } {
  const check = checkDispatch(issues, req);
  const binding = provenance.dispatch(check.issueId, {
    claimId: req.claimId ?? null,
    participantId: req.holder,
    activationId: req.activationId ?? null,
    attemptId: req.attemptId ?? null,
    sessionId: req.sessionId ?? null,
    workspace: req.workspace,
    baseCommit: req.baseCommit ?? null,
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
