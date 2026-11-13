import { createHash } from "node:crypto";

// Canonical seven-field executable work contract (PRD §11).
// This module owns the schema shape, canonical hashing, command-input sanity,
// and the deterministic structural validator (PRD §12.1). Semantic readiness
// (attestation, derived state, dispatch) lives in ./readiness.ts.

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
// This only rejects malformed input; full structural readiness (§12.1) is
// validateContractStructure below and never blocks create/revise.
export function assertContractShape(contract: unknown): asserts contract is WorkContract {
  const fail = (why: string): never => {
    throw new Error(`invalid contract: ${why}`);
  };
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) fail("must be an object");
  const c = contract as Record<string, unknown>;
  const nested = c["contract"];
  if (nested !== null && typeof nested === "object") {
    fail('the contract is nested under a "contract" key; pass the inner object itself (problem, success, scope, nonGoals, constraints, validation, output at top level)');
  }
  if (typeof c["problem"] !== "string" || c["problem"].trim() === "") fail("problem must be a non-empty string");
  if (typeof c["success"] !== "string" || c["success"].trim() === "") fail("success must be a non-empty string");
  for (const f of ["scope", "nonGoals", "constraints", "validation", "output"]) {
    if (!Array.isArray(c[f])) fail(`${f} must be an array`);
  }
}

// -- normalisation (XTRM-786) -------------------------------------------------
// A prose entry where {check}/{artifact} belongs is a slight shape error, not a
// reason to lose the contract: the create/edit write path repairs it and says
// so. The repair only rewrites a plain string; whether a stored entry is
// ACCEPTABLE is readiness's verdict alone (validateContractStructure), so an
// object that already carries the key — including {check: ""} — is stored as
// written and judged there. The two deliberately differ: the write path owns
// shape, readiness owns the draft verdict.

export interface ContractRepair {
  field: "validation" | "output";
  key: "check" | "artifact";
  count: number;
}

export interface NormalisedContract {
  contract: WorkContract;
  repairs: ContractRepair[];
}

const NORMALISABLE_FIELDS = [
  { field: "validation", key: "check", example: '{"check": "…"}' },
  { field: "output", key: "artifact", example: '{"artifact": "…"}' },
] as const;

// One entry of the two object-array fields. An array entry fails here because
// it carries no named key, which is the same verdict readiness reached before
// this predicate existed.
function isValidContractEntry(entry: unknown, key: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "";
}

// Normalisation only converts a plain string. An object that already carries
// the key is left exactly as it is, even when the value is empty or of the
// wrong type: that contract stays the draft it was (readiness still rejects it),
// which is the behaviour a contract stored before this change had and keeps.
// Refusing it here would newly reject input that creates today.
function hasEntryKey(entry: unknown, key: string): boolean {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) && key in (entry as Record<string, unknown>);
}

function describeEntry(entry: unknown): string {
  if (entry === null) return "null";
  if (typeof entry === "string") return `a string ${JSON.stringify(entry.length > 60 ? `${entry.slice(0, 57)}…` : entry)}`;
  if (Array.isArray(entry)) return "an array";
  if (typeof entry !== "object") return `${typeof entry} (${String(entry)})`;
  const text = JSON.stringify(entry) ?? "";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * Repairs the two object-array fields on the create/edit write path: a string
 * entry becomes `{check}` / `{artifact}`, an object that already carries the key
 * is carried through untouched (extra keys included, empty value included — the
 * draft verdict is readiness's to make, not this function's), and an entry that
 * cannot be repaired unambiguously is refused with the field, the entry and the
 * expected shape named. Idempotent: normalising a normalised contract reports no
 * repairs.
 */
export function normaliseContract(contract: unknown): NormalisedContract {
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    return { contract: contract as WorkContract, repairs: [] };
  }
  const out: Record<string, unknown> = { ...(contract as Record<string, unknown>) };
  const repairs: ContractRepair[] = [];
  for (const { field, key, example } of NORMALISABLE_FIELDS) {
    const entries = out[field];
    if (!Array.isArray(entries)) continue;
    let count = 0;
    out[field] = entries.map((entry, index) => {
      if (typeof entry === "string") {
        // An empty string is wrapped as-is rather than refused: the repair has
        // one job (shape), and an empty check is readiness's finding, exactly as
        // it was before this change.
        count += 1;
        return { [key]: entry };
      }
      if (hasEntryKey(entry, key)) return entry;
      const reason =
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? `${describeEntry(entry)} has no "${key}" key`
          : `the entry is ${describeEntry(entry)}`;
      throw new Error(`invalid contract: ${field}[${index}] cannot be normalised: ${reason}; expected ${example} or a plain string`);
    });
    if (count > 0) repairs.push({ field, key, count });
  }
  return { contract: out as unknown as WorkContract, repairs };
}

