// Work Journal domain (PRD §20): Issue-scoped continuity, never authority.
// Pure types + validation only; persistence lives in journal-service.ts.
// Journal != memory (§25, §43): findings here never become reusable truth
// without a separate promotion step, which v0 does not implement.

import { v7 as uuidv7 } from "uuid";

// Bounded nine-kind vocabulary (ADR §22): note, finding, decision, blocker,
// milestone, handoff, result, checkpoint, compaction. Do not multiply
// near-synonymous kinds; do not reduce everything to `note`.
export const JOURNAL_KINDS = [
  "checkpoint",
  "handoff",
  "milestone",
  "decision",
  "finding",
  "blocker",
  "result",
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

// Bounded result payload (ADR §29, §39): a durable execution outcome that may
// exist with zero Git commits. Publication is bounded on purpose — arbitrary
// raw model output stays in runtime storage and is referenced, never dumped
// into the Journal. The field set is closed: unknown keys are rejected so a
// host cannot smuggle an unbounded body in through a new key.
// ponytail: whole result text is bounded per field; raise if a real body
// needs it, but keep the reference-not-dump rule (ADR §39).
const RESULT_MAX_TEXT = 4000;
const RESULT_MAX_ITEMS = 100;
const RESULT_MAX_ITEM_TEXT = 1000;

export const RESULT_STRING_FIELDS = ["summary", "attempted", "outcome"] as const;
export const RESULT_ARRAY_FIELDS = [
  "completed",
  "validation",
  "findings",
  "artifactRefs",
  "receiptRefs",
  "provenanceRefs",
] as const;
export const RESULT_FIELDS = [...RESULT_STRING_FIELDS, ...RESULT_ARRAY_FIELDS] as const;

// Version envelope (XTRM-339): `resultVersion` is written inside the existing
// JSON payload — no sibling column, no migration. 1 is the only known
// version. Missing version reads as 1 (pre-change rows stay readable);
// any other version fails closed with a message naming the version.
// `result.outcome` stays a free string: no closure-outcome enum is invented
// here (that is C1's); a future version may add bounded fields alongside it.
export const RESULT_VERSION = 1;
export const KNOWN_RESULT_VERSIONS = [1] as const;

export interface ResultPayload {
  summary: string;
  resultVersion?: number;
  attempted?: string;
  outcome?: string;
  completed?: string[];
  validation?: string[];
  findings?: string[];
  artifactRefs?: string[];
  receiptRefs?: string[];
  provenanceRefs?: string[];
}

export function validateResultPayload(value: unknown): string[] {
  const problems: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["result payload must be an object"];
  }
  const r = value as Record<string, unknown>;
  const version = r["resultVersion"];
  if (version !== undefined) {
    if (typeof version !== "number" || !Number.isInteger(version)) {
      problems.push(`result.resultVersion ${JSON.stringify(version)} is unknown (want ${RESULT_VERSION})`);
    } else if (!(KNOWN_RESULT_VERSIONS as readonly number[]).includes(version)) {
      problems.push(`result.resultVersion ${version} is unknown (want ${RESULT_VERSION})`);
    }
  }
  for (const key of Object.keys(r)) {
    if (key === "resultVersion") continue;
    if (!(RESULT_FIELDS as readonly string[]).includes(key)) {
      problems.push(`result.${key} is not a bounded result field (want ${RESULT_FIELDS.join("|")})`);
    }
  }
  const summary = r["summary"];
  if (typeof summary !== "string" || summary.trim() === "") {
    problems.push("result.summary must be a non-empty string");
  } else if (summary.length > RESULT_MAX_TEXT) {
    problems.push(`result.summary must be at most ${RESULT_MAX_TEXT} characters`);
  }
  for (const f of ["attempted", "outcome"] as const) {
    const v = r[f];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim() === "") problems.push(`result.${f} must be a non-empty string when present`);
    else if (v.length > RESULT_MAX_TEXT) problems.push(`result.${f} must be at most ${RESULT_MAX_TEXT} characters`);
  }
  for (const f of RESULT_ARRAY_FIELDS) {
    const v = r[f];
    if (v === undefined) continue;
    if (!stringArray(v)) {
      problems.push(`result.${f} must be an array of strings when present`);
      continue;
    }
    if (v.length > RESULT_MAX_ITEMS) problems.push(`result.${f} must hold at most ${RESULT_MAX_ITEMS} items`);
    if (v.some((e) => e.length > RESULT_MAX_ITEM_TEXT)) {
      problems.push(`result.${f} items must be at most ${RESULT_MAX_ITEM_TEXT} characters`);
    }
  }
  return problems;
}

export function assertResultPayload(value: unknown): asserts value is ResultPayload {
  const problems = validateResultPayload(value);
  if (problems.length > 0) throw new Error(`invalid result payload: ${problems[0]}`);
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
  result: ResultPayload | null;
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
