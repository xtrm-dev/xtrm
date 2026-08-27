/**
 * FINALIZE enforcement — runtime-owned phase gate (bead xtrm-2mi, R3.13).
 *
 * THE INVARIANT (PRD §3): agent finished ≠ protocol completed. This module is
 * the structural enforcement point: finalization can only execute THROUGH
 * finalizeGate(), and the gate refuses to run the runner unless
 * checkFinalization() returned `clear`. There is no API shape here that runs a
 * finalizer without a verdict.
 *
 * BINDING RULE: an obligation binds activation A iff A's participant is in
 * `expected_responders` AND the record is unresolved (state open | replied;
 * see schemas.ts for the replied-vs-settled stance). Terminal states
 * (settled/voided/expired/superseded) never bind. Empty expected_responders
 * means "any visible participant may reply" (hzb stance), so such records
 * bind every checked participant.
 *
 * MANDATORY POLICY: mandatory=true + unresolved ⇒ verdict blocked (or
 * uncertain). Non-mandatory unresolved obligations NEVER block, but are also
 * NEVER silently dropped — they appear under `downgraded[]` with explicit
 * codes on EVERY verdict kind, including clear.
 *
 * UNCERTAIN RULE (R2.7): pending_external_observations ⇒ verdict uncertain,
 * regardless of mandatory flag. Uncertain never auto-resolves; reconciliation
 * happens only through ledger.recordReply/settleFromStream writing events.
 *
 * RECEIPT TRIPLE (comm-transport-evidence-reference-only-pinned): for each
 * binding replied obligation the verdict reports per-point receipt presence
 * from the injected lookup. Missing/incomplete triple ⇒ reason code
 * receipt_triple_incomplete. Rebound or lost deliveries (no full triple)
 * therefore never present as cleanly delivered. Absent lookup ⇒ null
 * (unobtainable), which is NOT reported as delivered.
 *
 * SETTLEMENT OPS: voidObligation is operator/coordinator-class ONLY (class
 * check mirrors hzb assertOwner's ownership refusal). expireOverdue is NOT
 * duplicated — it already exists on ObligationLedger; call it there before
 * checking. Every settlement appends a resolving-evidence entry (R2.7).
 */

import {
  ObligationError,
  ObligationLedger,
  REPLY_OBLIGATION_SCHEMA_VERSION,
  type ObligationEvent,
  type ObligationJournal,
  type ReplyObligationRecord,
} from "../obligation/index.ts";
import {
  FINALIZE_SCHEMA_VERSION,
  FinalizeVerdictSchema,
  SettlementEvidenceEntrySchema,
  type DeliveryReceipt,
  type FinalizeVerdict,
  type ReceiptLookup,
  type ReasonCode,
  type SettlementEvidenceEntry,
  type SettlementEvidenceJournal,
} from "./schemas.ts";

export * from "./schemas.ts";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by finalizeGate when the verdict is not clear. Carries the verdict. */
export class BlockedFinalize extends Error {
  readonly verdict: Extract<FinalizeVerdict, { verdict: "blocked" | "uncertain" }>;
  constructor(verdict: Extract<FinalizeVerdict, { verdict: "blocked" | "uncertain" }>) {
    const ids = verdict.obligations.map((o) => o.obligation_id).join(", ");
    super(`[blocked_finalize] finalization refused while obligations unresolved (${verdict.verdict}): ${ids}`);
    this.name = "BlockedFinalize";
    this.verdict = verdict;
  }
}

export interface FinalizeCheckInput {
  /** Identity of the activation asking to finalize (PRD §2 identity rules). */
  activation_id: string;
  /** The checking activation's participant identity (descriptive rider per §2). */
  participant_id: string;
  /** Ledger projection records to check (caller re-derived them from the journal). */
  obligations: readonly ReplyObligationRecord[];
  /** Injected clock (deterministic tests); used only for deadline reporting context. */
  now_ms: number;
  /** Optional receipt store; absent ⇒ delivery_receipts null everywhere. */
  receipts?: ReceiptLookup;
}

