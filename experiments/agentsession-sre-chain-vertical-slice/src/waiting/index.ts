/**
 * Runtime-owned WAITING_ON_CHANNEL state + SchedulerIntent wake/resume
 * (bead xtrm-sf3).
 *
 * Builds ON src/obligation/ (xtrm-hzb): an activation enters
 * waiting_on_channel while obligations it requested are open; when the ledger
 * records a correlated reply, THIS module emits a resume SchedulerIntent —
 * exactly once, deduped by deterministic intent_id (R2.8) — and transitions
 * the activation to resumed_pending_dispatch. Intents are journal records;
 * they are NEVER executed here (scheduler indirection, R5.18: no direct wake
 * path exists in this module).
 *
 * BORROWED PATTERNS (pinned evidence, bd memory
 * comm-transport-evidence-reference-only-pinned):
 *  - Claude CLI notify_when_idle: one-shot opt-in wake with EXPLICIT EXPIRY —
 *    expiry is surfaced as `wait_expired` so the resumed agent distinguishes
 *    "counterparty still busy" from "counterparty gone". Expired ≠ failed:
 *    no data destroyed, obligations untouched.
 *  - pi-intercom idle-vs-busy split → classifyResume() returns new_turn |
 *    steer | decline_noninteractive. PURE ADVISORY: this layer never injects
 *    anything anywhere — xtmux/provider adapters own physical delivery,
 *    ActivationSupervisor owns native injection. We only classify.
 *  - intercom E_MUTUAL_ASK → E_MUTUAL_WAIT cycle refusal (see enterWaiting).
 *
 * NO channel_wait API (loud): there is deliberately NO public method that
 * lets an agent block or poll on a channel. The ONLY agent-visible surface is
 * its own activation record state (get/list). Wake-up happens TO the agent
 * via scheduler intents consumed by the host — never BY the agent polling.
 *
 * PENDING-WAIT CEILING (documented decision): unlike intercom's single
 * pending ask, ONE waiting entry may list MULTIPLE obligation_ids (an
 * activation often awaits several replies). Ceiling: MAX_OBLIGATIONS_PER_WAIT
 * = 8 per entry. Justification: bounded pending state keeps the cycle graph
 * small and the fold cheap, and blocks the "unbounded pending waits"
 * anti-pattern; 8 covers any realistic chain fan-out (a step's responders are
 * declared at compile time). Exceeding it is a typed refusal, not a silent
 * truncation. A second concurrent wait entry per activation is impossible by
 * construction (single-scheduler invariant: one state per activation).
 */

import {
  ObligationError,
  stableStringify,
  type ObligationLedger,
  type ReplyObligationRecord,
} from "../obligation/index.ts";
import {
  SchedulerIntentSchema,
  WaitingEventSchema,
  WAITING_STATE_SCHEMA_VERSION,
  projectWaits,
  type ActivationPhase,
  type ActivationWaitRecord,
  type ResumeReason,
  type SchedulerIntent,
  type WakeDelivery,
  type WaitingEvent,
} from "./schemas.ts";

export * from "./schemas.ts";

// ---------------------------------------------------------------------------
// Errors — typed outcome classes (channels.md §10 spirit), deterministic.
// ---------------------------------------------------------------------------

export type WaitingErrorCode =
  | "unknown_obligation"
  | "obligation_not_open"
  | "self_target"
  | "mutual_wait"
  | "wait_ceiling_exceeded"
  | "invalid_transition"
  | "empty_wait";

export class WaitingError extends Error {
  readonly code: WaitingErrorCode;
  /** Cycle participants for mutual_wait; offending ids elsewhere. */
  readonly candidates: string[];
  constructor(code: WaitingErrorCode, message: string, candidates: string[] = []) {
    super(`[${code}] ${message}`);
    this.name = "WaitingError";
    this.code = code;
    this.candidates = candidates;
  }
}

/** E_MUTUAL_WAIT — exported alias so hosts can match without string compare. */
export const E_MUTUAL_WAIT: WaitingErrorCode = "mutual_wait";

/**
 * Pending-wait ceiling: max obligation_ids per waiting entry. See module
 * docblock for justification.
 */
export const MAX_OBLIGATIONS_PER_WAIT = 8;

// ---------------------------------------------------------------------------
// Injected persistence — the ONLY effect boundaries of this module.
// ---------------------------------------------------------------------------

export interface WaitingJournal {
  append(event: WaitingEvent): Promise<void>;
  readAll(): Promise<WaitingEvent[]>;
}

export interface IntentJournal {
  append(intent: SchedulerIntent): Promise<void>;
  readAll(): Promise<SchedulerIntent[]>;
}

export interface ReplyRecordedEvent {
  obligation_id: string;
  /** message_id of the committed reply (channels.md §5.1 semantic cursor). */
  reply_message_id: string;
}

