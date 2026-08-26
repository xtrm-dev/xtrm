/**
 * ChannelCommunicationService — semantic contracts over an INJECTED store.
 *
 * Scope (bead xtrm-6yn): schemas, validation, host-enforced authority,
 * correlation handles, inbox/cursor semantics, pure functions.
 *
 * CURSOR MODEL DEVIATION (documented): cursors here are per-participant
 * per-channel SEQUENCE positions (`last_read_seq` / `last_ack_seq`).
 * channels.md §5.1 makes the table-wide autoincrement `channel_messages.id`
 * the sole DELIVERY cursor and demotes `seq` to a per-channel DISPLAY ordinal
 * (`sp tail` readability only); real id allocation belongs to the store.
 * This layer models cursors as seq because it owns no storage and its injected
 * store interface is keyed by `(channel_id, seq)`; any production store must
 * translate to §5.1 id-based cursors at this seam.
 *
 * Explicit seams for later beads:
 *  - xtrm-hzb (obligation ledger/state machine): request() emits a
 *    RequestIntent VALUE and persists nothing about obligations. It does not
 *    track open/closed state; reply()'s double-reply check is a contract-level
 *    approximation (stream scan for an existing correlated reply).
 *    WRAP HONESTY: single-request/single-reply obligations wrap cleanly around
 *    these methods (handles are plain values, not service-held tokens), but
 *    multi-round or multi-replier obligation patterns do NOT flow through
 *    reply()'s single-consumption scan and need their own surface on the
 *    ledger side. Handle ISSUANCE and INTEGRITY are a mandatory xtrm-hzb
 *    responsibility: reply() trusts caller-supplied RequestIntent handles
 *    verbatim and performs no authenticity check of its own.
 *  - xtrm-sf3: no WAITING_ON_CHANNEL / scheduler wake here. Routing is hard,
 *    attention is soft, but nothing wakes anyone.
 *  - xtrm-2mi: FINALIZE enforcement absent by design.
 *  - No transport, no daemon, no IO of its own: the store interface below is
 *    the only effect boundary.
 */

import {
  CHANNEL_MESSAGE_SCHEMA_VERSION,
  KIND_AUTHORITY,
  normalizeDraft,
  StoredEnvelopeSchema,
  type EnvelopeDraft,
  type MessageKind,
  type ParticipantClass,
  type StoredEnvelope,
  type ValidationProblem,
  type ViewerClass,
} from "./schemas.ts";

export * from "./schemas.ts";

// ---------------------------------------------------------------------------
// Errors — deterministic, typed. ChannelValidationError covers schema /
// authority / routing rejections; problem-list normalization lives in
// normalizeDraft() and is surfaced verbatim on the error.
// ---------------------------------------------------------------------------

export type ChannelErrorCode =
  | "validation_failed"
  | "authority_denied"
  | "invalid_audience"
  | "correlation_mismatch"
  | "reply_not_expected_from"
  | "already_replied"
  | "unknown_field";

export class ChannelCommError extends Error {
  readonly code: ChannelErrorCode;
  constructor(code: ChannelErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ChannelCommError";
    this.code = code;
  }
}

