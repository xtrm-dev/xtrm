// WorkItemStore seam (Phase 9, bead xtrm-7wc.10; PRD §35). Backend-neutral
// work service: skills, hooks, and runtimes program to this interface while
// Phase 11 migrates each surface from Beads to Substrate. SubstrateIssueStore
// is canonical; BeadsWorkItemStore is temporary read-only compatibility over
// the passive Beads JSONL export — never a second write authority (§42: no
// permanent dual-write).
//
// Method surface (D-35): get, search, ready, validate, resolveContext, claim,
// claimReady, renew, release, update, addEdge, addJournal, checkpoint, close,
// changesSince. Only checkpoint is async (the secondary summarizer may be).

import type { ResolvedIssue } from "../domain/issue.ts";
import type { ResultPayload, SemanticCheckpoint } from "../domain/journal.ts";

export interface IssueView {
  issue: ResolvedIssue;
  contract: unknown;
  readinessState: string;
  dispatchable: boolean;
  reasons: string[];
}

export interface ClaimView {
  issueId: string;
  holder: string;
  claimId: number;
  expiresAt: number;
  generation: number;
}

export interface AttestationInput {
  outcome: "ready" | "reject";
  policy: string;
  attestedBy: string;
  evidenceRefs?: string[];
  blockingGaps?: string[];
}

export interface JournalEntryView {
  entryId: string;
  sequence: number;
  kind: string;
}

export interface ChangeBatch {
  issueId: string;
  afterEventId: number;
  events: Array<{ id: number; type: string; createdAt: number }>;
  nextCursor: number;
}

export interface CheckpointInput {
  sessionId?: string;
  participantId?: string;
  activationId?: string;
  headCommit?: string;
  changedFiles?: string[];
}

/**
 * Authority boundary for work-item backends: the typed seam every host (sb,
 * Pi, MCP) drives instead of touching a store directly. Durability belongs to
 * the backend implementation; this interface only admits operations with
 * explicit durability semantics. Side effects are backend mutations (claim,
 * release, update, note, checkpoint); reads never mutate. Revision-bearing
 * updates surface revisionCreated so callers know readiness went stale;
 * metadata writes do not. Implementations must attach stored actor/session
 * envelopes automatically and stay idempotent on retry; unknown refs and
 * cross-project writes fail closed.
 */
export interface WorkItemStore {
  readonly backend: "substrate" | "beads";
  get(ref: string): IssueView;
  search(project: string, query?: string, kind?: string): IssueView[];
  ready(project: string): IssueView[];
  validate(ref: string): IssueView;
  resolveContext(ref: string): { hash: string; entryCount: number };
  claim(ref: string, holder: string, opts?: { activationId?: string; ttlMs?: number }): ClaimView;
  claimReady(ref: string, holder: string, attestation: AttestationInput, opts?: { activationId?: string; ttlMs?: number }): { claim: ClaimView; attestedRevision: number };
  renew(ref: string, holder: string, opts?: { activationId?: string }): ClaimView;
  release(ref: string, holder: string, opts?: { activationId?: string }): boolean;
  update(ref: string, contract: unknown, opts?: { expectedRevision?: number; authoredBy?: string }): { view: IssueView; revisionCreated: boolean };
  addEdge(fromRef: string, toRef: string, kind: string): { edgeId: number | null; kind: string };
  addJournal(
    ref: string,
    kind: string,
    opts?: { sessionId?: string; participantId?: string; activationId?: string; semantic?: SemanticCheckpoint; result?: ResultPayload },
  ): JournalEntryView;
  checkpoint(ref: string, input?: CheckpointInput): Promise<JournalEntryView>;
  close(ref: string): IssueView;
  changesSince(ref: string, afterEventId: number): ChangeBatch;
}
