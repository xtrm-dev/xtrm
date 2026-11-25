import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  channelTimeline,
  channelTurns,
  turnAnchor,
  type ChannelItem,
} from "../src/lib/thread.ts"
import type { OptimisticMessage } from "../src/lib/optimistic.ts"
import type { ViewerEvent } from "../src/shared/types.ts"

/** Build a minimal ViewerEvent fixture. Timestamps are epoch milliseconds. */
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

function prompt(agentId: string, seq: number, at: number, text = "go"): ViewerEvent {
  return event(agentId, seq, at, "user", { text })
}

function working(agentId: string, seq: number, at: number): ViewerEvent {
  return event(agentId, seq, at, "assistant", {
    parts: [{ type: "tool-call", toolName: "bash", toolCallId: `call-${seq}` }],
    stopReason: "toolUse",
  })
}

function settled(agentId: string, seq: number, at: number, text = "done"): ViewerEvent {
  return event(agentId, seq, at, "assistant", {
    parts: [{ type: "text", text }],
    stopReason: "stop",
    text,
  })
}

function result(agentId: string, seq: number, at: number, callSeq: number): ViewerEvent {
  return event(agentId, seq, at, "tool-result", {
    toolName: "bash",
    toolCallId: `call-${callSeq}`,
    summary: "bash · ok",
  })
}

/** A compact, readable label for an ordered row. */
function label(item: ChannelItem): string {
  const who = item.agentName
  if (item.kind === "turn") return `turn:${who}:${item.at}${item.turn.pending ? ":pending" : ""}`
  if (item.kind === "user") return `user:${who}:${item.at}`
  return `optimistic:${who}:${item.at}`
}

function labels(items: ChannelItem[]): string[] {
  return items.map(label)
}

// 19:29-19:50 local on 2026-11-24, from the i1wb and jpnl session files.
const T = {
  i1wbPrompt: 1795544948146,
  i1wbSettle: 1795545184303,
  jpnlPrompt: 1795545220924,
  jpnlSettle: 1795545565000,
  i1wbNextPrompt: 1795545908679,
  i1wbWorking: 1795546005000,
  jpnlNextPrompt: 1795546076000,
  jpnlWorking: 1795546100000,
}

test("earlier start with later settle anchors at its settling event", () => {
  const items = channelTimeline([
    prompt("A", 0, 100),
    working("A", 1, 150),
    result("A", 2, 800, 1),
    settled("A", 3, 900),
    prompt("B", 0, 200),
    settled("B", 1, 600),
  ])

  assert.deepEqual(labels(items), [
    "user:A:100",
    "user:B:200",
    "turn:B:600",
    "turn:A:900",
  ])
})

test("later start with earlier settle comes before the longer turn", () => {
  const items = channelTimeline([
    prompt("A", 0, 100),
    settled("A", 1, 900),
    prompt("B", 0, 200),
    settled("B", 1, 600),
  ])

  const order = labels(items)
  assert.ok(order.indexOf("turn:B:600") < order.indexOf("turn:A:900"))
})

test("an operator message sent during a working turn keeps its send time", () => {
  const items = channelTimeline([
    prompt("A", 0, 100),
    working("A", 1, 200),
    prompt("A", 2, 300, "one more thing"),
    result("A", 3, 700, 1),
    settled("A", 4, 900),
  ])

  assert.deepEqual(labels(items), ["user:A:100", "user:A:300", "turn:A:900"])
  // The turn is one row anchored at 900; the prompt at 300 is not inside it.
  assert.equal(items.filter((item) => item.kind === "turn").length, 1)
})

test("two agents interleaved keep causal order", () => {
  const items = channelTimeline([
    prompt("A", 0, 100),
    settled("A", 1, 400),
    prompt("B", 0, 200),
    prompt("B", 1, 250, "and this"),
    settled("B", 2, 300),
  ])

  assert.deepEqual(labels(items), [
    "user:A:100",
    "user:B:200",
    "user:B:250",
    "turn:B:300",
    "turn:A:400",
  ])
})

test("a pending turn is last whatever its timestamps", () => {
  const items = channelTimeline([
    prompt("A", 0, 100),
    settled("A", 1, 200),
    prompt("B", 0, 50),
    working("B", 1, 950),
  ])

  assert.deepEqual(labels(items), [
    "user:B:50",
    "user:A:100",
    "turn:A:200",
    "turn:B:50:pending",
  ])
})

test("pending turns keep their order while their activity streams in", () => {
  const start = [
    prompt("A", 0, 100),
    settled("A", 1, 200),
    prompt("B", 0, 300),
    working("B", 1, 310),
    prompt("C", 0, 400),
    working("C", 1, 410),
  ]
  const streamed = [...start, result("B", 2, 900, 1), working("B", 3, 950)]

  assert.deepEqual(labels(channelTimeline(start)).slice(-2), [
    "turn:B:300:pending",
    "turn:C:400:pending",
  ])
  assert.deepEqual(labels(channelTimeline(streamed)).slice(-2), [
    "turn:B:300:pending",
    "turn:C:400:pending",
  ])
})

