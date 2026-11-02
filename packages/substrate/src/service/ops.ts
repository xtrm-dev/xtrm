// The operation table: the entire vocabulary a client can use.
//
// Every entry is a named call into the same services `sb` itself uses. There is
// no `sql` op, no expression op and no path op: a client on another machine can
// ask for a claim to be released, and cannot ask for the statements that would
// do it. That is the whole reason this surface exists rather than a tunnel to the
// file (ADR-008, in-process consumers).

import type { SubstrateDatabase } from "../store/database.ts";
import { IssueService } from "../service/issue-service.ts";
import { JournalService } from "../service/journal-service.ts";
import { ProvenanceService } from "../service/provenance-service.ts";
import { ResumeService } from "../service/resume-service.ts";
import { IntegrationService } from "../service/integration-service.ts";
import { SubstrateIssueStore } from "../workitems/substrate-store.ts";
import { checkDispatch, dispatchToSpecialist } from "../workitems/dispatch-gate.ts";
import type { SpecialistDispatchRequest } from "../workitems/dispatch-gate.ts";
import {
  ACTIVITY_READER_LIMIT,
  activateAuthority,
  listActiveAuthority,
  listAuthority,
  removeAuthority,
  type AuthorityOperation,
} from "./authority-service.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "../domain/provenance.ts";
import { ServiceCallError, type ServiceErrorCode } from "./protocol.ts";

export interface Services {
  db: SubstrateDatabase;
  issues: IssueService;
  journal: JournalService;
  provenance: ProvenanceService;
  resume: ResumeService;
  store: SubstrateIssueStore;
}

export function createServices(db: SubstrateDatabase): Services {
  const issues = new IssueService(db);
  const journal = new JournalService(db, issues);
  const provenance = new ProvenanceService(db, issues, journal);
  const resume = new ResumeService(db, issues, journal, { external: new IntegrationService(db, issues) });
  const store = new SubstrateIssueStore(issues, journal);
  return { db, issues, journal, provenance, resume, store };
}

type Args = Record<string, unknown>;
type Handler = (services: Services, args: Args) => unknown | Promise<unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ServiceCallError("bad_request", `argument "${key}" must be a non-empty string`);
  }
  return value;
}

function optionalText(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return text(args, key);
}

// A wire integer must be a safe integer: `Number.isInteger` accepts 1e300 and
// -1e300, and a bound that only asks "is it an integer" stores a value no clock,
// cursor or TTL can ever work with.
function integer(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ServiceCallError("bad_request", `argument "${key}" must be an integer`);
  }
  return value;
}

function bounded(args: Args, key: string, min: number, max: number): number {
  const value = integer(args, key);
  if (value < min || value > max) {
    throw new ServiceCallError("bad_request", `argument "${key}" must be between ${min} and ${max}`);
  }
  return value;
}

function optionalInteger(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return integer(args, key);
}

function optionalBounded(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return bounded(args, key, min, max);
}

const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const READER_LIMIT = ACTIVITY_READER_LIMIT;
const MAX_REVISION = 1_000_000_000;
const MAX_LIMIT = 1000;

