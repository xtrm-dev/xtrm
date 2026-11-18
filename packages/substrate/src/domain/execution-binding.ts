// Execution bindings (PRD §26): immutable dispatch -> exact revision/hash.
// Pure types + validation only; persistence lives in provenance-service.ts.
// The binding is created by the host/runtime, never reconstructed from
// executor prose. Executor-supplied fields (participant/attempt/session)
// are recorded as observed labels, never as authority.

import { v7 as uuidv7 } from "uuid";
import type { WorkspaceIdentity } from "./claim.ts";
import {
  normalizeExecutionContext,
  validateExecutionContext,
  type ExecutionContext,
} from "./execution-context.ts";

export interface ExecutionBinding {
  id: string;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  resolvedContextHash: string;
  claimId: number | null;
  participantId: string | null;
  activationId: string | null;
  attemptId: string | null;
  sessionId: string | null;
  // Who dispatched this execution and from which xtrm session (XTRM-839).
  // Null for every binding that never recorded one, including all bindings
  // written before migration 017: absent is not a placeholder.
  dispatcherParticipantId: string | null;
  dispatcherSessionId: string | null;
  workspace: string;
  baseCommit: string | null;
  createdAt: number;
  // Shared versioned envelope (X1): the authoritative runtime input.
  // Flat columns above stay as query-compatible projections of it.
  executionContext: ExecutionContext | null;
}

export interface DispatchInput {
  claimId?: number | null;
  participantId?: string | null;
  activationId?: string | null;
  attemptId?: string | null;
  sessionId?: string | null;
  dispatcherParticipantId?: string | null;
  dispatcherSessionId?: string | null;
  workspace: string | WorkspaceIdentity;
  baseCommit?: string | null;
  // Authoritative optional runtime input (ADR §57): replaces manual
  // --session/--activation/--attempt/--participant/--branch flags.
  executionContext?: ExecutionContext | null;
}

// Gate pin for atomic dispatch: the exact live claim observed by
// checkDispatch (id + generation), or null when no live claim was
// observed. Carried into provenance.dispatch and re-verified inside the
// same transaction before INSERT so claim expiry/release/reclaim between
// check and dispatch fails closed with no row written. Undefined means
// no pin was supplied (direct-service callers that bypass the gate).
export interface ExpectedClaimPin {
  id: number;
  generation: number;
}

export function newExecutionBindingId(): string {
  return `exb_${uuidv7()}`;
}

// Host-side validation: the revision/hash pair is always copied from the
// live Issue row by the service, never accepted from the caller, so there
// is nothing here for model output to forge — this only rejects malformed
// host input fail-closed.
export function validateDispatchInput(input: unknown): string[] {
  const problems: string[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) return ["dispatch input must be an object"];
  const d = input as Record<string, unknown>;
  const ws = d["workspace"];
  if (typeof ws !== "string" && (ws === null || typeof ws !== "object" || Array.isArray(ws))) {
    problems.push("workspace must be a non-empty path or WorkspaceIdentity");
  } else if (typeof ws === "string" && ws.trim() === "") {
    problems.push("workspace must be a non-empty path or WorkspaceIdentity");
  }
  for (const f of ["participantId", "activationId", "attemptId", "sessionId", "dispatcherParticipantId", "dispatcherSessionId", "baseCommit"] as const) {
    if (d[f] !== undefined && d[f] !== null && (typeof d[f] !== "string" || (d[f] as string).trim() === "")) {
      problems.push(`${f} must be a non-empty string when present`);
    }
  }
  if (d["claimId"] !== undefined && d["claimId"] !== null && !Number.isInteger(d["claimId"])) {
    problems.push("claimId must be an integer when present");
  }
  if (d["executionContext"] !== undefined && d["executionContext"] !== null) {
    for (const p of validateExecutionContext(d["executionContext"])) problems.push(p);
  }
  return problems;
}
