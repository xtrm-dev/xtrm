import { describe, expect, test } from "bun:test";
import {
  canonicalEventLine,
  ObligationLedger,
  stableStringify as canonicalLine,
  type ObligationEvent,
  type ObligationJournal,
} from "../src/obligation/index.ts";
import {
  MAX_OBLIGATIONS_PER_WAIT,
  WaitingError,
  WaitingRegistry,
  expiryIntentId,
  resumeIntentId,
  type SchedulerIntent,
  type WaitingEvent,
  type WaitingJournal,
  type IntentJournal,
} from "../src/waiting/index.ts";

const T0 = 1_700_000_000_000;
function tickClock() {
  let t = T0;
  return () => (t += 1_000);
}

function memWaitJournal(): WaitingJournal & { lines: () => string[] } {
  const lines: string[] = [];
  return {
    async append(e: WaitingEvent) {
      lines.push(canonicalLine(e));
    },
    async readAll() {
      return lines.map((l) => JSON.parse(l) as WaitingEvent);
    },
    lines: () => [...lines],
  };
}

function memIntentJournal(): IntentJournal & { lines: () => string[] } {
  const lines: string[] = [];
  return {
    async append(i: SchedulerIntent) {
      lines.push(canonicalLine(i));
    },
    async readAll() {
      return lines.map((l) => JSON.parse(l) as SchedulerIntent);
    },
    lines: () => [...lines],
  };
}

function memOblJournal(): ObligationJournal & { lines: () => string[] } {
  const lines: string[] = [];
  return {
    async append(e: ObligationEvent) {
      lines.push(canonicalEventLine(e));
    },
    async readAll() {
      return lines.map((l) => JSON.parse(l) as ObligationEvent);
    },
    lines: () => [...lines],
  };
}

interface World {
  registry: WaitingRegistry;
  ledger: ObligationLedger;
  waitJ: ReturnType<typeof memWaitJournal>;
  intentJ: ReturnType<typeof memIntentJournal>;
}

/** Fresh world: obligation ledger + waiting registry on deterministic journals/clock. */
async function world(): Promise<World> {
  const now = tickClock();
  const oblJ = memOblJournal();
  const ledger = await new ObligationLedger(oblJ, { now }).load();
  const waitJ = memWaitJournal();
  const intentJ = memIntentJournal();
  const registry = await new WaitingRegistry(ledger, waitJ, intentJ, { now }).load();
  return { registry, ledger, waitJ, intentJ };
}

async function openObligation(w: World, key: string, requester: string, responders: string[]) {
  return w.ledger.registerRequest({
    idempotency_key: key,
    channel_id: "chain:t1",
    requester,
    expected_responders: responders,
  });
}