function receiptsToTriple(receipts: DeliveryReceipt[]): { transport_delivered: boolean; receiver_received: boolean; injected: boolean } {
  const points = new Set(receipts.map((r) => r.point));
  return {
    transport_delivered: points.has("transport_delivered"),
    receiver_received: points.has("receiver_received"),
    injected: points.has("injected"),
  };
}

/**
 * Pure-ish check: reads only injected projections + optional injected receipt
 * store. Deterministic for identical inputs (obligations sorted by id, codes
 * in canonical order). Throws nothing for ordinary business states — caller
 * validation of record shapes happened at fold time.
 */
export async function checkFinalization(input: FinalizeCheckInput): Promise<FinalizeVerdict> {
  const binding = input.obligations
    .filter((r) => (r.state === "open" || r.state === "replied") && bindsParticipant(r, input.participant_id))
    .sort((a, b) => a.obligation_id.localeCompare(b.obligation_id));

  const downgraded = binding
    .filter((r) => !r.mandatory)
    .map((r) => ({
      obligation_id: r.obligation_id,
      state: r.state,
      code: r.state === "open" ? ("non_mandatory_open_downgraded" as const) : ("non_mandatory_replied_downgraded" as const),
    }));

  async function buildRefs(records: readonly ReplyObligationRecord[]) {
    return Promise.all(
      records.map(async (r) => ({
        obligation_id: r.obligation_id,
        state: r.state as "open" | "replied",
        waited_since: r.state === "replied" ? (r.replied_at_ms ?? r.created_at_ms) : r.created_at_ms,
        mandatory: r.mandatory,
        deadline_ms: r.deadline_ms,
        pending_external_observations: [...r.pending_external_observations],
        delivery_receipts:
          input.receipts && r.state === "replied" ? receiptsToTriple(await input.receipts(r.obligation_id)) : null,
      })),
    );
  }

  function deriveCodes(records: readonly ReplyObligationRecord[], refs: Awaited<ReturnType<typeof buildRefs>>): ReasonCode[] {
    const codes = new Set<ReasonCode>();
    for (const r of records) {
      if (r.pending_external_observations.length > 0) codes.add("pending_external_observation");
      if (r.state === "open") codes.add("open_mandatory_inbound");
      else codes.add("replied_not_settled");
      if (input.receipts && r.state === "replied") {
        const t = refs.find((x) => x.obligation_id === r.obligation_id)?.delivery_receipts;
        if (t && !(t.transport_delivered && t.receiver_received && t.injected)) codes.add("receipt_triple_incomplete");
      }
    }
    return [...codes].sort();
  }

  // UNCERTAIN RULE (R2.7), bead xtrm-2hn.2: uncertainty is a property of whether
  // an external effect happened, not of record priority — so it is classified
  // across ALL binding records (mandatory or not) BEFORE blocked/clear.
  const uncertainObs = binding
    .filter((r) => r.pending_external_observations.length > 0)
    .map((r) => ({ obligation_id: r.obligation_id, external_refs: [...r.pending_external_observations] }));

  if (uncertainObs.length > 0) {
    const refs = await buildRefs(binding);
    return FinalizeVerdictSchema.parse({ verdict: "uncertain", obligations: refs, observations: uncertainObs, reason_codes: deriveCodes(binding, refs), downgraded });
  }

  const blocking = binding.filter((r) => r.mandatory);
  if (blocking.length === 0) {
    return FinalizeVerdictSchema.parse({ verdict: "clear", downgraded });
  }

  const refs = await buildRefs(blocking);
  return FinalizeVerdictSchema.parse({ verdict: "blocked", obligations: refs, reason_codes: deriveCodes(blocking, refs), downgraded });
}

/** Binding rule: empty expected_responders = any visible participant (hzb stance). */
function bindsParticipant(rec: ReplyObligationRecord, participant_id: string): boolean {
  return rec.expected_responders.length === 0 || rec.expected_responders.includes(participant_id);
}

// ---------------------------------------------------------------------------
// Gate — the enforcement point
// ---------------------------------------------------------------------------

