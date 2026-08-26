/**
 * ReplyObligation ledger — durable request/reply correlation (bead xtrm-hzb).
 *
 * Builds on src/channel-comm/ (xtrm-6yn): channel-comm's request() emits a
 * RequestIntent VALUE and persists no obligation state; reply() trusts
 * caller-supplied handles. THIS module owns handle issuance/integrity and the
 * durable open/closed intent state: an append-only event journal plus a pure
 * projection fold (R2.8 — reducer from persisted evidence only). See
 * schemas.ts for durability/concurrency/responder-set stances.
 *
 * LEDGER-FIRST ORDERING (atomicity): registerRequest() appends the
 * `obligation.opened` event BEFORE the request message is considered sent.
 * withRequest() makes inverting the order structurally awkward: it registers,
 * then hands back a send-ready draft with correlation_id already injected;
 * the caller's send can only happen after the journal write resolved.
 * confirmRequestSent() completes request_ref after the send resolves.
 *
 * EDGE CONSUMED EXACTLY ONCE: recordReply validates edge alive + direction +
 * responder set, then appends one `obligation.replied` event; a second reply
 * against the same correlation finds zero open obligations and is rejected
 * with typed errors (`already_replied`, or `ambiguous_correlation`
 * listing candidates when several OPEN obligations share the correlation id).
 *
 * UNCERTAIN RULE (R2.7): observeExternalReply() records an external reply
 * observation WITHOUT transitioning state — the record surfaces
 * `pending_external_observations` and stays open until either recordReply or
 * settleFromStream() reconciles it against committed stream evidence, or it
 * remains uncertain forever (never silently resolved). No transition here
 * ever guesses about an unconfirmed external effect.
 *
 * LINEAGE (pi-intercom pattern, lineage-only): supersede/cancel/retry write
 * bookkeeping events with route-ownership checks (requester only); retryOf
 * NEVER auto-redelivers anything — no send happens anywhere in this module.
 */

import {
  ObligationEventSchema,
  REPLY_OBLIGATION_SCHEMA_VERSION,
  type Lineage,
  type ObligationEvent,
  type ObligationState,
  type RegisterInput,
  type ReplyObligationRecord,
  type ReplyRef,
} from "./schemas.ts";

export * from "./schemas.ts";
export { StoredEnvelopeSchema, type StoredEnvelope } from "../channel-comm/index.ts";

// ---------------------------------------------------------------------------
// Errors — deterministic, typed (channels.md §10 outcome-class spirit:
// rejection kinds are distinct facts, not one generic failure).
// ---------------------------------------------------------------------------

export type ObligationErrorCode =
  | "unknown_correlation"
  | "ambiguous_correlation"
  | "already_replied"
  | "wrong_direction"
  | "correlation_mismatch"
  | "unknown_obligation"
  | "not_owner"
  | "invalid_transition";

export class ObligationError extends Error {
  readonly code: ObligationErrorCode;
  /** For ambiguous_correlation / consumed-once reports: candidate obligation ids. */
  readonly candidates: string[];
  constructor(code: ObligationErrorCode, message: string, candidates: string[] = []) {
    super(`[${code}] ${message}`);
    this.name = "ObligationError";
    this.code = code;
    this.candidates = candidates;
  }
}

// ---------------------------------------------------------------------------
// Injected persistence — the ONLY effect boundary of this module.
// ---------------------------------------------------------------------------

export interface ObligationJournal {
  append(event: ObligationEvent): Promise<void>;
  readAll(): Promise<ObligationEvent[]>;
}

/** Key-order-independent JSON stringify → byte-identical journals for identical op sequences. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** Canonical journal line (one event per line, sorted keys) for JSONL stores. */
export function canonicalEventLine(event: ObligationEvent): string {
  return stableStringify(event);
}