/** One-line human notice for what the write path repaired. */
export function describeContractRepairs(repairs: ContractRepair[]): string {
  return repairs
    .map((r) => `${r.field}: ${r.count} ${r.count === 1 ? "entry" : "entries"} normalised to {${r.key}}`)
    .join(" · ");
}

// Entry-shape hints for the two object-array fields: a plain string where
// {check}/{artifact} is expected leaves the issue draft, so name the expected
// shape next to the structural finding instead of leaving the author to guess.
// Contracts written before XTRM-786 are still stored this way, so the read-side
// hint stays even though the write path now repairs them.
export function contractShapeHints(contract: unknown): string[] {
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) return [];
  const c = contract as Record<string, unknown>;
  const hints: string[] = [];
  for (const [field, key] of [["validation", "check"], ["output", "artifact"]] as const) {
    const entries = c[field];
    if (!Array.isArray(entries)) continue;
    const bad = entries.findIndex((e) => typeof e !== "object" || e === null || Array.isArray(e));
    if (bad >= 0) hints.push(`${field}[${bad}] is ${typeof entries[bad] === "string" ? "a plain string" : "not an object"}; expected ${field}: [{"${key}": "…"}]`);
  }
  return hints;
}

// -- structural validation (PRD §12.1) --------------------------------------

export interface StructuralFinding {
  field: string;
  code: string;
  message: string;
}

// SCRUTINY is policy input, not prose. dispatchable work names one level;
// the policy seam that enforces it lives in ./readiness.ts.
export const SCRUTINY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export function isValidScrutiny(value: unknown): value is string {
  return typeof value === "string" && (SCRUTINY_LEVELS as readonly string[]).includes(value);
}

// Structured ownership metadata (PRD §14.4). Human-readable SCOPE stays
// authoritative; this supports overlap detection and safer parallelism.
export interface OwnershipContract {
  repositories?: string[];
  paths?: string[];
  services?: string[];
  interfaces?: string[];
}

const OWNERSHIP_FIELDS = ["repositories", "paths", "services", "interfaces"] as const;

export function validateOwnership(ownership: unknown): StructuralFinding[] {
  const out: StructuralFinding[] = [];
  if (ownership == null) return out;
  if (typeof ownership !== "object" || Array.isArray(ownership)) {
    return [{ field: "ownership", code: "ownership-shape", message: "ownership must be an object" }];
  }
  for (const f of OWNERSHIP_FIELDS) {
    const v = (ownership as Record<string, unknown>)[f];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((e) => typeof e !== "string" || e.trim() === "")) {
      out.push({ field: `ownership.${f}`, code: "ownership-shape", message: `ownership.${f} must be an array of non-empty strings` });
    }
  }
  return out;
}

// Forbidden placeholders: an unresolved marker anywhere in the seven fields
// means the fresh-worker test (§11.1) fails — the worker would have to guess.
const PLACEHOLDER_RE = /\b(TBD|TODO|XXX|FIXME)\b/i;

function checkPlaceholders(findings: StructuralFinding[], field: string, values: unknown[]): void {
  for (const v of values) {
    if (typeof v === "string" && PLACEHOLDER_RE.test(v)) {
      findings.push({ field, code: "placeholder", message: `${field} contains an unresolved marker` });
      return;
    }
  }
}

function nonEmptyStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((e) => typeof e === "string" && e.trim() !== "");
}

export interface StructuralSubject {
  contract: unknown;
  scrutiny?: unknown;
  ownership?: unknown;
  contextRefs?: unknown;
  lifecycleState?: unknown;
}

