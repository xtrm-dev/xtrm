import { strict as assert } from "node:assert"
import { test } from "node:test"

import { applyIntercomResults, intercomFromEntry } from "../server/intercom.ts"
import { channelTimeline, dedupeIntercoms } from "../src/lib/thread.ts"
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

test("dedupe keeps a failure when the received copy arrives", () => {
  const sent = intercom("a", 1, 1_000, "sent", "hello", {
    toolCallId: "call-3",
    failed: true,
    delivery: "failed",
    error: "Session not found",
  })
  const received = intercom("b", 1, 2_000, "received", "hello", { messageId: "m-3" })
  const [out] = dedupeIntercoms([sent, received])
  assert.equal(out.intercom?.failed, true)
  assert.equal(out.intercom?.delivery, "failed")
  assert.equal(out.intercom?.error, "Session not found")
})
