/**
 * Communication adversarial/recovery acceptance suite (bead xtrm-1xn).
 *
 * TEST-ONLY cross-layer acceptance: wires ALL FOUR comm-runtime modules
 * together through their public APIs with deterministic injected clocks and
 * journals. Every case asserts the INVARIANT under adversarial conditions
 * (duplicate delivery, races, crash windows, restarts, mis-delivery), not
 * merely no-throw:
 *
 *  - channel-comm (xtrm-6yn): semantic contracts, host-injected authority,
 *    read≠ack cursors, runtime.message_rejected audit-twin.
 *  - obligation (xtrm-hzb): ObligationLedger — append-only journal + pure
 *    fold, ledger-first atomicity, consumed-once edges, UNCERTAIN observations.
 *  - waiting (xtrm-sf3): WaitingRegistry — exact+idempotent SchedulerIntents,
 *    generation-scoped expiry, cycle refusal.
 *  - finalize (xtrm-2mi): agent finished ≠ protocol completed; SETTLED-not-
 *    replied; receipt triple.
 *
 * Canon: docs/runtime/prd/native-chain-runtime.md R2.6–R2.10 — receipts
 * append-only; uncertain blocks blind replay; recovery never destroys work.
 *
 * CANON UPDATE (bead xtrm-2hn.8, fallout of xtrm-2hn.4): the store assigns a
 * GLOBAL monotonic message `id` at enqueue (channels.md §5.1) — the sole
 * semantic cursor position; cursors are PER CHANNEL per participant shaped
 * {last_read_message_id, last_ack_message_id}; `seq` is display-only and is
 * never compared. Cases 9/14 and the shared fake store follow that canon.
 */

import { describe, expect, test } from "bun:test";
import {
  ChannelCommunicationService,
  type ChannelCommStore,
  type ChannelCursors,
  emptyChannelCursors,
  type StoredEnvelope,
} from "../src/channel-comm/index.ts";
import {
  canonicalEventLine,
  ObligationLedger,
  stableStringify,
  type ObligationEvent,
  type ObligationJournal,
} from "../src/obligation/index.ts";
import {
  WAITING_STATE_SCHEMA_VERSION,
  WaitingEventSchema,
  WaitingRegistry,
  expiryIntentId,
  resumeIntentId,
  type IntentJournal,
  type SchedulerIntent,
  type WaitingEvent,
  type WaitingJournal,
} from "../src/waiting/index.ts";
import {
  BlockedFinalize,
  checkFinalization,
  FinalizeController,
  finalizeGate,
  type FinalizeVerdict,
  type SettlementEvidenceEntry,
} from "../src/finalize/index.ts";

// ---------------------------------------------------------------------------
// Deterministic harness: one shared mutable clock + in-memory JSONL journals.
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const CH = "chain:t1";

