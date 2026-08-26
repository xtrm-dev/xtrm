import { describe, expect, test } from "bun:test";
import {
  ChannelCommunicationService,
  ChannelValidationError,
  type ChannelCommStore,
  type ParticipantCursors,
  type StoredEnvelope,
} from "../src/channel-comm/index.ts";

/** Deterministic in-memory fake store. */
function fakeStore(): ChannelCommStore {
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

const NOW = 1_700_000_000_000;
const mk = (pid: string, cls: Parameters<typeof ChannelCommunicationService.prototype.send>[0] extends never ? never : any) =>
  new ChannelCommunicationService({ participant_id: pid, participant_class: cls }, fakeStore(), { now: () => NOW });

const CH = "chain:t1";

describe("channel-comm semantic contracts", () => {
  test("valid send per family", async () => {
    const cases: Array<[string, any, any]> = [
      ["work.turn", { summary: "did the thing", refs: { result_id: "r1" } }, "participant"],
      ["work.finding", { severity: "blocking", summary: "boom" }, "participant"],
      ["work.verdict", { verdict: "PASS", summary: "ok", findings: [] }, "reviewer-policy"],
      ["work.proposal", { proposal_class: "terminate", summary: "done?" }, "participant"],
      ["work.ack", { refs: [`${CH}#1`], decision: "accept" }, "participant"],
      ["control.steer", { instruction: "focus retries" }, "coordinator"],
      ["control.attention_requested", { reason: "need context", scope_refs: [], refs: [] }, "participant"],
      ["control.escalation", { reason: "stuck" }, "participant"],
      ["system.continue", { reason: "go" }, "runtime"],
      ["system.done", { reason: "r", outcome: "pass" }, "runtime"],
      ["runtime.error", { error_code: "E", likely_cause: "c" }, "runtime"],
    ];
    let n = 0;
    const store = fakeStore();
    for (const [kind, body, cls] of cases) {
      const svc = new ChannelCommunicationService(
        { participant_id: `lane-${cls}`, participant_class: cls },
        store,
        { now: () => NOW },
      );
      const res = await svc.send({
        channel_id: CH,
        kind,
        body,
        audience: { action_targets: ["p2"], visibility: "chain" },
        idempotency_key: `k-${kind}`,
      });
      n += 1;
      expect(res.seq).toBe(n);
      expect(res.message_id).toBe(`${CH}#${n}`);
    }
  });

  test("malformed kind and unknown family rejected deterministically", async () => {
    const svc = mk("p1", "participant");
    const base = { channel_id: CH, audience: { action_targets: ["p2"], visibility: "chain" }, idempotency_key: "x" };
    const bads = [
      { ...base, kind: "work.nope", body: {} },
      { ...base, kind: "family.kind", body: {} },
      { ...base, kind: "work.turn", body: {} },
      { ...base, kind: "work.verdict", body: { verdict: "PASS", summary: "s" }, audience: { action_targets: [], visibility: "chain" } },
    ];
    for (const bad of bads) {
      await expect(svc.send(bad as any)).rejects.toBeInstanceOf(ChannelValidationError);
      // deterministic: same rejection shape on repeat
      await expect(svc.send(structuredClone(bad))).rejects.toMatchObject({ name: "ChannelValidationError" });
    }
  });

  test("authority: participant cannot emit system.*, runtime can, reviewer-policy may emit verdicts", async () => {
    const store = fakeStore();
    const lane = (pid: string, cls: any) =>
      new ChannelCommunicationService({ participant_id: pid, participant_class: cls }, store, { now: () => NOW });
    const participant = lane("p1", "participant");
    const runtime = lane("rt", "runtime");
    const reviewerPolicy = lane("rev", "reviewer-policy");
    const done = {
      channel_id: CH,
      kind: "system.done" as const,
      body: { reason: "r", outcome: "pass" },
      audience: { action_targets: [], visibility: "chain" as const },
      idempotency_key: "sys-done",
    };
    await expect(participant.send(done)).rejects.toMatchObject({ code: "authority_denied" });
    await expect(runtime.send(done)).resolves.toMatchObject({ seq: 1 });
    const verdict = {
      channel_id: CH,
      kind: "work.verdict" as const,
      body: { verdict: "FAIL" as const, summary: "nope" },
      audience: { action_targets: ["p1"], visibility: "targets" as const },
      idempotency_key: "v1",
    };
    await expect(reviewerPolicy.send(verdict)).resolves.toMatchObject({ seq: 2 });
    await expect(participant.send({ ...verdict, idempotency_key: "v2" })).rejects.toMatchObject({ code: "authority_denied" });
  });

  test("author injection from call args is REJECTED (host-injected only)", async () => {
    const svc = mk("p1", "participant");
    await expect(
      svc.send({
        channel_id: CH,
        kind: "work.turn",
        body: { summary: "hi" },
        audience: { action_targets: ["p2"], visibility: "chain" },
        idempotency_key: "a1",
        // smuggled identity:
        author: { participant_id: "god", participant_class: "runtime" },
      } as any),
    ).rejects.toBeInstanceOf(ChannelValidationError);
    await expect(
      svc.send({
        channel_id: CH,
        kind: "work.turn",
        body: { summary: "hi", role: "runtime" },
        audience: { action_targets: ["p2"], visibility: "chain" },
        idempotency_key: "a2",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  test("routing hard + attention soft", async () => {
    const p1 = mk("p1", "participant");
    await p1.send({
      channel_id: CH,
      kind: "work.turn",
      body: { summary: "status" },
      audience: { action_targets: ["p2"], visibility: "chain" },
      idempotency_key: "r1",
    });
    const p2 = new ChannelCommunicationService({ participant_id: "p2", participant_class: "participant" }, p1["store"], { now: () => NOW });
    const p3 = new ChannelCommunicationService({ participant_id: "p3", participant_class: "participant" }, p1["store"], { now: () => NOW });
    const in2 = await p2.inbox({ participant_id: "p2", viewer_class: "participant" });
    expect(in2.items).toHaveLength(1);
    expect(in2.items[0]!.addressed).toBe(true);
    expect(in2.items[0]!.attention_only).toBe(false);
    const in3 = await p3.inbox({ participant_id: "p3", viewer_class: "participant" });
    expect(in3.items).toHaveLength(1); // chain-visible: aware
    expect(in3.items[0]!.addressed).toBe(false);
    expect(in3.items[0]!.attention_only).toBe(true); // attention surface flag, not a target
  });

  test("visibility inclusion rule per class", async () => {
    const store = fakeStore();
    const coord = new ChannelCommunicationService({ participant_id: "coord", participant_class: "coordinator" }, store, { now: () => NOW });
    await coord.send({ channel_id: CH, kind: "work.turn", body: { summary: "s" }, audience: { action_targets: ["pb"], visibility: "private" }, idempotency_key: "priv" });
    await coord.send({ channel_id: CH, kind: "work.turn", body: { summary: "s" }, audience: { action_targets: ["pt"], visibility: "targets" }, idempotency_key: "tgt" });
    await coord.send({ channel_id: CH, kind: "work.turn", body: { summary: "s" }, audience: { action_targets: [], visibility: "operator" }, idempotency_key: "op" });
    await coord.send({ channel_id: CH, kind: "work.turn", body: { summary: "s" }, audience: { action_targets: [], visibility: "chain" }, idempotency_key: "chn" });
    const vis = async (viewer: { participant_id: string; viewer_class: any }) =>
      (await coord.inbox(viewer)).items.map((m) => m.idempotency_key).sort();
    expect(await vis({ participant_id: "pa", viewer_class: "participant" })).toEqual(["chn"]); // chain only
    expect(await vis({ participant_id: "pb", viewer_class: "participant" })).toEqual(["chn", "priv"]); // private target
    expect(await vis({ participant_id: "pt", viewer_class: "participant" })).toEqual(["chn", "tgt"]);
    expect(await vis({ participant_id: "cx", viewer_class: "coordinator" })).toEqual(["chn", "op", "priv", "tgt"]);
    expect(await vis({ participant_id: "op1", viewer_class: "operator" })).toEqual(["chn", "op"]);
  });

  test("request -> reply correlation: match ok, mismatch rejected, double reply rejected", async () => {
    const store = fakeStore();
    const requester = new ChannelCommunicationService({ participant_id: "p1", participant_class: "participant" }, store, { now: () => NOW });
    const replier = new ChannelCommunicationService({ participant_id: "p2", participant_class: "participant" }, store, { now: () => NOW });
    const other = new ChannelCommunicationService({ participant_id: "p9", participant_class: "participant" }, store, { now: () => NOW });
    const { intent } = await requester.request({
      channel_id: CH,
      kind: "work.proposal",
      body: { proposal_class: "evaluation_request", summary: "check my work" },
      audience: { action_targets: ["p2"], visibility: "targets" },
      idempotency_key: "eval-1",
      expects_reply_from: ["p2"],
    });
    expect(intent.request_id).toBe("req:eval-1");
    // mismatched correlation_id
    await expect(
      replier.reply(intent, {
        channel_id: CH,
        kind: "work.ack",
        body: { refs: [intent.request_message_id], decision: "accept" },
        audience: { action_targets: ["p1"], visibility: "targets" },
        idempotency_key: "rep-bad",
        correlation_id: "req:other",
      }),
    ).rejects.toMatchObject({ code: "correlation_mismatch" });
    // replier must be in expects.reply_from
    await expect(
      other.reply(intent, {
        channel_id: CH,
        kind: "work.ack",
        body: { refs: [intent.request_message_id], decision: "accept" },
        audience: { action_targets: ["p1"], visibility: "targets" },
        idempotency_key: "rep-other",
        correlation_id: intent.request_id,
      }),
    ).rejects.toMatchObject({ code: "reply_not_expected_from" });
    // valid reply
    const rep = await replier.reply(intent, {
      channel_id: CH,
      kind: "work.ack",
      body: { refs: [intent.request_message_id], decision: "accept" },
      audience: { action_targets: ["p1"], visibility: "targets" },
      idempotency_key: "rep-ok",
      correlation_id: intent.request_id,
    });
    expect(rep.message_id).toBe(`${CH}#2`);
    // double reply at contract level: handle consumed
    await expect(
      replier.reply(intent, {
        channel_id: CH,
        kind: "work.ack",
        body: { refs: [intent.request_message_id], decision: "accept again" },
        audience: { action_targets: ["p1"], visibility: "targets" },
        idempotency_key: "rep-dup",
        correlation_id: intent.request_id,
      }),
    ).rejects.toMatchObject({ code: "already_replied" });
  });

  test("read != ack: advancing read never advances ack; ack-set stays queryable", async () => {
    const store = fakeStore();
    const runtime = new ChannelCommunicationService({ participant_id: "rt", participant_class: "runtime" }, store, { now: () => NOW });
    for (const i of [1, 2]) {
      await runtime.send({
        channel_id: CH,
        kind: "system.epoch_bump",
        body: { reason: `r${i}` },
        audience: { action_targets: ["p1"], visibility: "targets" },
        idempotency_key: `bump-${i}`,
      });
    }
    const p1 = new ChannelCommunicationService({ participant_id: "p1", participant_class: "participant" }, store, { now: () => NOW });
    const v = { participant_id: "p1", viewer_class: "participant" as const };
    expect((await p1.inbox(v)).items).toHaveLength(2);
    await p1.advanceRead("p1", 2);
    let cur = await store.getCursors("p1");
    expect(cur.last_read_seq).toBe(2);
    expect(cur.last_ack_seq).toBe(0);
    expect((await p1.inbox(v)).items).toHaveLength(0); // read excludes
    expect(await p1.pendingAck(v)).toHaveLength(2); // ack-set still queryable
    await p1.ackUpTo("p1", 1);
    cur = await store.getCursors("p1");
    expect(cur.last_read_seq).toBe(2); // ack did not rewind/mutate read
    expect(cur.last_ack_seq).toBe(1);
    expect(await p1.pendingAck(v)).toHaveLength(1);
  });

  test("idempotent append: same idempotency_key twice -> same message, no duplicate", async () => {
    const svc = mk("rt", "runtime");
    const draft = {
      channel_id: CH,
      kind: "system.continue" as const,
      body: { reason: "go" },
      audience: { action_targets: [], visibility: "chain" as const },
      idempotency_key: "same-key",
    };
    const first = await svc.send(draft);
    const second = await svc.send(draft);
    expect(second).toEqual(first);
    const stream = await svc["store"].readChannel({});
    expect(stream).toHaveLength(1);
  });

  test("determinism: identical stores + calls -> identical outputs", async () => {
    const run = async () => {
      const store = fakeStore();
      const rt = new ChannelCommunicationService({ participant_id: "rt", participant_class: "runtime" }, store, { now: () => NOW });
      const p1 = new ChannelCommunicationService({ participant_id: "p1", participant_class: "participant" }, store, { now: () => NOW });
      const p2 = new ChannelCommunicationService({ participant_id: "p2", participant_class: "reviewer-policy" }, store, { now: () => NOW });
      await rt.send({ channel_id: CH, kind: "system.continue", body: { reason: "go" }, audience: { action_targets: ["p1"], visibility: "targets" }, idempotency_key: "c1" });
      const req = await p1.request({
        channel_id: CH,
        kind: "work.proposal",
        body: { proposal_class: "evaluation_request", summary: "check" },
        audience: { action_targets: ["p2"], visibility: "private" },
        idempotency_key: "rq1",
        expects_reply_from: ["p2"],
      });
      const reply = await p2.reply(req.intent, {
        channel_id: CH,
        kind: "work.ack",
        body: { refs: [req.message_id], decision: "accept" },
        audience: { action_targets: ["p1"], visibility: "private" },
        idempotency_key: "rp1",
        correlation_id: req.intent.request_id,
      });
      return { stream: await store.readChannel({}), req, reply };
    };
    expect(JSON.stringify(await run())).toEqual(JSON.stringify(await run()));
  });
});
