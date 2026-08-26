/**
 * Runtime-owned WAITING_ON_CHANNEL state contracts — `xtrm.waiting-state.v1`.
 *
 * Normative sources:
 *  - docs/runtime/prd/native-chain-runtime.md §3 R2.8 (scheduler intents exact
 *    and idempotent; reducer from persisted evidence only), R5.18–R5.19
 *    (scheduler indirection, single-scheduler invariant, no direct resume
 *    bypass).
 *  - docs/channels/channels.md ~line 253 (`emitResumeIntent` writes a
 *    scheduler INTENT, never direct enqueue; no direct wake path), §10 outcome
 *    classes, §5.1 cursors.
 *  - src/obligation/ (xtrm-hzb): this layer sits ON the ledger. An activation
 *    blocks while obligations it awaits are open; the runtime resumes it when
 *    correlated replies land.
 *
 * IDENTITY RULES (PRD §2): activation_id is the only identity here;
 * participant_id rides along as descriptive data. job/session ids NEVER
 * participate in identity — provider session ids as identity is a forbidden
 * anti-pattern.
 *
 * SINGLE-SCHEDULER INVARIANT: one activation is in EXACTLY ONE state at a time
 * (running | waiting_on_channel | resumed_pending_dispatch). There is no way
 * through this module for an activation to hold two concurrent waits.
 *
 * SCHEDULER INDIRECTION: this module emits SchedulerIntent records into an
 * injectable intent journal. It NEVER executes them — no enqueue, no tmux, no
 * provider call anywhere (R5.18). Consumption belongs to the scheduler /
 * node-supervisor seam (channels.md §11).
 *
 * NO channel_wait SURFACE (loud): there is deliberately NO public API here
 * that lets an agent block or poll on a channel. The ONLY agent-visible
 * surface is its own activation record state. Agents learn "a reply landed"
 * by being resumed, never by polling.
 */

import { z } from "zod";

export const WAITING_STATE_SCHEMA_VERSION = "xtrm.waiting-state.v1" as const;

/** Per-activation lifecycle state. Exactly one at a time per activation. */
export const ACTIVATION_STATES = ["running", "waiting_on_channel", "resumed_pending_dispatch"] as const;
export type ActivationRunState = (typeof ACTIVATION_STATES)[number];

/** Why the activation left waiting_on_channel. Expired ≠ failed (nothing destroyed). */
export const RESUME_REASONS = ["reply_received", "wait_expired"] as const;
export type ResumeReason = (typeof RESUME_REASONS)[number];

const OpaqueRef = z.string().min(1);

/**
 * Projected per-activation record. Only ever re-derived from events.
 * `job_id` / `pi_session_id` intentionally absent — see identity rules above.
 */
export const ActivationWaitRecordSchema = z
  .object({
    activation_id: OpaqueRef,
    /** Descriptive only; never an identity key in this layer. */
    participant_id: OpaqueRef,
    state: z.enum(ACTIVATION_STATES),
    waiting_reason: z
      .object({ obligation_ids: z.array(OpaqueRef), since: z.number().int().nonnegative() })
      .strict()
      .nullable(),
    deadline_ms: z.number().int().nonnegative().nullable(),
    resumed_at_ms: z.number().int().nonnegative().nullable(),
    resume_reason: z.enum(RESUME_REASONS).nullable(),
  })
  .strict();
export type ActivationWaitRecord = z.infer<typeof ActivationWaitRecordSchema>;

/**
 * Scheduler intent — EXACT + IDEMPOTENT (R2.8). `intent_id` is deterministic
 * from (activation_id, obligation_id, trigger ref), so replays of the same
 * triggering evidence produce the SAME id and are deduped at journal level.
 * Appended to the intent journal; never directly executed.
 */
export const SchedulerIntentSchema = z
  .object({
    schema_version: z.literal(WAITING_STATE_SCHEMA_VERSION),
    intent_id: OpaqueRef,
    action: z.literal("resume"),
    activation_id: OpaqueRef,
    obligation_id: OpaqueRef,
    /** What triggered the resume: reply message_id, or "wait_expired". */
    reason_ref: OpaqueRef,
    created_at_ms: z.number().int().nonnegative(),
  })
  .strict();
export type SchedulerIntent = z.infer<typeof SchedulerIntentSchema>;

// ---------------------------------------------------------------------------
// Event journal — the ONLY mutation shape for waiting state. Append-only;
// the fold below is total.
// ---------------------------------------------------------------------------

export const WaitingEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      schema_version: z.literal(WAITING_STATE_SCHEMA_VERSION),
      type: z.literal("waiting.entered"),
      activation_id: OpaqueRef,
      participant_id: OpaqueRef,
      obligation_ids: z.array(OpaqueRef).min(1),
      at_ms: z.number().int().nonnegative(),
      deadline_ms: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(WAITING_STATE_SCHEMA_VERSION),
      type: z.literal("waiting.resumed"),
      activation_id: OpaqueRef,
      at_ms: z.number().int().nonnegative(),
      reason: z.enum(RESUME_REASONS),
      obligation_id: OpaqueRef.nullable(),
      reply_message_id: OpaqueRef.nullable(),
    })
    .strict(),
]);
export type WaitingEvent = z.infer<typeof WaitingEventSchema>;

/** Pure, total fold: journal order IS truth (same stance as obligation/projectAll). */
export function projectWaits(events: WaitingEvent[]): Map<string, ActivationWaitRecord> {
  const records = new Map<string, ActivationWaitRecord>();
  for (const ev of events) {
    switch (ev.type) {
      case "waiting.entered":
        records.set(ev.activation_id, {
          activation_id: ev.activation_id,
          participant_id: ev.participant_id,
          state: "waiting_on_channel",
          waiting_reason: { obligation_ids: [...ev.obligation_ids], since: ev.at_ms },
          deadline_ms: ev.deadline_ms,
          resumed_at_ms: null,
          resume_reason: null,
        });
        break;
      case "waiting.resumed": {
        const r = records.get(ev.activation_id);
        if (r && r.state === "waiting_on_channel") {
          r.state = "resumed_pending_dispatch";
          r.resumed_at_ms = ev.at_ms;
          r.resume_reason = ev.reason;
        }
        break;
      }
    }
  }
  return records;
}

/** Wake-delivery classification phases (idle-vs-busy split, intercom pattern). */
export const ACTIVATION_PHASES = ["idle", "busy_interactive", "busy_noninteractive"] as const;
export type ActivationPhase = (typeof ACTIVATION_PHASES)[number];

/** PURE advisory output; this layer never injects anything anywhere. */
export const WAKE_DELIVERIES = ["new_turn", "steer", "decline_noninteractive"] as const;
export type WakeDelivery = (typeof WAKE_DELIVERIES)[number];
