// Closure service (XTRM-252.7 / C1, ADR §96): the canonical
// close/reopen/cancel paths over the immutable Closure record.
//
// Separation rules, enforced here and nowhere else:
// - Lifecycle state and closure outcome are distinct facts (ADR §42). The
//   state says where the Issue rests; the outcome says why.
// - Reopening never mutates the historical Closure (ADR §45): it restores
//   lifecycle state and appends a reopen event; the row stays byte-identical.
// - Stopping one execution (claim release / activation cancellation) never
//   cancels the Issue (ADR §46): activation cancellation emits an
//   `activation.cancelled` event and leaves lifecycle and Closure untouched.
// - Failed attempts stay durable after a later success (ADR §47): every
//   attempt — failed or completed — is a row in `closure_attempts`.
//
// The X1 envelope (execution-context.ts) is the identity carrier: the
// caller builds it from trusted typed input plus the R4 env contract, and
// this service normalizes it fail-closed before persisting. Unknown stays
// absent (§98) — nothing is invented.

import type { DatabaseSync, SQLInputValue } from "../store/database.ts";
import { withTransaction } from "../store/transactions.ts";
import {
  normalizeExecutionContext,
  type ExecutionContext,
} from "../domain/execution-context.ts";
import {
  CLOSURE_OUTCOMES,
  cleanRefList,
  inferBeadsOutcome,
  isClosureOutcome,
  newClosureId,
  terminalStateForOutcome,
  validateRefList,
  type Closure,
  type ClosureAttempt,
  type ClosureAttemptKind,
  type ClosureOutcome,
} from "../domain/closure.ts";
import type { IssueService } from "./issue-service.ts";
import { TERMINAL_STATES } from "../domain/issue.ts";

interface Row {
  [key: string]: unknown;
}

function row<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function rows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export interface CloseIssueInput {
  outcome: ClosureOutcome;
  reason: string;
  actor: string;
  executionContext?: ExecutionContext | null;
  validationRefs?: string[];
  journalResultRefs?: string[];
  receiptRefs?: string[];
  artifactRefs?: string[];
  now?: number;
}

export interface CancelIssueInput {
  reason: string;
  actor: string;
  outcome?: ClosureOutcome;
  executionContext?: ExecutionContext | null;
  validationRefs?: string[];
  journalResultRefs?: string[];
  receiptRefs?: string[];
  artifactRefs?: string[];
  now?: number;
}

export interface ReopenIssueInput {
  reason: string;
  actor?: string;
  executionContext?: ExecutionContext | null;
  now?: number;
}

export interface BeadsClosureInput {
  reason: string;
  actor: string;
  legacyState: string;
  closedAt?: number;
}

