// Provenance service (PRD §§26-30): execution bindings, WorkReceipts,
// artifact bindings, traces, and repository bundles. Host authority only:
// every revision/hash pair is copied from live Substrate rows, never from
// caller input, so executor model output cannot forge receipt authority
// (§5, E37). Each public method owns its transaction; Tx-suffixed helpers
// assume the caller holds it (same non-nesting rule as claims/journal).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "../store/database.ts";
import { withTransaction } from "../store/transactions.ts";
import { normalizeWorkspace, sameHolder } from "../domain/claim.ts";
import {
  newExecutionBindingId,
  validateDispatchInput,
  type DispatchInput,
  type ExpectedClaimPin,
  type ExecutionBinding,
} from "../domain/execution-binding.ts";
import {
  canonicalizeWriteIdentity,
  executionContextFromLegacy,
  normalizeExecutionContext,
  projectFlatIdentity,
  validateExecutionContext,
  type ExecutionContext,
} from "../domain/execution-context.ts";
import {
  ARTIFACT_KINDS,
  attachTrailers,
  attachIssueTrailers,
  formatIssueTrailers,
  formatTrailers,
  isArtifactKind,
  isValidReceiptId,
  isValidSha,
  newBundleId,
  newWorkReceiptId,
  type ArtifactBinding,
  type ArtifactKind,
  type ArtifactRef,
  type CheckpointSummary,
  type ProvenanceBundle,
  type WorkReceipt,
} from "../domain/provenance.ts";
import type { IssueService } from "./issue-service.ts";
import type { JournalService } from "./journal-service.ts";
import type { JournalEntry } from "../domain/journal.ts";
import {
  isClosureOutcome,
  type Closure,
  type ClosureOutcome,
} from "../domain/closure.ts";

export const BUNDLE_DIR = ".xtrm/provenance/bundles";

interface Row {
  [key: string]: unknown;
}

function row<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function rows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function trunc(s: string, max = 500): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// A checkpoint link is optional continuity (XTRM-416). Absence is explicit:
// a missing, blank or whitespace-only option stores NULL, never an empty
// string that a reader would have to interpret.
function normalizeCheckpointId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export interface ProvenanceTrace {
  issueId: string;
  locator: string;
  humanRef: string;
  revision: number;
  contractHash: string;
  lifecycleState: string;
  attestation: unknown | null;
  claims: unknown[];
  bindings: ExecutionBinding[];
  // Each receipt carries the exact shared envelope inherited through its
  // execution binding (X1) — queried, never duplicated.
  receipts: Array<WorkReceipt & { artifacts: ArtifactBinding[]; executionContext: ExecutionContext | null }>;
  checkpoints: CheckpointSummary[];
  commits: string[];
  prs: Array<{ value: string; provider: string | null }>;
  externalBindings: Array<{ provider: string; scope: string; remoteId: string; remoteKey?: string | null; url?: string | null }>;
  // Every Closure row in outcome order, with its evidence refs (ADR §96). A
  // reopened and re-closed Issue carries one row per settlement.
  closures: Closure[];
  closureRevision: number | null;
}

/**
 * Authority for the lineage spine: execution bindings, work receipts with
 * artifacts, attestation currency, claims and the closure view, read from the
 * WAL store that stays the durable authority. Trace and reverse lookups are
 * read-only with no side effects; dispatch and receipt writes are
 * transactional rows that pin the Issue revision and contract hash, so a later
 * contract edit binds anew instead of silently re-authorizing. Reads never
 * move the revision and never stale readiness. Automatic metadata: bindings
 * and receipts stamp actor, session, execution envelope and timestamps at
 * write time. Reads are idempotent; dispatch against a stale revision,
 * unknown commits and missing receipts fail closed.
 */
