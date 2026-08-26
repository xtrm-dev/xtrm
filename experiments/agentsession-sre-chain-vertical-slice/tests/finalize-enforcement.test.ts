/**
 * FINALIZE enforcement tests (xtrm-2mi) — agent finished ≠ protocol completed.
 *
 * Covers: clear paths, blocked mandatory inbound, finalizeGate structural
 * enforcement, uncertain never silently resolves, mandatory flag backward
 * compatibility with legacy journals, voidObligation class authority +
 * resolving evidence, replied≠settled stance, receipt-triple awareness,
 * determinism byte-equality, durability across reload.
 */

import { describe, expect, test } from "bun:test";
import {
  canonicalEventLine,
  ObligationError,
  ObligationLedger,
  projectAll,
  stableStringify,
  type ObligationEvent,
  type ObligationJournal,
  type ReplyObligationRecord,
} from "../src/obligation/index.ts";
import {
  BlockedFinalize,
  checkFinalization,
  FinalizeController,
  FinalizeVerdictSchema,
  finalizeGate as finalizeGateChecked,
  type DeliveryReceipt,
  type SettlementEvidenceEntry,
} from "../src/finalize/index.ts";

const T0 = 1_700_000_000_000;
function tickClock() {
  let t = T0;
  return () => (t += 1_000);
}

function memJournal(): ObligationJournal & { lines: () => string[] } {
  const lines: string[] = [];
  return {
    async append(event) {
      lines.push(canonicalEventLine(event));
    },
    async readAll() {
      return lines.map((l) => JSON.parse(l) as ObligationEvent);
    },
    lines: () => [...lines],
  };
}

function memEvidence(): { journal: { append(e: SettlementEvidenceEntry): Promise<void> }; entries: SettlementEvidenceEntry[] } {
  const entries: SettlementEvidenceEntry[] = [];
  return { journal: { async append(e) { entries.push(e); } }, entries };
}

async function freshLedger(now = tickClock()) {
  const journal = memJournal();
  const ledger = await new ObligationLedger(journal, { now }).load();
  return { ledger, journal };
}

const RESPONDER = "p2";
const OTHER = "p9";
const baseInput = {
  channel_id: "chain:t1",
  requester: "coord-1",
  expected_responders: [RESPONDER],
};

async function openObligation(ledger: ObligationLedger, key: string, extra: Record<string, unknown> = {}) {
  await ledger.registerRequest({ ...baseInput, idempotency_key: key, ...extra });
  return ledger.get(`obl:${key}`)!;
}

async function repliedObligation(ledger: ObligationLedger, key: string, extra: Record<string, unknown> = {}) {
  await openObligation(ledger, key, extra);
  await ledger.recordReply(`req:${key}`, { channel_id: "chain:t1", message_id: `chain:t1#${key}`, responder: RESPONDER });
  return ledger.get(`obl:${key}`)!;
}

const CHECK_BASE = { activation_id: "act-1", participant_id: RESPONDER, now_ms: T0 + 60_000 };

describe("finalize check — clear paths", () => {
  test("no obligations at all → clear", async () => {
    const v = await checkFinalization({ ...CHECK_BASE, obligations: [] });
    expect(v.verdict).toBe("clear");
    expect(v.downgraded).toEqual([]);
  });

  test("all binding obligations settled → clear", async () => {
    const { ledger } = await freshLedger();
    await repliedObligation(ledger, "k1");
    await ledger.settle("obl:k1", "ev:settlement-1");
    // Terminal records stay in the projection; they must not bind.
    const obligations = [...(await allRecords(ledger)).values()];
    expect(obligations).toHaveLength(1);
    const v = await checkFinalization({ ...CHECK_BASE, obligations });
    expect(v.verdict).toBe("clear");
  });

  test("obligation for a different responder set does not bind this participant", async () => {
    const { ledger } = await freshLedger();
    const rec = await openObligation(ledger, "k-other", { expected_responders: [OTHER] });
    const v = await checkFinalization({ ...CHECK_BASE, obligations: [rec] });
    expect(v.verdict).toBe("clear");
  });
});

