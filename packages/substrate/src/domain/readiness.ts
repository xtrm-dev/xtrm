import { createHash } from "node:crypto";
import {
  validateContractStructure,
  type StructuralFinding,
  type StructuralSubject,
} from "./contract.ts";

// Semantic readiness, derived operational state, dispatch gate inputs, and
// deterministic context inheritance (PRD §§12, 13, 15, 39.1, 43).
// Pure functions only: IssueService wires DB rows into these so CLI and every
// integration share the same readiness service (PRD §5).

// -- semantic attestation (PRD §12.2) ---------------------------------------

export type AttestationOutcome = "ready" | "reject";

export interface ReadinessAttestation {
  id: number;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  outcome: AttestationOutcome;
  policy: string;
  attestedBy: string;
  evidenceRefs?: string[];
  blockingGaps?: string[];
  createdAt: number;
}

// An attestation authorizes exactly one contract revision: it is current iff
// it says "ready" for the issue's present revision AND present contract hash.
// Any contract edit bumps both, invalidating prior attestations.
export function isAttestationCurrent(
  attestation: ReadinessAttestation | null,
  revision: number,
  contractHash: string,
): boolean {
  return (
    attestation !== null &&
    attestation.outcome === "ready" &&
    attestation.issueRevision === revision &&
    attestation.contractHash === contractHash
  );
}

// -- SCRUTINY policy seam ----------------------------------------------------

export interface ScrutinyPolicy {
  ref: string;
  allow: (level: string) => boolean;
}

const SCRUTINY_POLICIES = new Map<string, ScrutinyPolicy>();

export const DEFAULT_SCRUTINY_POLICY_REF = "default";

function defaultPolicy(): ScrutinyPolicy {
  return {
    ref: DEFAULT_SCRUTINY_POLICY_REF,
    allow: (level) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level),
  };
}

SCRUTINY_POLICIES.set(DEFAULT_SCRUTINY_POLICY_REF, defaultPolicy());

// Integrations plug stricter policy here (e.g. production lanes that only
// accept HIGH/CRITICAL). Unknown refs fail closed at dispatch.
export function registerScrutinyPolicy(policy: ScrutinyPolicy): void {
  if (!policy.ref.trim()) throw new Error("scrutiny policy ref must be non-empty");
  SCRUTINY_POLICIES.set(policy.ref, policy);
}

export function scrutinyPolicyFor(ref: string): ScrutinyPolicy {
  const found = SCRUTINY_POLICIES.get(ref);
  if (!found) throw new Error(`fail-closed: unknown scrutiny policy: ${ref}`);
  return found;
}

// -- derived operational state (PRD §13) -------------------------------------

export type OperationalState = "terminal" | "deferred" | "draft" | "blocked" | "claimed" | "ready";

export const TERMINAL_LIFECYCLE = ["done", "cancelled", "archived"] as const;

// A blocker is satisfied only by completed lineage. A cancelled prerequisite
// stays unsatisfied: abandoned work must be explicitly replanned, never
// silently treated as done (fail closed).
export function isBlockerSatisfied(blockerLifecycleState: string): boolean {
  return blockerLifecycleState === "done" || blockerLifecycleState === "archived";
}

export interface ReadinessInputs extends StructuralSubject {
  issueId: string;
  revision: number;
  contractHash: string;
  lifecycleState: string;
  deferUntil: number | null;
  attestation: ReadinessAttestation | null;
  unsatisfiedBlockers: string[];
  now: number;
  hasActiveClaim: boolean;
}

export interface ReadinessReport {
  issueId: string;
  revision: number;
  contractHash: string;
  findings: StructuralFinding[];
  structurallyValid: boolean;
  attestationCurrent: boolean;
  unsatisfiedBlockers: string[];
  state: OperationalState;
  dispatchable: boolean;
  reasons: string[];
}