/**
 * The ONLY way this module exposes finalization execution. The runner cannot
 * run unless the check returned clear — the throw happens BEFORE the runner
 * function is even invoked, so a blocked finalizer has no side effects.
 */
export async function finalizeGate<T>(
  check: () => FinalizeVerdict | Promise<FinalizeVerdict>,
  run: () => T | Promise<T>,
): Promise<T> {
  const verdict = await check();
  if (verdict.verdict !== "clear") throw new BlockedFinalize(verdict);
  return run();
}

// ---------------------------------------------------------------------------
// Settlement ops
// ---------------------------------------------------------------------------

export interface FinalizeControllerOptions {
  /** Injectable clock for determinism; defaults to Date.now. */
  now?: () => number;
  /** Resolving-evidence journal (R2.7). Required for voidObligation. */
  evidence?: SettlementEvidenceJournal;
}

const VOID_ACTOR_CLASSES = ["operator", "coordinator"] as const;
export type VoidActorClass = (typeof VOID_ACTOR_CLASSES)[number];

/**
 * Runtime-owned FINALIZE-phase settlement controller over an existing ledger.
 * Reuses the ledger's journal and projection (expireOverdue lives THERE — no
 * duplication); adds class-authority voids + evidence recording.
 */
export class FinalizeController {
  constructor(
    private readonly ledger: ObligationLedger,
    private readonly opts: FinalizeControllerOptions = {},
  ) {}

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /**
   * open|replied → voided by OPERATOR or COORDINATOR class only (ownership
   * refusal mirrors hzb assertOwner). Precondition-first (xtrm-2hn.3): the
   * resolving-evidence sink and entry are resolved and validated BEFORE any
   * durable mutation, so precondition failures write ZERO events anywhere.
   * Appends the standard `obligation.voided` journal event through the
   * ledger's own journal, then re-folds, so the voided state survives reload
   * exactly like every other event. Records a resolving-evidence entry with
   * the caller's evidence_ref (R2.7).
   */
  async voidObligation(obligation_id: string, actor_class: VoidActorClass, reason: string, evidence_ref: string): Promise<ReplyObligationRecord> {
    if (!(VOID_ACTOR_CLASSES as readonly string[]).includes(actor_class)) {
      throw new ObligationError("not_owner", `voidObligation requires actor_class operator|coordinator; got "${actor_class}"`);
    }
    const rec = this.ledger.get(obligation_id);
    if (!rec) throw new ObligationError("unknown_obligation", `no obligation "${obligation_id}" in ledger`);
    if (rec.state !== "open" && rec.state !== "replied") {
      throw new ObligationError("invalid_transition", `void requires open|replied; ${obligation_id} is "${rec.state}"`);
    }
    // Preconditions BEFORE any durable write: sink configured + entry valid.
    const event: ObligationEvent = {
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.voided",
      obligation_id,
      at_ms: this.nowMs(),
      reason,
      cancelled_by: `${actor_class}:finalize`,
    };
    const entry: SettlementEvidenceEntry = {
      schema_version: FINALIZE_SCHEMA_VERSION,
      action: "voided",
      obligation_id,
      actor_class,
      reason,
      evidence_ref,
      at_ms: event.at_ms,
    };
    SettlementEvidenceEntrySchema.parse(entry);
    if (!this.opts.evidence) {
      throw new ObligationError("invalid_transition", "voidObligation requires an evidence journal (R2.7 resolving evidence)");
    }
    // TWO-JOURNAL PROTOCOL: evidence entry is precondition-validated first, then
    // the voided event lands durably, then the evidence append mirrors it. If the
    // crash window hits between those last two writes, recovery surfaces on reload
    // via reconcileOnLoad → reconciliation.voided_without_evidence (detection-only).
    await this.ledger.journal.append(event);
    await this.opts.evidence.append(entry);
    await this.ledger.load(); // re-fold from the journal: single source of truth
    const voided = this.ledger.get(obligation_id);
    if (!voided || voided.state !== "voided") {
      throw new ObligationError("invalid_transition", `void of ${obligation_id} did not land (projection shows ${voided?.state ?? "missing"})`);
    }
    return voided;
  }
}
