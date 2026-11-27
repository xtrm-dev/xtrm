import { strict as assert } from "node:assert"
import { test } from "node:test"

import { applyIntercomResults, intercomFromEntry, intercomPairKey as bodyPairKey } from "../server/intercom.ts"
import { normalizeEvent } from "../server/session.ts"
import { channelTimeline, channelTurns, dedupeIntercoms, intercomPairKey } from "../src/lib/thread.ts"
import type { IntercomDirection, ViewerEvent } from "../src/shared/types.ts"

function event(
  agentId: string,
  seq: number,
  at: number,
  kind: ViewerEvent["kind"],
  extra: Partial<ViewerEvent> = {},
): ViewerEvent {
  return {
    id: `${agentId}:${seq}`,
    agentId,
    agentName: agentId,
    seq,
    at,
    kind,
    role: kind === "user" ? "user" : "assistant",
    summary: `${kind} ${seq}`,
    onBranch: true,
    ...extra,
  }
}

function intercom(
  agentId: string,
  seq: number,
  at: number,
  direction: IntercomDirection,
  body: string,
  extra: Partial<NonNullable<ViewerEvent["intercom"]>> = {},
): ViewerEvent {
  const from = direction === "sent" ? agentId : "a"
  const to = direction === "sent" ? "b" : agentId
  return event(agentId, seq, at, "intercom", {
    intercom: {
      direction,
      from,
      to,
      body,
      delivery: direction === "sent" ? "sent" : "received",
      ...extra,
    },
  })
}

test("pair identity hashes the full body, not the 160-char display cut", () => {
  const shared = "word ".repeat(40).slice(0, 160)
  const first = `${shared}alpha`
  const second = `${shared}beta`
  assert.equal(first.slice(0, 160), second.slice(0, 160))
  assert.notEqual(bodyPairKey(first), bodyPairKey(second))

  const base = { from: "a", to: "b", body: shared }
  assert.notEqual(
    intercomPairKey({ ...base, pairKey: bodyPairKey(first) }),
    intercomPairKey({ ...base, pairKey: bodyPairKey(second) }),
  )
  assert.equal(intercomPairKey(base), intercomPairKey({ ...base }))
})

test("sent and received copies collapse to the send position with the receiver id", () => {
  const sent = intercom("a", 1, 1_000, "sent", "the same body")
  const received = intercom("b", 1, 1_000 + 10 * 60_000, "received", "the same body", {
    messageId: "msg-1",
  })
  const out = dedupeIntercoms([sent, received])
  assert.equal(out.length, 1)
  assert.equal(out[0].intercom?.direction, "sent")
  assert.equal(out[0].at, 1_000)
  assert.equal(out[0].intercom?.messageId, "msg-1")
  assert.equal(out[0].intercom?.delivery, "delivered")
})

test("envelope entities decode before dedupe", () => {
  const meta = intercomFromEntry(
    {
      type: "custom_message",
      customType: "intercom_message",
      content:
        '<cross-session-message message-id="m-1" from="a" from-name="a">use &lt;div&gt; &amp; stop</cross-session-message>',
      timestamp: 1_000,
    },
    { name: "b" },
  )
  assert.equal(meta?.body, "use <div> & stop")
  assert.equal(meta?.messageId, "m-1")
})

test("unrelated bodies and stale pairs are not collapsed", () => {
  const sent = intercom("a", 1, 1_000, "sent", "first")
  const different = intercom("b", 1, 1_100, "received", "second")
  const stale = intercom("b", 2, 1_000 + 31 * 60_000, "received", "first")
  assert.equal(dedupeIntercoms([sent, different]).length, 2)
  assert.equal(dedupeIntercoms([sent, stale]).length, 2)
})