export class ChannelValidationError extends ChannelCommError {
  /** Deterministic, ordered NormalizationError-style problem list. */
  readonly problems: ValidationProblem[];
  constructor(problems: ValidationProblem[], code: ChannelErrorCode = "validation_failed") {
    const detail = problems.map((p) => `${p.path}: ${p.message}`).join("; ");
    super(code, `${problems.length} validation problem(s): ${detail}`);
    this.name = "ChannelValidationError";
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------
// Rejection audit-twin (channels.md §10.1 outcome classes: validation-reject /
// authority-reject both write one runtime.message_rejected FACT for post-mortem
// replay). Best-effort: never masks the original ChannelValidationError, and a
// failing audit write still surfaces the original error.
// ---------------------------------------------------------------------------

/** Deterministic key-order-independent JSON stringify (for offender digests). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** FNV-1a 32-bit hex digest — deterministic across processes/runtimes. */
function stableDigest(v: unknown): string {
  const s = stableStringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function extractChannelId(rawDraft: unknown): string | null {
  if (typeof rawDraft !== "object" || rawDraft === null || Array.isArray(rawDraft)) return null;
  const cid = (rawDraft as Record<string, unknown>).channel_id;
  return typeof cid === "string" && cid.length > 0 ? cid : null;
}

// ---------------------------------------------------------------------------
// Injected store — the ONLY effect boundary of this module.
// ---------------------------------------------------------------------------

/** Read vs ack cursors are independent values; neither implies the other. */
export interface ParticipantCursors {
  last_read_seq: number;
  last_ack_seq: number;
}

export interface ChannelCommStore {
  append(envelope: StoredEnvelope): Promise<void>;
  readChannel(filter?: { channel_id?: string }): Promise<StoredEnvelope[]>;
  findByIdempotencyKey(idempotency_key: string): Promise<StoredEnvelope | null>;
  getCursors(participant_id: string): Promise<ParticipantCursors>;
  setCursors(participant_id: string, cursors: ParticipantCursors): Promise<void>;
}

// ---------------------------------------------------------------------------
// Correlation handles (values — safe to persist by the obligation ledger).
// ---------------------------------------------------------------------------

export interface RequestIntent {
  request_id: string;
  channel_id: string;
  requested_by: string;
  /** Participant ids allowed to reply; empty = anyone visible may reply. */
  expects: { reply_from: string[] };
  request_message_id: string;
  request_seq: number;
}

export interface SendResult {
  message_id: string;
  seq: number;
}

export interface RequestResult extends SendResult {
  intent: RequestIntent;
}

export interface InboxItem extends StoredEnvelope {
  /** audience.action_targets contains the viewer (routing hard). */
  addressed: boolean;
  /** Chain-visible but NOT a target: awareness surface only (attention soft). */
  attention_only: boolean;
}

export interface Inbox {
  items: InboxItem[];
  cursors: ParticipantCursors;
}

// ---------------------------------------------------------------------------
// Visibility inclusion rule (channels.md ~line 208).
// ---------------------------------------------------------------------------

const COORDINATOR_CLASSES: readonly ViewerClass[] = ["coordinator", "runtime"];

export function canSee(
  viewer: { participant_id: string; viewer_class: ViewerClass },
  msg: StoredEnvelope,
): boolean {
  const targeted = msg.audience.action_targets.includes(viewer.participant_id);
  const isAuthor = msg.author.participant_id === viewer.participant_id;
  const isCoordinator = COORDINATOR_CLASSES.includes(viewer.viewer_class);
  switch (msg.audience.visibility) {
    case "private":
      return isAuthor || targeted || isCoordinator;
    case "targets":
      return targeted || isCoordinator;
    case "chain":
    case "node":
      // All authorized participants of the container; this layer has no
      // membership model, so authorized = any lane holding a valid viewer.
      return true;
    case "operator":
      return viewer.viewer_class === "operator" || isCoordinator;
    case "public_audit":
      return true;
  }
}

// ---------------------------------------------------------------------------
// Service — one instance per participant (authority lane, §11).
// ---------------------------------------------------------------------------

export interface ServiceOptions {
  /** Injectable clock for determinism; defaults to Date.now. */
  now?: () => number;
}

export class ChannelCommunicationService {
  constructor(
    /** HOST-INJECTED author identity. Never accepted from call args. */
    private readonly author: { participant_id: string; participant_class: ParticipantClass },
    private readonly store: ChannelCommStore,
    private readonly opts: ServiceOptions = {},
  ) {}

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private assertAuthority(kind: MessageKind): void {
    const allowed = KIND_AUTHORITY[kind];
    if (!allowed.includes(this.author.participant_class)) {
      throw new ChannelValidationError(
        [
          {
            code: "authority_denied",
            path: "kind",
            message: `participant_class "${this.author.participant_class}" may not emit "${kind}" (allowed: ${allowed.join(", ")})`,
          },
        ],
        "authority_denied",
      );
    }
  }

  /**
   * Idempotent, deterministic append. Same idempotency_key → the ORIGINAL
   * stored message ids are returned again; nothing is duplicated (store
   * contract enforced at this seam so every op inherits it).
   *
   * `seq` is allocated as max+1 within the channel and is a DISPLAY ordinal
   * only (channels.md §5.1): within-channel order reads naturally in `sp tail`
   * style projections, but delivery cursors and replay authority belong to the
   * underlying store (table-wide message id), never to this value.
   */
  private async commit(
    draft: EnvelopeDraft,
    correlationOverride?: string,
    authorOverride?: ChannelCommunicationService["author"],
  ): Promise<SendResult> {
    const existing = await this.store.findByIdempotencyKey(draft.idempotency_key);
    if (existing) {
      return { message_id: existing.message_id, seq: existing.seq };
    }
    const siblings = await this.store.readChannel({ channel_id: draft.channel_id });
    const seq = siblings.reduce((mx, m) => Math.max(mx, m.seq), 0) + 1;
    const envelope: StoredEnvelope = {
      schema_version: CHANNEL_MESSAGE_SCHEMA_VERSION,
      channel_id: draft.channel_id,
      message_id: `${draft.channel_id}#${seq}`,
      seq,
      author: { ...(authorOverride ?? this.author) },
      kind: draft.kind,
      body: draft.body,
      audience: draft.audience,
      refs: draft.refs,
      evidence_refs: draft.evidence_refs,
      correlation_id: correlationOverride ?? draft.correlation_id,
      idempotency_key: draft.idempotency_key,
      created_at_ms: this.nowMs(),
    };
    StoredEnvelopeSchema.parse(envelope); // host-side post-assembly guard
    await this.store.append(envelope);
    return { message_id: envelope.message_id, seq };
  }

  private static parseOrThrow(draft: unknown): EnvelopeDraft {
    const result = normalizeDraft(draft);
    if (!result.ok) throw new ChannelValidationError(result.problems);
    return result.value;
  }

  /**
   * Rejection audit-twin (§10.1): on any ChannelValidationError from
   * send/request/reply, best-effort append ONE `runtime.message_rejected`
   * fact authored by the RUNTIME lane (the audit boundary, independent of the
   * rejecting caller's class). Body carries stable problem codes plus a
   * digest of the rejected draft; the idempotency key derives from that
   * digest, so identical repeated attempts dedup to the single original fact.
   * NEVER masks the original error; a failed audit write is swallowed and the
   * original ChannelValidationError propagates.
   */
  private async emitRejectionAudit(rawDraft: unknown, error: ChannelValidationError): Promise<void> {
    try {
      const channelId = extractChannelId(rawDraft);
      if (!channelId) return; // no placement target → nothing to audit against
      const digest = stableDigest(rawDraft);
      await this.commit(
        {
          channel_id: channelId,
          kind: "runtime.message_rejected",
          body: {
            error_code: error.code,
            problem_codes: error.problems.map((p) => p.code),
            offender_digest: digest,
          },
          audience: { action_targets: [], visibility: "public_audit" },
          idempotency_key: `audit:${channelId}:${digest}`,
        },
        undefined,
        { participant_id: "runtime", participant_class: "runtime" },
      );
    } catch {
      // best-effort: the ORIGINAL rejection must win
    }
  }

  /** Validate schema + body + authority + audience, then append. */
  async send(draft: unknown): Promise<SendResult> {
    try {
      const value = ChannelCommunicationService.parseOrThrow(draft);
      this.assertAuthority(value.kind);
      return await this.commit(value);
    } catch (e) {
      if (e instanceof ChannelValidationError) await this.emitRejectionAudit(draft, e);
      throw e;
    }
  }

  /**
   * send() + correlation handle. Emits the RequestIntent as a VALUE for the
   * obligation layer (xtrm-hzb) — this method MUST NOT maintain obligation
   * state. The request message itself carries correlation_id = request_id.
   */
  async request(args: Omit<EnvelopeDraft, "correlation_id"> & { expects_reply_from?: string[] }): Promise<RequestResult> {
    const { expects_reply_from = [], ...rest } = args;
    try {
      // Single normalizeDraft pass: same path-qualified problem shape as send()
      // (body.* / audience.* paths), no double parsing of args.
      const checked = ChannelCommunicationService.parseOrThrow(rest);
      this.assertAuthority(checked.kind);
      const request_id = `req:${checked.idempotency_key}`;
      const committed = await this.commit(checked, request_id);
      return {
        ...committed,
        intent: {
          request_id,
          channel_id: checked.channel_id,
          requested_by: this.author.participant_id,
          expects: { reply_from: [...expects_reply_from] },
          request_message_id: committed.message_id,
          request_seq: committed.seq,
        },
      };
    } catch (e) {
      if (e instanceof ChannelValidationError) await this.emitRejectionAudit(rest, e);
      throw e;
    }
  }

  /**
   * Reply against a caller-supplied RequestIntent. Contract-level checks only:
   *  - draft.correlation_id must equal handle.request_id (mismatch → reject);
   *  - author lane must be in handle.expects.reply_from when non-empty;
   *  - double reply rejected: the stream already holds another message with
   *    this correlation_id besides the request itself. CHOICE DOCUMENTED:
   *    handles are consumed on first successful reply, enforced by stream
   *    scan — durable open/closed obligation state belongs to xtrm-hzb.
   */
  async reply(handle: RequestIntent, draft: unknown): Promise<SendResult> {
    try {
      return await this.replyInner(handle, draft);
    } catch (e) {
      if (e instanceof ChannelValidationError) await this.emitRejectionAudit(draft, e);
      throw e;
    }
  }

  private async replyInner(handle: RequestIntent, draft: unknown): Promise<SendResult> {
    const value = ChannelCommunicationService.parseOrThrow(draft);
    this.assertAuthority(value.kind);
    if (value.correlation_id !== handle.request_id) {
      throw new ChannelValidationError(
        [
          {
            code: "correlation_mismatch",
            path: "correlation_id",
            message: `reply correlation_id "${value.correlation_id}" does not match open request "${handle.request_id}"`,
          },
        ],
        "correlation_mismatch",
      );
    }
    if (handle.expects.reply_from.length > 0 && !handle.expects.reply_from.includes(this.author.participant_id)) {
      throw new ChannelValidationError(
        [
          {
            code: "reply_not_expected_from",
            path: "author",
            message: `request ${handle.request_id} expects replies from [${handle.expects.reply_from.join(", ")}]; lane is "${this.author.participant_id}"`,
          },
        ],
        "reply_not_expected_from",
      );
    }
    const stream = await this.store.readChannel({ channel_id: handle.channel_id });
    const priorReply = stream.some((m) => m.correlation_id === handle.request_id && m.message_id !== handle.request_message_id);
    if (priorReply) {
      throw new ChannelValidationError(
        [
          {
            code: "already_replied",
            path: "correlation_id",
            message: `request ${handle.request_id} already replied (handle consumed); obligation ledger (xtrm-hzb) owns reopen semantics`,
          },
        ],
        "already_replied",
      );
    }
    if (value.channel_id !== handle.channel_id) {
      throw new ChannelValidationError(
        [{ code: "invalid_audience", path: "channel_id", message: `reply targets channel "${value.channel_id}" but request lives in "${handle.channel_id}"` }],
        "invalid_audience",
      );
    }
    return this.commit(value);
  }

  /** Shared addressed/attention classification (routing hard, attention soft). */
  private static classify(msg: StoredEnvelope, viewer_id: string): { addressed: boolean; attention_only: boolean } {
    const addressed = msg.audience.action_targets.includes(viewer_id);
    const attention_only =
      !addressed && msg.author.participant_id !== viewer_id && ["chain", "node", "public_audit"].includes(msg.audience.visibility);
    return { addressed, attention_only };
  }

  /** Pure observation: unread + visibility-filtered. NEVER mutates cursors. */
  async inbox(viewer: { participant_id: string; viewer_class: ViewerClass }, channel_id?: string): Promise<Inbox> {
    const cursors = await this.store.getCursors(viewer.participant_id);
    const stream = await this.store.readChannel(channel_id ? { channel_id } : undefined);
    const items: InboxItem[] = [];
    for (const msg of stream) {
      if (msg.seq <= cursors.last_read_seq) continue;
      if (!canSee(viewer, msg)) continue;
      const flags = ChannelCommunicationService.classify(msg, viewer.participant_id);
      items.push({ ...msg, ...flags });
    }
    return { items, cursors };
  }

  /** Ack-set query: visibility-filtered items past the ack cursor, regardless of read cursor. */
  async pendingAck(viewer: { participant_id: string; viewer_class: ViewerClass }, channel_id?: string): Promise<InboxItem[]> {
    const cursors = await this.store.getCursors(viewer.participant_id);
    const stream = await this.store.readChannel(channel_id ? { channel_id } : undefined);
    return stream
      .filter((m) => m.seq > cursors.last_ack_seq)
      .filter((m) => canSee(viewer, m))
      .map((msg) => ({ ...msg, ...ChannelCommunicationService.classify(msg, viewer.participant_id) }));
  }

  /** Advancing READ never touches ACK (read != ack, API-shape-enforced). */
  async advanceRead(participant_id: string, upToSeq: number): Promise<ParticipantCursors> {
    const cur = await this.store.getCursors(participant_id);
    const next: ParticipantCursors = { ...cur, last_read_seq: Math.max(cur.last_read_seq, upToSeq) };
    await this.store.setCursors(participant_id, next);
    return next;
  }

  /** Ack advances ONLY the ack cursor. */
  async ackUpTo(participant_id: string, upToSeq: number): Promise<ParticipantCursors> {
    const cur = await this.store.getCursors(participant_id);
    const next: ParticipantCursors = { ...cur, last_ack_seq: Math.max(cur.last_ack_seq, upToSeq) };
    await this.store.setCursors(participant_id, next);
    return next;
  }
}
