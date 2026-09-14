// First-class Closure (XTRM-252.7 / C1, implements ADR §96).
//
// Closure answers why an Issue became terminal. Lifecycle state
// (open|deferred|done|cancelled|archived) and closure outcome are NOT the
// same thing (ADR §42): the state says where the Issue rests, the outcome
// says why it got there, and the reason/actor/session/revision/hash/refs
// say on what evidence. The reason lives in the store (ADR §43) — never
// only in `git log`.
//
// Pure types + validation only; persistence lives in closure-service.ts
// behind additive migration 011. Unknown values stay absent, never
// invented (§98).

import { v7 as uuidv7 } from "uuid";
import type { ExecutionContext } from "./execution-context.ts";

// Bounded closure-outcome vocabulary (ADR §96). Closed: anything outside
// this set fails validation rather than persisting a novel outcome.
// Deliberately distinct from lifecycle state and from the attestation
// ready|reject outcome (which authorizes a revision, not a closure).
export const CLOSURE_OUTCOMES = [
  "completed",
  "superseded",
  "duplicate",
  "wont_fix",
  "invalid",
  "cancelled",
  "abandoned",
] as const;
export type ClosureOutcome = (typeof CLOSURE_OUTCOMES)[number];

export function isClosureOutcome(value: unknown): value is ClosureOutcome {
  return typeof value === "string" && (CLOSURE_OUTCOMES as readonly string[]).includes(value);
}

// Terminal lifecycle states a Closure can rest on. done is the default;
// cancelled is reserved for the cancelled outcome (and the cancel path).
// archived is lifecycle-only: archiving is retention, not closure, so no
// Closure row is written for it.
export const CLOSURE_TERMINAL_STATES = ["done", "cancelled"] as const;
export type ClosureTerminalState = (typeof CLOSURE_TERMINAL_STATES)[number];

export type ClosureSource = "sb" | "beads";

export interface Closure {
  closureId: string;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  terminalState: ClosureTerminalState;
  outcome: ClosureOutcome;
  reason: string;
  actor: string;
  executionContext: ExecutionContext | null;
  validationRefs: string[];
  journalResultRefs: string[];
  receiptRefs: string[];
  artifactRefs: string[];
  source: ClosureSource;
  legacyState: string | null;
  closedAt: number;
}

export type ClosureAttemptKind = "close" | "reopen" | "cancel";
export type ClosureAttemptStatus = "failed" | "completed";

// Every close/reopen/cancel attempt is durable (ADR §47): failed attempts
// are never rewritten into only the final successful attempt. A failed row
// carries the error; a completed row points at its Closure.
export interface ClosureAttempt {
  id: number;
  issueId: string;
  kind: ClosureAttemptKind;
  status: ClosureAttemptStatus;
  outcome: ClosureOutcome | null;
  reason: string | null;
  error: string | null;
  closureId: string | null;
  createdAt: number;
}

export function newClosureId(): string {
  return `clo_${uuidv7()}`;
}

// Outcome/state separation (ADR §42): only the cancelled outcome rests on
// the cancelled lifecycle state; every other outcome rests on done.
export function terminalStateForOutcome(outcome: ClosureOutcome): ClosureTerminalState {
  return outcome === "cancelled" ? "cancelled" : "done";
}

// Beads close-reason intake without guessing: when the legacy reason names
// an outcome token exactly, keep it; otherwise rest on completed and let
// source=beads mark the row as migrated (the verbatim reason is preserved
// in the reason column either way).
export function inferBeadsOutcome(reason: string): ClosureOutcome {
  const token = reason.trim().toLowerCase();
  if (isClosureOutcome(token)) return token;
  return "completed";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function validateRefList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [`${field} must be an array of non-empty strings when present`];
  for (const entry of value) {
    if (!nonEmpty(entry)) return [`${field} must be an array of non-empty strings when present`];
  }
  return [];
}

export function cleanRefList(value: unknown): string[] {
  if (value === undefined) return [];
  return (value as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
}
