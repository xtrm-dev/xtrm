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
    expect(outcomes[0]!.intent_id).toBe(expiryIntentId("act-1", 0));

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

  test("mutual-cycle double-entry under overlapping ops (xtrm-2hn.8): detected exactly once per entrant pair, refusal inert, survivor wake exact, loser re-enterable", async () => {
    const w = await world();
    await openObligation(w, "ka", "pA", ["pB"]); // A would wait on a reply from B
    await openObligation(w, "kb", "pB", ["pA"]); // B would wait on a reply from A — mutually dependent

    // Writer 1 (pB) enters cleanly. Commands are host-serialized at the
    // registry seam per enterWaiting()'s single-scheduler contract; ops below
    // keep OVERLAPPING live state (no wake/resolution between the entries).
    const bEntered = await w.registry.enterWaiting("act-b", "pB", ["obl:kb"]);
    expect(bEntered.state).toBe("waiting_on_channel");
    const enteredLines = w.waitJ.lines().length;

    // Writer 2 (pA) fires its mutually-dependent entry: cycle detected —
    // exactly one typed resolution, zero journal residue for the loser.
    const refusal = await w.registry.enterWaiting("act-a", "pA", ["obl:ka"]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(WaitingError);
    expect((refusal as WaitingError).code).toBe("mutual_wait");
    expect((refusal as WaitingError).candidates).toContain("pA");
    expect(w.waitJ.lines()).toHaveLength(enteredLines); // refused entry wrote NOTHING

    // Adversarial double-entry REPLAY of the losing side: refused identically,
    // still inert.
    const replay = await w.registry.enterWaiting("act-a", "pA", ["obl:ka"]).then(
      () => null,
      (e: unknown) => e,
    );
    expect((replay as WaitingError | null)?.code).toBe("mutual_wait");
    expect(w.waitJ.lines()).toHaveLength(enteredLines);

    // Overlapping ops: while B's wake processes, the losing side retries —
    // the cycle persists until B stops waiting, so the retry MUST be refused
    // inside the same window; the wake itself completes exactly once.
    const [wakeOutcomes, overlapErr] = await Promise.all([
      w.registry.onReplyRecorded({ obligation_id: "obl:kb", reply_message_id: "chain:t1#3" }),
      w.registry.enterWaiting("act-a", "pA", ["obl:ka"]).then(
        () => null,
        (e: unknown) => e,
      ),
    ]);
    expect((overlapErr as WaitingError | null)?.code).toBe("mutual_wait");
    expect(wakeOutcomes).toHaveLength(1);
    expect(wakeOutcomes[0]).toMatchObject({
      activation_id: "act-b",
      intent_id: resumeIntentId("act-b", "obl:kb", "chain:t1#3"),
      reason: "reply_received",
      emitted: true,
    });

    // No wake fired twice: replayed identical evidence emits nothing further.
    expect(await w.registry.onReplyRecorded({ obligation_id: "obl:kb", reply_message_id: "chain:t1#3" })).toEqual([]);
    expect(w.intentJ.lines()).toHaveLength(1);

    // No lost wake intent on the refused side: nothing addressed to act-a was
    // ever emitted before it legitimately entered.
    expect(JSON.stringify(await w.intentJ.readAll()).includes("act-a")).toBe(false);

    // Cycle dissolved (B resumed): the loser now enters normally and remains
    // resumable per contract; its own wake is exact-once with a fresh id.
    await expect(w.registry.enterWaiting("act-a", "pA", ["obl:ka"])).resolves.toMatchObject({ state: "waiting_on_channel" });
    const aWake = await w.registry.onReplyRecorded({ obligation_id: "obl:ka", reply_message_id: "chain:t1#5" });
    expect(aWake).toHaveLength(1);
    expect(aWake[0]).toMatchObject({
      activation_id: "act-a",
      intent_id: resumeIntentId("act-a", "obl:ka", "chain:t1#5"),
      reason: "reply_received",
      emitted: true,
    });
    expect(await w.registry.onReplyRecorded({ obligation_id: "obl:ka", reply_message_id: "chain:t1#5" })).toEqual([]);
    expect(w.intentJ.lines()).toHaveLength(2);
    expect(w.registry.get("act-a")!.state).toBe("resumed_pending_dispatch");
    expect(w.registry.get("act-b")!.state).toBe("resumed_pending_dispatch");
  });
});

describe("expiry intent exactness across re-entries (review finding 1)", () => {
  test("two logical expiries of one activation produce two distinct intents", async () => {
    const w = await world();
    await openObligation(w, "k1", "p1", ["p2"]);
    await openObligation(w, "k2", "p1", ["p2"]);
    const reg2J = memWaitJournal();
    const reg2I = memIntentJournal();
    // Same journals are not shared; instead reuse w's journals via a second registry is overkill —
    // drive the existing registry twice.
    let t = 5_000;
    const reg = await new WaitingRegistry(
      w.ledger,
      { append: w.waitJ.append.bind(w.waitJ), readAll: async () => (await w.waitJ.readAll()) },
      { append: w.intentJ.append.bind(w.intentJ), readAll: async () => (await w.intentJ.readAll()) },
      { now: () => (t += 10_000) },
    ).load();

    void reg2J; void reg2I;

    await reg.enterWaiting("act-1", "p1", ["obl:k1"], 20_000);
    let out = await reg.expireWaiters();
    expect(out).toHaveLength(1);
    const firstId = out[0]!.intent_id;
    expect(firstId).toContain(":expiry:g0");

    // Re-enter after the first expiry; the second logical wake must get a NEW id.
    await reg.enterWaiting("act-1", "p1", ["obl:k2"], 40_000);
    out = await reg.expireWaiters();
    expect(out).toHaveLength(1);
    const secondId = out[0]!.intent_id;
    expect(secondId).toContain(":expiry:g1");
    expect(secondId).not.toBe(firstId);

    // Both intents durable in the journal.
    const all = await w.intentJ.readAll();
    expect(all.map((i) => i.intent_id)).toEqual(expect.arrayContaining([firstId, secondId]));
  });
});
