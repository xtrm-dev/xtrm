/**
 * FINALIZE enforcement contracts — `xtrm.finalize.v1`.
 *
 * Normative sources:
 *  - docs/runtime/prd/native-chain-runtime.md §3: "agent finished ≠ protocol
 *    completed"; R2.7 (uncertain blocks blind replay, reconciliation records
 *    resolving evidence); R3.13 (PREPARE/FINALIZE are runtime-owned phases).
 *  - src/obligation/ (xtrm-hzb): the durable ledger this check consumes.
 *  - bd memory comm-transport-evidence-reference-only-pinned: delivery has
 *    THREE distinct receipt points (transport-delivered / receiver-received /
 *    injected). Collapsing them makes finalize lie about delivery; rebound or
 *    lost deliveries therefore stay unresolved here.
 *
 * REPLIED-VS-SETTLED STANCE (documented decision): FINALIZE requires SETTLED,
 * not merely replied. A reply proves the responder spoke; settlement is the
 * runtime recording its resolving-evidence pointer (`settlement_evidence`,
 * R2.7) that the protocol obligation is discharged. Replied-but-unsettled is
 * an unresolved inbound obligation and blocks finalization.
 */

import { z } from "zod";

export const FINALIZE_SCHEMA_VERSION = "xtrm.finalize.v1" as const;

/** Distinct delivery receipt points (intercom three-receipt pattern). */
export const RECEIPT_POINTS = ["transport_delivered", "receiver_received", "injected"] as const;
export type ReceiptPoint = (typeof RECEIPT_POINTS)[number];

/** One observed receipt at one distinct point. Never merged across points. */
export const DeliveryReceiptSchema = z
  .object({
    point: z.enum(RECEIPT_POINTS),
    at_ms: z.number().int().nonnegative(),
    /** Opaque transport-level proof ref (message id, intent id, …). */
    ref: z.string().min(1),
  })
  .strict();
export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;

/**
 * Injectable receipt lookup keyed by obligation_id (the reply-edge owner).
 * Absent lookup ⇒ receipts unobtainable ⇒ `delivery_receipts: null` in the
 * verdict (never fabricated as present).
 */
export type ReceiptLookup = (obligation_id: string) => Promise<DeliveryReceipt[]>;

const OpaqueRef = z.string().min(1);

/** Per-obligation surface inside a non-clear verdict. */
export const FinalizeObligationRefSchema = z
  .object({
    obligation_id: OpaqueRef,
    state: z.enum(["open", "replied"]),
    /** created_at_ms (open) or replied_at_ms (replied); how long finalization has been blocked. */
    waited_since: z.number().int().nonnegative(),
    mandatory: z.boolean(),
    deadline_ms: z.number().int().nonnegative().nullable(),
    pending_external_observations: z.array(OpaqueRef),
    /**
     * Triple-awareness: per-point presence booleans from the injected lookup.
     * `null` = no receipt store injected (status unobtainable, NOT "delivered").
     */
    delivery_receipts: z
      .object({
        transport_delivered: z.boolean(),
        receiver_received: z.boolean(),
        injected: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const REASON_CODES = [
  "open_mandatory_inbound",
  "replied_not_settled",
  "pending_external_observation",
  "receipt_triple_incomplete",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const DOWNGRADE_CODES = ["non_mandatory_open_downgraded", "non_mandatory_replied_downgraded"] as const;
export type DowngradeCode = (typeof DOWNGRADE_CODES)[number];

/** Non-mandatory unresolved obligation: policy-downgraded, NEVER silently dropped. */
export const DowngradedObligationSchema = z
  .object({
    obligation_id: OpaqueRef,
    state: z.enum(["open", "replied"]),
    code: z.enum(DOWNGRADE_CODES),
  })
  .strict();

/** Verdict union: clear | blocked | uncertain. Uncertain IS blocked-with-flag (R2.7). */
export const FinalizeVerdictSchema = z.discriminatedUnion("verdict", [
  z
    .object({
      verdict: z.literal("clear"),
      downgraded: z.array(DowngradedObligationSchema),
    })
    .strict(),
  z
    .object({
      verdict: z.literal("blocked"),
      obligations: z.array(FinalizeObligationRefSchema).min(1),
      reason_codes: z.array(z.enum(REASON_CODES)).min(1),
      downgraded: z.array(DowngradedObligationSchema),
    })
    .strict(),
  z
    .object({
      verdict: z.literal("uncertain"),
      obligations: z.array(FinalizeObligationRefSchema).min(1),
      observations: z.array(z.object({ obligation_id: OpaqueRef, external_refs: z.array(OpaqueRef).min(1) }).strict()).min(1),
      reason_codes: z.array(z.enum(REASON_CODES)).min(1),
      downgraded: z.array(DowngradedObligationSchema),
    })
    .strict(),
]);
export type FinalizeVerdict = z.infer<typeof FinalizeVerdictSchema>;
export type ClearVerdict = Extract<FinalizeVerdict, { verdict: "clear" }>;

/** Resolving-evidence record for every settlement op (R2.7): append-only. */
export const SettlementEvidenceEntrySchema = z
  .object({
    schema_version: z.literal(FINALIZE_SCHEMA_VERSION),
    action: z.enum(["voided"]),
    obligation_id: OpaqueRef,
    actor_class: z.enum(["operator", "coordinator"]),
    reason: OpaqueRef,
    /** Pointer-first resolving evidence (channels.md evidence stance). */
    evidence_ref: OpaqueRef,
    at_ms: z.number().int().nonnegative(),
  })
  .strict();
export type SettlementEvidenceEntry = z.infer<typeof SettlementEvidenceEntrySchema>;

export interface SettlementEvidenceJournal {
  append(entry: SettlementEvidenceEntry): Promise<void>;
}
