import { strict as assert } from "node:assert"
import { test } from "node:test"

import { agentsInScope, eventsInScope, type Scope } from "../src/lib/scope.ts"
import { channelTimeline, channelTurns } from "../src/lib/thread.ts"
import type { OptimisticMessage } from "../src/lib/optimistic.ts"
import type { IntercomMeta, ViewerAgent, ViewerEvent, ViewerSession } from "../src/shared/types.ts"

/**
 * Three agents: alpha (%1) and beta (%2) share window 0, gamma (%3) is in window 1.
 * Times are epoch milliseconds; seq is the line order in each agent's own transcript.
 *
 *   alpha  prompt@100  tool call@110  result@115  sent->beta@160  sent->gamma@170  final@200
 *   beta   prompt@120  received<-alpha@162  final@190
 *   gamma  prompt@130  received<-alpha@172  final@195
 */
function agent(paneId: string, windowIndex: number, paneIndex: number, name: string): ViewerAgent {
  return {
    id: paneId, paneId, panePid: 1, provider: "pi", piPid: 2, tmuxSession: "xx", windowIndex,
    windowId: `@${windowIndex + 1}`,
    windowName: `win${windowIndex}`, paneIndex, name, role: null, title: "", cwd: "/w", sessionFile: null,
    sessionId: null, sessionName: null, model: null, thinkingLevel: null, modifiedAt: 0, lastWriteAt: 0, eventCount: 0,
    status: "idle", statusNote: null,
  }
}

const ALPHA = agent("%1", 0, 0, "alpha")
const BETA = agent("%2", 0, 1, "beta")
const GAMMA = agent("%3", 1, 0, "gamma")
const SESSIONS: ViewerSession[] = [{ name: "xx", serverId: "tmux:test", agents: [GAMMA, BETA, ALPHA], capturedAt: 0 }]

function ev(a: ViewerAgent, seq: number, at: number, kind: ViewerEvent["kind"], extra: Partial<ViewerEvent> = {}): ViewerEvent {
  return { id: `${a.id}:${seq}`, agentId: a.id, agentName: a.name, seq, at, kind, role: null, summary: `${a.name} ${kind} ${seq}`, onBranch: true, ...extra }
}
function note(direction: "sent" | "received", from: string, to: string, body: string, messageId: string): IntercomMeta {
  return { direction, from, to, body, messageId }
}
const final = (a: ViewerAgent, seq: number, at: number) =>
  ev(a, seq, at, "assistant", { parts: [{ type: "text", text: "done" }], text: "done", stopReason: "stop" })

const EVENTS: ViewerEvent[] = [
  ev(ALPHA, 0, 100, "user", { text: "go alpha" }),
  ev(ALPHA, 1, 110, "assistant", { parts: [{ type: "tool-call", toolName: "bash", toolCallId: "t1" }], stopReason: "toolUse" }),
  ev(ALPHA, 2, 115, "tool-result", { toolName: "bash", toolCallId: "t1", summary: "bash · ok" }),
  ev(ALPHA, 3, 160, "intercom", { intercom: note("sent", "alpha", "beta", "ping beta", "m1") }),
  ev(ALPHA, 4, 170, "intercom", { intercom: note("sent", "alpha", "gamma", "ping gamma", "m2") }),
  final(ALPHA, 5, 200),
  ev(BETA, 0, 120, "user", { text: "go beta" }),
  ev(BETA, 1, 162, "intercom", { intercom: note("received", "alpha", "beta", "ping beta", "m1") }),
  final(BETA, 2, 190),
  ev(GAMMA, 0, 130, "user", { text: "go gamma" }),
  ev(GAMMA, 1, 172, "intercom", { intercom: note("received", "alpha", "gamma", "ping gamma", "m2") }),
  final(GAMMA, 2, 195),
].sort((a, b) => a.at - b.at)

function rows(scope: Scope, optimistic: OptimisticMessage[] = []): string[] {
  const agents = agentsInScope(SESSIONS, scope)
  return channelTimeline(eventsInScope(EVENTS, agents), optimistic).map((item) => item.id)
}

test("session scope: every agent on one settle-time timeline, a two-sided message shown once", () => {
  assert.deepEqual(rows({ kind: "session", session: "xx" }), [
    "user:%1:0",
    "user:%2:0",
    "user:%3:0",
    "intercom:%1:3",
    "intercom:%1:4",
    "turn:%2:0", // beta settles at 190
    "turn:%3:0", // gamma at 195
    "turn:%1:0", // alpha at 200, the last to settle
  ])
})

test("window scope: only that window's agents; a message to an agent outside the window shows only on its sender", () => {
  assert.deepEqual(rows({ kind: "window", session: "xx", window: 0 }), [
    "user:%1:0",
    "user:%2:0",
    "intercom:%1:3", // alpha -> beta, both in the window: one card
    "intercom:%1:4", // alpha -> gamma: alpha's own sent card; gamma's received side is out of scope
    "turn:%2:0",
    "turn:%1:0",
  ])
  assert.deepEqual(rows({ kind: "window", session: "xx", window: 1 }), ["user:%3:0", "intercom:%3:1", "turn:%3:0"])
})