function record(args: Args, key: string): Record<string, unknown> {
  const value = args[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServiceCallError("bad_request", `argument "${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(args: Args, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return record(args, key);
}

/**
 * Named operations, grouped by the service they call.
 *
 * `hello` is handled by the server itself (it is the handshake, not an
 * operation), and anything absent from this table is refused with `unknown_op`
 * — the list is the capability set the handshake reports.
 */
export const OPERATIONS: Record<string, Handler> = {
  // ---- issues (IssueService) ----
  "issue.resolveRef": (s, a) => s.issues.resolveRef(text(a, "ref")),
  "issue.resolveRefInProject": (s, a) => s.issues.resolveRefInProject(text(a, "ref"), text(a, "projectId")),
  "issue.get": (s, a) => s.issues.getIssue(text(a, "issueId")),
  "issue.getRevision": (s, a) => s.issues.getRevision(text(a, "issueId"), bounded(a, "revision", 1, MAX_REVISION)),
  "issue.listEvents": (s, a) => s.issues.listEvents(text(a, "issueId")),
  "issue.getReadiness": (s, a) => s.issues.getReadiness(text(a, "issueId")),
  "issue.unsatisfiedBlockers": (s, a) => s.issues.unsatisfiedBlockers(text(a, "issueId")),
  "issue.getActiveClaim": (s, a) => s.issues.getActiveClaim(text(a, "issueId")),
  "issue.getParent": (s, a) => s.issues.getParent(text(a, "issueId")),
  "issue.getResolvedContext": (s, a) => s.issues.getResolvedContext(text(a, "issueId")),
  "issue.resolveProject": (s, a) => s.issues.resolveProject({ gitRoot: text(a, "gitRoot") }),
  "issue.queryAllIssues": (s, a) => s.issues.queryAllIssues(record(a, "query") as never),
  "issue.create": (s, a) => s.issues.createIssue(record(a, "input") as never),
  "issue.updateContract": (s, a) =>
    s.issues.updateContract(
      text(a, "issueId"),
      record(a, "contract") as never,
      text(a, "authoredBy"),
      optionalRecord(a, "opts") as never,
    ),
  "issue.setTitle": (s, a) => s.issues.setTitle(text(a, "issueId"), text(a, "title")),
  "issue.setPriority": (s, a) => s.issues.setPriority(text(a, "issueId"), bounded(a, "priority", 0, 1_000_000)),
  "issue.setScrutiny": (s, a) => s.issues.setScrutiny(text(a, "issueId"), text(a, "scrutiny"), optionalText(a, "authoredBy")),
  "issue.claimIssue": (s, a) =>
    s.issues.claimIssue(text(a, "issueId"), text(a, "holder"), {
      activationId: optionalText(a, "activationId"),
      ttlMs: optionalBounded(a, "ttlMs", 1, MAX_TTL_MS),
    }),
  "issue.claimReady": (s, a) =>
    s.issues.claimReady(text(a, "issueId"), text(a, "holder"), record(a, "attestation") as never, {
      activationId: optionalText(a, "activationId"),
    }),
  "issue.renewClaim": (s, a) =>
    s.issues.renewClaim(text(a, "issueId"), text(a, "holder"), {
      activationId: optionalText(a, "activationId"),
      ttlMs: optionalBounded(a, "ttlMs", 1, MAX_TTL_MS),
    }),
  "issue.releaseClaim": (s, a) =>
    s.issues.releaseClaim(text(a, "issueId"), text(a, "holder"), { activationId: optionalText(a, "activationId") }),
  // Pi handlers read the attestation that made an issue claimable, and the MCP
  // server appends an event when it degrades a checkpoint.
  "issue.latestAttestation": (s, a) => s.issues.latestAttestation(text(a, "issueId")),
  "issue.appendEvent": (s, a) =>
    s.issues.appendEvent(text(a, "issueId"), text(a, "type"), a["payload"], optionalInteger(a, "at")),

  // ---- dispatch gate (check, then the binding mutation) ----
  "gate.check": (s, a) => checkDispatch(s.issues, record(a, "request") as unknown as SpecialistDispatchRequest),
  "gate.dispatch": (s, a) =>
    dispatchToSpecialist(
      s.issues,
      s.provenance,
      record(a, "request") as unknown as SpecialistDispatchRequest,
    ),

  // ---- store view (issue + readiness + pinned contract in one read) ----
  "store.get": (s, a) => s.store.get(text(a, "ref")),
  "store.addJournal": (s, a) => {
    s.store.addJournal(text(a, "ref"), text(a, "kind"), {
      participantId: optionalText(a, "participantId"),
      activationId: optionalText(a, "activationId"),
    });
    return { ok: true };
  },

  // ---- journal (JournalService) ----
  "journal.appendEntry": (s, a) => s.journal.appendEntry(text(a, "issueId"), record(a, "input") as never),
  "journal.listEntries": (s, a) =>
    s.journal.listEntries(text(a, "issueId"), {
      kind: optionalText(a, "kind") as never,
      limit: optionalBounded(a, "limit", 1, MAX_LIMIT),
    }),
  "journal.latest": (s, a) => s.journal.latest(text(a, "issueId"), { kind: optionalText(a, "kind") as never }),
  "journal.latestCheckpoint": (s, a) => s.journal.latestCheckpoint(text(a, "issueId")),
  "journal.since": (s, a) => s.journal.since(text(a, "issueId"), bounded(a, "cursor", 0, MAX_REVISION)),
  "journal.checkpoint": (s, a) => s.journal.checkpoint(text(a, "issueId"), record(a, "input") as never),
  "journal.collectMechanical": (s, a) =>
    s.journal.collectMechanical(text(a, "issueId"), record(a, "input") as never),
  "journal.renderCheckpoint": (s, a) => s.journal.renderCheckpoint(record(a, "entry") as never),
  "journal.getEntry": (s, a) => s.journal.getEntry(text(a, "entryId")),
  "journal.timeline": (s, a) =>
    s.journal.timeline(text(a, "issueId"), {
      kind: optionalText(a, "kind") as never,
      limit: optionalBounded(a, "limit", 1, MAX_LIMIT),
    }),
  // Compaction checkpoint: the same write as journal.checkpoint, reporting a
  // degraded result instead of failing, because a compaction must not be lost to
  // a storage error.
  "journal.compactionCheckpoint": (s, a) =>
    s.journal.compactionCheckpoint(text(a, "issueId"), record(a, "input") as never),
  // Enrichment writes only `semantic_json` on an existing entry plus an audit
  // event: it cannot change the entry's id, issue, kind or sequence.
  "journal.enrichEntry": (s, a) =>
    s.journal.enrichEntry(text(a, "entryId"), record(a, "semantic") as never),

  // ---- provenance (ProvenanceService) ----
  "provenance.dispatch": (s, a) => s.provenance.dispatch(text(a, "issueId"), record(a, "input") as never),
  "provenance.allocateReceipt": (s, a) => s.provenance.allocateReceipt(text(a, "bindingId")),
  "provenance.attachArtifact": (s, a) =>
    s.provenance.attachArtifact(text(a, "receiptId"), artifactKind(a["kind"]), text(a, "value")),
  "provenance.bindCommit": (s, a) => s.provenance.bindCommit(text(a, "receiptId"), text(a, "sha")),
  "provenance.listReceipts": (s, a) => s.provenance.listReceipts(text(a, "issueId")),
  "provenance.listBindings": (s, a) => s.provenance.listBindings(text(a, "issueId")),
  "provenance.trace": (s, a) => s.provenance.trace(text(a, "issueId")),
  "provenance.findByCommit": (s, a) => s.provenance.findByCommit(text(a, "sha")),
  "provenance.sessionDetail": (s, a) => s.provenance.sessionDetail(text(a, "sessionId")),
  "provenance.activationDetail": (s, a) => s.provenance.activationDetail(text(a, "activationId")),

  // ---- resume capsule (ResumeService): build, then render on the caller's side ----
  "resume.buildCapsule": (s, a) => s.resume.buildCapsule(text(a, "issueId")),
  "resume.renderCapsule": (s, a) => s.resume.renderCapsule(record(a, "capsule") as never),

  // ---- activation authority: structured rows, never SQL ----
  "authority.record": (s, a) => activateAuthority(s.db, a as unknown as AuthorityOperation),
  "authority.remove": (s, a) =>
    removeAuthority(s.db, text(a, "activationId"), optionalText(a, "expectState")),
  "authority.list": (s, a) =>
    a["activeOnly"] === true
      ? { rows: listActiveAuthority(s.db, optionalBounded(a, "limit", 1, MAX_LIMIT) ?? READER_LIMIT) }
      : { rows: listAuthority(s.db, optionalText(a, "activationId")) },
};

function artifactKind(value: unknown): ArtifactKind {
  const kind = text({ kind: value }, "kind");
  if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
    throw new ServiceCallError("bad_request", `argument "kind" must be one of ${ARTIFACT_KINDS.join(", ")}`);
  }
  return kind as ArtifactKind;
}

/**
 * The argument names each operation reads. A misspelt name would otherwise be
 * ignored and the operation would run with a default (an `issueRef` typo records
 * null), so an unknown name is refused instead.
 */
export const ARGS: Record<string, readonly string[]> = {
  "issue.resolveRef": ["ref"],
  "issue.resolveRefInProject": ["ref", "projectId"],
  "issue.get": ["issueId"],
  "issue.getRevision": ["issueId", "revision"],
  "issue.listEvents": ["issueId"],
  "issue.getReadiness": ["issueId"],
  "issue.unsatisfiedBlockers": ["issueId"],
  "issue.getActiveClaim": ["issueId"],
  "issue.getParent": ["issueId"],
  "issue.getResolvedContext": ["issueId"],
  "issue.resolveProject": ["gitRoot"],
  "issue.queryAllIssues": ["query"],
  "issue.create": ["input"],
  "issue.updateContract": ["issueId", "contract", "authoredBy", "opts"],
  "issue.setTitle": ["issueId", "title"],
  "issue.setPriority": ["issueId", "priority"],
  "issue.setScrutiny": ["issueId", "scrutiny", "authoredBy"],
  "issue.claimIssue": ["issueId", "holder", "activationId", "ttlMs"],
  "issue.claimReady": ["issueId", "holder", "attestation", "activationId"],
  "issue.renewClaim": ["issueId", "holder", "activationId", "ttlMs"],
  "issue.releaseClaim": ["issueId", "holder", "activationId"],
  "issue.latestAttestation": ["issueId"],
  "issue.appendEvent": ["issueId", "type", "payload", "at"],
  "gate.check": ["request"],
  "gate.dispatch": ["request"],
  "store.get": ["ref"],
  "store.addJournal": ["ref", "kind", "participantId", "activationId"],
  "journal.appendEntry": ["issueId", "input"],
  "journal.listEntries": ["issueId", "kind", "limit"],
  "journal.latest": ["issueId", "kind"],
  "journal.latestCheckpoint": ["issueId"],
  "journal.since": ["issueId", "cursor"],
  "journal.checkpoint": ["issueId", "input"],
  "journal.compactionCheckpoint": ["issueId", "input"],
  "journal.collectMechanical": ["issueId", "input"],
  "journal.renderCheckpoint": ["entry"],
  "journal.getEntry": ["entryId"],
  "journal.timeline": ["issueId", "kind", "limit"],
  "journal.enrichEntry": ["entryId", "semantic"],
  "provenance.dispatch": ["issueId", "input"],
  "provenance.allocateReceipt": ["bindingId"],
  "provenance.attachArtifact": ["receiptId", "kind", "value"],
  "provenance.bindCommit": ["receiptId", "sha"],
  "provenance.listReceipts": ["issueId"],
  "provenance.listBindings": ["issueId"],
  "provenance.trace": ["issueId"],
  "provenance.findByCommit": ["sha"],
  "provenance.sessionDetail": ["sessionId"],
  "provenance.activationDetail": ["activationId"],
  "resume.buildCapsule": ["issueId"],
  "resume.renderCapsule": ["capsule"],
  "authority.record": ["activationId", "specialist", "state", "issueRef", "lastActivityAt"],
  "authority.remove": ["activationId", "expectState"],
  "authority.list": ["activationId", "activeOnly", "limit"],
};

/** Refuse an argument name the operation does not read. */
export function assertKnownArgs(op: string, args: Record<string, unknown>): void {
  const allowed = ARGS[op];
  if (allowed === undefined) return;
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw new ServiceCallError("bad_request", `argument "${key}" is not part of ${op}`);
    }
  }
}

export const CAPABILITIES: string[] = Object.keys(OPERATIONS).sort();

// A store path or a raw SQLite sentence in an error message tells a remote caller
// where the file lives and which statement failed. Both are the server's business.
const STORE_PATH = /(?:\/[^\s'"]*state\.db|[A-Za-z]:\\[^\s'"]*state\.db)/g;
const SQLITE_CODE = /\bSQLITE_[A-Z_]+\b/g;
const SQL_STATEMENT = /^\s*(SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE|ALTER|DROP)\b/i;
const MAX_MESSAGE = 500;

function sanitize(message: string): string {
  const stripped = message
    .replace(STORE_PATH, "<store>")
    .replace(SQLITE_CODE, "storage error")
    .replace(/\s*\(code: \d+\)/g, "")
    .trim();
  const reduced = SQL_STATEMENT.test(stripped) ? "storage error" : stripped;
  return reduced.length > MAX_MESSAGE ? `${reduced.slice(0, MAX_MESSAGE - 3)}...` : reduced;
}

/** Map a thrown error onto a wire code, so a client can branch without parsing prose. */
export function classifyError(error: unknown): { code: ServiceErrorCode; message: string } {
  if (error instanceof ServiceCallError) return { code: error.code, message: sanitize(error.message) };
  const message = sanitize(error instanceof Error ? error.message : String(error));
  // Validation the service performs on a document it was handed is a bad request,
  // not a server fault: the caller can fix it and resend.
  if (/^invalid (mechanical|semantic|contract|checkpoint|attestation|claim|input)/i.test(message)) {
    return { code: "bad_request", message };
  }
  if (/^unknown (journal )?kind\b/i.test(message)) {
    return { code: "bad_request", message };
  }
  if (/^(not found|no such|unknown\b.*\b(issue|entry|ref|project|receipt|binding|artifact|commit)\b)/i.test(message)) {
    return { code: "not_found", message };
  }
  if (/cannot be claimed|not claimable|not dispatchable|not ready|is not open|already (finalized|claimed)/i.test(message)) {
    return { code: "conflict", message };
  }
  if (/no active claim|holds no claim|claim is held/i.test(message)) {
    return { code: "conflict", message };
  }
  if (/unresolvable|not resolvable|cannot resolve|unknown (ref|project|issue ref)/i.test(message)) {
    return { code: "not_found", message };
  }
  if (/^(claim|revision|contract hash|conflict|already|activation|holder)/i.test(message)) {
    return { code: "conflict", message };
  }
  if (/is not supported|cannot (speak|read) the (service )?protocol/i.test(message)) {
    return { code: "unsupported", message };
  }
  return { code: "internal", message };
}