// Deterministic structural validation over the seven-field contract plus the
// revision-scoped metadata that dispatch depends on. Returns findings;
// empty means structurally valid. Never throws on malformed input.
export function validateContractStructure(subject: StructuralSubject): StructuralFinding[] {
  const findings: StructuralFinding[] = [];
  const c = subject.contract as Record<string, unknown> | null;
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    return [{ field: "contract", code: "contract-shape", message: "contract must be an object" }];
  }
  for (const f of ["problem", "success"] as const) {
    if (typeof c[f] !== "string" || (c[f] as string).trim() === "") {
      findings.push({ field: f, code: "required-field", message: `${f} must be a non-empty string` });
    }
  }
  for (const f of ["scope", "nonGoals", "constraints"] as const) {
    if (!nonEmptyStrings(c[f])) {
      findings.push({ field: f, code: "required-field", message: `${f} must be a non-empty array of non-empty strings` });
    }
  }
  const validation = c["validation"];
  if (!Array.isArray(validation) || validation.length === 0 || validation.some((e) => !isValidContractEntry(e, "check"))) {
    findings.push({ field: "validation", code: "required-field", message: "validation must be a non-empty array of { check: non-empty string }" });
  }
  const output = c["output"];
  if (!Array.isArray(output) || output.length === 0 || output.some((e) => !isValidContractEntry(e, "artifact"))) {
    findings.push({ field: "output", code: "required-field", message: "output must be a non-empty array of { artifact: non-empty string }" });
  }
  checkPlaceholders(findings, "problem", [c["problem"]]);
  checkPlaceholders(findings, "success", [c["success"]]);
  for (const f of ["scope", "nonGoals", "constraints"] as const) {
    if (Array.isArray(c[f])) checkPlaceholders(findings, f, c[f] as unknown[]);
  }
  if (Array.isArray(validation)) {
    checkPlaceholders(findings, "validation", validation.map((e) => (e as Record<string, unknown> | null)?.["check"]));
  }
  if (Array.isArray(output)) {
    checkPlaceholders(findings, "output", output.map((e) => (e as Record<string, unknown> | null)?.["artifact"]));
  }
  if (!isValidScrutiny(subject.scrutiny)) {
    findings.push({
      field: "scrutiny",
      code: "scrutiny-reference",
      message: `scrutiny must be one of ${SCRUTINY_LEVELS.join(", ")}`,
    });
  }
  findings.push(...validateOwnership(subject.ownership));
  findings.push(...validateContextRefs(subject.contextRefs));
  if (subject.lifecycleState !== undefined && (typeof subject.lifecycleState !== "string" || subject.lifecycleState.trim() === "")) {
    findings.push({ field: "lifecycleState", code: "lifecycle-state", message: "lifecycle state must be a non-empty string" });
  }
  return findings;
}

export function isStructurallyValid(subject: StructuralSubject): boolean {
  return validateContractStructure(subject).length === 0;
}

// Context references (PRD §15) carried on a revision. `journal` and `memory`
// kinds are rejected: the journal is continuity, not authority, and planning
// context must never treat journal entries as memory authority (PRD §43).
export function validateContextRefs(refs: unknown): StructuralFinding[] {
  if (refs === undefined || refs === null) return [];
  if (!Array.isArray(refs)) {
    return [{ field: "contextRefs", code: "context-shape", message: "contextRefs must be an array" }];
  }
  const out: StructuralFinding[] = [];
  for (let i = 0; i < refs.length; i++) {
    const e = refs[i] as Record<string, unknown> | null;
    const at = `contextRefs[${i}]`;
    if (e === null || typeof e !== "object" || Array.isArray(e) || typeof e["key"] !== "string" || (e["key"] as string).trim() === "") {
      out.push({ field: at, code: "context-shape", message: `${at} must be an object with a non-empty string key` });
      continue;
    }
    if (!("value" in e) || e["value"] === undefined) {
      out.push({ field: at, code: "context-shape", message: `${at} must define a value` });
    }
    const kind = e["kind"];
    if (kind !== undefined && (typeof kind !== "string" || kind.trim() === "")) {
      out.push({ field: at, code: "context-shape", message: `${at}.kind must be a non-empty string when present` });
    } else if (kind === "journal" || kind === "memory") {
      out.push({
        field: at,
        code: "journal-authority",
        message: `${at} uses kind "${kind}": journal entries are continuity, never planning authority (§43)`,
      });
    }
  }
  return out;
}
