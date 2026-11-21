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
  canonicalizeWriteIdentity,
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
import { LinkGateService, type GateMode } from "./link-gate-service.ts";
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
  linkGate?: GateMode;
  gateOverride?: string;
  /**
   * XTRM-959: the caller's stated justification for closing while a blocking
   * dependency is still open. Empty/absent means "no override" — the close is
   * then refused, because a terminal issue whose own declared dependency is
   * unresolved cannot be told apart from an ordered close.
   */
  blockerOverrideReason?: string | null;
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

/**
 * Authority for first-class Closure: the only writer of immutable Closure
 * rows answering why an Issue became terminal. Side effects are the durable
 * transactional close/cancel writes (Closure row plus lifecycle rest plus closed event);
 * reopen appends a reopen event and keeps every historical Closure row
 * untouched. The Closure pins the current revision and contract hash but never
 * mints a revision, and terminal readiness ends dispatchability until reopen
 * and re-attestation. Automatic metadata: outcome, reason, actor, execution
 * envelope, closed-at timestamp and validation/result/receipt/artifact refs.
 * Closes are idempotent only by explicit retry of the same terminal intent;
 * unknown outcomes, missing reasons and already-terminal issues fail closed.
 */
export class ClosureService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;

  private readonly gate: LinkGateService;

  constructor(db: DatabaseSync, issues: IssueService, gate?: LinkGateService) {
    this.db = db;
    this.issues = issues;
    this.gate = gate ?? new LinkGateService(db, issues);
  }

  // -- close (canonical: sb issue close <ref> --outcome <o> --reason <r>) ---

  /** Canonical close: validates outcome and reason, writes the immutable row and rests the lifecycle terminal. */
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
    // XTRM-959: a declared blocking dependency that is still open refuses the
    // close, unless the caller says why it no longer binds. Checked before the
    // link gate and before any row is written, so a refusal leaves no partial
    // closure. Outcomes that point at another issue rather than delivering
    // (superseded|duplicate) and the cancel path are exempt by contract.
    const blockerOverride = kind === "close"
      ? this.settleOpenBlockers(issueId, input.outcome, input.blockerOverrideReason ?? null)
      : null;
    if (kind === "close" && input.outcome === "completed") {
      // Only a delivery close is gated. Before any closure row: warn (event,
      // proceed), enforce (throw, write nothing) or off.
      this.gate.enforce(issueId, {
        mode: input.linkGate,
        override: input.gateOverride ?? null,
        actor: input.actor,
        now: input.now,
      });
    }
    // XTRM-447: closure identity passes through the SAME canonical write seam
    // as the journal (XTRM-412) — canonicalise, then fail closed before any row
    // is written, so an invalid session id can no longer be stored silently and
    // the caller learns which field was rejected. Scalars come from the envelope
    // itself (CloseIssueInput carries no separate scalar fields); historical rows
    // are never rewritten.
    const normalizedCtx = normalizeExecutionContext(input.executionContext ?? null);
    const canonical = canonicalizeWriteIdentity({
      executionContext: normalizedCtx,
      participantId: normalizedCtx?.participantId ?? null,
      activationId: normalizedCtx?.specialist?.activationId ?? null,
      attemptId: normalizedCtx?.specialist?.attemptId ?? null,
      sessionId: normalizedCtx?.xtrmSessionId ?? null,
      runId: normalizedCtx?.runId ?? null,
    });
    const ctx = canonical.executionContext;
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
      blockerOverride,
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

  /** Restores open while keeping every Closure row; history is appended, never rewritten. */
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
    // Reopen must not silently drop what the caller supplied (C1 review
    // P2-1): a provided actor has to be a usable label, and the provided
    // envelope is persisted on the reopen event rather than validated and
    // discarded.
    if (input.actor !== undefined && (typeof input.actor !== "string" || input.actor.trim() === "")) {
      throw new Error("actor must be a non-empty string when provided");
    }
    const actor = typeof input.actor === "string" ? input.actor.trim() : null;
    // XTRM-447: same canonical write seam as close — reopen stores an
    // execution envelope too, so it gets the same rule (canonicalise, fail
    // closed before anything is written).
    const reopened = canonicalizeWriteIdentity({
      executionContext: normalizeExecutionContext(input.executionContext ?? null),
      participantId: null,
      activationId: null,
      attemptId: null,
      sessionId: null,
      runId: null,
    });
    const reopenContext = reopened.executionContext;
    const prior = this.listClosures(issueId).map((c) => c.closureId);
    const now = input.now ?? Date.now();
    this.db.prepare("UPDATE issues SET lifecycle_state = 'open', updated_at = ? WHERE id = ?").run(now, issueId);
    this.issues.appendEvent(issueId, "issue.lifecycle", { from: issue.lifecycleState, to: "open" });
    this.issues.appendEvent(issueId, "issue.reopened", {
      reason: input.reason.trim(),
      priorClosures: prior,
      ...(actor !== null ? { actor } : {}),
      ...(reopenContext !== null ? { executionContext: reopenContext } : {}),
    });
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
      // Synthesised for an already-terminal issue: no override was recorded.
      blockerOverride: null,
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
      }, closedAt);
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

  // -- XTRM-959: open blocking dependencies on the close path ---------------
  // Read from the local store (no network): a blocker is satisfied only by a
  // closed issue, never by an open PR. Human refs are what the caller can act
  // on, so the refusal names those rather than internal ids.

  private openBlockerRefs(issueId: string): string[] {
    return this.issues.unsatisfiedBlockers(issueId).map((id) => {
      try {
        return this.issues.getIssue(id).locator;
      } catch {
        return id;
      }
    });
  }

  /** Refuses a delivery close past an open blocker unless `overrideReason` says why it no longer binds. */
  private settleOpenBlockers(
    issueId: string,
    outcome: ClosureOutcome,
    overrideReason: string | null,
  ): { reason: string; refs: string[] } | null {
    // `superseded` and `duplicate` point at another issue instead of claiming
    // delivery; `cancelled` is the cancel path. None of them assert that the
    // blocked work was done, so none of them carry this check (contract
    // CONSTRAINT, XTRM-959).
    if (outcome === "superseded" || outcome === "duplicate" || outcome === "cancelled") return null;
    const refs = this.openBlockerRefs(issueId);
    if (refs.length === 0) return null;
    const issue = this.issues.getIssue(issueId);
    const reason = (overrideReason ?? "").trim();
    if (reason === "") {
      throw new Error(
        `refusing to close ${issue.locator}: ${refs.length === 1 ? "blocker" : "blockers"} ${refs.join(", ")} ` +
          `${refs.length === 1 ? "is" : "are"} still open. A blocker is satisfied only when it is itself terminal ` +
          `(done or archived): an open PR is not evidence, and neither is a merged one — this guard reads the ` +
          `blocker's lifecycle state, not its PRs. Close ${refs.join(", ")} first, or state why it no longer binds: ` +
          `sb issue close ${issue.locator} --outcome ${outcome} --reason "<why this issue is finished>" ` +
          `--force-close-with-open-blocker "<why ${refs.join(", ")} no longer binds>"`,
      );
    }
    // The flag carries the reason, so it must read like one: a bare boolean (or
    // a word that only satisfies a parser) becomes a habit within a week, and a
    // habit is exactly what makes an override unreadable to the next person.
    const words = reason.split(/\s+/).filter((w) => w.length > 0);
    const lowered = reason.toLowerCase();
    // Pasting the ref or the flag name satisfies a word count without saying
    // anything, which is the habit the floor exists to prevent.
    // Three ways to satisfy the parser without saying anything: pasting the ref,
    // pasting a flag-shaped token, or pasting the flag's own name. Each arm is
    // named in its refusal, because a caller who guessed wrong needs to know
    // which floor they hit — "needs two words" was false for a three-word
    // reason that only named the flag.
    const pastedRef = refs.some((ref) => ref.toLowerCase() === lowered);
    const pastedFlagShape = lowered.startsWith("--");
    const namedTheFlag = lowered.includes("force-close-with-open-blocker");
    // Kept deliberately: a reason that mentions the flag itself is not a reason
    // the blocker stopped binding, and this arm is what a distracted caller
    // writes. It refuses such a sentence and says which arm refused it, rather
    // than accepting it quietly — a caller who means it can reword.
    const tooShort = words.length < 2 || reason.length < 12;
    if (tooShort || pastedRef || pastedFlagShape || namedTheFlag) {
      const why = pastedRef
        ? `it is just the blocker's own ref, so it names what blocks and not why it stopped`
        : pastedFlagShape
          ? `it reads as a command-line flag, not as a reason ${refs.join(", ")} stopped binding`
          : namedTheFlag
            ? `it names --force-close-with-open-blocker instead of saying why ${refs.join(", ")} no longer binds`
            : `it needs at least two words and twelve characters saying why ${refs.join(", ")} no longer binds`;
      throw new Error(
        `refusing to close ${issue.locator}: the override reason is not usable — ${why}, not "${reason}". Nothing was closed.`,
      );
    }
    return { reason, refs };
  }

  /**
   * Legacy bare `close` (no Closure row) shares the blocker rule, but has no
   * row to record an override on — so it can only refuse. A caller who means
   * to close past a blocker uses `--outcome ... --force-close-with-open-blocker`.
   */
  assertNoOpenBlockers(issueId: string): void {
    const refs = this.openBlockerRefs(issueId);
    if (refs.length === 0) return;
    const issue = this.issues.getIssue(issueId);
    throw new Error(
      `refusing to close ${issue.locator}: ${refs.length === 1 ? "blocker" : "blockers"} ${refs.join(", ")} ` +
        `${refs.length === 1 ? "is" : "are"} still open. A blocker is satisfied only when it is itself terminal ` +
        `(done or archived): an open PR is not evidence, and neither is a merged one — this guard reads the ` +
        `blocker's lifecycle state, not its PRs. To close deliberately, state why it no longer binds: ` +
        `sb issue close ${issue.locator} --outcome completed --reason "<why this issue is finished>" ` +
        `--force-close-with-open-blocker "<why ${refs.join(", ")} no longer binds>"`,
    );
  }

  private insertClosure(c: Closure): void {
    this.db
      .prepare(
        `INSERT INTO issue_closures
           (closure_id, issue_id, issue_revision, contract_hash, terminal_state, outcome,
            reason, actor, execution_context_json, validation_refs_json,
            journal_result_refs_json, receipt_refs_json, artifact_refs_json,
            source, legacy_state, closed_at, blocker_override_reason,
            blocker_override_refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        c.blockerOverride ? c.blockerOverride.reason : null,
        JSON.stringify(c.blockerOverride ? c.blockerOverride.refs : []),
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
      blockerOverride: (() => {
        const why = r["blocker_override_reason"] as string | null | undefined;
        if (why === null || why === undefined || why === "") return null;
        return { reason: why, refs: list("blocker_override_refs_json") };
      })(),
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