test("equal timestamps order user before turn, then by agent id", () => {
  const events = [
    settled("B", 1, 500),
    prompt("B", 0, 500),
    settled("A", 1, 500),
    prompt("A", 0, 500),
  ]

  assert.deepEqual(labels(channelTimeline(events)), [
    "user:A:500",
    "user:B:500",
    "turn:A:500",
    "turn:B:500",
  ])
})

test("the timeline is stable across polls and independent of input order", () => {
  const events = [
    prompt("A", 0, 100),
    working("A", 1, 150),
    prompt("B", 0, 120),
    result("A", 2, 400, 1),
    settled("A", 3, 500),
    settled("B", 1, 300),
  ]

  const first = labels(channelTimeline(events))
  const again = labels(channelTimeline([...events]))
  const reversed = labels(channelTimeline([...events].reverse()))
  const rotated = labels(channelTimeline([...events.slice(2), ...events.slice(0, 2)]))

  assert.deepEqual(again, first)
  assert.deepEqual(reversed, first)
  assert.deepEqual(rotated, first)
})

test("a turn without a settling timestamp falls back to its start", () => {
  const turn = channelTurns([
    prompt("A", 0, 100),
    event("A", 1, 0, "assistant", {
      parts: [{ type: "text", text: "reply" }],
      stopReason: "stop",
    }),
  ])[0]

  assert.equal(turn.final?.at, 0)
  assert.equal(turnAnchor(turn), 100)
})

test("a prompt without a timestamp stays with its turn", () => {
  const items = channelTimeline([
    event("A", 0, 0, "user", { text: "go" }),
    settled("A", 1, 700),
  ])

  assert.deepEqual(labels(items), ["user:A:700", "turn:A:700"])
  // Equal anchor: the prompt still renders before the reply it opened.
  assert.equal(items[0].kind, "user")
})

test("optimistic messages anchor at their send time and stay before a pending turn", () => {
  const optimistic: OptimisticMessage[] = [
    { id: "m1", paneId: "A", agentName: "A", text: "hello", at: 650, status: "sending" },
  ]
  const items = channelTimeline(
    [prompt("A", 0, 100), settled("A", 1, 500), prompt("A", 2, 600), working("A", 3, 900)],
    optimistic,
  )

  assert.deepEqual(labels(items), [
    "user:A:100",
    "turn:A:500",
    "user:A:600",
    "optimistic:A:650",
    "turn:A:600:pending",
  ])
})

test("the 07:33-07:39 i1wb/jpnl sequence settles in causal order", () => {
  const events = [
    // i1wb: 19:29 prompt, settled 19:33.
    prompt("i1wb", 0, T.i1wbPrompt),
    working("i1wb", 1, T.i1wbPrompt + 600),
    result("i1wb", 2, T.i1wbSettle - 40_000, 1),
    settled("i1wb", 3, T.i1wbSettle, "here is the plan"),
    // jpnl: 19:33 prompt, settled 19:39.
    prompt("jpnl", 0, T.jpnlPrompt),
    working("jpnl", 1, T.jpnlPrompt + 600),
    result("jpnl", 2, T.jpnlSettle - 20_000, 1),
    settled("jpnl", 3, T.jpnlSettle, "here is the activity page"),
    // i1wb starts again at 19:45 and keeps working.
    prompt("i1wb", 4, T.i1wbNextPrompt),
    working("i1wb", 5, T.i1wbWorking),
    // jpnl gets a newer prompt at 19:47 and keeps working.
    prompt("jpnl", 4, T.jpnlNextPrompt),
    working("jpnl", 5, T.jpnlWorking),
  ]
  const items = channelTimeline(events)
  const order = labels(items)

  const settledTurns = items.filter((item) => item.kind === "turn" && !item.turn.pending)
  assert.equal(
    settledTurns.at(-1)?.at,
    T.jpnlSettle,
    "jpnl's 19:39 answer is last among settled turns",
  )
  assert.ok(order.indexOf(`turn:jpnl:${T.jpnlSettle}`) > order.indexOf(`turn:i1wb:${T.i1wbSettle}`))
  assert.ok(
    order.indexOf(`turn:i1wb:${T.i1wbNextPrompt}:pending`) >
      order.indexOf(`user:jpnl:${T.jpnlNextPrompt}`),
    "i1wb's pending turn does not move above jpnl's newer operator message",
  )
  assert.equal(order.at(-1), `turn:jpnl:${T.jpnlNextPrompt}:pending`)
  assert.equal(order.filter((row) => row.endsWith(":pending")).length, 2)
})

test("channelTurns uses the same settling anchor", () => {
  const turns = channelTurns([
    prompt("A", 0, 100),
    settled("A", 1, 900),
    prompt("B", 0, 200),
    settled("B", 1, 600),
  ])

  assert.deepEqual(
    turns.map((turn) => `${turn.agentId}:${turnAnchor(turn)}`),
    ["B:600", "A:900"],
  )
})