function emptyRecord(opened: Extract<ObligationEvent, { type: "obligation.opened" }>): ReplyObligationRecord {
  const input = opened.input as unknown as RegisterInput;
  return {
    schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
    obligation_id: opened.obligation_id,
    request_ref: { channel_id: input.channel_id, message_id: null, request_id: input.correlation_id ?? `req:${input.idempotency_key}` },
    requester: input.requester,
    expected_responders: [...(input.expected_responders ?? [])],
    correlation_id: input.correlation_id ?? `req:${input.idempotency_key}`,
    state: "open",
    created_at_ms: opened.at_ms,
    deadline_ms: input.deadline_ms ?? null,
    replied_at_ms: null,
    settled_at_ms: null,
    voided_at_ms: null,
    expired_at_ms: null,
    superseded_at_ms: null,
    lineage: {
      supersedes: input.lineage?.supersedes,
      retry_of: input.lineage?.retry_of,
      cancelled_by: undefined,
    },
    superseded_by: null,
    settlement_evidence: null,
    pending_external_observations: [],
    mandatory: input.mandatory ?? false,
  };
}

/** Total, pure fold: journal order IS truth; events are trusted post-append (commands validate first). */
export function projectAll(events: ObligationEvent[]): Map<string, ReplyObligationRecord> {
  const records = new Map<string, ReplyObligationRecord>();
  for (const ev of events) {
    switch (ev.type) {
      case "obligation.opened":
        records.set(ev.obligation_id, emptyRecord(ev));
        break;
      case "obligation.request_sent": {
        const r = records.get(ev.obligation_id);
        if (r) r.request_ref = { ...r.request_ref, message_id: ev.message_id };
        break;
      }
      case "obligation.replied": {
        const r = records.get(ev.obligation_id);
        if (r && r.state === "open") {
          // A confirmed reply resolves any uncertain observations of this edge.
          r.pending_external_observations = [];
          r.state = "replied";
          r.replied_at_ms = ev.at_ms;
        }
        break;
      }
      case "obligation.settled": {
        const r = records.get(ev.obligation_id);
        if (r && r.state === "replied") {
          r.state = "settled";
          r.settled_at_ms = ev.at_ms;
          r.settlement_evidence = ev.settlement_evidence;
        }
        break;
      }
      case "obligation.voided": {
        const r = records.get(ev.obligation_id);
        if (r && (r.state === "open" || r.state === "replied")) {
          r.state = "voided";
          r.voided_at_ms = ev.at_ms;
          r.lineage = { ...r.lineage, cancelled_by: ev.cancelled_by };
        }
        break;
      }
      case "obligation.expired": {
        const r = records.get(ev.obligation_id);
        if (r && r.state === "open") {
          r.state = "expired";
          r.expired_at_ms = ev.at_ms;
        }
        break;
      }
      case "obligation.superseded": {
        const r = records.get(ev.obligation_id);
        if (r && (r.state === "open" || r.state === "replied")) {
          r.state = "superseded";
          r.superseded_at_ms = ev.at_ms;
          r.superseded_by = ev.superseded_by;
        }
        break;
      }
      case "obligation.external_observed": {
        const r = records.get(ev.obligation_id);
        if (r && r.state === "open" && !r.pending_external_observations.includes(ev.external_ref)) {
          r.pending_external_observations = [...r.pending_external_observations, ev.external_ref];
        }
        break;
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface LedgerOptions {
  /** Injectable clock for determinism; defaults to Date.now. */
  now?: () => number;
}

export class ObligationLedger {
  private records = new Map<string, ReplyObligationRecord>();

  constructor(
    /** Public-read so FINALIZE-phase settlement ops (xtrm-2mi) append through the same journal; appends remain single-writer per the stance in schemas.ts. */
    readonly journal: ObligationJournal,
    private readonly opts: LedgerOptions = {},
  ) {}

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Reload projection from persisted events. Idempotent; call once at startup. */
  async load(): Promise<this> {
    this.records = projectAll(await this.journal.readAll());
    return this;
  }

  private async append(event: ObligationEvent): Promise<void> {
    ObligationEventSchema.parse(event); // host-side guard: journal only ever holds valid events
    await this.journal.append(event);
    this.records = projectAll(await this.journal.readAll()); // re-fold: single source of truth
  }

  private getOrThrow(id: string): ReplyObligationRecord {
    const rec = this.records.get(id);
    if (!rec) throw new ObligationError("unknown_obligation", `no obligation "${id}" in ledger`);
    return rec;
  }

  /**
   * Write-ahead registration: the obligation exists durably BEFORE any send.
   * Re-registering the same idempotency_key returns the existing record
   * unchanged (completed idempotency key returns durable result, R2.6).
   */
  async registerRequest(input: RegisterInput): Promise<ReplyObligationRecord> {
    const id = `obl:${input.idempotency_key}`;
    const existing = this.records.get(id);
    if (existing) return existing;
    await this.append({ schema_version: REPLY_OBLIGATION_SCHEMA_VERSION, type: "obligation.opened", obligation_id: id, at_ms: this.nowMs(), input: input as unknown as Record<string, unknown> });
    return structuredClone(this.records.get(id)!);
  }

  /**
   * Ledger-first helper: registers the obligation, then returns a send-ready
   * draft with correlation_id injected, so callers cannot invert the order
   * accidentally. After the send resolves, call confirmRequestSent() to
   * complete request_ref (optional but recommended for forensics).
   */
  async withRequest<D>(
    draft: D,
    input: RegisterInput,
  ): Promise<{ draft: D & { correlation_id: string }; record: ReplyObligationRecord }> {
    const record = await this.registerRequest(input);
    return { draft: { ...draft, correlation_id: record.correlation_id }, record };
  }

  /** Complete request_ref after the send resolved. Purely additive forensics. */
  async confirmRequestSent(obligation_id: string, sent: { message_id: string; seq: number }): Promise<ReplyObligationRecord> {
    this.getOrThrow(obligation_id);
    await this.append({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.request_sent",
      obligation_id,
      at_ms: this.nowMs(),
      message_id: sent.message_id,
      seq: sent.seq,
    });
    return structuredClone(this.records.get(obligation_id)!);
  }

  /**
   * Atomic correlation: exactly ONE open obligation may absorb this reply.
   * Validates edge alive + direction + responder set; appends one replied
   * event. There is no window where a reply lands against a nonexistent or
   * already-consumed record — validation reads the same projection fold the
   * append re-derives (single-writer stance, schemas.ts docblock).
   */
  async recordReply(correlation_id: string, ref: ReplyRef): Promise<ReplyObligationRecord> {
    const rec = await this.resolveOpenByCorrelation(correlation_id, ref.channel_id);
    if (rec.expected_responders.length > 0 && !rec.expected_responders.includes(ref.responder)) {
      throw new ObligationError(
        "wrong_direction",
        `obligation ${rec.obligation_id} expects replies from [${rec.expected_responders.join(", ")}]; got "${ref.responder}"`,
      );
    }
    await this.append({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.replied",
      obligation_id: rec.obligation_id,
      at_ms: this.nowMs(),
      reply: { channel_id: ref.channel_id, message_id: ref.message_id, responder: ref.responder },
    });
    return structuredClone(this.records.get(rec.obligation_id)!);
  }

  /**
   * Shared correlation resolution: zero obligations with the id at all →
   * unknown_correlation; some exist but none OPEN → already_replied (edge
   * consumed exactly once, terminal states listed); several OPEN share the
   * correlation id → ambiguous_correlation refusal listing every candidate
   * (borrowed intercom ambiguity-refusal pattern: never guess).
   */
  private async resolveOpenByCorrelation(correlation_id: string, channel_id: string): Promise<ReplyObligationRecord> {
    const all = [...this.records.values()].filter((r) => r.correlation_id === correlation_id);
    if (all.length === 0) throw new ObligationError("unknown_correlation", `no obligation carries correlation_id "${correlation_id}"`);
    const channelMatched = all.filter((r) => r.request_ref.channel_id === channel_id);
    const pool = channelMatched.length > 0 ? channelMatched : [];
    if (pool.length === 0) {
      throw new ObligationError(
        "correlation_mismatch",
        `correlation "${correlation_id}" exists only on channels [${all.map((r) => r.request_ref.channel_id).join(", ")}], not "${channel_id}"`,
      );
    }
    const open = pool.filter((r) => r.state === "open");
    if (open.length > 1) {
      throw new ObligationError(
        "ambiguous_correlation",
        `${open.length} open obligations share correlation_id "${correlation_id}"; refusing to pick one`,
        open.map((r) => r.obligation_id),
      );
    }
    const found = open[0];
    if (!found) {
      throw new ObligationError(
        "already_replied",
        `no open obligation for correlation "${correlation_id}" (consumed or terminal)`,
        pool.map((r) => `${r.obligation_id}:${r.state}`),
      );
    }
    return found;
  }

  /** replied → settled with opaque settlement-evidence pointer (append-only receipt, R2.6). */
  async settle(obligation_id: string, settlement_evidence: string): Promise<ReplyObligationRecord> {
    const rec = this.getOrThrow(obligation_id);
    if (rec.state !== "replied") {
      throw new ObligationError("invalid_transition", `settle requires state "replied"; ${obligation_id} is "${rec.state}"`);
    }
    await this.append({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.settled",
      obligation_id,
      at_ms: this.nowMs(),
      settlement_evidence,
    });
    return structuredClone(this.records.get(obligation_id)!);
  }

  /**
   * Route ownership: supersede/cancel/retry are REQUESTER-only operations
   * (route-ownership check borrowed from intercom's lineage fields). Actor
   * must equal the original requester participant_id.
   */
  private assertOwner(rec: ReplyObligationRecord, actor: string): void {
    if (actor !== rec.requester) {
      throw new ObligationError("not_owner", `only requester "${rec.requester}" owns ${rec.obligation_id}; actor was "${actor}"`);
    }
  }

  /** Create successor (lineage.supersedes = old), then mark old superseded. Bookkeeping only. */
  async supersede(old_id: string, new_input: RegisterInput, actor: string): Promise<ReplyObligationRecord> {
    const rec = this.getOrThrow(old_id);
    this.assertOwner(rec, actor);
    if (rec.state !== "open" && rec.state !== "replied") {
      throw new ObligationError("invalid_transition", `supersede requires open|replied; ${old_id} is "${rec.state}"`);
    }
    const lineage: Lineage = { ...(new_input.lineage ?? {}), supersedes: old_id };
    const successor = await this.registerRequest({ ...new_input, lineage });
    await this.append({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.superseded",
      obligation_id: old_id,
      at_ms: this.nowMs(),
      superseded_by: successor.obligation_id,
    });
    return structuredClone(this.records.get(successor.obligation_id)!);
  }

  /** open|replied → voided with reason + cancelled_by lineage. Forensically queryable forever. */
  async cancel(obligation_id: string, reason: string, actor: string): Promise<ReplyObligationRecord> {
    const rec = this.getOrThrow(obligation_id);
    this.assertOwner(rec, actor);
    if (rec.state !== "open" && rec.state !== "replied") {
      throw new ObligationError("invalid_transition", `cancel requires open|replied; ${obligation_id} is "${rec.state}"`);
    }
    await this.append({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.voided",
      obligation_id,
      at_ms: this.nowMs(),
      reason,
      cancelled_by: actor,
    });
    return structuredClone(this.records.get(obligation_id)!);
  }

  /**
   * New obligation with lineage.retry_of = old. Policy: if old is still
   * open|replied it becomes superseded; already-terminal old stays as-is.
   * NEVER redelivers: this writes obligation events only — sending the new
   * request is the caller's explicit act.
   */
  async retry(old_id: string, new_input: RegisterInput, actor: string): Promise<ReplyObligationRecord> {
    const rec = this.getOrThrow(old_id);
    this.assertOwner(rec, actor);
    const lineage: Lineage = { ...(new_input.lineage ?? {}), retry_of: old_id };
    const successor = await this.registerRequest({ ...new_input, lineage });
    if (rec.state === "open" || rec.state === "replied") {
      await this.append({
        schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
        type: "obligation.superseded",
        obligation_id: old_id,
        at_ms: this.nowMs(),
        superseded_by: successor.obligation_id,
      });
    }
    return structuredClone(this.records.get(successor.obligation_id)!);
  }

  /** open → expired past deadline (injected clock). Expired records stay queryable forever. */
  async expireOverdue(): Promise<string[]> {
    const now = this.nowMs();
    const expiredIds: string[] = [];
    for (const rec of this.records.values()) {
      if (rec.state === "open" && rec.deadline_ms !== null && rec.deadline_ms < now) {
        await this.append({ schema_version: REPLY_OBLIGATION_SCHEMA_VERSION, type: "obligation.expired", obligation_id: rec.obligation_id, at_ms: now });
        expiredIds.push(rec.obligation_id);
      }
    }
    return expiredIds;
  }

  /**
   * UNCERTAIN surface: an external transport observed a probable reply that
   * is NOT yet in this journal. Records the observation (uncertain-pending-
   * reconciliation) instead of guessing; state stays open until recordReply
   * or settleFromStream confirms against committed stream evidence.
   */
  async observeExternalReply(external_ref: string, correlation_id: string, channel_id: string): Promise<ReplyObligationRecord> {
    const rec = await this.resolveOpenByCorrelation(correlation_id, channel_id);
    await this.append({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.external_observed",
      obligation_id: rec.obligation_id,
      at_ms: this.nowMs(),
      external_ref,
    });
    return structuredClone(this.records.get(rec.obligation_id)!);
  }

  /**
   * Durability-meets-stream seam: scan committed messages (a channel tail,
   * newest-last per §5.1 ORDER BY id) for replies to tracked requests and
   * reconcile the ledger. Valid replies (responder in expected set, not the
   * request itself) consume their obligation via the same atomic path as
   * recordReply. Uncertain observations whose confirming message is absent
   * REMAIN uncertain — never silently resolved. Returns what happened so the
   * caller can audit both directions.
   */
  async settleFromStream(tail: Array<{ channel_id: string; message_id: string; author: { participant_id: string }; correlation_id?: string }>): Promise<{
    replied: Array<{ obligation_id: string; message_id: string }>;
    unresolved_uncertain: Array<{ obligation_id: string; external_refs: string[] }>;
  }> {
    const replied: Array<{ obligation_id: string; message_id: string }> = [];
    for (const msg of tail) {
      if (!msg.correlation_id) continue;
      const cands = [...this.records.values()].filter(
        (r) => r.state === "open" && r.correlation_id === msg.correlation_id && r.request_ref.channel_id === msg.channel_id,
      );
      const rec = cands[0];
      if (!rec || cands.length !== 1) continue; // zero = nothing to do; >1 stays ambiguous (refusal by omission)
      if (msg.author.participant_id === rec.requester) continue;
      if (rec.expected_responders.length > 0 && !rec.expected_responders.includes(msg.author.participant_id)) continue;
      if (rec.request_ref.message_id !== null && msg.message_id === rec.request_ref.message_id) continue;
      try {
        await this.recordReply(msg.correlation_id, { channel_id: msg.channel_id, message_id: msg.message_id, responder: msg.author.participant_id });
        replied.push({ obligation_id: rec.obligation_id, message_id: msg.message_id });
      } catch {
        // raced into terminal between snapshot and append: leave for next pass
      }
    }
    const unresolved_uncertain = [...this.records.values()]
      .filter((r) => r.pending_external_observations.length > 0)
      .map((r) => ({ obligation_id: r.obligation_id, external_refs: [...r.pending_external_observations] }));
    return { replied, unresolved_uncertain };
  }

  /**
   * Integration seam with channel-comm (xtrm-6yn): produce the handle shape
   * reply() accepts from a durable record. request_seq is 0 when the request
   * message has not been confirmed yet (seq is display-only per §5.1; reply()
   * does not depend on it).
   */
  static replyHandle(rec: ReplyObligationRecord) {
    return {
      request_id: rec.correlation_id,
      channel_id: rec.request_ref.channel_id,
      requested_by: rec.requester,
      expects: { reply_from: [...rec.expected_responders] },
      request_message_id: rec.request_ref.message_id ?? "",
      request_seq: 0,
    };
  }

  // -- queries ------------------------------------------------------------

  get(obligation_id: string): ReplyObligationRecord | undefined {
    const rec = this.records.get(obligation_id);
    return rec ? structuredClone(rec) : undefined;
  }

  listOpen(): ReplyObligationRecord[] {
    return [...this.records.values()].filter((r) => r.state === "open").map((r) => structuredClone(r));
  }

  list(filter?: { correlation_id?: string; state?: ObligationState }): ReplyObligationRecord[] {
    let out = [...this.records.values()];
    if (filter?.correlation_id) out = out.filter((r) => r.correlation_id === filter.correlation_id);
    if (filter?.state) out = out.filter((r) => r.state === filter.state);
    return out.sort((a, b) => a.obligation_id.localeCompare(b.obligation_id)).map((r) => structuredClone(r));
  }
}