function mkClock() {
  const state = { t: T0 };
  return {
    now: () => state.t,
    advance: (ms: number) => {
      state.t += ms;
    },
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

function memWaitJournal(): WaitingJournal & { lines: () => string[] } {
  const lines: string[] = [];
  return {
    async append(e: WaitingEvent) {
      lines.push(stableStringify(e));
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
      lines.push(stableStringify(i));
    },
    async readAll() {
      return lines.map((l) => JSON.parse(l) as SchedulerIntent);
    },
    lines: () => [...lines],
  };
}

/** In-memory channel store. Raw append() deliberately bypasses idempotency
 *  dedup so tests can simulate AT-LEAST-ONCE transport duplication below the
 *  service seam (the service dedups; the wire does not have to).
 *  CANON: append() assigns the GLOBAL monotonically increasing message `id`
 *  at enqueue; cursors are PER CHANNEL per participant
 *  {last_read_message_id, last_ack_message_id} (mirrors the repaired module
 *  seam; see src/channel-comm/index.ts §5.1 adoption). */
function memCommStore(): ChannelCommStore & { lines: () => string[] } {
  const lines: string[] = [];
  const cursors = new Map<string, ChannelCursors>();
  const ck = (cid: string, pid: string) => `${cid}\u0000${pid}`;
  let nextId = 0;
  return {
    async append(env: StoredEnvelope) {
      const stored = { ...structuredClone(env), id: ++nextId };
      lines.push(stableStringify(stored));
      return structuredClone(stored);
    },
    async readChannel(filter) {
      return lines
        .map((l) => JSON.parse(l) as StoredEnvelope)
        .filter((m) => !filter?.channel_id || m.channel_id === filter.channel_id);
    },
    async findByIdempotencyKey(key) {
      const hit = (await this.readChannel({})).find((m) => m.idempotency_key === key);
      return hit ? structuredClone(hit) : null;
    },
    async getCursors(cid, pid) {
      return cursors.get(ck(cid, pid)) ?? emptyChannelCursors();
    },
    async setCursors(cid, pid, c) {
      cursors.set(ck(cid, pid), structuredClone(c));
    },
    lines: () => [...lines],
  };
}

interface World {
  clk: ReturnType<typeof mkClock>;
  comm: ReturnType<typeof memCommStore>;
  oblJ: ReturnType<typeof memOblJournal>;
  waitJ: ReturnType<typeof memWaitJournal>;
  intentJ: ReturnType<typeof memIntentJournal>;
  ledger: ObligationLedger;
  registry: WaitingRegistry;
}

async function world(): Promise<World> {
  const clk = mkClock();
  const comm = memCommStore();
  const oblJ = memOblJournal();
  const waitJ = memWaitJournal();
  const intentJ = memIntentJournal();
  const ledger = await new ObligationLedger(oblJ, { now: clk.now }).load();
  const registry = await new WaitingRegistry(ledger, waitJ, intentJ, { now: clk.now }).load();
  return { clk, comm, oblJ, waitJ, intentJ, ledger, registry };
}

/** Process-restart simulation: NEW module instances over the SAME journals. */
async function restart(w: World): Promise<World> {
  const ledger = await new ObligationLedger(w.oblJ, { now: w.clk.now }).load();
  const registry = await new WaitingRegistry(ledger, w.waitJ, w.intentJ, { now: w.clk.now }).load();
  return { ...w, ledger, registry };
}

function lane(w: World, pid: string, participant_class: "coordinator" | "participant" | "runtime" | "reviewer-policy" = "participant") {
  return new ChannelCommunicationService({ participant_id: pid, participant_class }, w.comm, { now: w.clk.now });
}

// ---------------------------------------------------------------------------
// Conversation helpers — the realistic full-stack flow.
// ---------------------------------------------------------------------------

/** Register obligation (ledger-first), send the request through channel-comm, confirm sent. */
async function requestFrom(
  w: World,
  key: string,
  requester: string,
  responder: string,
  opts: { mandatory?: boolean } = {},
) {
  await w.ledger.registerRequest({
    idempotency_key: key,
    channel_id: CH,
    requester,
    expected_responders: [responder],
    mandatory: opts.mandatory ?? false,
  });
  const req = await lane(w, requester).request({
    channel_id: CH,
    kind: "work.proposal",
    body: { proposal_class: "evaluation_request", summary: `eval ${key}` },
    audience: { action_targets: [responder], visibility: "targets" },
    idempotency_key: key,
    expects_reply_from: [responder],
  });
  await w.ledger.confirmRequestSent(`obl:${key}`, { message_id: req.message_id, seq: req.seq });
  return req;
}

/** Responder replies through channel-comm against the request's intent handle. */
async function replyTo(w: World, req: Awaited<ReturnType<typeof requestFrom>>, responder: string, key: string) {
  return lane(w, responder).reply(req.intent, {
    channel_id: req.intent.channel_id,
    kind: "work.ack",
    body: { refs: [req.intent.request_message_id], decision: "accept" },
    audience: { action_targets: [req.intent.requested_by], visibility: "targets" },
    idempotency_key: key,
    correlation_id: req.intent.request_id,
  });
}

/** Host-side delivery: committed channel message → ledger correlation → wake seam. */
async function deliverReply(w: World, msg: { message_id: string }, obligationKey: string, responder: string) {
  const record = await w.ledger.recordReply(`req:${obligationKey}`, {
    channel_id: CH,
    message_id: msg.message_id,
    responder,
  });
  const outcomes = await w.registry.onReplyRecorded({
    obligation_id: `obl:${obligationKey}`,
    reply_message_id: msg.message_id,
  });
  return { record, outcomes };
}

/** FINALIZE check over the full current ledger projection for a participant. */
function check(w: World, participant: string): Promise<FinalizeVerdict> {
  return checkFinalization({
    activation_id: `act-${participant}`,
    participant_id: participant,
    now_ms: w.clk.now(),
    obligations: w.ledger.list(),
  });
}

/** Channel tail shaped for settleFromStream (only correlated messages matter). */
async function correlatedTail(w: World, channel = CH) {
  return (await w.comm.readChannel({ channel_id: channel }))
    .filter((m) => m.correlation_id !== undefined)
    .map((m) => ({
      channel_id: m.channel_id,
      message_id: m.message_id,
      author: { participant_id: m.author.participant_id },
      correlation_id: m.correlation_id,
    }));
}

const repliedEventCount = (w: World) => w.oblJ.lines().filter((l) => l.includes('"type":"obligation.replied"')).length;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("comm adversarial/recovery acceptance (xtrm-1xn)", () => {
  test("1. duplicate delivery: replayed reply settles once; duplicates are inert end-to-end", async () => {
    const w = await world();
    const req = await requestFrom(w, "k1", "pA", "pB");
    await w.registry.enterWaiting("act-A", "pA", ["obl:k1"]);
    const rep = await replyTo(w, req, "pB", "r1");

    // Transport replays the SAME committed envelope (at-least-once delivery).
    const envelope = (await w.comm.readChannel({ channel_id: CH })).find((m) => m.message_id === rep.message_id)!;
    await w.comm.append(structuredClone(envelope));

    // Ledger reconciliation over the polluted stream: settles EXACTLY once.
    let report = await w.ledger.settleFromStream(await correlatedTail(w));
    expect(report.replied).toEqual([{ obligation_id: "obl:k1", message_id: rep.message_id }]);
    expect(repliedEventCount(w)).toBe(1);

    // Re-scanning the same polluted stream is idempotent: no double transition.
    report = await w.ledger.settleFromStream(await correlatedTail(w));
    expect(report.replied).toEqual([]);
    expect(repliedEventCount(w)).toBe(1);

    // Command surface agrees: a second direct delivery is a typed consumed-once refusal.
    await expect(
      w.ledger.recordReply("req:k1", { channel_id: CH, message_id: rep.message_id, responder: "pB" }),
    ).rejects.toMatchObject({ code: "already_replied" });

    // Downstream: replayed wake evidence cannot double-emit the resume intent.
    const first = await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: rep.message_id });
    expect(first).toHaveLength(1);
    expect(first[0]!.emitted).toBe(true);
    for (let i = 0; i < 3; i++) {
      await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: rep.message_id });
    }
    expect(w.intentJ.lines()).toHaveLength(1);
    expect(w.registry.get("act-A")!.state).toBe("resumed_pending_dispatch");
  });

  test("2. reply-before-obligation race: typed rejection; no retroactive matching (semantics pinned)", async () => {
    const w = await world();

    // Stray reply arrives for an unknown correlation → typed rejection.
    await expect(
      w.ledger.recordReply("req:early", { channel_id: CH, message_id: `${CH}#1`, responder: "pB" }),
    ).rejects.toMatchObject({ code: "unknown_correlation" });

    // PINNED SEMANTICS (hzb): rejections leave no residue — the ledger buffers
    // no stray replies and evaluates correlation against the CURRENT projection
    // at each delivery attempt. A later-registered obligation therefore does NOT
    // retroactively absorb the stray reply, even with a genuinely matching
    // correlation_id:
    await w.ledger.registerRequest({
      idempotency_key: "late",
      channel_id: CH,
      requester: "pA",
      expected_responders: ["pB"],
      correlation_id: "req:early",
    });
    expect(w.ledger.get("obl:late")).toMatchObject({ state: "open" });
    expect(repliedEventCount(w)).toBe(0);

    // The ONLY way the stray takes effect is an explicit NEW delivery decision —
    // and no lingering "tainted/consumed" state blocks that legitimate redelivery:
    const rec = await w.ledger.recordReply("req:early", { channel_id: CH, message_id: `${CH}#1`, responder: "pB" });
    expect(rec.state).toBe("replied");
  });

  test("3. crash window between registerRequest and confirmRequestSent: reload keeps obligation open; late confirm works; reply correlates", async () => {
    const w = await world();
    await w.ledger.registerRequest({
      idempotency_key: "k1",
      channel_id: CH,
      requester: "pA",
      expected_responders: ["pB"],
    });
    // Message actually reaches the transport, THEN the process dies before
    // confirmRequestSent: the journal holds `obligation.opened` only.
    const sent = await lane(w, "pA").request({
      channel_id: CH,
      kind: "work.proposal",
      body: { proposal_class: "evaluation_request", summary: "eval k1" },
      audience: { action_targets: ["pB"], visibility: "targets" },
      idempotency_key: "k1",
      expects_reply_from: ["pB"],
    });

    const w2 = await restart(w);
    const rec = w2.ledger.get("obl:k1")!;
    expect(rec.state).toBe("open"); // recovery never destroys work
    expect(rec.request_ref.message_id).toBeNull(); // crash window visible in projection

    // Late confirm (post-recovery forensic completion) works.
    await w2.ledger.confirmRequestSent("obl:k1", { message_id: sent.message_id, seq: sent.seq });
    expect(w2.ledger.get("obl:k1")!.request_ref.message_id).toBe(sent.message_id);

    // A reply arriving after the late confirm correlates normally.
    const rep = await lane(w2, "pB").reply(sent.intent, {
      channel_id: CH,
      kind: "work.ack",
      body: { refs: [sent.message_id], decision: "accept" },
      audience: { action_targets: ["pA"], visibility: "targets" },
      idempotency_key: "r1",
      correlation_id: sent.intent.request_id,
    });
    const done = await w2.ledger.recordReply("req:k1", {
      channel_id: CH,
      message_id: rep.message_id,
      responder: "pB",
    });
    expect(done.state).toBe("replied");
  });

  test("4. restart loss boundary: durable state survives; emitted intents not re-emitted; unjournaled observations ARE lost", async () => {
    const w = await world();
    // Mid-conversation state: one answered+resumed activation, one queued open
    // obligation with an actively-waiting activation.
    await w.ledger.registerRequest({ idempotency_key: "k0", channel_id: CH, requester: "pA", expected_responders: ["pB"] });
    await w.registry.enterWaiting("act-R", "pA", ["obl:k0"]);
    await w.ledger.recordReply("req:k0", { channel_id: CH, message_id: `${CH}#1`, responder: "pB" });
    const outcomes = await w.registry.onReplyRecorded({ obligation_id: "obl:k0", reply_message_id: `${CH}#1` });
    expect(outcomes[0]!.emitted).toBe(true);
    await w.ledger.registerRequest({
      idempotency_key: "k1",
      channel_id: CH,
      requester: "pA",
      expected_responders: ["pB"],
      mandatory: true,
    });
    await w.registry.enterWaiting("act-W", "pA", ["obl:k1"]);

    // --- restart: new instances, same journals ---
    const w2 = await restart(w);

    // SURVIVES: queued obligations, terminal records, waiting states, intents.
    expect(w2.ledger.get("obl:k1")).toMatchObject({ state: "open", mandatory: true });
    expect(w2.ledger.get("obl:k0")).toMatchObject({ state: "replied" });
    expect(w2.registry.get("act-W")).toMatchObject({ state: "waiting_on_channel" });
    expect(w2.registry.get("act-W")!.waiting_reason!.obligation_ids).toEqual(["obl:k1"]);
    expect(w2.registry.get("act-R")).toMatchObject({ state: "resumed_pending_dispatch" });
    expect(w2.intentJ.lines()).toHaveLength(1);

    // NOT re-emitted: replaying the exact same triggering evidence emits nothing.
    const replay = await w2.registry.onReplyRecorded({ obligation_id: "obl:k0", reply_message_id: `${CH}#1` });
    expect(replay).toEqual([]);
    expect(w2.intentJ.lines()).toHaveLength(1);

    // LOST (documented durability boundary): an external reply the transport
    // observed but which was never journaled via observeExternalReply before
    // the crash leaves NO trace. The runtime refuses to guess in EITHER
    // direction — no fabricated certainty (still open), no fabricated
    // uncertainty (no phantom observation): plain blocked, safe to investigate.
    const v = await check(w2, "pB");
    expect(v).toMatchObject({ verdict: "blocked", reason_codes: ["open_mandatory_inbound"] });
    expect(w2.ledger.get("obl:k1")!.pending_external_observations).toEqual([]);
  });

  test("5. uncertain reconciliation: observe → uncertain → reconcile → blocked(replied) → settle → clear; unconfirmed stays uncertain across reloads", async () => {
    const w = await world();
    await w.ledger.registerRequest({
      idempotency_key: "k1",
      channel_id: CH,
      requester: "pA",
      expected_responders: ["pB"],
      mandatory: true,
    });
    await w.ledger.observeExternalReply("transport:evt-42", "req:k1", CH);

    // Observation without committed evidence ⇒ UNCERTAIN, and the gate refuses.
    let v = await check(w, "pB");
    expect(v.verdict).toBe("uncertain");
    let ran = 0;
    await expect(
      finalizeGate(
        () => check(w, "pB"),
        async () => {
          ran++;
          return "ok";
        },
      ),
    ).rejects.toBeInstanceOf(BlockedFinalize);
    expect(ran).toBe(0);

    // Reconcile against committed stream evidence → replied, but NOT complete.
    const report = await w.ledger.settleFromStream([
      { channel_id: CH, message_id: `${CH}#1`, author: { participant_id: "pB" }, correlation_id: "req:k1" },
    ]);
    expect(report.replied.map((r) => r.obligation_id)).toEqual(["obl:k1"]);
    v = await check(w, "pB");
    expect(v).toMatchObject({ verdict: "blocked", reason_codes: ["replied_not_settled"] });

    // Settlement records the resolving-evidence pointer → clear.
    await w.ledger.settle("obl:k1", "ev:settle-1");
    expect((await check(w, "pB")).verdict).toBe("clear");

    // Negative path: an observation whose confirming message NEVER arrives
    // stays uncertain — across settleFromStream passes AND process reloads.
    await w.ledger.registerRequest({
      idempotency_key: "k2",
      channel_id: CH,
      requester: "pA",
      expected_responders: ["pB"],
      mandatory: true,
    });
    await w.ledger.observeExternalReply("transport:evt-99", "req:k2", CH);
    await w.ledger.settleFromStream([]);
    const w2 = await restart(w);
    expect(w2.ledger.get("obl:k2")).toMatchObject({ state: "open" });
    expect(w2.ledger.get("obl:k2")!.pending_external_observations).toEqual(["transport:evt-99"]);
    expect((await check(w2, "pB")).verdict).toBe("uncertain"); // no silent resolution
  });

  test("6. wake intent loss/duplication defense: replayed replies → one intent; double expiry sweep → one intent; re-entry gets a fresh generation", async () => {
    const w = await world();
    const req = await requestFrom(w, "k1", "pA", "pB");
    await w.registry.enterWaiting("act-1", "pA", ["obl:k1"]);
    const rep = await replyTo(w, req, "pB", "r1");

    // Same reply event replayed N times → exactly ONE resume intent.
    const first = await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: rep.message_id });
    expect(first[0]!.emitted).toBe(true);
    expect(first[0]!.intent_id).toBe(resumeIntentId("act-1", "obl:k1", rep.message_id));
    for (let i = 0; i < 5; i++) {
      await w.registry.onReplyRecorded({ obligation_id: "obl:k1", reply_message_id: rep.message_id });
    }
    expect(w.intentJ.lines()).toHaveLength(1);

    // Expiry sweep run twice → one intent.
    await w.ledger.registerRequest({ idempotency_key: "kE", channel_id: CH, requester: "pA", expected_responders: ["pB"] });
    await w.registry.enterWaiting("act-E", "pA", ["obl:kE"], w.clk.now() + 5_000);
    w.clk.advance(10_000);
    const e1 = await w.registry.expireWaiters();
    expect(e1).toHaveLength(1);
    expect(e1[0]).toMatchObject({ activation_id: "act-E", reason: "wait_expired", emitted: true, intent_id: expiryIntentId("act-E", 0) });
    expect(await w.registry.expireWaiters()).toEqual([]);
    const afterFirstExpiry = w.intentJ.lines().length;

    // Re-entry + second expiry → DISTINCT generation-scoped intent.
    await w.registry.enterWaiting("act-E", "pA", ["obl:kE"], w.clk.now() + 5_000);
    w.clk.advance(10_000);
    const e2 = await w.registry.expireWaiters();
    expect(e2).toHaveLength(1);
    expect(e2[0]!.emitted).toBe(true);
    expect(e2[0]!.intent_id).toBe(expiryIntentId("act-E", 1));
    expect(e2[0]!.intent_id).not.toBe(e1[0]!.intent_id);
    expect(w.intentJ.lines()).toHaveLength(afterFirstExpiry + 1);
  });

  test("7. FINALIZE blocked/released: gate throws before runner side effects; operator void releases; participant-class void mutates nothing", async () => {
    const w = await world();
    await w.ledger.registerRequest({ idempotency_key: "k1", channel_id: CH, requester: "pA", expected_responders: ["pB"], mandatory: true });
    await w.ledger.registerRequest({ idempotency_key: "k2", channel_id: CH, requester: "pA", expected_responders: ["pB"], mandatory: true });

    // Mandatory inbound open ⇒ gate throws BEFORE the runner executes.
    let ran = 0;
    const gateCheck = () => check(w, "pB");
    await expect(
      finalizeGate(
        gateCheck,
        async () => {
          ran++;
          return "ok";
        },
      ),
    ).rejects.toBeInstanceOf(BlockedFinalize);
    expect(ran).toBe(0);

    const evidence: SettlementEvidenceEntry[] = [];
    const ctl = new FinalizeController(w.ledger, {
      now: w.clk.now,
      evidence: {
        async append(e) {
          evidence.push(e);
        },
      },
    });

    // Participant-class void attempt: refused with ZERO mutation.
    const journalLen = w.oblJ.lines().length;
    // runtime class-guard under test; the `as any` type bypass IS the point.
    await expect(ctl.voidObligation("obl:k1", "participant" as any, "self-release", "ev:nope")).rejects.toMatchObject({
      code: "not_owner",
    });
    expect(w.oblJ.lines()).toHaveLength(journalLen);
    expect(evidence).toHaveLength(0);
    expect((await check(w, "pB")).verdict).toBe("blocked");

    // Operator void releases k1; voiding the terminal record again is refused.
    await ctl.voidObligation("obl:k1", "operator", "operator override after timeout", "ev:void-1");
    expect(w.ledger.get("obl:k1")!.state).toBe("voided");
    expect(evidence).toHaveLength(1);
    await expect(ctl.voidObligation("obl:k1", "coordinator", "again", "ev:void-2")).rejects.toMatchObject({
      code: "invalid_transition",
    });
    expect(evidence).toHaveLength(1);

    // Release the remaining blocker → the gate finally RUNS the runner.
    await ctl.voidObligation("obl:k2", "operator", "operator override", "ev:void-3");
    const out = await finalizeGate(
      gateCheck,
      async () => {
        ran++;
        return "ok";
      },
    );
    expect(out).toBe("ok");
    expect(ran).toBe(1);
  });

  test("8. body-cannot-grant-authority: capability/permissions/author-key smuggling rejected with body_authority_assertion; audit-twin exactly once per identical attempt", async () => {
    const w = await world();
    const p1 = lane(w, "pA", "participant");
    const smuggledBodies = [
      { summary: "x", capability: "system.swap" },
      { summary: "x", permissions: ["all"] },
      { summary: "x", author_key: "sk-live-1" },
      { summary: "x", authority: "coordinator" },
    ];
    for (const [i, body] of smuggledBodies.entries()) {
      const draft = {
        channel_id: CH,
        kind: "work.turn",
        body,
        audience: { action_targets: [], visibility: "chain" },
        idempotency_key: `smug-${i}`,
      };
      // Each attempt rejected, TWICE (identical retry), with the typed problem.
      for (let attempt = 0; attempt < 2; attempt++) {
        const err = await p1.send(draft).catch((e) => e);
        expect(err.name).toBe("ChannelValidationError");
        expect(err.problems.some((p: { code: string }) => p.code === "body_authority_assertion")).toBe(true);
      }
    }
    // Audit-twin: exactly ONE runtime.message_rejected fact per DISTINCT draft,
    // authored by the runtime lane — repeated identical attempts dedup.
    const audits = (await w.comm.readChannel({ channel_id: CH })).filter((m) => m.kind === "runtime.message_rejected");
    expect(audits).toHaveLength(smuggledBodies.length);
    for (const a of audits) {
      expect(a.author).toEqual({ participant_id: "runtime", participant_class: "runtime" });
      expect(typeof a.body.offender_digest).toBe("string");
      expect((a.body.problem_codes as string[]).includes("body_authority_assertion")).toBe(true);
    }
  });

  test("9. read≠ack under adversarial sequence: read-everything/ack-almost-nothing; ack never advances read; read never advances ack", async () => {
    const w = await world();
    const rt = lane(w, "rt", "runtime");
    for (const i of [1, 2, 3]) {
      await rt.send({
        channel_id: CH,
        kind: "system.epoch_bump",
        body: { reason: `r${i}` },
        audience: { action_targets: ["p1"], visibility: "targets" },
        idempotency_key: `bump-${i}`,
      });
    }
    const p1 = lane(w, "p1");
    const v = { participant_id: "p1", viewer_class: "participant" as const };

    // Single-channel world: the store hands out global ids in arrival order,
    // so numeric cursor positions coincide with the display ordinals used in
    // the narrative (id N ↔ message "seq" N) while remaining canon-shaped.
    // Adversarial order: read EVERYTHING first, ack almost nothing.
    await p1.advanceRead(CH, "p1", 3);
    expect(await w.comm.getCursors(CH, "p1")).toEqual({ last_read_message_id: 3, last_ack_message_id: 0 });
    expect((await p1.inbox(v)).items).toHaveLength(0); // read excludes from inbox…
    expect(await p1.pendingAck(v)).toHaveLength(3); // …but the ack-set stays queryable

    await p1.ackUpTo(CH, "p1", 1);
    // Ack advanced ONLY the ack cursor; read untouched.
    expect(await w.comm.getCursors(CH, "p1")).toEqual({ last_read_message_id: 3, last_ack_message_id: 1 });
    expect(await p1.pendingAck(v)).toHaveLength(2);

    // Regressive operations clamp, never rewind.
    await p1.advanceRead(CH, "p1", 1);
    expect((await w.comm.getCursors(CH, "p1")).last_read_message_id).toBe(3);
    await p1.ackUpTo(CH, "p1", 0);
    expect((await w.comm.getCursors(CH, "p1")).last_ack_message_id).toBe(1);

    // Reverse direction: ack BEFORE read on a fresh participant — ack never advances read.
    for (const i of [4, 5]) {
      await rt.send({
        channel_id: CH,
        kind: "system.epoch_bump",
        body: { reason: `r${i}` },
        audience: { action_targets: ["p2"], visibility: "targets" },
        idempotency_key: `bump-${i}`,
      });
    }
    const p2 = lane(w, "p2");
    await p2.ackUpTo(CH, "p2", 2);
    expect(await w.comm.getCursors(CH, "p2")).toEqual({ last_read_message_id: 0, last_ack_message_id: 2 });
    const v2 = { participant_id: "p2", viewer_class: "participant" as const };
    expect((await p2.inbox(v2)).items).toHaveLength(2); // unread despite acked
  });

  test("10. delivered ≠ processed ≠ replied: transport arrival alone leaves obligation open; processing without settlement keeps FINALIZE blocked", async () => {
    const w = await world();
    const req = await requestFrom(w, "k1", "pA", "pB", { mandatory: true });

    // DELIVERED: the reply envelope is on the stream; the ledger was never told.
    const rep = await replyTo(w, req, "pB", "r1");
    expect(w.ledger.get("obl:k1")!.state).toBe("open"); // delivery ≠ processing

    // Observing the unprocessed delivery yields UNCERTAIN, never "replied".
    await w.ledger.observeExternalReply(`transport:${rep.message_id}`, "req:k1", CH);
    expect((await check(w, "pB")).verdict).toBe("uncertain");

    // PROCESSED: the correlated reply is recorded — but the protocol is not complete.
    await w.ledger.recordReply("req:k1", { channel_id: CH, message_id: rep.message_id, responder: "pB" });
    expect(w.ledger.get("obl:k1")!.state).toBe("replied");
    expect((await check(w, "pB")).verdict).toBe("blocked"); // replied ≠ settled ⇒ FINALIZE blocked

    // Settlement records resolving evidence → protocol completed.
    await w.ledger.settle("obl:k1", "ev:settle-1");
    expect((await check(w, "pB")).verdict).toBe("clear");
  });

  test("11. interleaved mis-delivery defense: concurrent requests, out-of-order replies — correlations land by identity, never position", async () => {
    const w = await world();
    const req1 = await requestFrom(w, "k1", "pA", "pB"); // seq 1
    const req2 = await requestFrom(w, "k2", "pA", "pC"); // seq 2

    // Replies arrive OUT OF ORDER: pC's reply commits first (seq 3), pB's second (seq 4).
    const rep2 = await replyTo(w, req2, "pC", "r-k2");
    const rep1 = await replyTo(w, req1, "pB", "r-k1");
    expect(rep2.seq).toBeLessThan(rep1.seq);

    // Cross-talk: each responder aiming at the OTHER request's correlation.
    await expect(
      w.ledger.recordReply("req:k1", { channel_id: CH, message_id: rep2.message_id, responder: "pC" }),
    ).rejects.toMatchObject({ code: "wrong_direction" });
    await expect(
      w.ledger.recordReply("req:k2", { channel_id: CH, message_id: rep1.message_id, responder: "pB" }),
    ).rejects.toMatchObject({ code: "wrong_direction" });
    expect(repliedEventCount(w)).toBe(0); // cross-talk wrote NOTHING

    // Deliver in reverse order anyway: correlation follows identity, not arrival position.
    const d1 = await deliverReply(w, rep1, "k1", "pB");
    const d2 = await deliverReply(w, rep2, "k2", "pC");
    expect(d1.record.state).toBe("replied");
    expect(d2.record.state).toBe("replied");
    const repliedLines = w.oblJ.lines().filter((l) => l.includes('"type":"obligation.replied"'));
    expect(
      repliedLines.some((l) => l.includes('"obligation_id":"obl:k1"') && l.includes(`"message_id":"${rep1.message_id}"`)),
    ).toBe(true);
    expect(
      repliedLines.some((l) => l.includes('"obligation_id":"obl:k2"') && l.includes(`"message_id":"${rep2.message_id}"`)),
    ).toBe(true);
    expect(repliedEventCount(w)).toBe(2); // each obligation consumed by exactly its own reply
  });

  test("12. fan-out leak defense: one reply consumes exactly its own obligation; ambiguity refuses by omission", async () => {
    const w = await world();
    const req1 = await requestFrom(w, "k1", "pA", "pB");
    await requestFrom(w, "k2", "pA", "pC");
    await requestFrom(w, "k3", "pA", "pB");
    // Adversarial configuration: two open obligations share one correlation id.
    await w.ledger.registerRequest({ idempotency_key: "k4", channel_id: CH, requester: "pA", expected_responders: ["pB"], correlation_id: "req:shared" });
    await w.ledger.registerRequest({ idempotency_key: "k5", channel_id: CH, requester: "pA", expected_responders: ["pB"], correlation_id: "req:shared" });

    // ONE committed reply message enters the stream…
    const rep = await replyTo(w, req1, "pB", "r1");
    // …plus a stray message carrying the SHARED correlation (mis-delivery bait).
    await lane(w, "pB").send({
      channel_id: CH,
      kind: "work.ack",
      body: { refs: ["x"], decision: "d" },
      audience: { action_targets: ["pA"], visibility: "targets" },
      idempotency_key: "stray-shared",
      correlation_id: "req:shared",
    });

    const report = await w.ledger.settleFromStream(await correlatedTail(w));
    // Exactly the addressed obligation consumed; unrelated ones untouched.
    expect(report.replied).toEqual([{ obligation_id: "obl:k1", message_id: rep.message_id }]);
    expect(w.ledger.get("obl:k2")!.state).toBe("open");
    expect(w.ledger.get("obl:k3")!.state).toBe("open");
    // The ambiguous pair: refusal by omission — NEITHER absorbs the stray.
    expect(w.ledger.get("obl:k4")!.state).toBe("open");
    expect(w.ledger.get("obl:k5")!.state).toBe("open");
    expect(report.unresolved_uncertain).toEqual([]);

    // Command surface backs that comment directly (xtrm-1o8): two OPEN
    // obligations sharing "req:shared" make recordReply REFUSE outright with
    // typed ambiguous_correlation, listing both candidates.
    await expect(
      w.ledger.recordReply("req:shared", { channel_id: CH, message_id: rep.message_id, responder: "pB" }),
    ).rejects.toMatchObject({ code: "ambiguous_correlation" });

    // Command surface strictness: the same physical message cannot be re-used
    // as the reply for a different obligation…
    await expect(
      w.ledger.recordReply("req:k2", { channel_id: CH, message_id: rep.message_id, responder: "pB" }),
    ).rejects.toMatchObject({ code: "wrong_direction" });
    // …nor delivered twice to its own (already consumed) edge.
    await expect(
      w.ledger.recordReply("req:k1", { channel_id: CH, message_id: rep.message_id, responder: "pB" }),
    ).rejects.toMatchObject({ code: "already_replied" });

    // Contract level: the handle is consumed — a single turn cannot be relayed
    // as a SECOND reply on the same request.
    await expect(
      lane(w, "pB").reply(req1.intent, {
        channel_id: CH,
        kind: "work.ack",
        body: { refs: [req1.message_id], decision: "again" },
        audience: { action_targets: ["pA"], visibility: "targets" },
        idempotency_key: "r1-dup",
        correlation_id: req1.intent.request_id,
      }),
    ).rejects.toMatchObject({ code: "already_replied" });
  });

  test("13. identity death: activation identity survives process simulation; provider session ids are structurally excluded from identity", async () => {
    const w = await world();
    const req = await requestFrom(w, "k1", "pA", "pB");
    await w.registry.enterWaiting("act-77", "pA", ["obl:k1"]);

    // Process death + new registry/ledger instances: identity survives.
    const w2 = await restart(w);
    const rec = w2.registry.get("act-77")!;
    expect(rec.activation_id).toBe("act-77");
    expect(rec.participant_id).toBe("pA");
    expect(rec.state).toBe("waiting_on_channel");

    // Wake routing after restart works off activation_id alone.
    const rep = await replyTo(w2, req, "pB", "r1");
    const { outcomes } = await deliverReply(w2, rep, "k1", "pB");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.activation_id).toBe("act-77");

    // Structural exclusion: strict schemas reject provider-session smuggling.
    expect(() =>
      WaitingEventSchema.parse({
        schema_version: WAITING_STATE_SCHEMA_VERSION,
        type: "waiting.entered",
        activation_id: "act-77",
        participant_id: "pA",
        obligation_ids: ["obl:k1"],
        at_ms: 1,
        deadline_ms: null,
        pi_session_id: "sess_abc123",
      }),
    ).toThrow();

    // Grep-level + behavioral: no identity-bearing projection (waiting events,
    // obligation events, scheduler intents) ever carries session/job identity keys.
    const identityBlob = JSON.stringify({
      waits: await w2.waitJ.readAll(),
      obligations: await w2.oblJ.readAll(),
      intents: await w2.intentJ.readAll(),
    });
    expect(identityBlob.includes('"session_id"')).toBe(false);
    expect(identityBlob.includes('"pi_session_id"')).toBe(false);
    expect(identityBlob.includes('"job_id"')).toBe(false);

    // Source-level: pi_session_id appears in the waiting contracts ONLY inside
    // documentation comments (documented absence), never as a schema field.
    const src = await Bun.file(new URL("../src/waiting/schemas.ts", import.meta.url)).text();
    const offending = src.split("\n").filter((l) => l.includes("session_id") && !/^\s*(\/\/|\*|\/\*)/.test(l));
    expect(offending).toEqual([]);
  });

  test("14. byte-determinism: identical op sequences across all four layers → byte-identical journals", async () => {
    const run = async () => {
      const w = await world();
      // channel-comm + obligation: full request/reply round trip.
      const req = await requestFrom(w, "k1", "pA", "pB", { mandatory: true });
      await w.registry.enterWaiting("act-pA", "pA", ["obl:k1"]);
      const rep = await replyTo(w, req, "pB", "r1");
      // Rejection audit-twin fact.
      await lane(w, "pA")
        .send({ channel_id: CH, kind: "work.turn", body: {}, audience: { action_targets: [], visibility: "chain" }, idempotency_key: "bad" })
        .catch(() => {});
      // waiting: wake + expiry generations.
      await deliverReply(w, rep, "k1", "pB");
      await w.ledger.settle("obl:k1", "ev:settle-1");
      w.clk.advance(60_000);
      await requestFrom(w, "k2", "pA", "pB");
      await w.registry.enterWaiting("act-pA", "pA", ["obl:k2"], w.clk.now() + 1_000);
      w.clk.advance(2_000);
      await w.registry.expireWaiters();
      // Cursors (global-id positions scoped to the one channel).
      const svc = lane(w, "pA");
      await svc.advanceRead(CH, "pA", 3);
      await svc.ackUpTo(CH, "pA", 2);
      // finalize: operator void with resolving evidence.
      const evidence: SettlementEvidenceEntry[] = [];
      const ctl = new FinalizeController(w.ledger, {
        now: w.clk.now,
        evidence: {
          async append(e) {
            evidence.push(e);
          },
        },
      });
      await ctl.voidObligation("obl:k2", "operator", "override", "ev:void-1");
      const verdict = await check(w, "pB");
      return {
        comm: w.comm.lines(),
        obligations: w.oblJ.lines(),
        waits: w.waitJ.lines(),
        intents: w.intentJ.lines(),
        evidence,
        verdict,
        waitRecords: w.registry.list(),
        obligationRecords: w.ledger.list(),
        cursors: await w.comm.getCursors(CH, "pA"),
      };
    };
    expect(await run()).toEqual(await run());
  });

  test("15. same-idempotency-key across TWO service instances: one durable envelope; both callers resolve to the FIRST outcome; zero downstream duplicates", async () => {
    /** Store seam carrying the service contract for real (commit() docblock:
     *  "nothing is duplicated — store contract enforced at this seam"): the
     *  SQL UNIQUE(idempotency_key) analog lives INSIDE append(). The
     *  check+insert pair runs synchronously in one JS turn, so concurrent
     *  writers that both miss their earlier findByIdempotencyKey probe still
     *  land on exactly one row, regardless of interleaving. */
    function atomicKeyStore(): ChannelCommStore & { lines: () => string[] } {
      const lines: string[] = [];
      const byKey = new Map<string, StoredEnvelope>();
      let nextId = 0;
      return {
        async append(env: StoredEnvelope) {
          const existing = byKey.get(env.idempotency_key);
          if (existing) return structuredClone(existing);
          const stored = { ...structuredClone(env), id: ++nextId };
          lines.push(stableStringify(stored));
          byKey.set(stored.idempotency_key, stored);
          return structuredClone(stored);
        },
        async readChannel(filter) {
          return [...byKey.values()]
            .filter((m) => !filter?.channel_id || m.channel_id === filter.channel_id)
            .map((m) => structuredClone(m));
        },
        async findByIdempotencyKey(key) {
          const hit = byKey.get(key);
          return hit ? structuredClone(hit) : null;
        },
        async getCursors(cid, pid) {
          void cid;
          void pid;
          return emptyChannelCursors();
        },
        async setCursors() {},
        lines: () => [...lines],
      };
    }

    // One store, TWO instances of the same participant authority — the crash-
    // retry replica shape (same lane resurrected in two processes).
    const clk = mkClock();
    const store = atomicKeyStore();
    const laneA = new ChannelCommunicationService(
      { participant_id: "pW", participant_class: "participant" },
      store,
      { now: clk.now },
    );
    const laneB = new ChannelCommunicationService(
      { participant_id: "pW", participant_class: "participant" },
      store,
      { now: clk.now },
    );
    const responder = new ChannelCommunicationService(
      { participant_id: "pR", participant_class: "participant" },
      store,
      { now: clk.now },
    );
    const seenProposals: string[] = [];

    // Interleaving stress: launch order ALTERNATES per round; every round must
    // deterministically converge to ONE envelope per key.
    for (let round = 0; round < 25; round++) {
      const key = `storm-${round}`;
      const racers = round % 2 === 0 ? [laneA, laneB] : [laneB, laneA];
      const draftBase = {
        channel_id: CH,
        kind: "work.proposal" as const,
        body: { proposal_class: "evaluation_request", summary: "dup-key race" },
        audience: { action_targets: ["pR"], visibility: "targets" as const },
        idempotency_key: key,
      };

      if (round % 2 === 0) {
        // request()/request() race: both resolve; second REUSES the first's
        // committed outcome (ids) instead of minting a twin.
        const [x, y] = await Promise.all([
          racers[0]!.request({ ...draftBase, expects_reply_from: ["pR"] }),
          racers[1]!.request({ ...draftBase, expects_reply_from: ["pR"] }),
        ]);
        expect(x.message_id).toBe(y.message_id);
        expect(x.seq).toBe(y.seq);
        expect(x.id).toBeDefined();
        expect(x.id).toBe(y.id);
        expect(y.intent).toEqual(x.intent); // identical handle ⇒ same handle value
      } else {
        // send()/send() race over the same guarantees.
        const [a, b] = await Promise.all([racers[0]!.send(draftBase), racers[1]!.send(draftBase)]);
        expect(a.message_id).toBe(b.message_id);
        expect(a.id).toBe(b.id);
        expect(a.seq).toBe(b.seq);
      }

      // Exactly ONE durable envelope for this key.
      const durables = store.lines().filter((l) => l.includes(`"idempotency_key":"${key}"`));
      expect(durables).toHaveLength(1);

      // Downstream inbox never observes a duplicate proposal across ALL rounds.
      const items = (await responder.inbox({ participant_id: "pR", viewer_class: "participant" })).items;
      const proposals = items.filter((m) => m.kind === "work.proposal");
      expect(proposals).toHaveLength(seenProposals.length + 1);
      const msgId = proposals[proposals.length - 1]!.message_id;
      expect(seenProposals.includes(msgId)).toBe(false);
      seenProposals.push(msgId);
    }

    // Global integrity after the storm: distinct keys kept DISTINCT rows and ids.
    expect(store.lines()).toHaveLength(25);
    const ids = new Set(store.lines().map((l) => (JSON.parse(l) as StoredEnvelope).id));
    expect(ids.size).toBe(25);
  });
});