// Derived, never stored. `blocked` and `claimed` come from graph + runtime
// state, so closing the final blocker flips the projection with no write.
export function deriveReadiness(inp: ReadinessInputs): ReadinessReport {
  const findings = validateContractStructure(inp);
  const structurallyValid = findings.length === 0;
  const attestationCurrent = isAttestationCurrent(inp.attestation, inp.revision, inp.contractHash);
  const reasons: string[] = [];
  let state: OperationalState;
  if ((TERMINAL_LIFECYCLE as readonly string[]).includes(inp.lifecycleState)) {
    state = "terminal";
    reasons.push(`lifecycle is terminal (${inp.lifecycleState})`);
  } else if (inp.deferUntil !== null && inp.deferUntil > inp.now) {
    state = "deferred";
    reasons.push("deferred until a future time");
  } else if (!structurallyValid) {
    state = "draft";
    for (const f of findings) reasons.push(`${f.field}: ${f.message}`);
  } else if (!attestationCurrent) {
    state = "draft";
    reasons.push("no current semantic attestation for this revision + contract hash");
  } else if (inp.unsatisfiedBlockers.length > 0) {
    state = "blocked";
    reasons.push(`unsatisfied blockers: ${inp.unsatisfiedBlockers.join(", ")}`);
  } else if (inp.hasActiveClaim) {
    state = "claimed";
    reasons.push("an active claim holds this issue");
  } else {
    state = "ready";
  }
  // SCRUTINY recheck at dispatch time: a policy change after attestation must
  // not silently widen dispatch authority. Unknown policy refs fail closed
  // to draft (never throw from a pure projection).
  if (state === "ready" && inp.attestation) {
    let allowed = false;
    try {
      allowed = scrutinyPolicyFor(inp.attestation.policy).allow(String(inp.scrutiny));
    } catch {
      allowed = false;
    }
    if (!allowed) {
      state = "draft";
      reasons.push(`scrutiny policy \"${inp.attestation.policy}\" denies level \"${String(inp.scrutiny)}\"`);
    }
  }
  return {
    issueId: inp.issueId,
    revision: inp.revision,
    contractHash: inp.contractHash,
    findings,
    structurallyValid,
    attestationCurrent,
    unsatisfiedBlockers: [...inp.unsatisfiedBlockers],
    state,
    dispatchable: state === "ready",
    reasons,
  };
}

// -- dispatch scope check (PRD §39.1) ----------------------------------------

// Free-form delegation text may NARROW an authorized activation but never
// expand it. A requested entry is covered by exact match or by naming a
// sub-path under a contract SCOPE boundary; anything else is expansion.
export function scopeCovers(contractScope: string[], requested: string[]): { ok: boolean; expanded: string[] } {
  const expanded = requested.filter(
    (r) => !contractScope.some((c) => r === c || r.startsWith(`${c}/`)),
  );
  return { ok: expanded.length === 0, expanded };
}

// -- deterministic context inheritance (PRD §15) ------------------------------

export interface ContextRef {
  key: string;
  value: unknown;
  kind?: string;
}

export interface ResolvedContextEntry {
  key: string;
  value: unknown;
  sourceIssueId: string;
  sourceRevision: number;
  sourceField: "contextRefs";
  resolutionRule: "own" | "inherited";
}

export interface ResolvedContext {
  issueId: string;
  revision: number;
  entries: ResolvedContextEntry[];
  hash: string;
}

// Chain runs root → leaf; the leaf wins per key. Every value keeps source
// provenance so execution binds to a snapshot, not to live ancestors.
export function resolveInheritedContext(
  chain: Array<{ issueId: string; revision: number; refs: ContextRef[] }>,
): Omit<ResolvedContext, "issueId" | "revision"> {
  const merged = new Map<string, ResolvedContextEntry>();
  const leafId = chain.length > 0 ? chain[chain.length - 1]!.issueId : "";
  for (const link of chain) {
    for (const ref of link.refs) {
      if (ref.kind === "journal" || ref.kind === "memory") {
        throw new Error(`fail-closed: context key \"${ref.key}\" claims ${ref.kind} authority (§43)`);
      }
      merged.set(ref.key, {
        key: ref.key,
        value: ref.value,
        sourceIssueId: link.issueId,
        sourceRevision: link.revision,
        sourceField: "contextRefs",
        resolutionRule: link.issueId === leafId ? "own" : "inherited",
      });
    }
  }
  const entries = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return { entries, hash };
}
