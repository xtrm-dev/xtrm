import { describe, expect, test } from "bun:test";
import {
  canonicalEventLine,
  ObligationError,
  ObligationEventSchema,
  ObligationInputError,
  ObligationLedger,
  projectAll,
  REPLY_OBLIGATION_SCHEMA_VERSION,
  type ObligationEvent,
  type ObligationJournal,
} from "../src/obligation/index.ts";
import { ChannelCommunicationService, type ChannelCommStore, type ParticipantCursors, type StoredEnvelope } from "../src/channel-comm/index.ts";
import { FinalizeController, type SettlementEvidenceEntry } from "../src/finalize/index.ts";

const T0 = 1_700_000_000_000;
/** Deterministic injected clock: each ledger op advances 1s. */
function tickClock() {
  let t = T0;
  return () => (t += 1_000);
}

/** In-memory JSONL-style journal implementing the persistence interface. */
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

const baseInput = {
  channel_id: "chain:t1",
  requester: "coord-1",
  expected_responders: ["p2"],
};

async function openedLedger(journal = memJournal(), now = tickClock()) {
  const ledger = await new ObligationLedger(journal, { now }).load();
  return { ledger, journal };
}

describe("obligation ledger — atomic request/reply correlation (xtrm-hzb)", () => {
  test("happy path: register → reply → settle, atomicity at both ends", async () => {
    const { ledger, journal } = await openedLedger();

    // Atomicity: a reply BEFORE registration is unknown-correlation rejection.
    expect(ledger.recordReply(`req:k1`, { channel_id: "chain:t1", message_id: "chain:t1#2", responder: "p2" })).rejects.toMatchObject({
      code: "unknown_correlation",
    });

    // withRequest: journal-first, draft comes back send-ready.
    const { draft, record } = await ledger.withRequest(
      { channel_id: "chain:t1", kind: "work.turn", body: {}, audience: { action_targets: ["p2"], visibility: "chain" }, idempotency_key: "k1" },
      { ...baseInput, idempotency_key: "k1" },
    );
    expect(draft.correlation_id).toBe("req:k1");
    // Register visible IMMEDIATELY after (no window).
    expect(ledger.get("obl:k1")?.state).toBe("open");
    expect(record.request_ref.message_id).toBeNull();

    await ledger.confirmRequestSent("obl:k1", { message_id: "chain:t1#1", seq: 1 });
    expect(ledger.get("obl:k1")?.request_ref.message_id).toBe("chain:t1#1");

    const replied = await ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "chain:t1#2", responder: "p2" });
    expect(replied.state).toBe("replied");
    expect(replied.replied_at_ms).toBeGreaterThan(T0);

    const settled = await ledger.settle("obl:k1", "evidence:settlement-1");
    expect(settled.state).toBe("settled");
    expect(settled.settlement_evidence).toBe("evidence:settlement-1");
    expect(journal.lines()).toHaveLength(4); // opened, request_sent, replied, settled
  });

  test("idempotent re-register returns original record unchanged", async () => {
    const { ledger } = await openedLedger();
    const r1 = await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    const r2 = await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    expect(r2).toEqual(r1);
  });

  test("durability: reload → identical projected state; expired-at-deadline honored across reload", async () => {
    let t = T0;
    const clock = () => (t += 1_000);
    const journal = memJournal();
    {
      const ledger = await new ObligationLedger(journal, { now: clock }).load();
      await ledger.registerRequest({ ...baseInput, idempotency_key: "live" });
      await ledger.registerRequest({ ...baseInput, idempotency_key: "doomed", deadline_ms: T0 + 5_000 });
      await ledger.registerRequest({ ...baseInput, idempotency_key: "answered" });
      await ledger.recordReply("req:answered", { channel_id: "chain:t1", message_id: "m-ans", responder: "p2" });
    }
    // Restart: NEW ledger instance over the SAME store; deadline already passed in wall time terms
    // because expireOverdue uses the injected clock — advance it past the deadline.
    t = T0 + 10_000;
    const ledger2 = await new ObligationLedger(journal, { now: clock }).load();
    expect(ledger2.get("obl:live")?.state).toBe("open"); // previously-open, unexpired → open again
    expect(ledger2.get("obl:answered")?.state).toBe("replied"); // terminal survives reload

    await ledger2.expireOverdue();
    expect(ledger2.get("obl:doomed")?.state).toBe("expired");
    expect(ledger2.get("obl:doomed")?.expired_at_ms).not.toBeNull();
    // Expired obligations stay queryable forever (forensic value).
    expect(ledger2.list({ state: "expired" }).map((r) => r.obligation_id)).toEqual(["obl:doomed"]);

    // Reload again: expired-at-deadline decision is durable too.
    const ledger3 = await new ObligationLedger(journal, { now: clock }).load();
    expect(ledger3.get("obl:doomed")?.state).toBe("expired");
    expect(ledger3.listOpen().map((r) => r.obligation_id)).toEqual(["obl:live"]);

    // Whole-projection reload equality: EVERY record (all states) is byte-identical
    // after restart — not just spot-checked ids.
    const projectionBeforeRestart = ledger2.list();
    const ledger4 = await new ObligationLedger(journal, { now: clock }).load();
    expect(ledger4.list()).toEqual(projectionBeforeRestart);
  });

  test("consumed-once: double reply rejected as typed error", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    await ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "m1", responder: "p2" });
    try {
      await ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "m2", responder: "p2" });
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(ObligationError);
      expect((e as ObligationError).code).toBe("already_replied");
      expect((e as ObligationError).candidates).toEqual(["obl:k1:replied"]);
    }
  });

  test("wrong-direction reply rejected", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" }); // expects p2 only
    await expect(
      ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "m1", responder: "p9" }),
    ).rejects.toMatchObject({ code: "wrong_direction" });
    // empty expected_responders = anyone may reply
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k2", expected_responders: [] });
    const rec = await ledger.recordReply("req:k2", { channel_id: "chain:t1", message_id: "m2", responder: "anyone" });
    expect(rec.state).toBe("replied");
  });

  test("ambiguous correlation refusal lists every open candidate", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "a", correlation_id: "req:shared" });
    await ledger.registerRequest({ ...baseInput, idempotency_key: "b", correlation_id: "req:shared" });
    try {
      await ledger.recordReply("req:shared", { channel_id: "chain:t1", message_id: "m1", responder: "p2" });
      throw new Error("expected rejection");
    } catch (e) {
      const err = e as ObligationError;
      expect(err.code).toBe("ambiguous_correlation");
      expect(err.candidates.sort()).toEqual(["obl:a", "obl:b"]);
    }
  });

  test("unknown correlation and channel mismatch are distinct rejections", async () => {
    const { ledger } = await openedLedger();
    await expect(
      ledger.recordReply("req:nope", { channel_id: "chain:t1", message_id: "m", responder: "p2" }),
    ).rejects.toMatchObject({ code: "unknown_correlation" });
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    await expect(
      ledger.recordReply("req:k1", { channel_id: "chain:other", message_id: "m", responder: "p2" }),
    ).rejects.toMatchObject({ code: "correlation_mismatch" });
  });

  test("lineage: supersede chain validation + ownership checks", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "v1" });

    // Ownership: only the requester may supersede.
    await expect(ledger.supersede("obl:v1", { ...baseInput, idempotency_key: "v2" }, "intruder")).rejects.toMatchObject({
      code: "not_owner",
    });

    const v2 = await ledger.supersede("obl:v1", { ...baseInput, idempotency_key: "v2" }, "coord-1");
    expect(v2.lineage.supersedes).toBe("obl:v1");
    expect(ledger.get("obl:v1")?.state).toBe("superseded");
    expect(ledger.get("obl:v1")?.superseded_by).toBe("obl:v2");

    // Chain: v3 supersedes v2.
    const v3 = await ledger.supersede("obl:v2", { ...baseInput, idempotency_key: "v3" }, "coord-1");
    expect(v3.lineage.supersedes).toBe("obl:v2");
    // Terminal old cannot be superseded again.
    await expect(ledger.supersede("obl:v1", { ...baseInput, idempotency_key: "vx" }, "coord-1")).rejects.toMatchObject({
      code: "invalid_transition",
    });
  });

  test("cancel: ownership + voided terminal with cancelled_by lineage", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    await expect(ledger.cancel("obl:k1", "changed mind", "p2")).rejects.toMatchObject({ code: "not_owner" });
    const rec = await ledger.cancel("obl:k1", "changed mind", "coord-1");
    expect(rec.state).toBe("voided");
    expect(rec.lineage.cancelled_by).toBe("coord-1");
    // Replies against cancelled edge are consumed-once refusals, not resurrections.
    await expect(ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "m", responder: "p2" })).rejects.toMatchObject({
      code: "already_replied",
    });
    await expect(ledger.cancel("obl:k1", "again", "coord-1")).rejects.toMatchObject({ code: "invalid_transition" });
  });

  test("retry: creates successor with retry_of lineage, old terminal, ZERO redelivery side effects", async () => {
    const { ledger, journal } = await openedLedger();
    const before = journal.lines().length;
    await ledger.registerRequest({ ...baseInput, idempotency_key: "old" });
    const retried = await ledger.retry("obl:old", { ...baseInput, idempotency_key: "new", channel_id: "chain:t1" }, "coord-1");
    expect(retried.lineage.retry_of).toBe("obl:old");
    expect(ledger.get("obl:old")?.state).toBe("superseded");
    // No redelivery: only obligation.opened + obligation.superseded events were written.
    const newLines = journal.lines().slice(before);
    expect(newLines.every((l) => l.includes('"type":"obligation.opened"') || l.includes('"type":"obligation.superseded"'))).toBe(true);
    // Retry on an already-terminal obligation still yields the successor, leaves old untouched.
    await ledger.cancel("obl:new", "noop", "coord-1");
    const r2 = await ledger.retry("obl:new", { ...baseInput, idempotency_key: "newer" }, "coord-1");
    expect(r2.lineage.retry_of).toBe("obl:new");
    expect(ledger.get("obl:new")?.state).toBe("voided"); // stays terminal per policy
  });

  test("uncertain: external observation marks uncertain-pending; reconciliation completes or keeps uncertain", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });

    const rec = await ledger.observeExternalReply("transport:evt-42", "req:k1", "chain:t1");
    expect(rec.state).toBe("open"); // NEVER guessed into replied
    expect(rec.pending_external_observations).toEqual(["transport:evt-42"]);

    // Stream WITHOUT the confirming message: observation remains uncertain (never silently resolved).
    let report = await ledger.settleFromStream([]);
    expect(report.replied).toHaveLength(0);
    expect(report.unresolved_uncertain.map((u) => u.obligation_id)).toEqual(["obl:k1"]);

    // Stream WITH the committed reply from an allowed responder: reconciles to replied.
    report = await ledger.settleFromStream([
      { channel_id: "chain:t1", message_id: "chain:t1#2", author: { participant_id: "p2" }, correlation_id: "req:k1" },
    ]);
    expect(report.replied).toEqual([{ obligation_id: "obl:k1", message_id: "chain:t1#2" }]);
    expect(ledger.get("obl:k1")?.state).toBe("replied");
    expect(ledger.get("obl:k1")?.pending_external_observations).toEqual([]);

    // Uncertain observations that never confirm stay open forever.
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k2" });
    await ledger.observeExternalReply("transport:evt-99", "req:k2", "chain:t1");
    report = await ledger.settleFromStream([]); // nothing ever arrives
    expect(ledger.get("obl:k2")?.state).toBe("open");
    expect(ledger.get("obl:k2")?.pending_external_observations).toEqual(["transport:evt-99"]);
    expect(report.unresolved_uncertain.map((u) => u.obligation_id)).toEqual(["obl:k2"]);
  });

  test("settleFromStream ignores requester-authored messages, non-responder replies, and the request itself", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    await ledger.confirmRequestSent("obl:k1", { message_id: "chain:t1#1", seq: 1 });
    let report = await ledger.settleFromStream([
      { channel_id: "chain:t1", message_id: "chain:t1#1", author: { participant_id: "coord-1" }, correlation_id: "req:k1" },
      { channel_id: "chain:t1", message_id: "chain:t1#2", author: { participant_id: "coord-1" }, correlation_id: "req:k1" },
      { channel_id: "chain:t1", message_id: "chain:t1#3", author: { participant_id: "p9" }, correlation_id: "req:k1" },
      { channel_id: "chain:t1", message_id: "chain:t1#4", author: { participant_id: "unrelated" }, correlation_id: "req:other" },
    ]);
    expect(report.replied).toHaveLength(0);
    expect(ledger.get("obl:k1")?.state).toBe("open");
    report = await ledger.settleFromStream([
      { channel_id: "chain:t1", message_id: "chain:t1#5", author: { participant_id: "p2" }, correlation_id: "req:k1" },
    ]);
    expect(report.replied).toHaveLength(1);
  });

  test("integration seam: ledgerBackedReplyHandle matches the channel-comm RequestIntent shape", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    await ledger.confirmRequestSent("obl:k1", { message_id: "chain:t1#1", seq: 7 });
    const handle = ObligationLedger.replyHandle(ledger.get("obl:k1")!);
    expect(handle).toEqual({
      request_id: "req:k1",
      channel_id: "chain:t1",
      requested_by: "coord-1",
      expects: { reply_from: ["p2"] },
      request_message_id: "chain:t1#1",
      request_seq: 0,
    });
    // Unconfirmed request: handle still well-formed for reply()'s contract checks.
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k2", expected_responders: [] });
    expect(ObligationLedger.replyHandle(ledger.get("obl:k2")!).request_message_id).toBe("");
  });

  test("determinism: same operations → byte-identical journal + identical projection", async () => {
    async function runOnce() {
      const journal = memJournal();
      const ledger = await new ObligationLedger(journal, { now: tickClock() }).load();
      await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
      await ledger.confirmRequestSent("obl:k1", { message_id: "chain:t1#1", seq: 1 });
      await ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "chain:t1#2", responder: "p2" });
      await ledger.settle("obl:k1", "ev:1");
      await ledger.registerRequest({ ...baseInput, idempotency_key: "k2", deadline_ms: T0 + 60_000 });
      await ledger.expireOverdue(); // not overdue yet → no-op
      return { lines: journal.lines(), projection: [...projectAll(await journal.readAll()).entries()] };
    }
    const a = await runOnce();
    const b = await runOnce();
    expect(a.lines).toEqual(b.lines);
    expect(a.projection).toEqual(b.projection);
    expect(a.lines.every((l) => l === stableLine(JSON.parse(l)))).toBe(true); // canonical form throughout
  });
  test("writer mutex: interleaved async callers cannot append duplicate contradictory events", async () => {
    const { ledger, journal } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });

    // Two replies racing on the same correlation: exactly ONE replied event may land.
    const race = await Promise.allSettled([
      ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "m1", responder: "p2" }),
      ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: "m2", responder: "p2" }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(journal.lines().filter((l) => l.includes('"type":"obligation.replied"'))).toHaveLength(1);

    // Concurrent registrations of DISTINCT keys all land complete and distinct.
    await Promise.all([
      ledger.registerRequest({ ...baseInput, idempotency_key: "a" }),
      ledger.registerRequest({ ...baseInput, idempotency_key: "b" }),
      ledger.registerRequest({ ...baseInput, idempotency_key: "c" }),
    ]);
    // Same key raced concurrently: idempotency holds under interleave — one opened event only.
    await Promise.all([
      ledger.registerRequest({ ...baseInput, idempotency_key: "d" }),
      ledger.registerRequest({ ...baseInput, idempotency_key: "d" }),
    ]);
    const events = await journal.readAll();
    expect(events.filter((e) => e.type === "obligation.opened").map((e) => e.obligation_id).sort()).toEqual([
      "obl:a", "obl:b", "obl:c", "obl:d", "obl:k1",
    ]);
    expect([...projectAll(events).keys()].sort()).toEqual(["obl:a", "obl:b", "obl:c", "obl:d", "obl:k1"]);
  });

  test("uncertain-replay gate: retry refuses unresolved observations until explicit reconcile-or-abandon", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "old" });
    await ledger.observeExternalReply("transport:e1", "req:old", "chain:t1");

    try {
      await ledger.retry("obl:old", { ...baseInput, idempotency_key: "new" }, "coord-1");
      throw new Error("expected rejection");
    } catch (e) {
      const err = e as ObligationError;
      expect(err.code).toBe("uncertain_pending");
      expect(err.candidates).toEqual(["transport:e1"]);
    }
    // Refusal wrote NOTHING: old stays open with its observation intact.
    expect(ledger.get("obl:old")?.state).toBe("open");
    expect(ledger.get("obl:old")?.pending_external_observations).toEqual(["transport:e1"]);

    // Explicit RECONCILE unlocks retry.
    await ledger.settleFromStream([
      { channel_id: "chain:t1", message_id: "chain:t1#2", author: { participant_id: "p2" }, correlation_id: "req:old" },
    ]);
    const succ = await ledger.retry("obl:old", { ...baseInput, idempotency_key: "new" }, "coord-1");
    expect(succ.lineage.retry_of).toBe("obl:old");
    expect(ledger.get("obl:old")?.state).toBe("superseded");
  });

  test("public API boundary rejects malformed inputs as typed ObligationInputError, never raw ZodError", async () => {
    const { ledger } = await openedLedger();

    // registerRequest: empty idempotency_key + missing required field → typed problems.
    for (const bad of [
      { ...baseInput, idempotency_key: "" },
      { idempotency_key: "x", channel_id: "chain:t1", requester: "coord-1" } as unknown as Record<string, unknown>,
      { ...baseInput, idempotency_key: "x", deadline_ms: -5 },
    ]) {
      try {
        await ledger.registerRequest(bad as never);
        throw new Error("expected rejection");
      } catch (e) {
        expect(e).toBeInstanceOf(ObligationInputError);
        expect((e as ObligationInputError).code).toBe("invalid_input");
        expect((e as ObligationInputError).problems.length).toBeGreaterThan(0);
        expect((e as Error).name).not.toBe("ZodError");
      }
    }

    // recordReply / confirmRequestSent / settle argument shapes parsed at the same boundary.
    await ledger.registerRequest({ ...baseInput, idempotency_key: "ok" });
    await expect(
      ledger.recordReply("req:ok", { channel_id: "chain:t1", message_id: "", responder: "p2" }),
    ).rejects.toBeInstanceOf(ObligationInputError);
    await expect(
      ledger.recordReply("", { channel_id: "chain:t1", message_id: "m", responder: "p2" }),
    ).rejects.toBeInstanceOf(ObligationInputError);
    await expect(ledger.confirmRequestSent("obl:ok", { message_id: "m", seq: -1 })).rejects.toBeInstanceOf(ObligationInputError);
    await expect(ledger.settle("obl:ok", "")).rejects.toBeInstanceOf(ObligationInputError);
    // Nothing above mutated the journal beyond the single valid registration.
    expect(ledger.list()).toHaveLength(1);
  });

  test("reconciliation-on-load: voided-without-evidence surfaced via injected predicate, history untouched", async () => {
    const journal = memJournal();
    const sv = REPLY_OBLIGATION_SCHEMA_VERSION;
    // Hand-crafted two-journal crash gap: obl:gap was voided in the ledger journal but its
    // evidence entry never landed; obl:ok has both sides.
    await journal.append({ schema_version: sv, type: "obligation.opened", obligation_id: "obl:gap", at_ms: T0, input: { ...baseInput, idempotency_key: "gap" } });
    await journal.append({ schema_version: sv, type: "obligation.voided", obligation_id: "obl:gap", at_ms: T0 + 1_000, reason: "crash-window", cancelled_by: "coord-1" });
    await journal.append({ schema_version: sv, type: "obligation.opened", obligation_id: "obl:ok", at_ms: T0 + 2_000, input: { ...baseInput, idempotency_key: "ok" } });
    await journal.append({ schema_version: sv, type: "obligation.voided", obligation_id: "obl:ok", at_ms: T0 + 3_000, reason: "clean", cancelled_by: "coord-1" });

    let evidenceIds = new Set(["obl:ok"]);
    const ledger = await new ObligationLedger(journal, { now: tickClock(), evidenceExists: async (id) => evidenceIds.has(id) }).load();
    // Gap DETECTED and reported with forensics; clean record absent.
    expect(ledger.reconciliation.voided_without_evidence).toEqual([
      { obligation_id: "obl:gap", voided_at_ms: T0 + 1_000, cancelled_by: "coord-1" },
    ]);
    // Detection ONLY: the record itself is NOT auto-mutated.
    expect(ledger.get("obl:gap")?.state).toBe("voided");

    // Once evidence exists, reload reports clean.
    evidenceIds = new Set(["obl:ok", "obl:gap"]);
    const relisted = await new ObligationLedger(journal, { now: tickClock(), evidenceExists: async (id) => evidenceIds.has(id) }).load();
    expect(relisted.reconciliation.voided_without_evidence).toEqual([]);

    // No predicate configured → no audit, empty report, no crash.
    const plain = await new ObligationLedger(journal, { now: tickClock() }).load();
    expect(plain.reconciliation.voided_without_evidence).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seam integration proof (xtrm-1o8): ledger replyHandle output drives
// ChannelCommunicationService.reply() end to end.
// ---------------------------------------------------------------------------

function fakeCommStore(): ChannelCommStore {
  const messages: StoredEnvelope[] = [];
  const cursors = new Map<string, ParticipantCursors>();
  return {
    async append(env) {
      messages.push(structuredClone(env));
    },
    async readChannel(filter) {
      return messages.filter((m) => !filter?.channel_id || m.channel_id === filter.channel_id).map((m) => structuredClone(m));
    },
    async findByIdempotencyKey(key) {
      const hit = messages.find((m) => m.idempotency_key === key);
      return hit ? structuredClone(hit) : null;
    },
    async getCursors(pid) {
      return cursors.get(pid) ?? { last_read_seq: 0, last_ack_seq: 0 };
    },
    async setCursors(pid, c) {
      cursors.set(pid, structuredClone(c));
    },
  };
}

describe("seam integration: ledger handle → ChannelCommunicationService.reply (xtrm-1o8)", () => {
  test("ordering contract: unconfirmed handle (request_message_id='') fails reply()'s stream-scan; confirm first, then reply passes", async () => {
    const NOW = 1_700_000_000_000;
    const store = fakeCommStore();
    const requester = new ChannelCommunicationService({ participant_id: "coord-1", participant_class: "coordinator" }, store, { now: () => NOW });
    const responder = new ChannelCommunicationService({ participant_id: "p2", participant_class: "participant" }, store, { now: () => NOW });
    const { ledger } = await openedLedger();

    // Ledger-first registration, THEN the real send through channel-comm.
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k1" });
    const req = await requester.request({
      channel_id: "chain:t1",
      kind: "work.turn",
      body: { summary: "please check", refs: { result_id: "r1" } },
      audience: { action_targets: ["p2"], visibility: "chain" },
      idempotency_key: "k1",
    });
    expect(req.intent.request_id).toBe("req:k1"); // default correlation aligns with the ledger's

    // ORDERING CONTRACT: replying against the UNCONFIRMED handle must NOT pass
    // reply()'s double-reply stream scan — with request_message_id="" the request
    // message itself ("chain:t1#1" !== "") counts as a prior correlated reply.
    const unconfirmedHandle = ObligationLedger.replyHandle(ledger.get("obl:k1")!);
    expect(unconfirmedHandle.request_message_id).toBe("");
    const ackDraft = {
      channel_id: "chain:t1",
      kind: "work.ack",
      body: { refs: [req.message_id], decision: "accept" },
      audience: { action_targets: ["coord-1"], visibility: "targets" as const },
      correlation_id: "req:k1",
    };
    await expect(responder.reply(unconfirmedHandle, { ...ackDraft, idempotency_key: "early" })).rejects.toMatchObject({
      code: "already_replied",
    });
    // The premature rejection wrote NOTHING consumable by the ledger.
    expect(ledger.get("obl:k1")?.state).toBe("open");

    // Confirm first: request_ref completed from the REAL send result…
    await ledger.confirmRequestSent("obl:k1", { message_id: req.message_id, seq: req.seq });
    // …and NOW the same-shaped reply passes the stream scan (request itself excluded)
    // and lands on the stream; the ledger then consumes it atomically.
    const out = await responder.reply(ObligationLedger.replyHandle(ledger.get("obl:k1")!), { ...ackDraft, idempotency_key: "proper" });
    const consumed = await ledger.recordReply("req:k1", { channel_id: "chain:t1", message_id: out.message_id, responder: "p2" });
    expect(consumed.state).toBe("replied");
    expect(consumed.request_ref.message_id).toBe(req.message_id);
  });

  test("ambiguous_correlation command surface: two open obligations sharing one correlation refuse recordReply outright", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "a", correlation_id: "req:shared" });
    await ledger.registerRequest({ ...baseInput, idempotency_key: "b", correlation_id: "req:shared" });
    try {
      await ledger.recordReply("req:shared", { channel_id: "chain:t1", message_id: "m1", responder: "p2" });
      throw new Error("expected rejection");
    } catch (e) {
      const err = e as ObligationError;
      expect(err.code).toBe("ambiguous_correlation");
      expect(err.candidates.sort()).toEqual(["obl:a", "obl:b"]);
    }
    // Neither candidate absorbed anything: both stay open, journal holds zero replied events.
    expect(ledger.get("obl:a")?.state).toBe("open");
    expect(ledger.get("obl:b")?.state).toBe("open");
  });
});

