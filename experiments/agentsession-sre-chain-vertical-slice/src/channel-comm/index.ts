/**
 * ChannelCommunicationService — semantic contracts over an INJECTED store.
 *
 * Scope (bead xtrm-6yn): schemas, validation, host-enforced authority,
 * correlation handles, inbox/cursor semantics, pure functions.
 *
 * Explicit seams for later beads:
 *  - xtrm-hzb (obligation ledger/state machine): request() emits a
 *    RequestIntent VALUE and persists nothing about obligations. It does not
 *    track open/closed state; reply()'s double-reply check is a contract-level
 *    approximation (stream scan for an existing correlated reply). The ledger
 *    bead owns durable intent state and can wrap/replace reply() without an
 *    API break: handles are plain values, not service-held tokens.
 *  - xtrm-sf3: no WAITING_ON_CHANNEL / scheduler wake here. Routing is hard,
 *    attention is soft, but nothing wakes anyone.
 *  - xtrm-2mi: FINALIZE enforcement absent by design.
 *  - No transport, no daemon, no IO of its own: the store interface below is
 *    the only effect boundary.
 */

import {
  BODY_SCHEMAS,
  CHANNEL_MESSAGE_SCHEMA_VERSION,
  EnvelopeDraftSchema,
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
   */
  private async commit(draft: EnvelopeDraft, correlationOverride?: string): Promise<SendResult> {
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
      author: { ...this.author },
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

  /** Validate schema + body + authority + audience, then append. */
  async send(draft: unknown): Promise<SendResult> {
    const value = ChannelCommunicationService.parseOrThrow(draft);
    this.assertAuthority(value.kind);
    return this.commit(value);
  }

  /**
   * send() + correlation handle. Emits the RequestIntent as a VALUE for the
   * obligation layer (xtrm-hzb) — this method MUST NOT maintain obligation
   * state. The request message itself carries correlation_id = request_id.
   */
  async request(args: Omit<EnvelopeDraft, "correlation_id"> & { expects_reply_from?: string[] }): Promise<RequestResult> {
    const { expects_reply_from = [], ...rest } = args;
    const parsed = EnvelopeDraftSchema.safeParse(rest);
    if (!parsed.success) throw new ChannelValidationError([{ code: "validation_failed", path: "request", message: parsed.error.issues.map((i) => i.message).join("; ") }]);
    this.assertAuthority(parsed.data.kind);
    // Body validation + forbidden-key scan via normalizeDraft on the full draft.
    const checked = ChannelCommunicationService.parseOrThrow(parsed.data);
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

  /** Pure observation: unread + visibility-filtered. NEVER mutates cursors. */
  async inbox(viewer: { participant_id: string; viewer_class: ViewerClass }, channel_id?: string): Promise<Inbox> {
    const cursors = await this.store.getCursors(viewer.participant_id);
    const stream = await this.store.readChannel(channel_id ? { channel_id } : undefined);
    const items: InboxItem[] = [];
    for (const msg of stream) {
      if (msg.seq <= cursors.last_read_seq) continue;
      if (!canSee(viewer, msg)) continue;
      const addressed = msg.audience.action_targets.includes(viewer.participant_id);
      const attentionOnly =
        !addressed &&
        msg.author.participant_id !== viewer.participant_id &&
        ["chain", "node", "public_audit"].includes(msg.audience.visibility);
      items.push({ ...msg, addressed, attention_only: attentionOnly });
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
      .map((msg) => ({
        ...msg,
        addressed: msg.audience.action_targets.includes(viewer.participant_id),
        attention_only: false,
      }));
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