export class ClosureService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;

  constructor(db: DatabaseSync, issues: IssueService) {
    this.db = db;
    this.issues = issues;
  }

  // -- close (canonical: sb issue close <ref> --outcome <o> --reason <r>) ---

  closeIssue(issueId: string, input: CloseIssueInput): Closure {
    try {
      return withTransaction(this.db, () => this.closeTx(issueId, input, "close"));
    } catch (err) {
      this.recordAttempt(issueId, "close", "failed", isClosureOutcome(input.outcome) ? input.outcome : null,
        typeof input.reason === "string" ? input.reason : null, err);
      throw err;
    }
  }

  // -- cancel (canonical: sb issue cancel <ref> --reason <r>) ---------------
  // Issue cancellation is a terminal Closure with the cancelled outcome
  // resting on the cancelled lifecycle state. Activation cancellation is a
  // different operation (cancelActivation below) and never lands here.

  cancelIssue(issueId: string, input: CancelIssueInput): Closure {
    if (input.outcome !== undefined && input.outcome !== "cancelled") {
      const err = new Error(`cancel carries the cancelled outcome, not ${JSON.stringify(input.outcome)} (want cancelled)`);
      this.recordAttempt(issueId, "cancel", "failed", null, input.reason ?? null, err);
      throw err;
    }
    try {
      return withTransaction(this.db, () =>
        this.closeTx(issueId, { ...input, outcome: "cancelled" as ClosureOutcome }, "cancel"));
    } catch (err) {
      this.recordAttempt(issueId, "cancel", "failed", "cancelled", typeof input.reason === "string" ? input.reason : null, err);
      throw err;
    }
  }

  private closeTx(issueId: string, input: CloseIssueInput, kind: "close" | "cancel"): Closure {
    const issue = this.issues.getIssue(issueId);
    if (!isClosureOutcome(input.outcome)) {
      throw new Error(`unknown closure outcome: ${JSON.stringify(input.outcome)} (want ${CLOSURE_OUTCOMES.join("|")})`);
    }
    if (typeof input.reason !== "string" || input.reason.trim() === "") {
      throw new Error("a close reason is required (--reason): the reason lives in the Closure row, never only in git log (§43)");
    }
    if (typeof input.actor !== "string" || input.actor.trim() === "") {
      throw new Error("a close actor is required: who closed the issue is durable closure data");
    }
    for (const [field, value] of [
      ["validationRefs", input.validationRefs],
      ["journalResultRefs", input.journalResultRefs],
      ["receiptRefs", input.receiptRefs],
      ["artifactRefs", input.artifactRefs],
    ] as const) {
      const problems = validateRefList(value, field);
      if (problems.length > 0) throw new Error(problems[0]!);
    }
    if ((TERMINAL_STATES as readonly string[]).includes(issue.lifecycleState)) {
      throw new Error(`already terminal: ${issueId} is ${issue.lifecycleState}; reopen before closing again (history is immutable)`);
    }
    const ctx = normalizeExecutionContext(input.executionContext ?? null);
    const now = input.now ?? Date.now();
    const closureId = newClosureId();
    const terminalState = terminalStateForOutcome(input.outcome);
    const closure: Closure = {
      closureId,
      issueId,
      issueRevision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      terminalState,
      outcome: input.outcome,
      reason: input.reason.trim(),
      actor: input.actor.trim(),
      executionContext: ctx,
      validationRefs: cleanRefList(input.validationRefs),
      journalResultRefs: cleanRefList(input.journalResultRefs),
      receiptRefs: cleanRefList(input.receiptRefs),
      artifactRefs: cleanRefList(input.artifactRefs),
      source: "sb",
      legacyState: null,
      closedAt: now,
    };
    this.insertClosure(closure);
    this.db
      .prepare("UPDATE issues SET lifecycle_state = ?, updated_at = ? WHERE id = ?")
      .run(terminalState, now, issueId);
    this.issues.appendEvent(issueId, "issue.lifecycle", { from: issue.lifecycleState, to: terminalState });
    this.issues.appendEvent(issueId, "issue.closed", {
      closure: closureId,
      outcome: closure.outcome,
      terminalState,
      revision: closure.issueRevision,
      contractHash: closure.contractHash,
    });
    this.insertAttempt(issueId, kind, "completed", closure.outcome, closure.reason, null, closureId, now);
    return closure;
  }

  // -- reopen (canonical: sb issue reopen <ref> --reason <r>) ---------------
  // Keeps every historical Closure row untouched, appends a reopen event,
  // and restores lifecycle state to open (ADR §45).

  reopenIssue(issueId: string, input: ReopenIssueInput): { issueId: string; lifecycleState: string } {
    try {
      return withTransaction(this.db, () => this.reopenTx(issueId, input));
    } catch (err) {
      this.recordAttempt(issueId, "reopen", "failed", null, typeof input.reason === "string" ? input.reason : null, err);
      throw err;
    }
  }

  private reopenTx(issueId: string, input: ReopenIssueInput): { issueId: string; lifecycleState: string } {
    const issue = this.issues.getIssue(issueId);
    if (!(TERMINAL_STATES as readonly string[]).includes(issue.lifecycleState)) {
      throw new Error(`not terminal: ${issueId} is ${issue.lifecycleState}; only a terminal issue reopens`);
    }
    if (typeof input.reason !== "string" || input.reason.trim() === "") {
      throw new Error("a reopen reason is required (--reason): reopening appends a durable reopen event");
    }
    normalizeExecutionContext(input.executionContext ?? null);
    const prior = this.listClosures(issueId).map((c) => c.closureId);
    const now = input.now ?? Date.now();
    this.db.prepare("UPDATE issues SET lifecycle_state = 'open', updated_at = ? WHERE id = ?").run(now, issueId);
    this.issues.appendEvent(issueId, "issue.lifecycle", { from: issue.lifecycleState, to: "open" });
    this.issues.appendEvent(issueId, "issue.reopened", { reason: input.reason.trim(), priorClosures: prior });
    this.insertAttempt(issueId, "reopen", "completed", null, input.reason.trim(), null, null, now);
    return { issueId, lifecycleState: "open" };
  }

  // -- activation cancellation (stopping one execution, ADR §46) ------------
  // Cancelling an activation releases the holder's claim and records an
  // `activation.cancelled` event. It never touches lifecycle state and
  // never writes a Closure: stopping one execution does not cancel the
  // Issue. Cancelling the Issue is cancelIssue above.

  cancelActivation(
    issueId: string,
    holder: string,
    opts?: { activationId?: string; now?: number },
  ): { released: boolean; lifecycleState: string } {
    return withTransaction(this.db, () => {
      const issue = this.issues.getIssue(issueId);
      const released = this.issues.releaseClaim(issueId, holder, {
        activationId: opts?.activationId,
        now: opts?.now,
      });
      if (released === null) {
        this.issues.appendEvent(issueId, "activation.cancelled", {
          holder,
          activationId: opts?.activationId ?? null,
          claim: null,
          note: "no open claim; nothing stopped",
        });
        return { released: false, lifecycleState: issue.lifecycleState };
      }
      this.issues.appendEvent(issueId, "activation.cancelled", {
        holder,
        activationId: opts?.activationId ?? null,
        claim: released.id,
        generation: released.generation,
      });
      return { released: true, lifecycleState: this.issues.getIssue(issueId).lifecycleState };
    });
  }

  // -- Beads close-reason migration (source=beads, never guessed) -----------
  // Maps a historical Beads close into a Closure row preserving the verbatim
  // reason, the legacy Beads status, the transition timestamp, and the
  // recorded author. Idempotent: an issue that already carries a Closure
  // keeps it (re-runs add no rows). Issues that are not terminal get no row.

  recordBeadsClosure(issueId: string, input: BeadsClosureInput): Closure | null {
    const existing = this.getLatestClosure(issueId);
    if (existing !== null) return existing;
    const issue = this.issues.getIssue(issueId);
    if (!(TERMINAL_STATES as readonly string[]).includes(issue.lifecycleState)) return null;
    const closedAt = this.lastTerminalTransitionAt(issueId) ?? Date.now();
    const reason = typeof input.reason === "string" ? input.reason : "";
    const closure: Closure = {
      closureId: newClosureId(),
      issueId,
      issueRevision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      terminalState: (issue.lifecycleState === "cancelled" ? "cancelled" : "done") as Closure["terminalState"],
      outcome: inferBeadsOutcome(reason),
      reason,
      actor: input.actor.trim() !== "" ? input.actor : "beads-import",
      executionContext: null,
      validationRefs: [],
      journalResultRefs: [],
      receiptRefs: [],
      artifactRefs: [],
      source: "beads",
      legacyState: input.legacyState,
      closedAt: input.closedAt ?? closedAt,
    };
    return withTransaction(this.db, () => {
      if (this.getLatestClosure(issueId) !== null) return this.getLatestClosure(issueId);
      this.insertClosure(closure);
      this.issues.appendEvent(issueId, "issue.closed", {
        closure: closure.closureId,
        outcome: closure.outcome,
        terminalState: closure.terminalState,
        revision: closure.issueRevision,
        contractHash: closure.contractHash,
        source: "beads",
        legacyState: input.legacyState,
      });
      this.insertAttempt(issueId, "close", "completed", closure.outcome, reason || null, null, closure.closureId, closedAt);
      return closure;
    });
  }

  private lastTerminalTransitionAt(issueId: string): number | null {
    let at: number | null = null;
    for (const e of this.issues.listEvents(issueId)) {
      if (e.type !== "issue.lifecycle") continue;
      const p = e.payload as { to?: unknown } | null;
      if (p && typeof p.to === "string" && (TERMINAL_STATES as readonly string[]).includes(p.to)) at = e.createdAt;
    }
    return at;
  }

  // -- reads (directly queryable closure data) -------------------------------

  getClosure(closureId: string): Closure {
    const r = row<Row>(this.db, "SELECT * FROM issue_closures WHERE closure_id = ?", closureId);
    if (!r) throw new Error(`unknown closure: ${closureId}`);
    return this.toClosure(r);
  }

  getLatestClosure(issueId: string): Closure | null {
    const r = row<Row>(
      this.db,
      "SELECT * FROM issue_closures WHERE issue_id = ? ORDER BY closed_at DESC, closure_id DESC LIMIT 1",
      issueId,
    );
    return r ? this.toClosure(r) : null;
  }

  listClosures(issueId: string): Closure[] {
    this.issues.getIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM issue_closures WHERE issue_id = ? ORDER BY closed_at, closure_id", issueId).map(
      (r) => this.toClosure(r),
    );
  }

  listAttempts(issueId: string): ClosureAttempt[] {
    this.issues.getIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM closure_attempts WHERE issue_id = ? ORDER BY id", issueId).map((r) =>
      this.toAttempt(r),
    );
  }

  // -- internals ---------------------------------------------------------------

  private insertClosure(c: Closure): void {
    this.db
      .prepare(
        `INSERT INTO issue_closures
           (closure_id, issue_id, issue_revision, contract_hash, terminal_state, outcome,
            reason, actor, execution_context_json, validation_refs_json,
            journal_result_refs_json, receipt_refs_json, artifact_refs_json,
            source, legacy_state, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.closureId,
        c.issueId,
        c.issueRevision,
        c.contractHash,
        c.terminalState,
        c.outcome,
        c.reason,
        c.actor,
        c.executionContext ? JSON.stringify(c.executionContext) : null,
        JSON.stringify(c.validationRefs),
        JSON.stringify(c.journalResultRefs),
        JSON.stringify(c.receiptRefs),
        JSON.stringify(c.artifactRefs),
        c.source,
        c.legacyState,
        c.closedAt,
      );
  }

  private insertAttempt(
    issueId: string,
    kind: ClosureAttemptKind,
    status: "failed" | "completed",
    outcome: ClosureOutcome | null,
    reason: string | null,
    error: string | null,
    closureId: string | null,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO closure_attempts (issue_id, kind, status, outcome, reason, error, closure_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(issueId, kind, status, outcome, reason, error, closureId, now);
  }

  // Failed attempts are durable (ADR §47): the validating transaction
  // rolled back, so the failure is recorded here in its own transaction
  // before the error propagates. Unknown issues cannot carry attempts
  // (the FK would invent history for nothing) — the error still throws.
  private recordAttempt(
    issueId: string,
    kind: ClosureAttemptKind,
    status: "failed" | "completed",
    outcome: ClosureOutcome | null,
    reason: string | null,
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    try {
      this.issues.getIssue(issueId);
    } catch {
      return;
    }
    withTransaction(this.db, () => {
      this.insertAttempt(issueId, kind, status, outcome, reason, message, null, Date.now());
    });
  }

  private toClosure(r: Row): Closure {
    const outcome = r["outcome"] as string;
    if (!isClosureOutcome(outcome)) throw new Error(`fail-closed: corrupt closure outcome ${JSON.stringify(outcome)}`);
    const terminalState = r["terminal_state"] as string;
    if (terminalState !== "done" && terminalState !== "cancelled") {
      throw new Error(`fail-closed: corrupt closure terminal state ${JSON.stringify(terminalState)}`);
    }
    const rawCtx = r["execution_context_json"] as string | null | undefined;
    let executionContext: Closure["executionContext"] = null;
    if (rawCtx !== null && rawCtx !== undefined) {
      executionContext = normalizeExecutionContext(JSON.parse(rawCtx));
    }
    const list = (key: string): string[] => {
      const raw = r[key] as string | null | undefined;
      if (raw === null || raw === undefined || raw === "") return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    };
    const source = r["source"] as string;
    return {
      closureId: r["closure_id"] as string,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      terminalState,
      outcome,
      reason: r["reason"] as string,
      actor: r["actor"] as string,
      executionContext,
      validationRefs: list("validation_refs_json"),
      journalResultRefs: list("journal_result_refs_json"),
      receiptRefs: list("receipt_refs_json"),
      artifactRefs: list("artifact_refs_json"),
      source: source === "beads" ? "beads" : "sb",
      legacyState: (r["legacy_state"] as string | null) ?? null,
      closedAt: r["closed_at"] as number,
    };
  }

  private toAttempt(r: Row): ClosureAttempt {
    const kind = r["kind"] as string;
    const status = r["status"] as string;
    if (kind !== "close" && kind !== "reopen" && kind !== "cancel") {
      throw new Error(`fail-closed: corrupt closure attempt kind ${JSON.stringify(kind)}`);
    }
    if (status !== "failed" && status !== "completed") {
      throw new Error(`fail-closed: corrupt closure attempt status ${JSON.stringify(status)}`);
    }
    const outcome = r["outcome"] as string | null;
    return {
      id: r["id"] as number,
      issueId: r["issue_id"] as string,
      kind,
      status,
      outcome: outcome === null ? null : isClosureOutcome(outcome) ? outcome : null,
      reason: (r["reason"] as string | null) ?? null,
      error: (r["error"] as string | null) ?? null,
      closureId: (r["closure_id"] as string | null) ?? null,
      createdAt: r["created_at"] as number,
    };
  }
}