/** Re-canonicalize an event through zod parse + canonical line: proves stored lines are canonical. */
function stableLine(ev: unknown): string {
  return canonicalEventLine(ObligationEventSchema.parse(ev));
}

// ---------------------------------------------------------------------------
// Two-journal mutation safety for voidObligation (xtrm-2hn.3): the resolving-
// evidence sink is precondition-validated BEFORE any durable mutation.
// ---------------------------------------------------------------------------

function memEvidence(): { journal: { append(e: SettlementEvidenceEntry): Promise<void> }; entries: SettlementEvidenceEntry[] } {
  const entries: SettlementEvidenceEntry[] = [];
  return { journal: { async append(e) { entries.push(e); } }, entries };
}

async function voidable(ledger: ObligationLedger, key = "k1") {
  await ledger.registerRequest({ ...baseInput, idempotency_key: key });
  return new FinalizeController(ledger);
}

describe("voidObligation two-journal safety: precondition-before-mutation (xtrm-2hn.3)", () => {
  test("(a) no evidence journal configured => typed rejection, ZERO durable events written", async () => {
    const { ledger, journal } = await openedLedger();
    await voidable(ledger);
    const before = journal.lines().length;
    const projectionBefore = ledger.list();
    try {
      // Controller constructed WITHOUT opts.evidence.
      await new FinalizeController(ledger).voidObligation("obl:k1", "operator", "abort", "ev:x");
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(ObligationError);
      expect((e as ObligationError).code).toBe("invalid_transition");
    }
    expect(journal.lines()).toHaveLength(before); // nothing landed anywhere
    expect(await journal.readAll()).toHaveLength(before);
    expect(ledger.list()).toEqual(projectionBefore); // projection state unchanged
    expect(ledger.get("obl:k1")?.state).toBe("open");
  });

  test("(b) evidence-append failure AFTER the void event persisted => reload reports voided_without_evidence", async () => {
    const { ledger, journal } = await openedLedger();
    let ctrl = await voidable(ledger);
    // Sink present but appends fail (injected post-persist crash window).
    const failing = { async append(_e: SettlementEvidenceEntry): Promise<void> { throw new Error("disk full"); } };
    ctrl = new FinalizeController(ledger, { evidence: failing });
    await expect(ctrl.voidObligation("obl:k1", "operator", "abort", "ev:x")).rejects.toThrow("disk full");
    // The protocol's residual race: voided event IS durable, evidence is not.
    expect((await journal.readAll()).filter((ev) => ev.type === "obligation.voided")).toHaveLength(1);
    // Recovery protocol surfaces through reconciliation-on-load (detection-only).
    const reloaded = await new ObligationLedger(journal, { now: tickClock(), evidenceExists: async () => false }).load();
    expect(reloaded.reconciliation.voided_without_evidence).toEqual([
      { obligation_id: "obl:k1", voided_at_ms: reloaded.get("obl:k1")?.voided_at_ms, cancelled_by: "operator:finalize" },
    ]);
    expect(reloaded.get("obl:k1")?.state).toBe("voided"); // history never auto-mutated
  });

  test("(c) happy path: valid evidence journal records the resolving entry; clean reconciliation on reload", async () => {
    const { ledger, journal } = await openedLedger();
    const ctrl = await voidable(ledger);
    const evidence = memEvidence();
    const voided = await new FinalizeController(ledger, { now: tickClock(), evidence: evidence.journal })
      .voidObligation("obl:k1", "coordinator", "operator abort", "ev:void-1");
    expect(voided.state).toBe("voided");
    expect(evidence.entries).toHaveLength(1);
    expect(evidence.entries[0]).toMatchObject({ action: "voided", obligation_id: "obl:k1", actor_class: "coordinator", evidence_ref: "ev:void-1" });
    expect(journal.lines()).toContain(canonicalEventLine({
      schema_version: REPLY_OBLIGATION_SCHEMA_VERSION,
      type: "obligation.voided",
      obligation_id: "obl:k1",
      at_ms: voided.voided_at_ms!,
      reason: "operator abort",
      cancelled_by: "coordinator:finalize",
    }));
    // Clean pair on both journals => reload reconciles to an EMPTY report.
    const reloaded = await new ObligationLedger(journal, { now: tickClock(), evidenceExists: async () => true }).load();
    expect(reloaded.reconciliation.voided_without_evidence).toEqual([]);
  });

  test("(d) invalid evidence-entry payload blocks the journal write entirely", async () => {
    const { ledger, journal } = await openedLedger();
    await voidable(ledger);
    const evidence = memEvidence();
    const mounted = new FinalizeController(ledger, { now: tickClock(), evidence: evidence.journal });
    let threw = false;
    try {
      await mounted.voidObligation("obl:k1", "operator", "abort", ""); // evidence_ref fails OpaqueRef min(1)
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(evidence.entries).toHaveLength(0);
    expect(journal.lines().every((l) => !l.includes('"type":"obligation.voided"'))).toBe(true);
    expect(await journal.readAll()).toHaveLength(1); // only the registration event
    expect(ledger.get("obl:k1")?.state).toBe("open");
  });
});

describe("xtrm-1o8 re-review repairs", () => {
  test("S1: supersede refuses uncertain-pending obligations (same gate as retry)", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k-s1" });
    await ledger.observeExternalReply("ext-s1", "req:k-s1", "chain:t1");
    let msg = "";
    try {
      await ledger.supersede("obl:k-s1", { ...baseInput, idempotency_key: "k-s1b" }, "coord-1");
    } catch (e) {
      msg = String((e as Error).message ?? e);
    }
    expect(msg).toContain("uncertain_pending");
    // Nothing landed: old record untouched, still open.
    expect(ledger.get("obl:k-s1")?.state).toBe("open");
  });

  test("S2: settleFromStream rejects malformed tail entries with ObligationInputError", async () => {
    const { ledger } = await openedLedger();
    await ledger.registerRequest({ ...baseInput, idempotency_key: "k-s2" });
    let threw = "";
    try {
      await ledger.settleFromStream([{ channel_id: "", message_id: "m1", author: { participant_id: "p" } } as never]);
    } catch (e) {
      threw = (e as Error).constructor.name + ":" + String((e as Error).message ?? e);
    }
    expect(threw).toContain("ObligationInputError");
  });
});