describe("finalize check — blocked + gate enforcement", () => {
  test("open mandatory inbound → blocked listing the obligation id", async () => {
    const { ledger } = await freshLedger();
    const rec = await openObligation(ledger, "k-mand", { mandatory: true });
    const v = await checkFinalization({ ...CHECK_BASE, obligations: [rec] });
    expect(v.verdict).toBe("blocked");
    if (v.verdict !== "blocked") return;
    expect(v.obligations.map((o) => o.obligation_id)).toEqual(["obl:k-mand"]);
    expect(v.reason_codes).toContain("open_mandatory_inbound");
    expect(v.obligations[0]?.waited_since).toBe(rec.created_at_ms);
  });

  test("agent cannot bypass via finalizeGate — BlockedFinalize thrown BEFORE runner executes", async () => {
    const { ledger } = await freshLedger();
    const rec = await openObligation(ledger, "k-gate", { mandatory: true });
    let runnerRan = false;
    const run = async () => {
      runnerRan = true;
      return "finalized";
    };
    await expect(
      finalizeGateChecked(() => checkFinalization({ ...CHECK_BASE, obligations: [rec] }), run),
    ).rejects.toBeInstanceOf(BlockedFinalize);
    expect(runnerRan).toBeFalse();

    // After settlement the same gate runs the runner.
    await ledger.recordReply("req:k-gate", { channel_id: "chain:t1", message_id: "chain:t1#g", responder: RESPONDER });
    await ledger.settle("obl:k-gate", "ev:g-settle");
    const settledRec = (await allRecords(ledger)).get("obl:k-gate")!;
    const out = await finalizeGateChecked(() => checkFinalization({ ...CHECK_BASE, obligations: [settledRec] }), run);
    expect(out).toBe("finalized");
    expect(runnerRan).toBeTrue();
  });

  test("BlockedFinalize carries the full verdict for coordinator surfaces", async () => {
    const { ledger } = await freshLedger();
    const rec = await openObligation(ledger, "k-bf", { mandatory: true });
    try {
      await finalizeGateChecked(() => checkFinalization({ ...CHECK_BASE, obligations: [rec] }), () => "never");
      throw new Error("gate should have blocked");
    } catch (e) {
      expect(e).toBeInstanceOf(BlockedFinalize);
      const bf = e as BlockedFinalize;
      expect(bf.verdict.verdict).toBe("blocked");
      expect(FinalizeVerdictSchema.safeParse(bf.verdict).success).toBeTrue();
    }
  });
});

describe("finalize check — uncertain never silently resolves (R2.7)", () => {
  test("pending_external_observations → uncertain verdict with observations", async () => {
    const { ledger } = await freshLedger();
    await openObligation(ledger, "k-ext", { mandatory: true });
    await ledger.observeExternalReply("ext-ref-1", "req:k-ext", "chain:t1");
    const rec = (await allRecords(ledger)).get("obl:k-ext")!;
    const v = await checkFinalization({ ...CHECK_BASE, obligations: [rec] });
    expect(v.verdict).toBe("uncertain");
    if (v.verdict !== "uncertain") return;
    expect(v.observations).toEqual([{ obligation_id: "obl:k-ext", external_refs: ["ext-ref-1"] }]);
    expect(v.reason_codes).toContain("pending_external_observation");
  });

  test("reconciliation via correlated reply clears uncertainty into blocked(replied), then settle → clear; every transition is journaled", async () => {
    const { ledger } = await freshLedger();
    await openObligation(ledger, "k-rec", { mandatory: true });
    await ledger.observeExternalReply("ext-ref-2", "req:k-rec", "chain:t1");
    const before = (await allRecords(ledger)).get("obl:k-rec")!;
    expect((await checkFinalization({ ...CHECK_BASE, obligations: [before] })).verdict).toBe("uncertain");

    // Reconciliation path: settleFromStream confirms against committed evidence.
    await ledger.settleFromStream([
      { channel_id: "chain:t1", message_id: "chain:t1#r2", author: { participant_id: RESPONDER }, correlation_id: "req:k-rec" },
    ]);
    const after = (await allRecords(ledger)).get("obl:k-rec")!;
    expect(after.pending_external_observations).toEqual([]);
    const blockedV = await checkFinalization({ ...CHECK_BASE, obligations: [after] });
    expect(blockedV.verdict).toBe("blocked"); // replied-but-unsettled still blocks

    await ledger.settle("obl:k-rec", "ev:rec-settle");
    const settledRec = (await allRecords(ledger)).get("obl:k-rec")!;
    expect((await checkFinalization({ ...CHECK_BASE, obligations: [settledRec] })).verdict).toBe("clear");
  });
});