test("timeline keeps a received card and the prompt at their own times", () => {
  const received = intercom("b", 1, 1_000, "received", "do the thing", {
    messageId: "msg-2",
  })
  const prompt = event("b", 2, 2_000, "user", { text: "go" })
  const working = event("b", 3, 3_000, "assistant", {
    parts: [{ type: "tool-call", toolName: "bash", toolCallId: "call-1" }],
    stopReason: "toolUse",
  })
  const sent = intercom("a", 2, 4_000, "sent", "meanwhile")
  const final = event("b", 4, 10_000, "assistant", {
    parts: [{ type: "text", text: "done" }],
    stopReason: "stop",
    text: "done",
  })

  const items = channelTimeline([final, prompt, sent, working, received])
  assert.deepEqual(
    items.map((item) =>
      item.kind === "user"
        ? `user:${item.at}`
        : item.kind === "intercom"
          ? `intercom:${item.at}`
          : item.kind === "turn"
            ? `turn:${item.at}`
            : "optimistic",
    ),
    ["intercom:1000", "user:2000", "intercom:4000", "turn:10000"],
  )
})

test("a sent card needs no turn row and a pending turn stays last", () => {
  const sent = intercom("a", 1, 1_000, "sent", "status")
  const received = intercom("b", 1, 2_000, "received", "question")
  const working = event("b", 2, 3_000, "assistant", {
    parts: [{ type: "tool-call", toolName: "bash", toolCallId: "call-1" }],
    stopReason: "toolUse",
  })
  const items = channelTimeline([sent, received, working])
  const turns = items.filter((item) => item.kind === "turn")
  assert.equal(turns.length, 1)
  assert.equal(turns[0].kind === "turn" && turns[0].turn.pending, true)
  assert.equal(items.at(-1)?.kind, "turn")
  assert.equal(items.filter((item) => item.kind === "intercom").length, 2)
})

test("a failed SendMessage result marks its sent card", () => {
  const sent = intercom("a", 1, 1_000, "sent", "hello", { toolCallId: "call-1" })
  const result = event("a", 2, 1_100, "meta", {
    toolName: "SendMessage",
    toolCallId: "call-1",
    isError: true,
    output: 'Message to "gone" was not delivered: Session not found',
  })
  const [out] = applyIntercomResults([sent, result])
  assert.equal(out.intercom?.failed, true)
  assert.equal(out.intercom?.delivery, "failed")
  assert.match(out.intercom?.error ?? "", /not delivered/)
  assert.equal(out.isError, true)
})

test("a successful SendMessage result leaves the card sent", () => {
  const sent = intercom("a", 1, 1_000, "sent", "hello", { toolCallId: "call-2" })
  const result = event("a", 2, 1_100, "meta", {
    toolName: "SendMessage",
    toolCallId: "call-2",
    isError: false,
    output: "Delivered to Pi session b",
  })
  const [out] = applyIntercomResults([sent, result])
  assert.equal(out.intercom?.failed, false)
  assert.equal(out.intercom?.delivery, "delivered")
})

test("a received copy clears a stale failure", () => {
  const sent = intercom("a", 1, 1_000, "sent", "hello", {
    toolCallId: "call-3",
    failed: true,
    delivery: "failed",
    error: "Session not found",
  })
  const received = intercom("b", 1, 2_000, "received", "hello", { messageId: "m-3" })
  const [out] = dedupeIntercoms([sent, received])
  assert.equal(out.intercom?.failed, undefined)
  assert.equal(out.intercom?.delivery, "delivered")
  assert.equal(out.intercom?.error, undefined)
  assert.equal(out.isError, false)
})

test("a successful retry upgrades a failed send before the received copy arrives", () => {
  const failed = intercom("a", 1, 1_000, "sent", "hello", {
    toolCallId: "call-fail",
    failed: true,
    delivery: "failed",
    error: "Session not found",
  })
  const success = intercom("a", 2, 2_000, "sent", "hello", {
    toolCallId: "call-ok",
    failed: false,
    delivery: "delivered",
  })
  const [out] = dedupeIntercoms([failed, success])
  assert.equal(out.intercom?.failed, undefined)
  assert.equal(out.intercom?.delivery, "delivered")
  assert.equal(out.intercom?.error, undefined)
  assert.equal(out.intercom?.toolCallId, "call-ok")
  assert.equal(out.isError, false)
})

