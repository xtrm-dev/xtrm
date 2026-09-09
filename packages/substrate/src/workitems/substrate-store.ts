// SubstrateIssueStore: the canonical WorkItemStore backend (PRD §35). Thin
// over IssueService / JournalService: no SQL, no business logic, no second
// readiness derivation. Actor strings (holder, attestedBy, authoredBy) pass
// through verbatim — trust class is preserved, never normalized (PRD §46).

import { IssueService } from "../service/issue-service.ts";
import { JournalService } from "../service/journal-service.ts";
import { isJournalKind } from "../domain/journal.ts";
import type {
  AttestationInput,
  ChangeBatch,
  CheckpointInput,
  ClaimView,
  IssueView,
  JournalEntryView,
  WorkItemStore,
} from "./store.ts";

function toClaim(c: { issueId: string; holder: string; id: number; expiresAt: number; generation: number }): ClaimView {
  return { issueId: c.issueId, holder: c.holder, claimId: c.id, expiresAt: c.expiresAt, generation: c.generation };
}

export class SubstrateIssueStore implements WorkItemStore {
  readonly backend = "substrate" as const;
  private readonly issues: IssueService;
  private readonly journal: JournalService;

  constructor(issues: IssueService, journal: JournalService) {
    this.issues = issues;
    this.journal = journal;
  }

  private view(id: string): IssueView {
    const issue = this.issues.getIssue(id);
    const readiness = this.issues.getReadiness(id);
    const revision = this.issues.getRevision(id, issue.currentRevision);
    return {
      issue,
      contract: revision.contract,
      readinessState: readiness.state,
      dispatchable: readiness.dispatchable,
      reasons: readiness.reasons,
    };
  }

  get(ref: string): IssueView {
    return this.view(this.issues.resolveRef(ref).id);
  }

  search(project: string, query?: string, kind?: string): IssueView[] {
    const q = (query ?? "").toLowerCase();
    return this.issues
      .listIssues(project)
      .filter((i) => (kind ? i.kind === kind : true))
      .filter((i) => (q ? `${i.title} ${i.humanRef} ${i.locator}`.toLowerCase().includes(q) : true))
      .map((i) => this.view(i.id));
  }

  ready(project: string): IssueView[] {
    return this.issues
      .listIssues(project)
      .map((i) => this.view(i.id))
      .filter((v) => v.dispatchable);
  }

  validate(ref: string): IssueView {
    return this.view(this.issues.resolveRef(ref).id);
  }

  resolveContext(ref: string): { hash: string; entryCount: number } {
    const resolved = this.issues.getResolvedContext(this.issues.resolveRef(ref).id);
    return { hash: resolved.hash, entryCount: resolved.entries.length };
  }

  claim(ref: string, holder: string, opts?: { activationId?: string; ttlMs?: number }): ClaimView {
    const id = this.issues.resolveRef(ref).id;
    return toClaim(this.issues.claimIssue(id, holder, { activationId: opts?.activationId, ttlMs: opts?.ttlMs }));
  }

  claimReady(
    ref: string,
    holder: string,
    attestation: AttestationInput,
    opts?: { activationId?: string; ttlMs?: number },
  ): { claim: ClaimView; attestedRevision: number } {
    const id = this.issues.resolveRef(ref).id;
    const { attestation: att, claim } = this.issues.claimReady(id, holder, attestation, {
      activationId: opts?.activationId,
      ttlMs: opts?.ttlMs,
    });
    return { claim: toClaim(claim), attestedRevision: att.issueRevision };
  }

  renew(ref: string, holder: string, opts?: { activationId?: string }): ClaimView {
    const id = this.issues.resolveRef(ref).id;
    return toClaim(this.issues.renewClaim(id, holder, { activationId: opts?.activationId }));
  }

  release(ref: string, holder: string, opts?: { activationId?: string }): boolean {
    const id = this.issues.resolveRef(ref).id;
    return this.issues.releaseClaim(id, holder, { activationId: opts?.activationId }) !== null;
  }

  update(
    ref: string,
    contract: unknown,
    opts?: { expectedRevision?: number; authoredBy?: string },
  ): { view: IssueView; revisionCreated: boolean } {
    const id = this.issues.resolveRef(ref).id;
    const { issue, created } = this.issues.updateContract(id, contract as never, opts?.authoredBy ?? "workitem-store", {
      expectedRevision: opts?.expectedRevision,
    });
    return { view: this.view(issue.id), revisionCreated: created };
  }

  addEdge(fromRef: string, toRef: string, kind: string): { edgeId: number | null; kind: string } {
    const from = this.issues.resolveRef(fromRef).id;
    const to = this.issues.resolveRef(toRef).id;
    if (kind === "parent_child") {
      this.issues.setParent(to, from);
      return { edgeId: null, kind };
    }
    const edge = this.issues.addEdge(from, to, kind as never);
    return { edgeId: edge.id, kind: edge.kind };
  }

  addJournal(
    ref: string,
    kind: string,
    opts?: { sessionId?: string; participantId?: string; activationId?: string },
  ): JournalEntryView {
    if (!isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
    const id = this.issues.resolveRef(ref).id;
    const entry = this.journal.appendEntry(id, {
      kind,
      sessionId: opts?.sessionId,
      participantId: opts?.participantId,
      activationId: opts?.activationId,
    });
    return { entryId: entry.id, sequence: entry.sequence, kind: entry.kind };
  }

  async checkpoint(ref: string, input?: CheckpointInput): Promise<JournalEntryView> {
    const id = this.issues.resolveRef(ref).id;
    const result = await this.journal.checkpoint(id, {
      sessionId: input?.sessionId,
      participantId: input?.participantId,
      activationId: input?.activationId,
      headCommit: input?.headCommit,
      changedFiles: input?.changedFiles,
    });
    return { entryId: result.entry.id, sequence: result.entry.sequence, kind: result.entry.kind };
  }

  close(ref: string): IssueView {
    const id = this.issues.resolveRef(ref).id;
    return this.view(this.issues.setLifecycleState(id, "done").id);
  }

  changesSince(ref: string, afterEventId: number): ChangeBatch {
    const id = this.issues.resolveRef(ref).id;
    const events = this.issues
      .listEvents(id)
      .filter((e) => e.id > afterEventId)
      .map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt }));
    return { issueId: id, afterEventId, events, nextCursor: events.length > 0 ? events[events.length - 1]!.id : afterEventId };
  }
}
