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
  activateAuthority,
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
type Handler = (services: Services, args: Args) => unknown;

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

function integer(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ServiceCallError("bad_request", `argument "${key}" must be an integer`);
  }
  return value;
}

function optionalInteger(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return integer(args, key);
}

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
  "issue.getRevision": (s, a) => s.issues.getRevision(text(a, "issueId"), integer(a, "revision")),
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
    s.issues.updateContract(text(a, "issueId"), record(a, "contract") as never, optionalRecord(a, "opts") as never),
  "issue.setTitle": (s, a) => s.issues.setTitle(text(a, "issueId"), text(a, "title")),
  "issue.setPriority": (s, a) => s.issues.setPriority(text(a, "issueId"), integer(a, "priority")),
  "issue.setScrutiny": (s, a) => s.issues.setScrutiny(text(a, "issueId"), text(a, "scrutiny"), optionalText(a, "authoredBy")),
  "issue.claimIssue": (s, a) =>
    s.issues.claimIssue(text(a, "issueId"), text(a, "holder"), {
      activationId: optionalText(a, "activationId"),
      ttlMs: optionalInteger(a, "ttlMs"),
    }),
  "issue.claimReady": (s, a) =>
    s.issues.claimReady(text(a, "issueId"), text(a, "holder"), record(a, "attestation") as never, {
      activationId: optionalText(a, "activationId"),
    }),
  "issue.renewClaim": (s, a) =>
    s.issues.renewClaim(text(a, "issueId"), text(a, "holder"), {
      activationId: optionalText(a, "activationId"),
      ttlMs: optionalInteger(a, "ttlMs"),
    }),
  "issue.releaseClaim": (s, a) =>
    s.issues.releaseClaim(text(a, "issueId"), text(a, "holder"), { activationId: optionalText(a, "activationId") }),

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
      limit: optionalInteger(a, "limit"),
    }),
  "journal.latest": (s, a) => s.journal.latest(text(a, "issueId"), { kind: optionalText(a, "kind") as never }),
  "journal.latestCheckpoint": (s, a) => s.journal.latestCheckpoint(text(a, "issueId")),
  "journal.since": (s, a) => s.journal.since(text(a, "issueId"), integer(a, "cursor")),
  "journal.checkpoint": (s, a) => s.journal.checkpoint(text(a, "issueId"), record(a, "input") as never),
  "journal.collectMechanical": (s, a) =>
    s.journal.collectMechanical(text(a, "issueId"), record(a, "input") as never),
  "journal.enrichEntry": (s, a) =>
    s.journal.enrichEntry(text(a, "entryId"), record(a, "semantic") as never),
  "journal.renderCheckpoint": (s, a) => s.journal.renderCheckpoint(record(a, "entry") as never),

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

  // ---- resume capsule (ResumeService), read-only ----
  "resume.capsule": (s, a) => s.resume.buildCapsule(text(a, "ref")),

  // ---- activation authority: structured rows, never SQL ----
  "authority.record": (s, a) => activateAuthority(s.db, a as unknown as AuthorityOperation),
  "authority.remove": (s, a) => removeAuthority(s.db, text(a, "activationId")),
  "authority.list": (s, a) => ({ rows: listAuthority(s.db, optionalText(a, "activationId")) }),
};

function artifactKind(value: unknown): ArtifactKind {
  const kind = text({ kind: value }, "kind");
  if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
    throw new ServiceCallError("bad_request", `argument "kind" must be one of ${ARTIFACT_KINDS.join(", ")}`);
  }
  return kind as ArtifactKind;
}

export const CAPABILITIES: string[] = Object.keys(OPERATIONS).sort();

/** Map a thrown error onto a wire code, so a client can branch without parsing prose. */
export function classifyError(error: unknown): { code: ServiceErrorCode; message: string } {
  if (error instanceof ServiceCallError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  if (/^(not found|unknown issue|no such)/i.test(message)) return { code: "not_found", message };
  if (/^(claim|revision|contract hash|conflict|already)/i.test(message)) return { code: "conflict", message };
  return { code: "internal", message };
}