test("a failed-then-retried message and its received copy collapse to one delivered card", () => {
  const failed = intercom("a", 1, 1_000, "sent", "hello", {
    toolCallId: "call-fail",
    failed: true,
    delivery: "failed",
    error: "Session not found",
  })
  const success = intercom("a", 2, 2_000, "sent", "hello", {
    toolCallId: "call-ok",
    failed: false,
    delivery: "delivered",
  })
  const received = intercom("b", 1, 3_000, "received", "hello", { messageId: "m-4" })
  const out = dedupeIntercoms([failed, success, received])
  assert.equal(out.length, 1)
  assert.equal(out[0].intercom?.failed, undefined)
  assert.equal(out[0].intercom?.delivery, "delivered")
  assert.equal(out[0].intercom?.error, undefined)
  assert.equal(out[0].intercom?.messageId, "m-4")
})

test("bodies longer than the 40,000-character cap still collapse to one card", () => {
  const body = "x".repeat(45_000)
  const sent = intercom("a", 1, 1_000, "sent", body, { toolCallId: "call-long" })
  const received = intercom("b", 1, 2_000, "received", body, { messageId: "m-long" })
  const out = dedupeIntercoms([sent, received])
  assert.equal(out.length, 1)
  assert.equal(out[0].intercom?.body.length, 45_000)
})

test("three intercom calls in one Pi assistant entry make three paired cards", () => {
  const call = (id: string, to: string, body: string) => ({
    type: "toolCall",
    id,
    name: "SendMessage",
    arguments: { to, message: body, summary: `to ${to}` },
  })
  const entry = {
    type: "message",
    id: "entry-1",
    timestamp: 1_000,
    message: {
      role: "assistant",
      content: [
        call("call-1", "b", "first body"),
        call("call-2", "c", "second body"),
        call("call-3", "d", "third body"),
      ],
      stopReason: "toolUse",
    },
  }
  const result = (seq: number, toolCallId: string, output: string, isError = false) => ({
    type: "message",
    id: `result-${seq}`,
    timestamp: 1_000 + seq * 100,
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "SendMessage",
      content: [{ type: "text", text: output }],
      isError,
    },
  })

  const events = [
    normalizeEvent(entry, { id: "a", name: "a" }, 0, true),
    normalizeEvent(result(1, "call-1", "Delivered to Pi session b"), { id: "a", name: "a" }, 1, true),
    normalizeEvent(result(2, "call-2", "Message to c was not delivered", true), { id: "a", name: "a" }, 2, true),
    normalizeEvent(result(3, "call-3", "Delivered to Pi session d"), { id: "a", name: "a" }, 3, true),
  ]
  assert.equal(events[0].intercoms?.length, 3)

  const mapped = applyIntercomResults(events)
  assert.match(mapped[0].summary, /· failed$/)
  assert.equal(mapped[0].isError, true)
  const cards = channelTimeline(mapped).filter((item) => item.kind === "intercom")
  assert.equal(cards.length, 3)
  assert.deepEqual(
    cards.map((item) => item.kind === "intercom" && item.event.intercom?.to),
    ["b", "c", "d"],
  )
  assert.deepEqual(
    cards.map((item) => item.kind === "intercom" && item.event.intercom?.delivery),
    ["delivered", "failed", "delivered"],
  )
  assert.deepEqual(
    cards.map((item) => item.kind === "intercom" && item.event.intercom?.toolCallId),
    ["call-1", "call-2", "call-3"],
  )
  assert.deepEqual(
    cards.map((item) => item.kind === "intercom" && item.event.isError === true),
    [false, true, false],
    "each card carries its own delivery failure, not the entry-level flag",
  )
  const turns = channelTurns(mapped)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].sent.length, 3)
  assert.equal(turns[0].activity.length, 0)
})