describe("mandatory flag — legacy compatibility + downgrade policy", () => {
  test("legacy journal line WITHOUT mandatory field loads; projection defaults false", () => {
    const legacyOpened = {
      schema_version: "xtrm.reply-obligation.v1",
      type: "obligation.opened",
      obligation_id: "obl:legacy",
      at_ms: T0,
      input: {
        channel_id: "chain:old",
        requester: "coord-1",
        expected_responders: [RESPONDER],
        correlation_id: "req:legacy",
      },
    };
    // Raw legacy line parses through the CURRENT event schema.
    const events = [JSON.parse(JSON.stringify(legacyOpened)) as ObligationEvent];
    const records = projectAll(events);
    const rec = records.get("obl:legacy")!;
    expect(rec.mandatory).toBe(false);
    expect(rec.state).toBe("open");

    // And a full ledger reload of the legacy journal yields the identical record.
    const reloaded = projectAll(events);
    expect(stableStringify(reloaded.get("obl:legacy"))).toBe(stableStringify(rec));
  });

  test("mandatory=true blocks; non-mandatory unresolved downgraded and listed, never dropped — even on clear", async () => {
    const { ledger } = await freshLedger();
    const mand = await openObligation(ledger, "k-m", { mandatory: true });
    const nonMandOpen = await openObligation(ledger, "k-nm-open", {});
    const nonMandReplied = await repliedObligation(ledger, "k-nm-rep", {});

    const blockedV = await checkFinalization({
      ...CHECK_BASE,
      obligations: [mand, nonMandOpen, nonMandReplied],
    });
    expect(blockedV.verdict).toBe("blocked");
    if (blockedV.verdict !== "blocked") return;
    expect(blockedV.obligations.map((o) => o.obligation_id)).toEqual(["obl:k-m"]); // only mandatory blocks
    expect(blockedV.downgraded.map((d) => d.code).sort()).toEqual([
      "non_mandatory_open_downgraded",
      "non_mandatory_replied_downgraded",
    ]);

    // Resolve the mandatory one: verdict flips to clear but the downgrades remain LISTED.
    await ledger.recordReply("req:k-m", { channel_id: "chain:t1", message_id: "chain:t1#m", responder: RESPONDER });
    await ledger.settle("obl:k-m", "ev:m-settle");
    const records = await allRecords(ledger);
    const clearV = await checkFinalization({ ...CHECK_BASE, obligations: [...records.values()] });
    expect(clearV.verdict).toBe("clear");
    expect(clearV.downgraded).toHaveLength(2);
    expect(clearV.downgraded.map((d) => d.obligation_id).sort()).toEqual(["obl:k-nm-open", "obl:k-nm-rep"]);
  });
});

describe("voidObligation — class authority + resolving evidence (R2.7)", () => {
  test("coordinator and operator may void; evidence entry recorded; state survives reload", async () => {
    for (const actor_class of ["coordinator", "operator"] as const) {
      const { ledger, journal } = await freshLedger();
      const evidence = memEvidence();
      await openObligation(ledger, `k-v-${actor_class}`, { mandatory: true });
      const ctrl = new FinalizeController(ledger, { now: tickClock(), evidence: evidence.journal });
      const voided = await ctrl.voidObligation(`obl:k-v-${actor_class}`, actor_class, "operator abort", `ev:void-${actor_class}`);
      expect(voided.state).toBe("voided");
      // Resolving evidence ref recorded (R2.7).
      expect(evidence.entries).toHaveLength(1);
      expect(evidence.entries[0]).toMatchObject({
        action: "voided",
        obligation_id: `obl:k-v-${actor_class}`,
        actor_class,
        reason: "operator abort",
        evidence_ref: `ev:void-${actor_class}`,
      });
      // Reload from journal: voided persists (event-journal truth).
      const reloaded = await new ObligationLedger(journal, { now: tickClock() }).load();
      expect(reloaded.get(`obl:k-v-${actor_class}`)?.state).toBe("voided");
      // Post-void check no longer binds.
      const v = await checkFinalization({
        ...CHECK_BASE,
        obligations: [...(await allRecords(reloaded)).values()],
      });
      expect(v.verdict).toBe("clear");
    }
  });

  test("participant-class actor refused (ownership refusal mirrors hzb assertOwner)", async () => {
    const { ledger } = await freshLedger();
    const evidence = memEvidence();
    await openObligation(ledger, "k-nope", { mandatory: true });
    const ctrl = new FinalizeController(ledger, { now: tickClock(), evidence: evidence.journal });
    for (const bad of ["participant", "runtime", "reviewer-policy"] as const) {
      // @ts-expect-error deliberately invalid actor class
      await expect(ctrl.voidObligation("obl:k-nope", bad, "nope", "ev:x")).rejects.toMatchObject({ code: "not_owner" });
    }
    expect(evidence.entries).toHaveLength(0);
    expect(ledger.get("obl:k-nope")?.state).toBe("open");
  });
});

describe("reply ≠ settle stance", () => {
  test("replied-but-unsettled mandatory obligation BLOCKS finalization until settle records evidence", async () => {
    const { ledger } = await freshLedger();
    await repliedObligation(ledger, "k-rs", { mandatory: true });
    const rec = (await allRecords(ledger)).get("obl:k-rs")!;
    expect(rec.state).toBe("replied");

    const v = await checkFinalization({ ...CHECK_BASE, obligations: [rec] });
    expect(v.verdict).toBe("blocked");
    if (v.verdict !== "blocked") return;
    expect(v.reason_codes).toContain("replied_not_settled");
    expect(v.obligations[0]?.waited_since).toBe(rec.replied_at_ms ?? rec.created_at_ms);

    // Stance decision point: reply alone never yields clear.
    await ledger.settle("obl:k-rs", "ev:rs-settlement-proof");
    const settled = (await allRecords(ledger)).get("obl:k-rs")!;
    expect(settled.settlement_evidence).toBe("ev:rs-settlement-proof");
    expect((await checkFinalization({ ...CHECK_BASE, obligations: [settled] })).verdict).toBe("clear");
  });
});