describe("waiting state + scheduler intents (xtrm-sf3)", () => {
  test("happy path: enterWaiting → reply recorded → exactly-one intent → resumed_pending_dispatch", async () => {
    const w = await world();
    await openObligation(w, "k1", "pA", ["pB"]);

    const rec = await w.registry.enterWaiting("act-1", "pA", ["obl:k1"]);
    expect(rec.state).toBe("waiting_on_channel");
    expect(rec.waiting_reason).toEqual({ obligation_ids: ["obl:k1"], since: expect.any(Number) });

    const outcomes = await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.emitted).toBe(true);
    expect(outcomes[0]!.intent_id).toBe(resumeIntentId("act-1", "obl:k1", "chain:t1#2"));
    expect(outcomes[0]!.reason).toBe("reply_received");

    const after = w.registry.get("act-1")!;
    expect(after.state).toBe("resumed_pending_dispatch");
    expect(after.resume_reason).toBe("reply_received");
    expect(after.waiting_reason?.obligation_ids).toEqual(["obl:k1"]); // reason preserved, not destroyed

    // Duplicate reply event: deduped at journal level, nothing re-emitted.
    const again = await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });
    expect(again).toHaveLength(0);
    expect(w.intentJ.lines()).toHaveLength(1);
  });

  test("validation: nonexistent / non-open / wrong-direction / self-target refusals", async () => {
    const w = await world();
    // nonexistent
    expect(w.registry.enterWaiting("act-1", "pA", ["obl:nope"])).rejects.toMatchObject({ code: "unknown_obligation" });
    // wrong direction: obligation requested by someone else
    await openObligation(w, "k1", "pX", ["pB"]);
    expect(w.registry.enterWaiting("act-1", "pA", ["obl:k1"])).rejects.toMatchObject({ code: "wrong_direction" });
    // non-open: replied obligation can no longer be waited on
    await openObligation(w, "k2", "pA", ["pB"]);
    await w.ledger.recordReply("req:k2", { channel_id: "chain:t1", message_id: "chain:t1#9", responder: "pB" });
    expect(w.registry.enterWaiting("act-1", "pA", ["obl:k2"])).rejects.toMatchObject({ code: "invalid_transition" });
    // self-target: waiter lists itself as expected responder of its own request
    await openObligation(w, "k3", "pA", ["pA"]);
    expect(w.registry.enterWaiting("act-1", "pA", ["obl:k3"])).rejects.toMatchObject({ code: "self_target" });
    // empty wait list
    expect(w.registry.enterWaiting("act-1", "pA", [])).rejects.toMatchObject({ code: "empty_wait" });
    // single-scheduler invariant: cannot double-enter while already waiting
    await openObligation(w, "k4", "pA", ["pB"]);
    await w.registry.enterWaiting("act-2", "pA", ["obl:k4"]);
    expect(w.registry.enterWaiting("act-2", "pA", ["obl:k4"])).rejects.toMatchObject({ code: "invalid_transition" });
  });

  test("cycle detection: mutual wait (E_MUTUAL_WAIT) and 3-cycle refused", async () => {
    const w = await world();
    // Mutual: A waits for pB's reply, B waits for pA's reply.
    await openObligation(w, "ka", "pA", ["pB"]);
    await openObligation(w, "kb", "pB", ["pA"]);
    await w.registry.enterWaiting("act-b", "pB", ["obl:kb"]); // fine: pA not waiting yet
    const err = await w.registry.enterWaiting("act-a", "pA", ["obl:ka"]).catch((e) => e);
    expect(err).toBeInstanceOf(WaitingError);
    expect(err.code).toBe("mutual_wait"); // E_MUTUAL_WAIT
    expect(err.candidates).toContain("pA");

    // 3-cycle: C waits on pA? no — chain pA→pB→pC→pA.
    const w2 = await world();
    await openObligation(w2, "ka", "pA", ["pB"]);
    await openObligation(w2, "kb", "pB", ["pC"]);
    await openObligation(w2, "kc", "pC", ["pA"]);
    await w2.registry.enterWaiting("act-c", "pC", ["obl:kc"]);
    await w2.registry.enterWaiting("act-b", "pB", ["obl:kb"]);
    await expect(w2.registry.enterWaiting("act-a", "pA", ["obl:ka"])).rejects.toMatchObject({ code: "mutual_wait" });
    // Nothing was written for the refused entry.
    expect(w2.waitJ.lines()).toHaveLength(2); // act-c and act-b only
  });

  test("documented ceiling enforced: >MAX_OBLIGATIONS_PER_WAIT refused", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < MAX_OBLIGATIONS_PER_WAIT + 1; i++) {
      await openObligation(w, `k${i}`, "pA", [`p${i}`]);
      ids.push(`obl:k${i}`);
    }
    await expect(w.registry.enterWaiting("act-1", "pA", ids)).rejects.toMatchObject({ code: "wait_ceiling_exceeded" });
    // Exactly at ceiling is allowed.
    await expect(w.registry.enterWaiting("act-1", "pA", ids.slice(0, MAX_OBLIGATIONS_PER_WAIT))).resolves.toBeTruthy();
  });

  test("idempotency: replayed reply event still exactly one intent; byte-deterministic journals", async () => {
    const build = async () => {
      const w = await world();
      await openObligation(w, "k1", "pA", ["pB"]);
      await w.registry.enterWaiting("act-1", "pA", ["obl:k1"], T0 + 60_000);
      await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });
      await w.registry.expireWaiters(); // no-op sweep after resume
      return w;
    };
    const a = await build();
    const b = await build();
    expect(a.waitJ.lines()).toEqual(b.waitJ.lines());
    expect(a.intentJ.lines()).toEqual(b.intentJ.lines());

    // Replaying the SAME reply event against a reloaded registry emits nothing new.
    const reloaded = await new WaitingRegistry(a.ledger, a.waitJ, a.intentJ, { now: tickClock() }).load();
    const outcomes = await reloaded.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });
    expect(outcomes).toHaveLength(0);
    expect(a.intentJ.lines()).toHaveLength(1);
  });

  test("expiry: deadline passes → wait_expired wake, distinct from reply reason, ledger untouched", async () => {
    const w = await world();
    await openObligation(w, "k1", "pA", ["pB"]);
    await w.registry.enterWaiting("act-1", "pA", ["obl:k1"], T0 + 5_000);

    // Not yet due.
    let outcomes = await w.registry.expireWaiters();
    expect(outcomes).toHaveLength(0);
    expect(w.registry.get("act-1")!.state).toBe("waiting_on_channel");

    // Advance clock past deadline via a fresh registry sharing journals.
    const later = await new WaitingRegistry(
      w.ledger,
      w.waitJ,
      w.intentJ,
      { now: () => T0 + 10_000 },
    ).load();
    outcomes = await later.expireWaiters();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.intent_id).toBe(expiryIntentId("act-1"));

    const rec = later.get("act-1")!;
    expect(rec.state).toBe("resumed_pending_dispatch");
    expect(rec.resume_reason).toBe("wait_expired");

    // Distinguishing: expired ≠ reply-resumed.
    expect(rec.resume_reason).not.toBe("reply_received");

    // Repeated sweep: no double emission.
    expect(await later.expireWaiters()).toHaveLength(0);
    expect(w.intentJ.lines()).toHaveLength(1);

    // Nothing destroyed: obligation still open and queryable.
    expect(w.ledger.get("obl:k1")?.state).toBe("open");
  });

  test("classifyResume matrix: idle/busy_interactive/busy_noninteractive (pure advisory)", () => {
    expect(WaitingRegistry.classifyResume("idle")).toBe("new_turn");
    expect(WaitingRegistry.classifyResume("busy_interactive")).toBe("steer");
    expect(WaitingRegistry.classifyResume("busy_noninteractive")).toBe("decline_noninteractive");
  });

  test("durability: reload from journals reproduces identical states; no re-emission after reload+same reply", async () => {
    const w = await world();
    await openObligation(w, "k1", "pA", ["pB"]);
    await openObligation(w, "k2", "pC", ["pD"]);
    await w.registry.enterWaiting("act-1", "pA", ["obl:k1"]);
    await w.registry.enterWaiting("act-2", "pC", ["obl:k2"]);
    await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });

    const reloaded = await new WaitingRegistry(w.ledger, w.waitJ, w.intentJ, { now: tickClock() }).load();
    expect(reloaded.list().map((r) => [r.activation_id, r.state])).toEqual([
      ["act-1", "resumed_pending_dispatch"],
      ["act-2", "waiting_on_channel"],
    ]);
    expect(reloaded.listIntentIds()).toContain(resumeIntentId("act-1", "obl:k1", "chain:t1#2"));

    // Same reply event replayed post-reload: no new intent, no state change.
    await reloaded.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });
    expect(w.intentJ.lines()).toHaveLength(1);
    expect(reloaded.get("act-1")!.state).toBe("resumed_pending_dispatch");

    // The OTHER activation still wakes normally after reload.
    const outcomes = await reloaded.onReplyRecorded({ obligation_id: "obl:k2", reply_message_id: "chain:t1#7" });
    expect(outcomes).toHaveLength(1);
    expect(reloaded.get("act-2")!.state).toBe("resumed_pending_dispatch");
  });

  test("determinism: identical op sequences produce byte-identical journals", async () => {
    const run = async () => {
      const w = await world();
      await openObligation(w, "k1", "pA", ["pB"]);
      await openObligation(w, "k2", "pA", ["pC"]);
      await w.registry.enterWaiting("act-1", "pA", ["obl:k2", "obl:k1"]); // unsorted input → sorted storage
      await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: "chain:t1#2" });
      return [w.waitJ.lines(), w.intentJ.lines(), w.ledger.list()] as const;
    };
    const a = await run();
    const b = await run();
    expect(a[0]).toEqual(b[0]);
    expect(a[1]).toEqual(b[1]);
    // Sorted, deduped obligation_ids in the durable event.
    expect(JSON.parse(a[0][0]!).obligation_ids).toEqual(["obl:k1", "obl:k2"]);
  });
});
