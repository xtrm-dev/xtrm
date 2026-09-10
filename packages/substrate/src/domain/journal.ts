// Work Journal domain (PRD §20): Issue-scoped continuity, never authority.
// Pure types + validation only; persistence lives in journal-service.ts.
// Journal != memory (§25, §43): findings here never become reusable truth
// without a separate promotion step, which v0 does not implement.

import { v7 as uuidv7 } from "uuid";

export const JOURNAL_KINDS = [
  "checkpoint",
  "handoff",
  "milestone",
  "decision",
  "finding",
  "blocker",
  "compaction",
  "note",
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export function isJournalKind(value: unknown): value is JournalKind {
  return typeof value === "string" && (JOURNAL_KINDS as readonly string[]).includes(value);
}

export function newJournalEntryId(): string {
  return `jrn_${uuidv7()}`;
}

// Mechanical checkpoint (§20.2): everything the host already knows without
// model reasoning. Only issueId/revision/contractHash/collectedAt are
// required; every other field is populated "where available".
export interface MechanicalCheckpoint {
  issueId: string;
  issueRevision: number;
  contractHash: string;
  collectedAt: number;
  claimHolder?: string | null;
  claimActivationId?: string | null;
  claimExpiresAt?: number | null;
  participantId?: string | null;
  activationId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  workspace?: string | null;
  branch?: string | null;
  baseCommit?: string | null;
  headCommit?: string | null;
  changedFiles?: string[];
  commitsSincePrevious?: string[];
  pendingBlockers?: string[];
  childSummary?: ChildCheckpointRef[];
  specialistRefs?: string[];
  pendingAsks?: string[];
  externalBindings?: Array<{ provider: string; scope: string; remoteId: string }>;
  cursor?: number | null;
}

// Root checkpoints record references + projections, never transcripts (§22).
export interface ChildCheckpointRef {
  issueId: string;
  locator?: string;
  lifecycleState?: string;
  revision?: number;
  checkpointRef?: string | null;
  blockedBy?: string[];
}

// Semantic checkpoint (§20.3): bounded summarizer output. It can never
// change the Issue contract; scope/success changes need an Issue revision.
export interface SemanticCheckpoint {
  summary: string;
  completed?: string[];
  current?: string;
  next?: string[];
  blocked?: string[];
  openQuestions?: string[];
  keyDecisions?: string[];
  materialFindings?: string[];
}

export interface EvidenceRef {
  kind: string;
  key: string;
  value?: unknown;
}

export interface JournalEntry {
  id: string;
  issueId: string;
  issueRevision: number;
  sequence: number;
  runId: string | null;
  participantId: string | null;
  activationId: string | null;
  sessionId: string | null;
  kind: JournalKind;
  mechanical: MechanicalCheckpoint | null;
  semantic: SemanticCheckpoint | null;
  refs: EvidenceRef[];
  createdAt: number;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((e) => typeof e === "string");
}

// Validated on read as well as on write: a corrupt semantic row fails
// closed rather than feeding a resumed agent a malformed summary.
export function validateSemanticCheckpoint(value: unknown): string[] {
  const problems: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["semantic checkpoint must be an object"];
  }
  const s = value as Record<string, unknown>;
  if (typeof s["summary"] !== "string" || (s["summary"] as string).trim() === "") {
    problems.push("semantic.summary must be a non-empty string");
  }
  for (const f of ["completed", "next", "blocked", "openQuestions", "keyDecisions", "materialFindings"] as const) {
    if (s[f] !== undefined && !stringArray(s[f])) problems.push(`semantic.${f} must be an array of strings when present`);
  }
  if (s["current"] !== undefined && typeof s["current"] !== "string") {
    problems.push("semantic.current must be a string when present");
  }
  return problems;
}

export function assertSemanticCheckpoint(value: unknown): asserts value is SemanticCheckpoint {
  const problems = validateSemanticCheckpoint(value);
  if (problems.length > 0) throw new Error(`invalid semantic checkpoint: ${problems[0]}`);
}

export function validateMechanicalCheckpoint(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["mechanical checkpoint must be an object"];
  }
  const m = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof m["issueId"] !== "string" || (m["issueId"] as string).trim() === "") {
    problems.push("mechanical.issueId must be a non-empty string");
  }
  if (!Number.isInteger(m["issueRevision"])) problems.push("mechanical.issueRevision must be an integer");
  if (typeof m["contractHash"] !== "string" || (m["contractHash"] as string).trim() === "") {
    problems.push("mechanical.contractHash must be a non-empty string");
  }
  for (const f of ["changedFiles", "commitsSincePrevious", "pendingBlockers", "specialistRefs", "pendingAsks"] as const) {
    if (m[f] !== undefined && m[f] !== null && !stringArray(m[f])) {
      problems.push(`mechanical.${f} must be an array of strings when present`);
    }
  }
  return problems;
}

export function validateEvidenceRefs(refs: unknown): string[] {
  if (!Array.isArray(refs)) return ["refs must be an array"];
  for (let i = 0; i < refs.length; i++) {
    const e = refs[i] as Record<string, unknown> | null;
    if (e === null || typeof e !== "object" || Array.isArray(e)) return [`refs[${i}] must be an object`];
    if (typeof e["kind"] !== "string" || (e["kind"] as string).trim() === "") return [`refs[${i}].kind must be non-empty`];
    if (typeof e["key"] !== "string" || (e["key"] as string).trim() === "") return [`refs[${i}].key must be non-empty`];
  }
  return [];
}