describe("receipt-triple awareness", () => {
  function lookup(table: Record<string, DeliveryReceipt[]>): (id: string) => Promise<DeliveryReceipt[]> {
    return async (id) => table[id] ?? [];
  }

  test("full triple reported per-point; incomplete triple adds receipt_triple_incomplete; absent store ⇒ null", async () => {
    const { ledger } = await freshLedger();
    await repliedObligation(ledger, "k-full", { mandatory: true });
    await repliedObligation(ledger, "k-partial", { mandatory: true });
    await openObligation(ledger, "k-open", { mandatory: true });

    const receipts = lookup({
      "obl:k-full": [
        { point: "transport_delivered", at_ms: T0 + 1_000, ref: "t1" },
        { point: "receiver_received", at_ms: T0 + 2_000, ref: "t2" },
        { point: "injected", at_ms: T0 + 3_000, ref: "t3" },
      ],
      "obl:k-partial": [{ point: "transport_delivered", at_ms: T0 + 1_000, ref: "t4" }],
    });
    const records = await allRecords(ledger);
    const v = await checkFinalization({ ...CHECK_BASE, obligations: [...records.values()], receipts });
    expect(v.verdict).toBe("blocked");
    if (v.verdict !== "blocked") return;
    const byId = new Map(v.obligations.map((o) => [o.obligation_id, o]));
    expect(byId.get("obl:k-full")?.delivery_receipts).toEqual({
      transport_delivered: true,
      receiver_received: true,
      injected: true,
    });
    expect(byId.get("obl:k-partial")?.delivery_receipts).toEqual({
      transport_delivered: true,
      receiver_received: false,
      injected: false,
    });
    expect(byId.get("obl:k-open")?.delivery_receipts).toBeNull(); // open ⇒ no reply edge to look up
    expect(v.reason_codes).toContain("receipt_triple_incomplete");

    // Same input WITHOUT an injected store: unobtainable ≠ delivered.
    const v2 = await checkFinalization({ ...CHECK_BASE, obligations: [...records.values()] });
    if (v2.verdict !== "blocked") throw new Error("expected blocked");
    expect(v2.reason_codes).not.toContain("receipt_triple_incomplete");
    for (const o of v2.obligations) expect(o.delivery_receipts).toBeNull();
  });
});

describe("determinism + durability", () => {
  test("byte-equality: identical inputs produce byte-identical verdicts", async () => {
    const build = async () => {
      const { ledger } = await freshLedger();
      await openObligation(ledger, "a", { mandatory: true });
      await openObligation(ledger, "b", {});
      await repliedObligation(ledger, "c", { mandatory: true });
      return [...(await allRecords(ledger)).values()];
    };
    const obs = await build();
    const v1 = await checkFinalization({ ...CHECK_BASE, obligations: structuredClone(obs) });
    const v2 = await checkFinalization({ ...CHECK_BASE, obligations: structuredClone(obs) });
    expect(stableStringify(v1)).toBe(stableStringify(v2));
    // Also stable under reversed input order (sorting by obligation_id).
    const v3 = await checkFinalization({ ...CHECK_BASE, obligations: structuredClone([...obs].reverse()) });
    expect(stableStringify(v3)).toBe(stableStringify(v1));
  });

  test("durability: second ledger instance reloading the same journal produces identical verdicts", async () => {
    const { ledger, journal } = await freshLedger();
    await openObligation(ledger, "dur-a", { mandatory: true });
    await repliedObligation(ledger, "dur-b", { mandatory: true });
    const first = await checkFinalization({ ...CHECK_BASE, obligations: [...(await allRecords(ledger)).values()] });

    const reloaded = await new ObligationLedger(journal, { now: tickClock() }).load();
    const second = await checkFinalization({ ...CHECK_BASE, obligations: [...(await allRecords(reloaded)).values()] });
    expect(stableStringify(first)).toBe(stableStringify(second));
  });
});

// -- helpers ---------------------------------------------------------------

async function allRecords(ledger: ObligationLedger): Promise<Map<string, ReplyObligationRecord>> {
  // list() without filter returns every record sorted by id.
  const out = new Map();
  for (const rec of ledger.list()) out.set(rec.obligation_id, rec);
  return out;
}