test("pane scope keeps intercom cards where the agent is sender or receiver", () => {
  assert.deepEqual(rows({ kind: "pane", session: "xx", window: 0, paneId: "%1" }), [
    "user:%1:0",
    "intercom:%1:3",
    "intercom:%1:4",
    "turn:%1:0",
  ])
  const betaRows = rows({ kind: "pane", session: "xx", window: 0, paneId: "%2" })
  assert.deepEqual(betaRows, ["user:%2:0", "intercom:%2:1", "turn:%2:0"])
  const received = channelTimeline(eventsInScope(EVENTS, [BETA])).find((item) => item.kind === "intercom")
  assert.equal(received?.kind === "intercom" && received.event.intercom?.direction, "received")
})

test("a scope's rows are the session rows that belong to it, in the same relative order", () => {
  const whole = rows({ kind: "session", session: "xx" })
  const window = rows({ kind: "window", session: "xx", window: 0 })
  const kept = whole.filter((id) => window.includes(id))
  assert.deepEqual(
    kept.filter((id) => !id.startsWith("intercom:")),
    window.filter((id) => !id.startsWith("intercom:")),
    "turns and prompts keep their order",
  )
})

test("settle-time anchoring and pending-last hold in every scope", () => {
  // Beta starts a new turn and is still working: it is always last in its scopes.
  const pending = [
    ...EVENTS,
    ev(BETA, 3, 300, "user", { text: "again" }),
    ev(BETA, 4, 310, "assistant", { parts: [{ type: "tool-call", toolName: "bash", toolCallId: "t9" }], stopReason: "toolUse" }),
  ].sort((a, b) => a.at - b.at)
  for (const scope of [
    { kind: "session", session: "xx" },
    { kind: "window", session: "xx", window: 0 },
    { kind: "pane", session: "xx", window: 0, paneId: "%2" },
  ] as Scope[]) {
    const turns = channelTurns(eventsInScope(pending, agentsInScope(SESSIONS, scope)))
    assert.equal(turns.at(-1)?.pending, true, "the working turn is last")
    assert.equal(turns.at(-1)?.agentId, "%2")
    const settled = turns.filter((turn) => !turn.pending)
    const anchors = settled.map((turn) => turn.final?.at ?? 0)
    assert.deepEqual(anchors, [...anchors].sort((a, b) => a - b), "settled turns follow their settling event")
  }
})

test("composer messages follow the scope's agents", () => {
  const sent = (paneId: string, at: number): OptimisticMessage => ({ id: `o${paneId}`, paneId, agentName: paneId, text: "hi", at, status: "sent" })
  const inScope = (scope: Scope) => {
    const ids = new Set(agentsInScope(SESSIONS, scope).map((entry) => entry.id))
    return [sent("%1", 500), sent("%3", 501)].filter((message) => ids.has(message.paneId))
  }
  assert.deepEqual(inScope({ kind: "window", session: "xx", window: 0 }).map((message) => message.paneId), ["%1"])
  assert.deepEqual(rows({ kind: "window", session: "xx", window: 1 }, inScope({ kind: "window", session: "xx", window: 1 })).at(-1), "optimistic:o%3")
})

test("a result pairs with its own call when one event issues several tool calls", () => {
  const a = agent("%9", 0, 0, "multi")
  const calls = ev(a, 1, 10, "assistant", {
    parts: [
      { type: "tool-call", toolName: "read", toolCallId: "c1", summary: "one" },
      { type: "tool-call", toolName: "grep", toolCallId: "c2", summary: "two" },
    ],
    stopReason: "toolUse",
  })
  const result = (seq: number, id: string) => ev(a, seq, 10 + seq, "tool-result", { toolName: "x", toolCallId: id, summary: `x · ${id}` })
  for (const order of [["c1", "c2"], ["c2", "c1"]]) {
    const events = [ev(a, 0, 5, "user", { text: "go" }), calls, result(2, order[0]), result(3, order[1]), final(a, 4, 20)]
    const turn = channelTurns(events)[0]
    const tools = turn.activity.filter((item) => item.kind === "tool")
    assert.equal(tools.length, 2, `one item per call (${order.join(",")})`)
    assert.ok(tools.every((item) => item.call && item.result), "both calls are paired")
    for (const item of tools) assert.equal(item.result?.toolCallId, item.toolCallId)
  }
})

test("a failed intercom card survives window and pane scope", () => {
  const failed = ev(ALPHA, 6, 180, "intercom", {
    isError: true,
    summary: "→ beta · failed",
    intercom: {
      direction: "sent",
      from: "alpha",
      to: "beta",
      body: "stale failure",
      messageId: "m-failed",
      toolCallId: "call-failed",
      failed: true,
      delivery: "failed",
      error: "Session not found",
    },
  })
  const events = [...EVENTS, failed].sort((a, b) => a.at - b.at)
  const rowsIn = (scope: Scope) =>
    channelTimeline(eventsInScope(events, agentsInScope(SESSIONS, scope))).map((item) => item.id)
  for (const scope of [
    { kind: "window", session: "xx", window: 0 },
    { kind: "pane", session: "xx", window: 0, paneId: "%1" },
  ] as Scope[]) {
    assert.ok(rowsIn(scope).includes("intercom:%1:6"), "the failed card is still in scope")
    const card = channelTimeline(eventsInScope(events, agentsInScope(SESSIONS, scope))).find(
      (item) => item.kind === "intercom" && item.id === "intercom:%1:6",
    )
    assert.equal(card?.kind === "intercom" && card.event.intercom?.failed, true)
    assert.equal(card?.kind === "intercom" && card.event.intercom?.delivery, "failed")
  }
})
