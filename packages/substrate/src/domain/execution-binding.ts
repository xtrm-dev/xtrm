// Execution bindings (PRD §26): immutable dispatch -> exact revision/hash.
// Pure types + validation only; persistence lives in provenance-service.ts.
// The binding is created by the host/runtime, never reconstructed from
// executor prose. Executor-supplied fields (participant/attempt/session)
// are recorded as observed labels, never as authority.

import { v7 as uuidv7 } from "uuid";
import type { WorkspaceIdentity } from "./claim.ts";

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
  workspace: string;
  baseCommit: string | null;
  createdAt: number;
}

export interface DispatchInput {
  claimId?: number | null;
  participantId?: string | null;
  activationId?: string | null;
  attemptId?: string | null;
  sessionId?: string | null;
  workspace: string | WorkspaceIdentity;
  baseCommit?: string | null;
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
  for (const f of ["participantId", "activationId", "attemptId", "sessionId", "baseCommit"] as const) {
    if (d[f] !== undefined && d[f] !== null && (typeof d[f] !== "string" || (d[f] as string).trim() === "")) {
      problems.push(`${f} must be a non-empty string when present`);
    }
  }
  if (d["claimId"] !== undefined && d["claimId"] !== null && !Number.isInteger(d["claimId"])) {
    problems.push("claimId must be an integer when present");
  }
  return problems;
}
