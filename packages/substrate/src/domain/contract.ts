import { createHash } from "node:crypto";

// Canonical seven-field executable work contract (PRD §11).
// Full structural + semantic readiness is Phase 2; this module owns only the
// schema shape, canonical hashing, and minimal command-input sanity.

export interface ValidationRequirement {
  check: string;
  [key: string]: unknown;
}

export interface OutputRequirement {
  artifact: string;
  [key: string]: unknown;
}

export interface WorkContract {
  problem: string;
  success: string;
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  validation: ValidationRequirement[];
  output: OutputRequirement[];
  libraries?: string[];
  references?: string[];
  telemetry?: string[];
  rollback?: string[];
  dependencies?: string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function hashContract(contract: WorkContract): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(contract))).digest("hex");
}

// Minimal command-input sanity for the transaction rule's "validate" step.
// Phase 2 owns real structural readiness; this only rejects malformed input.
export function assertContractShape(contract: unknown): asserts contract is WorkContract {
  const fail = (why: string): never => {
    throw new Error(`invalid contract: ${why}`);
  };
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) fail("must be an object");
  const c = contract as Record<string, unknown>;
  if (typeof c["problem"] !== "string" || c["problem"].trim() === "") fail("problem must be a non-empty string");
  if (typeof c["success"] !== "string" || c["success"].trim() === "") fail("success must be a non-empty string");
  for (const f of ["scope", "nonGoals", "constraints", "validation", "output"]) {
    if (!Array.isArray(c[f])) fail(`${f} must be an array`);
  }
}