export interface ResumeOutcome {
  activation_id: string;
  intent_id: string;
  reason: ResumeReason;
  /** True when an intent was appended now; false when deduped (already emitted). */
  emitted: boolean;
}

export interface WaitingOptions {
  now?: () => number;
}

/** Canonical JSONL line for either journal (sorted keys → byte determinism). */
function canonicalLine(v: unknown): string {
  return stableStringify(v);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class WaitingRegistry {
  private waits = new Map<string, ActivationWaitRecord>();
  private emittedIntents = new Set<string>();

  constructor(
    private readonly ledger: ObligationLedger,
    private readonly waitingJournal: WaitingJournal,
    private readonly intents: IntentJournal,
    private readonly opts: WaitingOptions = {},
  ) {}

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /**
   * Reload projections from both journals. Idempotent; call once at startup.
   * After reload, already-emitted intents are known, so replaying the same
   * triggering evidence cannot double-emit (durability guarantee).
   */
  async load(): Promise<this> {
    this.waits = projectWaits(await this.waitingJournal.readAll());
    this.emittedIntents = new Set((await this.intents.readAll()).map((i) => i.intent_id));
    return this;
  }

  private async appendWait(event: WaitingEvent): Promise<void> {
    WaitingEventSchema.parse(event); // host-side guard
    await this.waitingJournal.append(event);
    this.waits = projectWaits(await this.waitingJournal.readAll());
  }

  /**
   * Append an intent EXACTLY ONCE: dedup by deterministic intent_id against
   * everything ever emitted (in-memory set seeded from journal on load).
   */
  private async emitIntent(intent: SchedulerIntent): Promise<boolean> {
    if (this.emittedIntents.has(intent.intent_id)) return false;
    SchedulerIntentSchema.parse(intent); // host-side guard
    await this.intents.append(intent);
    this.emittedIntents.add(intent.intent_id);
    return true;
  }

  // -- commands -------------------------------------------------------------

  /**
   * Transition running → waiting_on_channel. Validates EVERY obligation via
   * the ledger before any event is written:
   *  - exists and is OPEN (unknown_obligation / obligation_not_open);
   *  - direction check (borrowed from hzb): the ledger record's requester
   *    must equal THIS activation's participant_id — you wait only on your
   *    own outstanding requests (wrong_requester);
   *  - self-target refusal: expected_responders must not include the waiter
   *    itself (self_target) — waiting on your own request for your own reply
   *    is structurally a deadlock;
   *  - cycle detection (E_MUTUAL_WAIT, borrowed from intercom E_MUTUAL_ASK):
   *    refuse when the wait graph reachable from this entry leads back to
   *    this participant — A waits on a reply from B while B (transitively)
   *    waits on a reply from A. Edges come from CURRENTLY-waiting
   *    activations' awaited responder sets.
   *
   * Ceiling: obligation_ids are deduped + sorted (byte-deterministic events),
   * then capped at MAX_OBLIGATIONS_PER_WAIT (wait_ceiling_exceeded).
   *
   * Concurrency stance: validation + cycle check run against the projection
   * as of call time; concurrent interleaved enterWaiting calls can each pass
   * validation against stale state. Hosts MUST serialize registry commands
   * per scheduler (single-scheduler invariant makes this the realistic shape);
   * multi-writer serialization is the store's concern, mirroring the ledger.
   */
  async enterWaiting(activation_id: string, participant_id: string, obligationIds: string[], deadlineMs?: number | null): Promise<ActivationWaitRecord> {
    const current = this.waits.get(activation_id);
    // Re-entry from resumed_pending_dispatch consumes the outstanding resume
    // dispatch (the agent acted on its wake); only an ACTIVELY waiting
    // activation may not re-enter (single-scheduler invariant).
    if (current && current.state === "waiting_on_channel") {
      throw new WaitingError(
        "invalid_transition",
        `activation "${activation_id}" is "${current.state}"; already actively waiting (single-scheduler invariant)`,
      );
    }
    const unique = [...new Set(obligationIds)].sort();
    if (unique.length === 0) {
      throw new WaitingError("empty_wait", "enterWaiting requires at least one obligation_id");
    }
    if (unique.length > MAX_OBLIGATIONS_PER_WAIT) {
      throw new WaitingError(
        "wait_ceiling_exceeded",
        `${unique.length} obligations exceed MAX_OBLIGATIONS_PER_WAIT=${MAX_OBLIGATIONS_PER_WAIT}; split into sequential waits`,
        unique.slice(MAX_OBLIGATIONS_PER_WAIT),
      );
    }

    // Ledger validation (direction check borrowed from hzb assertOwner shape).
    for (const oid of unique) {
      const rec: ReplyObligationRecord | undefined = this.ledger.get(oid);
      if (!rec) throw new ObligationError("unknown_obligation", `no obligation "${oid}" in ledger`);
      if (rec.state !== "open") {
        throw new ObligationError("invalid_transition", `obligation "${oid}" is "${rec.state}", not open`);
      }
      if (rec.requester !== participant_id) {
        throw new ObligationError(
          "wrong_direction",
          `obligation "${oid}" was requested by "${rec.requester}", not by waiting activation's participant "${participant_id}"`,
        );
      }
      if (rec.expected_responders.includes(participant_id)) {
        throw new WaitingError(
          "self_target",
          `obligation "${oid}" lists its own requester "${participant_id}" as expected responder — waiting on yourself is refused`,
          [oid],
        );
      }
    }

    this.assertAcyclic(activation_id, participant_id, unique);

    await this.appendWait({
      schema_version: WAITING_STATE_SCHEMA_VERSION,
      type: "waiting.entered",
      activation_id,
      participant_id,
      obligation_ids: unique,
      at_ms: this.nowMs(),
      deadline_ms: deadlineMs ?? null,
    });
    return structuredClone(this.waits.get(activation_id)!);
  }

  /**
   * Cycle detection over the CURRENT wait graph. Node = participant currently
   * waiting_on_channel; edge = awaited responder sets of its open waited
   * obligations (ledger truth). Obligations with empty expected_responders
   * ("anyone may reply") contribute NO edge — an anyone-may-reply wait cannot
   * be proven cyclic statically, and refusing it would over-block (documented
   * stance). DFS from the entrant's awaited participants; reaching the
   * entrant's own participant_id ⇒ E_MUTUAL_WAIT.
   */
  private assertAcyclic(activation_id: string, participant_id: string, obligationIds: string[]): void {
    const awaitingOf = new Map<string, Set<string>>(); // waiting participant -> awaited participants
    for (const rec of this.waits.values()) {
      if (rec.state !== "waiting_on_channel" || !rec.waiting_reason) continue;
      const awaited = new Set<string>();
      for (const oid of rec.waiting_reason.obligation_ids) {
        const obl = this.ledger.get(oid);
        if (!obl || obl.state !== "open") continue;
        for (const r of obl.expected_responders) awaited.add(r);
      }
      awaitingOf.set(rec.participant_id, awaited);
    }

    // Seed: responders of the obligations the entrant is about to wait on.
    const stack: string[] = [];
    for (const oid of obligationIds) {
      const obl = this.ledger.get(oid);
      if (!obl || obl.state !== "open") continue;
      for (const r of obl.expected_responders) stack.push(r);
    }
    // Reachability over currently-waiting participants; reaching the entrant
    // again means the wait graph cycles back to it (mutual deadlock).
    const visited = new Set<string>();
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (p === participant_id) {
        throw new WaitingError(
          "mutual_wait",
          `waiting on obligation(s) whose responder chain cycles back to "${participant_id}" — mutual wait would deadlock`,
          [participant_id],
        );
      }
      if (visited.has(p)) continue;
      visited.add(p);
      const next = awaitingOf.get(p);
      if (next) for (const n of [...next].sort()) stack.push(n);
    }
    void activation_id; // identity key is the activation; wait cycles are participant-level
  }

  /**
   * THE wake seam. Call AFTER the ledger durably recorded a reply (this
   * module never touches the ledger). For each waiting activation whose entry
   * includes the replied obligation: emit resume intent EXACTLY ONCE
   * (deterministic intent_id from (activation_id, obligation_id,
   * reply_message_id); duplicate/replayed reply events produce the same id
   * and are deduped), then transition to resumed_pending_dispatch with
   * reason "reply_received". First correlated reply resumes the activation —
   * remaining obligations stay open in the ledger (untouched); the resumed
   * agent may re-enter waiting if it still needs them (single-scheduler
   * invariant forbids partial states).
   *
   * Deterministic order: activations processed in sorted id order.
   */
  async onReplyRecorded(reply: ReplyRecordedEvent): Promise<ResumeOutcome[]> {
    const outcomes: ResumeOutcome[] = [];
    const waitingNow = [...this.waits.values()]
      .filter((r) => r.state === "waiting_on_channel" && r.waiting_reason?.obligation_ids.includes(reply.obligation_id))
      .sort((a, b) => a.activation_id.localeCompare(b.activation_id));
    for (const rec of waitingNow) {
      const intentId = resumeIntentId(rec.activation_id, reply.obligation_id, reply.reply_message_id);
      const emitted = await this.emitIntent({
        schema_version: WAITING_STATE_SCHEMA_VERSION,
        intent_id: intentId,
        action: "resume",
        activation_id: rec.activation_id,
        obligation_id: reply.obligation_id,
        reason_ref: reply.reply_message_id,
        created_at_ms: this.nowMs(),
      });
      await this.appendWait({
        schema_version: WAITING_STATE_SCHEMA_VERSION,
        type: "waiting.resumed",
        activation_id: rec.activation_id,
        at_ms: this.nowMs(),
        reason: "reply_received",
        obligation_id: reply.obligation_id,
        reply_message_id: reply.reply_message_id,
      });
      outcomes.push({ activation_id: rec.activation_id, intent_id: intentId, reason: "reply_received", emitted });
    }
    return outcomes;
  }

  /**
   * Deadline sweep (injectable clock): every waiting entry past its deadline
   * transitions to resumed_pending_dispatch with reason "wait_expired" and
   * emits ONE resume intent (intent_id deterministic per activation+expiry,
   * so repeated sweeps never double-emit). Borrowed from notify_when_idle
   * expiry notice: the resumed agent can distinguish "still busy" from
   * "gone". Expired ≠ failed: NOTHING is destroyed — the obligation ledger is
   * not consulted or mutated here.
   */
  async expireWaiters(): Promise<ResumeOutcome[]> {
    const now = this.nowMs();
    const outcomes: ResumeOutcome[] = [];
    const allEvents = await this.waitingJournal.readAll();
    const due = [...this.waits.values()]
      .filter((r) => r.state === "waiting_on_channel" && r.deadline_ms !== null && r.deadline_ms < now)
      .sort((a, b) => a.activation_id.localeCompare(b.activation_id));
    for (const rec of due) {
      // Generation counted BEFORE this entry's own entered event is consumed:
      // entries are the Nth entered event for the activation (N starts at 1).
      const priorEntries = countPriorEntries(allEvents, rec.activation_id);
      const waitGeneration = Math.max(priorEntries - 1, 0);
      const intentId = expiryIntentId(rec.activation_id, waitGeneration);
      const firstObligation = rec.waiting_reason?.obligation_ids[0] ?? "unknown";
      const emitted = await this.emitIntent({
        schema_version: WAITING_STATE_SCHEMA_VERSION,
        intent_id: intentId,
        action: "resume",
        activation_id: rec.activation_id,
        obligation_id: firstObligation,
        reason_ref: "wait_expired",
        created_at_ms: now,
      });
      await this.appendWait({
        schema_version: WAITING_STATE_SCHEMA_VERSION,
        type: "waiting.resumed",
        activation_id: rec.activation_id,
        at_ms: now,
        reason: "wait_expired",
        obligation_id: null,
        reply_message_id: null,
      });
      outcomes.push({ activation_id: rec.activation_id, intent_id: intentId, reason: "wait_expired", emitted });
    }
    return outcomes;
  }

  // -- pure advisory classification -----------------------------------------

  /**
   * Wake-delivery classification (idle-vs-busy, intercom pattern). PURE and
   * advisory: the host decides what to do with the answer. This layer has NO
   * injection capability by design.
   */
  static classifyResume(phase: ActivationPhase): WakeDelivery {
    switch (phase) {
      case "idle":
        return "new_turn";
      case "busy_interactive":
        return "steer";
      case "busy_noninteractive":
        return "decline_noninteractive";
    }
  }

  // -- queries ---------------------------------------------------------------

  get(activation_id: string): ActivationWaitRecord | undefined {
    const r = this.waits.get(activation_id);
    return r ? structuredClone(r) : undefined;
  }

  list(state?: ActivationWaitRecord["state"]): ActivationWaitRecord[] {
    let out = [...this.waits.values()];
    if (state) out = out.filter((r) => r.state === state);
    return out.sort((a, b) => a.activation_id.localeCompare(b.activation_id)).map((r) => structuredClone(r));
  }

  /** Ids of intents known to be emitted (loaded from journal + appended this session). */
  listIntentIds(): string[] {
    return [...this.emittedIntents].sort();
  }
}

// ---------------------------------------------------------------------------
// Deterministic intent ids (R2.8 exactness): pure functions of their inputs.
// ---------------------------------------------------------------------------

export function resumeIntentId(activation_id: string, obligation_id: string, reply_message_id: string): string {
  return `rintent:${activation_id}:${obligation_id}:${reply_message_id}`;
}

export function expiryIntentId(activation_id: string, waitGeneration: number): string {
  return `rintent:${activation_id}:expiry:g${waitGeneration}`;
}

/**
 * Wait generation = number of prior waiting.entered events for this
 * activation (0-based for the current entry). Distinct logical expiries of
 * distinct wait entries therefore never share an intent id — a re-entry
 * after an expired wake produces a fresh id, so the scheduler receives one
 * signal per logical wake (R2.8 "exact").
 */
function countPriorEntries(events: WaitingEvent[], activation_id: string): number {
  return events.filter((e) => e.type === "waiting.entered" && e.activation_id === activation_id).length;
}
