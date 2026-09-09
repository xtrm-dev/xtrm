// Provenance service (PRD §§26-30): execution bindings, WorkReceipts,
// artifact bindings, traces, and repository bundles. Host authority only:
// every revision/hash pair is copied from live Substrate rows, never from
// caller input, so executor model output cannot forge receipt authority
// (§5, E37). Each public method owns its transaction; Tx-suffixed helpers
// assume the caller holds it (same non-nesting rule as claims/journal).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { withTransaction } from "../store/transactions.ts";
import { normalizeWorkspace } from "../domain/claim.ts";
import {
  newExecutionBindingId,
  validateDispatchInput,
  type DispatchInput,
  type ExecutionBinding,
} from "../domain/execution-binding.ts";
import {
  ARTIFACT_KINDS,
  attachTrailers,
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
  receipts: Array<WorkReceipt & { artifacts: ArtifactBinding[] }>;
  checkpoints: CheckpointSummary[];
  commits: string[];
  prs: Array<{ value: string; provider: string | null }>;
  externalBindings: Array<{ provider: string; scope: string; remoteId: string; url?: string | null }>;
  closureRevision: number | null;
}

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

  dispatch(issueId: string, input: DispatchInput, opts?: { now?: number }): ExecutionBinding {
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
      const resolved = this.issues.getResolvedContext(issueId);
      const active = this.issues.getActiveClaim(issueId, { now });
      if (input.claimId !== undefined && input.claimId !== null) {
        if (!active || active.id !== input.claimId) throw new Error(`dispatch rejected: claim ${input.claimId} is not the live claim on ${issueId}`);
      }
      const id = newExecutionBindingId();
      this.db
        .prepare(
          `INSERT INTO execution_bindings
             (id, issue_id, issue_revision, contract_hash, resolved_context_hash,
              claim_id, participant_id, activation_id, attempt_id, session_id,
              workspace, base_commit, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, issueId, report.revision, report.contractHash, resolved.hash,
          active?.id ?? null, input.participantId ?? null, input.activationId ?? null,
          input.attemptId ?? null, input.sessionId ?? null, workspace, input.baseCommit ?? null, now,
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
          opts?.journalCheckpointId ?? null, JSON.stringify(opts?.validationRefs ?? []), now,
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

  listReceipts(issueId: string): WorkReceipt[] {
    this.issues.getIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM work_receipts WHERE issue_id = ? ORDER BY created_at, id", issueId).map((r) =>
      this.toReceipt(r),
    );
  }

  // post-commit finalization: binds the open receipt to the exact SHA git
  // just created. Idempotent on (receipt, sha) so hook retries are safe.
  bindCommit(receiptId: string, sha: string, opts?: { now?: number }): WorkReceipt {
    if (!isValidSha(sha)) throw new Error(`invalid commit SHA: ${String(sha)}`);
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      const receipt = this.requireReceipt(receiptId);
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
      this.db
        .prepare(
          "INSERT OR IGNORE INTO artifact_bindings (receipt_id, kind, value, provider, created_at, superseded_at) VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .run(receiptId, kind, value, opts?.provider ?? null, now);
      this.issues.appendEvent(receipt.issueId, "provenance.artifact_attached", { receipt: receiptId, kind, value });
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

  trace(issueId: string): ProvenanceTrace {
    const issue = this.issues.getIssue(issueId);
    const bindings = this.listBindings(issueId);
    const receipts = this.listReceipts(issueId).map((r) => ({ ...r, artifacts: this.listArtifacts(r.id) }));
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

  private listExternal(issueId: string): Array<{ provider: string; scope: string; remoteId: string; url?: string | null }> {
    try {
      return rows<Row>(this.db, "SELECT provider, remote_scope, remote_id, url FROM external_bindings WHERE issue_id = ? ORDER BY provider, remote_scope, remote_id", issueId)
        .map((r) => ({
          provider: r["provider"] as string,
          scope: r["remote_scope"] as string,
          remoteId: r["remote_id"] as string,
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
    return {
      id: r["id"] as string,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      resolvedContextHash: r["resolved_context_hash"] as string,
      claimId: (r["claim_id"] as number | null) ?? null,
      participantId: (r["participant_id"] as string | null) ?? null,
      activationId: (r["activation_id"] as string | null) ?? null,
      attemptId: (r["attempt_id"] as string | null) ?? null,
      sessionId: (r["session_id"] as string | null) ?? null,
      workspace: r["workspace"] as string,
      baseCommit: (r["base_commit"] as string | null) ?? null,
      createdAt: r["created_at"] as number,
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