export class ProvenanceService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;
  private readonly journal: JournalService | null;

  constructor(db: DatabaseSync, issues: IssueService, journal?: JournalService | null) {
    this.db = db;
    this.issues = issues;
    this.journal = journal ?? null;
  }

  // -- dispatch (E30) --------------------------------------------------------
  // The binding freezes the exact live revision/hash/context at dispatch.
  // Later contract edits never mutate it: a new dispatch binds the new
  // revision instead. Claim linkage is verified against the live claim row.

  /** Binds one execution to the live revision before work starts; later edits bind anew. */
  dispatch(issueId: string, input: DispatchInput, opts?: { now?: number; expectedClaim?: ExpectedClaimPin | null; expectedRevision?: number; expectedContractHash?: string }): ExecutionBinding {
    const problems = validateDispatchInput(input);
    if (problems.length > 0) throw new Error(`invalid dispatch input: ${problems[0]}`);
    const workspace = normalizeWorkspace(input.workspace);
    if (input.baseCommit !== undefined && input.baseCommit !== null && !isValidSha(input.baseCommit)) {
      throw new Error("baseCommit must be a 40-char hex SHA when present");
    }
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      // Dispatch gate mirrors assertDispatchable, except a live claim does
      // not block: the pipeline is claim -> binding (§52), so `claimed`
      // already passed every other gate (structure, attestation, blockers,
      // scrutiny) and only records who holds the work.
      const report = this.issues.getReadiness(issueId, { now });
      if (report.state !== "ready" && report.state !== "claimed") {
        throw new Error(`not dispatchable: ${issueId} is ${report.state}: ${report.reasons.join("; ")}`);
      }
      // Atomic revision pin: when the caller carries the revision/hash
      // observed at check time, the live values inside this same
      // transaction must still equal them. Mismatch fails closed before
      // INSERT so no row can bind a rotated contract and no event is
      // appended; scope validated at check then holds against the bound
      // revision by construction. Undefined means no pin (direct-service
      // callers that bypass the gate).
      if (opts?.expectedRevision !== undefined) {
        if (!Number.isInteger(opts.expectedRevision)) {
          throw new Error(`dispatch rejected: invalid expected revision pin on ${issueId}`);
        }
        if (report.revision !== opts.expectedRevision) {
          throw new Error(`dispatch rejected: revision changed since check on ${issueId} (expected rev ${opts.expectedRevision}, live rev ${report.revision}; repair and retry)`);
        }
      }
      if (opts?.expectedContractHash !== undefined) {
        if (typeof opts.expectedContractHash !== "string" || opts.expectedContractHash.trim() === "") {
          throw new Error(`dispatch rejected: invalid expected contract hash pin on ${issueId}`);
        }
        if (report.contractHash !== opts.expectedContractHash) {
          throw new Error(`dispatch rejected: contract changed since check on ${issueId} (repair and retry)`);
        }
      }
      const resolved = this.issues.getResolvedContext(issueId);
      const active = this.issues.getActiveClaim(issueId, { now });
      if (input.claimId !== undefined && input.claimId !== null) {
        if (!active || active.id !== input.claimId) throw new Error(`dispatch rejected: claim ${input.claimId} is not the live claim on ${issueId}`);
      }
      // Atomic gate pin: when the caller carries the claim observed at
      // check time, the live claim inside this same transaction must still
      // equal it (id + generation, including expected-null meaning still
      // no live claim). Mismatch fails closed before INSERT so no row can
      // bind a rotated or newly-appeared claim. Undefined means no pin was
      // supplied (direct-service callers that bypass the gate).
      if (opts?.expectedClaim !== undefined) {
        const expected = opts.expectedClaim;
        if (expected !== null) {
          if (typeof expected !== "object" || !Number.isInteger(expected.id) || !Number.isInteger(expected.generation)) {
            throw new Error(`dispatch rejected: invalid expected claim pin on ${issueId}`);
          }
          if (!active || active.id !== expected.id || active.generation !== expected.generation) {
            throw new Error(`dispatch rejected: live claim changed since check on ${issueId} (expected claim ${expected.id} gen ${expected.generation}; repair and retry)`);
          }
        } else {
          if (active) {
            throw new Error(`dispatch rejected: claim ${active.id} appeared after check on ${issueId} (expected no live claim; repair and retry)`);
          }
        }
      }
      // Claimed dispatch is fenced by the live claim: participant +
      // activation must be the live holder (sameHolder). ClaimId omission
      // does not bypass authority; omitted/mismatched identity fails
      // closed. Ready/unclaimed stays open for the claim-first flow.
      // Identity is read through the central projection: the envelope and
      // the legacy flat fields must agree exactly where both represent a
      // value (conflicts throw fail-closed); the provider-unknown legacy
      // session stays flat-only per §98. Identity values are canonicalised
      // and validated at this write seam (XTRM-412) before any row is
      // written; a rejection throws and stores no binding.
      const dispatchContext = normalizeExecutionContext(input.executionContext ?? null);
      const identity = canonicalizeWriteIdentity({
        executionContext: dispatchContext,
        participantId: input.participantId ?? null,
        activationId: input.activationId ?? null,
        attemptId: input.attemptId ?? null,
        sessionId: input.sessionId ?? null,
        runId: null,
      });
      const dispatchFlat = projectFlatIdentity(identity.executionContext, {
        participantId: identity.participantId,
        activationId: identity.activationId,
        attemptId: identity.attemptId,
        sessionId: identity.sessionId,
        workspace,
        baseCommit: input.baseCommit ?? null,
      });
      if (active) {
        const participant = dispatchFlat.participantId;
        if (typeof participant !== "string" || participant.trim() === "") {
          throw new Error(`dispatch rejected: ${issueId} is live-held by ${active.holder}; participant is required (anti-steal)`);
        }
        if (!sameHolder(active, participant, dispatchFlat.activationId)) {
          throw new Error(`dispatch rejected: ${issueId} is live-held by ${active.holder}; holder/activation mismatch (anti-steal)`);
        }
      }
      const id = newExecutionBindingId();
      this.db
        .prepare(
          `INSERT INTO execution_bindings
             (id, issue_id, issue_revision, contract_hash, resolved_context_hash,
              claim_id, participant_id, activation_id, attempt_id, session_id,
              workspace, base_commit, execution_context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, issueId, report.revision, report.contractHash, resolved.hash,
          active?.id ?? null, dispatchFlat.participantId, dispatchFlat.activationId,
          dispatchFlat.attemptId, dispatchFlat.sessionId, dispatchFlat.workspace, dispatchFlat.baseCommit,
          identity.executionContext ? JSON.stringify(identity.executionContext) : null, now,
        );
      this.issues.appendEvent(issueId, "provenance.dispatched", {
        binding: id, revision: report.revision, contractHash: report.contractHash, claim: active?.id ?? null,
      });
      return this.requireBinding(id);
    });
  }

  getBinding(id: string): ExecutionBinding {
    return this.requireBinding(id);
  }

  listBindings(issueId: string): ExecutionBinding[] {
    this.issues.getIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM execution_bindings WHERE issue_id = ? ORDER BY created_at, id", issueId).map((r) =>
      this.toBinding(r),
    );
  }

  // -- receipts (E32, E37) ----------------------------------------------------
  // Host-allocated before the commit (self-reference §28.3): issue,
  // revision, and hash are copied from the binding row. There is no
  // parameter for them, so model output has nothing to fill with lies.

  allocateReceipt(
    bindingId: string,
    opts?: { journalCheckpointId?: string; validationRefs?: ArtifactRef[]; now?: number },
  ): WorkReceipt {
    if (opts?.validationRefs !== undefined) {
      for (const ref of opts.validationRefs) {
        if (!isArtifactKind(ref?.kind)) throw new Error(`invalid validation ref kind: ${String(ref?.kind)}`);
        if (typeof ref?.value !== "string" || ref.value.trim() === "") throw new Error("validation ref value must be non-empty");
      }
    }
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      const binding = this.requireBinding(bindingId);
      const id = newWorkReceiptId();
      this.db
        .prepare(
          `INSERT INTO work_receipts
             (id, execution_binding_id, issue_id, issue_revision, contract_hash,
              journal_checkpoint_id, validation_refs_json, commit_sha, created_at, finalized_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
        )
        .run(
          id, bindingId, binding.issueId, binding.issueRevision, binding.contractHash,
          normalizeCheckpointId(opts?.journalCheckpointId), JSON.stringify(opts?.validationRefs ?? []), now,
        );
      this.issues.appendEvent(binding.issueId, "provenance.receipt_allocated", {
        receipt: id, binding: bindingId, revision: binding.issueRevision,
      });
      return this.requireReceipt(id);
    });
  }

  getReceipt(id: string): WorkReceipt {
    if (!isValidReceiptId(id)) throw new Error(`unknown receipt: ${id}`);
    return this.requireReceipt(id);
  }

  // WorkReceipts inherit the exact shared envelope through their execution
  // binding (X1): no duplicated JSON on work_receipts. This is the explicit
  // consumption point used by typed/provenance output (see trace()).
  receiptExecutionContext(receiptId: string): ExecutionContext | null {
    const receipt = this.requireReceipt(receiptId);
    return this.requireBinding(receipt.executionBindingId).executionContext;
  }

  listReceipts(issueId: string): WorkReceipt[] {
    this.issues.getIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM work_receipts WHERE issue_id = ? ORDER BY created_at, id", issueId).map((r) =>
      this.toReceipt(r),
    );
  }

  // post-commit finalization: binds the open receipt to the exact SHA git
  // just created. Idempotent on (receipt, sha): a retry for the SHA the
  // receipt already carries is a true no-op — no second artifact row, no
  // second event, no finalized_at churn — so hook retries are safe.
  // Re-pointing is NOT a side effect of this call: a receipt already carrying
  // a different SHA fails closed and must move through reconcileRewrite.
  bindCommit(receiptId: string, sha: string, opts?: { now?: number }): WorkReceipt {
    if (!isValidSha(sha)) throw new Error(`invalid commit SHA: ${String(sha)}`);
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      const receipt = this.requireReceipt(receiptId);
      if (receipt.commitSha === sha) return receipt;
      if (receipt.commitSha !== null) {
        throw new Error(
          `receipt ${receipt.id} is already bound to ${receipt.commitSha}; re-pointing to ${sha} is deliberate ` +
            "— use reconcileRewrite(oldSha, newSha)",
        );
      }
      this.db
        .prepare(
          "INSERT OR IGNORE INTO artifact_bindings (receipt_id, kind, value, provider, created_at, superseded_at) VALUES (?, 'commit', ?, NULL, ?, NULL)",
        )
        .run(receiptId, sha, now);
      this.db.prepare("UPDATE work_receipts SET commit_sha = ?, finalized_at = ? WHERE id = ?").run(sha, now, receiptId);
      this.issues.appendEvent(receipt.issueId, "provenance.receipt_bound", { receipt: receiptId, sha });
      return this.requireReceipt(receiptId);
    });
  }

  // post-rewrite reconciliation (E33): amend/rebase supersedes the old SHA
  // row and inserts the new one. Returns the number of receipts reconciled.
  reconcileRewrite(oldSha: string, newSha: string, opts?: { now?: number }): { reconciled: number } {
    if (!isValidSha(oldSha)) throw new Error(`invalid old SHA: ${String(oldSha)}`);
    if (!isValidSha(newSha)) throw new Error(`invalid new SHA: ${String(newSha)}`);
    if (oldSha === newSha) return { reconciled: 0 };
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      const stale = rows<Row>(
        this.db,
        "SELECT * FROM artifact_bindings WHERE kind = 'commit' AND value = ? AND superseded_at IS NULL ORDER BY id",
        oldSha,
      );
      for (const s of stale) {
        this.db.prepare("UPDATE artifact_bindings SET superseded_at = ? WHERE id = ?").run(now, s["id"] as number);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO artifact_bindings (receipt_id, kind, value, provider, created_at, superseded_at) VALUES (?, 'commit', ?, NULL, ?, NULL)",
          )
          .run(s["receipt_id"] as string, newSha, now);
        const receipt = this.requireReceipt(s["receipt_id"] as string);
        if (receipt.commitSha === oldSha) {
          this.db.prepare("UPDATE work_receipts SET commit_sha = ?, finalized_at = ? WHERE id = ?").run(newSha, now, receipt.id);
        }
        this.issues.appendEvent(receipt.issueId, "provenance.receipt_rewritten", {
          receipt: receipt.id, from: oldSha, to: newSha,
        });
      }
      return { reconciled: stale.length };
    });
  }

  // Non-commit artifacts (pr, validation, review, artifact, bundle). Commits
  // are rejected here on purpose: they must pass SHA-validated bindCommit
  // so finalized_at and the single-head invariant stay consistent.
  attachArtifact(
    receiptId: string,
    kind: ArtifactKind,
    value: string,
    opts?: { provider?: string; now?: number },
  ): ArtifactBinding {
    if (!isArtifactKind(kind)) throw new Error(`unknown artifact kind: ${String(kind)}`);
    if (kind === "commit") throw new Error("use bindCommit for commit SHAs (SHA-validated finalization)");
    if (typeof value !== "string" || value.trim() === "") throw new Error("artifact value must be non-empty");
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      const receipt = this.requireReceipt(receiptId);
      const inserted = this.db
        .prepare(
          "INSERT OR IGNORE INTO artifact_bindings (receipt_id, kind, value, provider, created_at, superseded_at) VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .run(receiptId, kind, value, opts?.provider ?? null, now);
      // A retry is a true no-op: no second event for the artifact that existed.
      if (Number(inserted.changes ?? 0) > 0) {
        this.issues.appendEvent(receipt.issueId, "provenance.artifact_attached", { receipt: receiptId, kind, value });
      }
      return this.toArtifact(
        row<Row>(this.db, "SELECT * FROM artifact_bindings WHERE receipt_id = ? AND kind = ? AND value = ?", receiptId, kind, value) as Row,
      );
    });
  }

  listArtifacts(receiptId: string, opts?: { liveOnly?: boolean }): ArtifactBinding[] {
    this.requireReceipt(receiptId);
    const liveOnly = opts?.liveOnly ?? true;
    return rows<Row>(
      this.db,
      liveOnly
        ? "SELECT * FROM artifact_bindings WHERE receipt_id = ? AND superseded_at IS NULL ORDER BY id"
        : "SELECT * FROM artifact_bindings WHERE receipt_id = ? ORDER BY id",
      receiptId,
    ).map((r) => this.toArtifact(r));
  }

  // -- P1 reference queries (ADR §§80-81) -------------------------------------
  // Every answer below is built from host-owned rows (bindings, journal
  // entries, receipts, artifacts, closures) joined by id — never from
  // strings embedded in prose (ADR §58). A commit message is not a Journal
  // entry, Closure or result (ADR §59): only rows resolve here.

  private requireJournal(): JournalService {
    if (!this.journal) throw new Error("provenance queries require a JournalService");
    return this.journal;
  }

  /** All bounded result payloads recorded for an Issue (ADR §80). */
  resultsForIssue(issueId: string): JournalEntry[] {
    this.issues.getIssue(issueId);
    return this.requireJournal().listEntries(issueId, { kind: "result" });
  }

  /** Newest bounded result for an Issue, or null (ADR §80 `latest result`). */
  latestResult(issueId: string): JournalEntry | null {
    this.issues.getIssue(issueId);
    return this.requireJournal().latest(issueId, { kind: "result" });
  }

  /** Decisions recorded for an Issue (ADR §80). */
  decisionsForIssue(issueId: string): JournalEntry[] {
    this.issues.getIssue(issueId);
    return this.requireJournal().listEntries(issueId, { kind: "decision" });
  }

  /**
   * Current blockers for an Issue (ADR §80): unsatisfied `blocks` edges
   * (durable truth) plus recorded journal blocker entries (coordination).
   */
  currentBlockers(issueId: string): { blockers: string[]; entries: JournalEntry[] } {
    this.issues.getIssue(issueId);
    return {
      blockers: this.issues.unsatisfiedBlockers(issueId),
      entries: this.requireJournal().listEntries(issueId, { kind: "blocker" }),
    };
  }

  /** Distinct session ids that touched an Issue via bindings or journal (ADR §80). */
  sessionsForIssue(issueId: string): string[] {
    this.issues.getIssue(issueId);
    const fromBindings = rows<{ session_id: string | null }>(
      this.db,
      "SELECT DISTINCT session_id FROM execution_bindings WHERE issue_id = ? AND session_id IS NOT NULL",
      issueId,
    ).map((r) => r.session_id as string);
    const fromJournal = rows<{ session_id: string | null }>(
      this.db,
      "SELECT DISTINCT session_id FROM issue_journal WHERE issue_id = ? AND session_id IS NOT NULL",
      issueId,
    ).map((r) => r.session_id as string);
    return [...new Set([...fromBindings, ...fromJournal])].sort();
  }

  /** Distinct activation ids bound to an Issue via bindings or journal (ADR §80). */
  activationsForIssue(issueId: string): string[] {
    this.issues.getIssue(issueId);
    const fromBindings = rows<{ activation_id: string | null }>(
      this.db,
      "SELECT DISTINCT activation_id FROM execution_bindings WHERE issue_id = ? AND activation_id IS NOT NULL",
      issueId,
    ).map((r) => r.activation_id as string);
    const fromJournal = rows<{ activation_id: string | null }>(
      this.db,
      "SELECT DISTINCT activation_id FROM issue_journal WHERE issue_id = ? AND activation_id IS NOT NULL",
      issueId,
    ).map((r) => r.activation_id as string);
    return [...new Set([...fromBindings, ...fromJournal])].sort();
  }

  /** Distinct Issue ids a session touched via bindings or journal (ADR §§80-81). */
  issuesForSession(sessionId: string): string[] {
    if (typeof sessionId !== "string" || sessionId.trim() === "") return [];
    const fromBindings = rows<{ issue_id: string }>(
      this.db,
      "SELECT DISTINCT issue_id FROM execution_bindings WHERE session_id = ?",
      sessionId,
    ).map((r) => r.issue_id);
    const fromJournal = rows<{ issue_id: string }>(
      this.db,
      "SELECT DISTINCT issue_id FROM issue_journal WHERE session_id = ?",
      sessionId,
    ).map((r) => r.issue_id);
    return [...new Set([...fromBindings, ...fromJournal])].sort();
  }

  /**
   * Session-centric provenance (ADR §81): what did this session touch —
   * Issues, bindings, receipts, artifacts and result count.
   */
  sessionDetail(sessionId: string): {
    sessionId: string;
    issueIds: string[];
    bindingIds: string[];
    receiptIds: string[];
    artifacts: Array<{ receiptId: string; kind: string; value: string; provider: string | null }>;
    resultCount: number;
  } {
    const issueIds = this.issuesForSession(sessionId);
    const bindings = rows<Row>(this.db, "SELECT * FROM execution_bindings WHERE session_id = ? ORDER BY created_at, id", sessionId)
      .map((r) => this.toBinding(r));
    const receiptIds: string[] = [];
    const artifacts: Array<{ receiptId: string; kind: string; value: string; provider: string | null }> = [];
    for (const b of bindings) {
      const receipts = rows<Row>(this.db, "SELECT * FROM work_receipts WHERE execution_binding_id = ? ORDER BY created_at, id", b.id);
      for (const rr of receipts) {
        const receiptId = rr["id"] as string;
        receiptIds.push(receiptId);
        for (const a of this.listArtifacts(receiptId)) {
          artifacts.push({ receiptId, kind: a.kind, value: a.value, provider: a.provider });
        }
      }
    }
    let resultCount = 0;
    for (const issueId of issueIds) {
      resultCount += rows<Row>(
        this.db,
        "SELECT id FROM issue_journal WHERE issue_id = ? AND session_id = ? AND kind = 'result'",
        issueId,
        sessionId,
      ).length;
    }
    return {
      sessionId,
      issueIds,
      bindingIds: bindings.map((b) => b.id),
      receiptIds,
      artifacts,
      resultCount,
    };
  }

  /**
   * Activation-centric provenance (ADR §81): what did this activation
   * produce — Issues, bindings, receipts and artifacts.
   */
  activationDetail(activationId: string): {
    activationId: string;
    issueIds: string[];
    bindingIds: string[];
    receiptIds: string[];
    artifacts: Array<{ receiptId: string; kind: string; value: string; provider: string | null }>;
  } {
    if (typeof activationId !== "string" || activationId.trim() === "") {
      return { activationId, issueIds: [], bindingIds: [], receiptIds: [], artifacts: [] };
    }
    const boundIssues = rows<{ issue_id: string }>(
      this.db,
      "SELECT DISTINCT issue_id FROM execution_bindings WHERE activation_id = ?",
      activationId,
    ).map((r) => r.issue_id);
    const journalIssues = rows<{ issue_id: string }>(
      this.db,
      "SELECT DISTINCT issue_id FROM issue_journal WHERE activation_id = ?",
      activationId,
    ).map((r) => r.issue_id);
    const issueIds = [...new Set([...boundIssues, ...journalIssues])].sort();
    const bindings = rows<Row>(this.db, "SELECT * FROM execution_bindings WHERE activation_id = ? ORDER BY created_at, id", activationId)
      .map((r) => this.toBinding(r));
    const receiptIds: string[] = [];
    const artifacts: Array<{ receiptId: string; kind: string; value: string; provider: string | null }> = [];
    for (const b of bindings) {
      const receipts = rows<Row>(this.db, "SELECT * FROM work_receipts WHERE execution_binding_id = ? ORDER BY created_at, id", b.id);
      for (const rr of receipts) {
        const receiptId = rr["id"] as string;
        receiptIds.push(receiptId);
        for (const a of this.listArtifacts(receiptId)) {
          artifacts.push({ receiptId, kind: a.kind, value: a.value, provider: a.provider });
        }
      }
    }
    return { activationId, issueIds, bindingIds: bindings.map((b) => b.id), receiptIds, artifacts };
  }

  /** Closure rows for an Issue in outcome order (ADR §80 `closure outcomes`). */
  closureOutcomes(issueId: string): Closure[] {
    this.issues.getIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM issue_closures WHERE issue_id = ? ORDER BY closed_at, closure_id", issueId).map((r) =>
      this.toClosure(r),
    );
  }

  /**
   * Closures lacking provenance (ADR §80): terminal Issues with no Closure
   * row, plus Closure rows whose result/receipt/validation/artifact ref
   * lists are all empty (a bare reason with no evidence links).
   */
  closuresLackingProvenance(opts?: { limit?: number }): Array<{ issueId: string; reason: string }> {
    const out: Array<{ issueId: string; reason: string }> = [];
    const limit = opts?.limit ?? 200;
    for (const r of rows<{ id: string }>(
      this.db,
      "SELECT id FROM issues WHERE lifecycle_state IN ('done', 'cancelled') ORDER BY id LIMIT ?",
      limit,
    )) {
      const closures = rows<Row>(this.db, "SELECT * FROM issue_closures WHERE issue_id = ?", r.id).map((c) => this.toClosure(c));
      if (closures.length === 0) {
        out.push({ issueId: r.id, reason: "terminal-without-closure" });
        continue;
      }
      for (const c of closures) {
        if (
          c.journalResultRefs.length === 0 && c.receiptRefs.length === 0 &&
          c.validationRefs.length === 0 && c.artifactRefs.length === 0
        ) {
          out.push({ issueId: r.id, reason: `closure-without-refs:${c.closureId}` });
        }
      }
    }
    return out;
  }

  /**
   * Results lacking receipts (ADR §80): bounded result entries with no
   * receipt covering their revision and no Closure citing them. Scoped to
   * one Issue, or across all Issues when omitted.
   */
  resultsLackingReceipts(issueId?: string): JournalEntry[] {
    const scope = issueId !== undefined ? [issueId] : rows<{ id: string }>(this.db, "SELECT id FROM issues ORDER BY id").map((r) => r.id);
    const out: JournalEntry[] = [];
    for (const id of scope) {
      let results: JournalEntry[];
      try {
        results = this.requireJournal().listEntries(id, { kind: "result" });
      } catch {
        continue;
      }
      if (results.length === 0) continue;
      const receipts = this.listReceipts(id);
      const cited = new Set<string>();
      for (const c of this.closureOutcomes(id)) {
        for (const ref of c.journalResultRefs) cited.add(ref);
      }
      for (const e of results) {
        if (cited.has(e.id)) continue;
        const covered = receipts.some((r) => r.issueRevision >= e.issueRevision);
        if (!covered) out.push(e);
      }
    }
    return out;
  }

  // -- inverse lookups (E34) ---------------------------------------------------
  // Trailer text alone never appears here: only host-bound rows resolve.

  findByCommit(sha: string): Array<{ receipt: WorkReceipt; binding: ExecutionBinding }> {
    if (!isValidSha(sha)) return [];
    const hits = rows<Row>(
      this.db,
      "SELECT receipt_id FROM artifact_bindings WHERE kind = 'commit' AND value = ? AND superseded_at IS NULL ORDER BY id",
      sha,
    );
    return hits.map((h) => {
      const receipt = this.requireReceipt(h["receipt_id"] as string);
      return { receipt, binding: this.requireBinding(receipt.executionBindingId) };
    });
  }

  findByPr(ref: string): Array<{ receipt: WorkReceipt; binding: ExecutionBinding }> {
    if (typeof ref !== "string" || ref.trim() === "") return [];
    const hits = rows<Row>(
      this.db,
      "SELECT receipt_id FROM artifact_bindings WHERE kind = 'pr' AND value = ? AND superseded_at IS NULL ORDER BY id",
      ref,
    );
    return hits.map((h) => {
      const receipt = this.requireReceipt(h["receipt_id"] as string);
      return { receipt, binding: this.requireBinding(receipt.executionBindingId) };
    });
  }

  // -- trace (E35, PRD §30) ----------------------------------------------------
  // Reconstructs revision -> attestation -> claim -> participant/attempt ->
  // checkpoint -> commits -> validation -> PR -> closure from Substrate
  // rows. Missing legs are null/empty, never invented.

  /** Reads the whole evidence spine in one derived view; pure read, safe to call before dispatch and after close. */
  trace(issueId: string): ProvenanceTrace {
    const issue = this.issues.getIssue(issueId);
    const bindings = this.listBindings(issueId);
    const bindingById = new Map(bindings.map((b) => [b.id, b]));
    const receipts = this.listReceipts(issueId).map((r) => ({
      ...r,
      artifacts: this.listArtifacts(r.id),
      executionContext: bindingById.get(r.executionBindingId)?.executionContext ?? null,
    }));
    const checkpoints = this.checkpointSummaries(issueId);
    const commits = [...new Set(receipts.flatMap((r) => r.artifacts).filter((a) => a.kind === "commit").map((a) => a.value))];
    const prs = receipts
      .flatMap((r) => r.artifacts)
      .filter((a) => a.kind === "pr")
      .map((a) => ({ value: a.value, provider: a.provider }));
    const closed = issue.lifecycleState === "done" || issue.lifecycleState === "cancelled" || issue.lifecycleState === "archived";
    return {
      issueId,
      locator: issue.locator,
      humanRef: issue.humanRef,
      revision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      lifecycleState: issue.lifecycleState,
      attestation: this.issues.latestAttestation(issueId),
      claims: this.issues.listClaims(issueId),
      bindings,
      receipts,
      checkpoints,
      commits,
      prs,
      externalBindings: this.listExternal(issueId),
      closures: this.closureOutcomes(issueId),
      closureRevision: closed ? issue.currentRevision : null,
    };
  }

  // -- bundles (E36, PRD §29) ---------------------------------------------------
  // Read-only over SQLite, then one file write. The bundle embeds the exact
  // dispatched contract plus checkpoint summaries only — never full
  // journal/transcript — so it survives SQLite loss on its own.

  generateBundle(issueId: string, opts?: { repoRoot?: string; now?: number }): { bundle: ProvenanceBundle; path: string } {
    const now = opts?.now ?? Date.now();
    const repoRoot = opts?.repoRoot ?? process.cwd();
    const bundle = withTransaction(this.db, () => this.buildBundle(issueId, now));
    const path = join(repoRoot, BUNDLE_DIR, `${bundle.bundleId}.json`);
    mkdirSync(join(repoRoot, BUNDLE_DIR), { recursive: true });
    writeFileSync(path, JSON.stringify(bundle, null, 2) + "\n");
    return { bundle, path };
  }

  // prepare-commit-msg helper (E31): trailers derived from live rows, keyed
  // by the receipt the host allocated for this execution.
  trailersForCommit(receiptId: string, message: string): string {
    const receipt = this.requireReceipt(receiptId);
    return attachTrailers(message, formatTrailers({
      issueId: receipt.issueId,
      issueRevision: receipt.issueRevision,
      receiptId: receipt.id,
    }));
  }

  // XTRM-684: trailers derived from an Issue without a receipt. Resolves the
  // Issue, reads its current revision and any Jira binding, and formats the
  // host-owned trailer block. Throws when the ref cannot be resolved; the hook
  // turns that into a stderr note and leaves the message untouched.
  trailersForIssue(issueRef: string, message: string, agent?: string | null): string {
    const issue = this.issues.resolveRef(issueRef);
    const jiraKey = this.jiraKeyForIssue(issue.id);
    return attachIssueTrailers(message, formatIssueTrailers({
      issueId: issue.id,
      issueRevision: issue.currentRevision,
      jiraKey,
      agent: agent ?? null,
    }));
  }

  private jiraKeyForIssue(issueId: string): string | null {
    const rows = this.db.prepare(
      "SELECT remote_key, remote_id FROM external_bindings WHERE issue_id = ? AND provider = 'jira' ORDER BY created_at LIMIT 1",
    ).all(issueId) as Array<{ remote_key: string | null; remote_id: string | null }>;
    const row = rows[0];
    if (!row) return null;
    return row.remote_key ?? row.remote_id ?? null;
  }

  private buildBundle(issueId: string, now: number): ProvenanceBundle {
    const issue = this.issues.getIssue(issueId);
    const bindings = this.listBindings(issueId);
    if (bindings.length === 0) throw new Error(`no execution binding for ${issueId}: nothing to bundle`);
    const anchor = bindings[bindings.length - 1]!;
    const revision = this.issues.getRevision(issueId, anchor.issueRevision);
    const receipts = this.listReceipts(issueId).map((r) => ({ ...r, artifacts: this.listArtifacts(r.id) }));
    const commits = [...new Set(receipts.flatMap((r) => r.artifacts).filter((a) => a.kind === "commit").map((a) => a.value))];
    const validationRefs: ArtifactRef[] = receipts.flatMap((r) => r.validationRefs);
    for (const r of receipts) {
      for (const a of r.artifacts) {
        if (a.kind === "validation") validationRefs.push({ kind: a.kind, value: a.value, provider: a.provider });
      }
    }
    const reviewRefs: ArtifactRef[] = receipts
      .flatMap((r) => r.artifacts)
      .filter((a) => a.kind === "review")
      .map((a) => ({ kind: a.kind, value: a.value, provider: a.provider }));
    return {
      bundleId: newBundleId(),
      issueId,
      issueRevision: anchor.issueRevision,
      contractHash: anchor.contractHash,
      contract: revision.contract,
      executionBindingIds: bindings.map((b) => b.id),
      checkpointSummaries: this.checkpointSummaries(issueId),
      commitShas: commits,
      validationRefs,
      reviewRefs,
      externalBindings: this.listExternal(issueId),
      createdAt: now,
    };
  }

  private checkpointSummaries(issueId: string): CheckpointSummary[] {
    if (!this.journal) return [];
    return this.journal
      .listEntries(issueId)
      .filter((e) => e.kind === "checkpoint" || e.kind === "compaction")
      .map((e) => ({
        entryId: e.id,
        sequence: e.sequence,
        kind: e.kind,
        issueRevision: e.issueRevision,
        summary: e.semantic ? trunc(e.semantic.summary) : null,
      }));
  }

  private listExternal(issueId: string): Array<{ provider: string; scope: string; remoteId: string; remoteKey?: string | null; url?: string | null }> {
    try {
      return rows<Row>(this.db, "SELECT provider, remote_scope, remote_id, remote_key, url FROM external_bindings WHERE issue_id = ? ORDER BY provider, remote_scope, remote_id", issueId)
        .map((r) => ({
          provider: r["provider"] as string,
          scope: r["remote_scope"] as string,
          remoteId: r["remote_id"] as string,
          remoteKey: (r["remote_key"] as string | null) ?? null,
          url: (r["url"] as string | null) ?? null,
        }));
    } catch {
      return [];
    }
  }

  private requireBinding(id: string): ExecutionBinding {
    const r = row<Row>(this.db, "SELECT * FROM execution_bindings WHERE id = ?", id);
    if (!r) throw new Error(`unknown execution binding: ${id}`);
    return this.toBinding(r);
  }

  private requireReceipt(id: string): WorkReceipt {
    if (!isValidReceiptId(id)) throw new Error(`unknown receipt: ${id}`);
    const r = row<Row>(this.db, "SELECT * FROM work_receipts WHERE id = ?", id);
    if (!r) throw new Error(`unknown receipt: ${id}`);
    return this.toReceipt(r);
  }

  private toBinding(r: Row): ExecutionBinding {
    const flat = {
      participantId: (r["participant_id"] as string | null) ?? null,
      activationId: (r["activation_id"] as string | null) ?? null,
      attemptId: (r["attempt_id"] as string | null) ?? null,
      sessionId: (r["session_id"] as string | null) ?? null,
      runId: null,
      workspace: r["workspace"] as string,
      baseCommit: (r["base_commit"] as string | null) ?? null,
    };
    // Stored envelope wins; legacy rows (execution_context_json NULL)
    // project their flat columns to a v1 envelope, or absent when nothing
    // is known (§98). Corrupt JSON fails closed.
    let executionContext: ExecutionContext | null = null;
    const raw = r["execution_context_json"] as string | null | undefined;
    if (raw !== null && raw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`fail-closed: corrupt execution context on ${r["id"]}`);
      }
      const problems = validateExecutionContext(parsed);
      if (problems.length > 0) throw new Error(`fail-closed: invalid execution context on ${r["id"]}: ${problems[0]}`);
      executionContext = normalizeExecutionContext(parsed);
    } else {
      executionContext = executionContextFromLegacy(flat, { timestamp: r["created_at"] as number });
    }
    return {
      id: r["id"] as string,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      resolvedContextHash: r["resolved_context_hash"] as string,
      claimId: (r["claim_id"] as number | null) ?? null,
      participantId: flat.participantId,
      activationId: flat.activationId,
      attemptId: flat.attemptId,
      sessionId: flat.sessionId,
      workspace: r["workspace"] as string,
      baseCommit: flat.baseCommit,
      createdAt: r["created_at"] as number,
      executionContext,
    };
  }

  private toReceipt(r: Row): WorkReceipt {
    let validationRefs: ArtifactRef[] = [];
    try {
      validationRefs = JSON.parse((r["validation_refs_json"] as string) ?? "[]") as ArtifactRef[];
    } catch {
      throw new Error(`fail-closed: corrupt validation refs on ${r["id"]}`);
    }
    return {
      id: r["id"] as string,
      executionBindingId: r["execution_binding_id"] as string,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      journalCheckpointId: (r["journal_checkpoint_id"] as string | null) ?? null,
      validationRefs,
      commitSha: (r["commit_sha"] as string | null) ?? null,
      createdAt: r["created_at"] as number,
      finalizedAt: (r["finalized_at"] as number | null) ?? null,
    };
  }

  private toClosure(r: Row): Closure {
    const outcome = r["outcome"] as string;
    if (!isClosureOutcome(outcome)) throw new Error(`fail-closed: corrupt closure outcome ${JSON.stringify(outcome)}`);
    const terminalState = r["terminal_state"] as string;
    if (terminalState !== "done" && terminalState !== "cancelled") {
      throw new Error(`fail-closed: corrupt closure terminal state ${JSON.stringify(terminalState)}`);
    }
    const list = (key: string): string[] => {
      const raw = r[key] as string | null | undefined;
      if (raw === null || raw === undefined || raw === "") return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    };
    const source = r["source"] as string;
    const outcomeTyped = outcome as ClosureOutcome;
    return {
      closureId: r["closure_id"] as string,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      terminalState,
      outcome: outcomeTyped,
      reason: r["reason"] as string,
      actor: r["actor"] as string,
      executionContext: (() => {
        const rawCtx = r["execution_context_json"] as string | null | undefined;
        if (rawCtx === null || rawCtx === undefined) return null;
        return normalizeExecutionContext(JSON.parse(rawCtx));
      })(),
      validationRefs: list("validation_refs_json"),
      journalResultRefs: list("journal_result_refs_json"),
      receiptRefs: list("receipt_refs_json"),
      artifactRefs: list("artifact_refs_json"),
      source: source === "beads" ? "beads" : "sb",
      legacyState: (r["legacy_state"] as string | null) ?? null,
      closedAt: r["closed_at"] as number,
    };
  }

  private toArtifact(r: Row): ArtifactBinding {
    const kind = r["kind"] as string;
    if (!isArtifactKind(kind)) throw new Error(`fail-closed: corrupt artifact kind on ${r["id"]}`);
    return {
      id: r["id"] as number,
      receiptId: r["receipt_id"] as string,
      kind,
      value: r["value"] as string,
      provider: (r["provider"] as string | null) ?? null,
      createdAt: r["created_at"] as number,
      supersededAt: (r["superseded_at"] as number | null) ?? null,
    };
  }
}

export { ARTIFACT_KINDS };
