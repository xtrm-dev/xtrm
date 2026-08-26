import { describe, expect, test } from "bun:test";
import {
  canonicalEventLine,
  ObligationError,
  ObligationEventSchema,
  ObligationLedger,
  projectAll,
  type ObligationEvent,
  type ObligationJournal,
} from "../src/obligation/index.ts";

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
});

/** Re-canonicalize an event through zod parse + canonical line: proves stored lines are canonical. */
function stableLine(ev: unknown): string {
  return canonicalEventLine(ObligationEventSchema.parse(ev));
}