test("a truncated card does not mark its siblings truncated", () => {
  const call = (id: string, body: string) => ({
    type: "toolCall",
    id,
    name: "SendMessage",
    arguments: { to: "b", message: body, summary: "to b" },
  })
  const entry = {
    type: "message",
    id: "entry-long",
    timestamp: 1_000,
    message: {
      role: "assistant",
      content: [call("call-short", "short body"), call("call-long", "x".repeat(45_000))],
      stopReason: "toolUse",
    },
  }
  const event = normalizeEvent(entry, { id: "a", name: "a" }, 0, true)
  assert.equal(event.intercoms?.length, 2)
  assert.equal(event.truncated, undefined, "the entry is not truncated; its cards are")
  assert.equal(event.intercoms?.[0].truncated, undefined)
  assert.equal(event.intercoms?.[1].truncated, true)
  const cards = channelTimeline([event]).filter((item) => item.kind === "intercom")
  assert.deepEqual(
    cards.map((item) => item.kind === "intercom" && Boolean(item.event.truncated)),
    [false, true],
  )
})

test("a single intercom call keeps the entry's other tool work", () => {
  const entry = {
    type: "message",
    id: "entry-mixed",
    timestamp: 1_000,
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-send",
          name: "SendMessage",
          arguments: { to: "b", message: "one message", summary: "to b" },
        },
        {
          type: "toolCall",
          id: "call-bash",
          name: "bash",
          arguments: { command: "echo after send" },
        },
      ],
      stopReason: "toolUse",
    },
  }
  const event = normalizeEvent(entry, { id: "a", name: "a" }, 0, true)
  assert.equal(event.intercoms?.length, 1)
  assert.ok(event.parts?.some((part) => part.type === "tool-call" && part.toolName === "bash"))

  const timeline = channelTimeline([event])
  const cards = timeline.filter((item) => item.kind === "intercom")
  assert.equal(cards.length, 1)
  const turns = channelTurns([event])
  assert.equal(turns.length, 1)
  assert.equal(turns[0].activity.length, 1)
  assert.match(turns[0].activity[0].summary, /echo after send/)
})

test("a delivery-failed card does not rely on the entry-level error flag", () => {
  const entry = event("a", 0, 1_000, "assistant", {
    isError: false,
    parts: [
      { type: "tool-call", toolCallId: "ok", toolName: "SendMessage", summary: "to b" },
      { type: "tool-call", toolCallId: "bad", toolName: "SendMessage", summary: "to c" },
    ],
    intercoms: [
      {
        direction: "sent", from: "a", to: "b", body: "fine", toolCallId: "ok",
        delivery: "delivered", runtime: "pi",
      },
      {
        direction: "sent", from: "a", to: "c", body: "lost", toolCallId: "bad",
        delivery: "failed", error: "not delivered", runtime: "pi",
      },
    ],
  })
  const cards = channelTimeline([entry]).filter((item) => item.kind === "intercom")
  assert.deepEqual(
    cards.map((item) => item.kind === "intercom" && item.event.isError === true),
    [false, true],
  )
})

test("a merged copy hands on an invisible carrier only when it opens or continues a turn", () => {
  const sent = intercom("a", 1, 1_000, "sent", "the same body")
  // Retries of the same send, cut from messages that ended the turn: no carrier, so no stopped
  // row from an invisible event and no reply that a meta event cannot apply.
  const aborted = { ...intercom("a", 2, 2_000, "sent", "the same body"), effect: "abort" as const }
  const replied = { ...intercom("a", 3, 3_000, "sent", "the same body"), effect: "reply" as const }
  // The receiver's copy wakes the receiver: it is carried.
  const received = { ...intercom("b", 1, 4_000, "received", "the same body"), effect: "open" as const }
  const carriers: ViewerEvent[] = []
  const out = dedupeIntercoms([sent, aborted, replied, received], carriers)
  assert.equal(out.length, 1)
  assert.deepEqual(
    carriers.map((carrier) => [carrier.agentId, carrier.kind, carrier.effect]),
    [["b", "meta", "open"]],
  )
})
