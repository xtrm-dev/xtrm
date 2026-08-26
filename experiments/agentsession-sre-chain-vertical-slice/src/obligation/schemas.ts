/**
 * Reply-obligation durable contracts — `xtrm.reply-obligation.v1`.
 *
 * Normative sources:
 *  - docs/runtime/prd/native-chain-runtime.md §3 R2.6–R2.10 (idempotency keys,
 *    completed/failed/UNCERTAIN tri-state, append-only receipts, reducer from
 *    persisted evidence).
 *  - docs/channels/channels.md §10 (outcome classes) and §5.1 cursor model
 *    (channel_messages.id is THE semantic cursor; seq is display-only).
 *  - src/channel-comm/ (xtrm-6yn): this layer builds ON the RequestIntent
 *    value contract; channel-comm's docblock assigns handle issuance,
 *    integrity, and durable open/closed obligation state to THIS bead.
 *
 * DURABILITY STANCE (the anti-pattern this file exists to kill — borrowed
 * evidence reference pi-intercom 0.12.0 keeps reply edges in memory and loses
 * them on restart, and persists forensic records it never reloads): the ledger
 * is an APPEND-ONLY EVENT JOURNAL plus a pure projection fold. Every mutation
 * is a journal event first; projected state is always re-derivable from the
 * journal alone. On reload, all previously-open obligations with unexpired
 * deadlines are open again. Expired/terminal records stay queryable forever
 * (forensic value).
 *
 * CONCURRENCY STANCE (honest): this layer is SINGLE-WRITER. Correctness comes
 * from validating each command against the projection derived from journal
 * order, then appending — there is no read-modify-write window because JS is
 * single-threaded and the fold is total. Concurrent writers to the same
 * journal are the persistence store's concern; a production store must either
 * serialize appends (single daemon transaction, like channels.next_seq) or
 * reject on optimistic version conflict. This module does not pretend to
 * solve multi-writer.
 *
 * RESPONDER SET CHOICE (documented per spec): `expected_responders` is an
 * explicit array; empty array means "any visible participant may reply"
 * (same semantics as channel-comm RequestIntent.expects.reply_from). Single
 * responder = one-element array; no separate scalar shape.
 */

import { z } from "zod";

export const REPLY_OBLIGATION_SCHEMA_VERSION = "xtrm.reply-obligation.v1" as const;

/** State machine: open → replied → settled; terminal: voided | expired | superseded. */
export const OBLIGATION_STATES = ["open", "replied", "settled", "voided", "expired", "superseded"] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

const OpaqueRef = z.string().min(1);

/**
 * Lineage fields (pi-intercom pattern, lineage-only): `supersedes` / `retry_of`
 * record WHY a successor exists; they NEVER trigger redelivery or auto-send.
 */
export const LineageSchema = z
  .object({
    supersedes: OpaqueRef.optional(),
    retry_of: OpaqueRef.optional(),
    cancelled_by: OpaqueRef.optional(),
  })
  .strict();
export type Lineage = z.infer<typeof LineageSchema>;

/** Projected record. Never mutated in place — only re-derived from events. */
export const ReplyObligationRecordSchema = z
  .object({
    schema_version: z.literal(REPLY_OBLIGATION_SCHEMA_VERSION),
    /** Deterministic: `obl:<idempotency_key>`. */
    obligation_id: OpaqueRef,
    request_ref: z
      .object({
        channel_id: OpaqueRef,
        /** Filled by request_sent event; null between registerRequest and confirmRequestSent. */
        message_id: OpaqueRef.nullable(),
        request_id: OpaqueRef,
      })
      .strict(),
    requester: OpaqueRef,
    expected_responders: z.array(OpaqueRef),
    correlation_id: OpaqueRef,
    state: z.enum(OBLIGATION_STATES),
    created_at_ms: z.number().int().nonnegative(),
    deadline_ms: z.number().int().nonnegative().nullable(),
    replied_at_ms: z.number().int().nonnegative().nullable(),
    settled_at_ms: z.number().int().nonnegative().nullable(),
    voided_at_ms: z.number().int().nonnegative().nullable(),
    expired_at_ms: z.number().int().nonnegative().nullable(),
    superseded_at_ms: z.number().int().nonnegative().nullable(),
    lineage: LineageSchema,
    superseded_by: OpaqueRef.nullable(),
    /** Opaque pointer to settlement proof (evidence pointer-first, channels.md). */
    settlement_evidence: OpaqueRef.nullable(),
    /**
     * UNCERTAIN surface (R2.7): non-empty while an external reply observation
     * awaits reconciliation against committed stream state. The record stays
     * open; uncertain never silently resolves.
     */
    pending_external_observations: z.array(OpaqueRef),
  })
  .strict();
export type ReplyObligationRecord = z.infer<typeof ReplyObligationRecordSchema>;

export interface RegisterInput {
  idempotency_key: string;
  channel_id: string;
  requester: string;
  /** Empty = anyone visible may reply (documented choice above). */
  expected_responders: string[];
  /** Optional absolute epoch ms; null/undefined = never expires HERE (FINALIZE bead decides later). */
  deadline_ms?: number | null;
  /** Overrides default `req:<idempotency_key>` (used by tests for ambiguity). */
  correlation_id?: string;
  lineage?: { supersedes?: string; retry_of?: string };
}

/** A committed reply observed on the stream (or handed in directly). */
export interface ReplyRef {
  channel_id: string;
  message_id: string;
  responder: string;
}

// ---------------------------------------------------------------------------
// Event journal — the ONLY write shape. Append-only; fold is total.
// ---------------------------------------------------------------------------

const EventBase = {
  schema_version: z.literal(REPLY_OBLIGATION_SCHEMA_VERSION),
  obligation_id: OpaqueRef,
  at_ms: z.number().int().nonnegative(),
};

export const ObligationEventSchema = z.discriminatedUnion("type", [
  z.object({ ...EventBase, type: z.literal("obligation.opened"), input: z.record(z.unknown()) }).strict(),
  z
    .object({ ...EventBase, type: z.literal("obligation.request_sent"), message_id: OpaqueRef, seq: z.number().int() })
    .strict(),
  z
    .object({
      ...EventBase,
      type: z.literal("obligation.replied"),
      reply: z.object({ channel_id: OpaqueRef, message_id: OpaqueRef, responder: OpaqueRef }).strict(),
    })
    .strict(),
  z.object({ ...EventBase, type: z.literal("obligation.settled"), settlement_evidence: OpaqueRef }).strict(),
  z.object({ ...EventBase, type: z.literal("obligation.voided"), reason: OpaqueRef, cancelled_by: OpaqueRef }).strict(),
  z.object({ ...EventBase, type: z.literal("obligation.expired") }).strict(),
  z.object({ ...EventBase, type: z.literal("obligation.superseded"), superseded_by: OpaqueRef }).strict(),
  z.object({ ...EventBase, type: z.literal("obligation.external_observed"), external_ref: OpaqueRef }).strict(),
]);
export type ObligationEvent = z.infer<typeof ObligationEventSchema>;
