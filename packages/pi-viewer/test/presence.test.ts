import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  currentStep,
  presenceAnnouncement,
  presenceLine,
  shortName,
  splitPresence,
  type TimelineItem,
} from "../src/lib/presence.ts"
import { agentsInScope, type Scope } from "../src/lib/scope.ts"
import { channelTimeline } from "../src/lib/thread.ts"
import type { AgentStatus, ViewerAgent, ViewerEvent, ViewerSession } from "../src/shared/types.ts"

const T0 = Date.parse("2026-11-25T13:00:00.000Z")
const s = (seconds: number) => T0 + seconds * 1_000

function event(agentId: string, seq: number, at: number, kind: ViewerEvent["kind"], extra: Partial<ViewerEvent> = {}): ViewerEvent {
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
const prompt = (agentId: string, seq: number, at: number) => event(agentId, seq, at, "user", { text: "go" })
const tool = (agentId: string, seq: number, at: number, name = "read", summary = "src/lib/thread.ts") =>
  event(agentId, seq, at, "assistant", {
    parts: [{ type: "tool-call", toolName: name, toolCallId: `call-${agentId}-${seq}`, summary }],
    stopReason: "toolUse",
  })
const reply = (agentId: string, seq: number, at: number) =>
  event(agentId, seq, at, "assistant", { parts: [{ type: "text", text: "done" }], stopReason: "stop", text: "done" })

function agent(id: string, over: Partial<ViewerAgent> = {}): ViewerAgent {
  const index = Number(id.replace(/\D/g, "")) || 0
  const modifiedAt = over.modifiedAt ?? T0
  return {
    id,
    paneId: id,
    panePid: index,
    provider: "claude",
    piPid: index,
    tmuxSession: "xx",
    windowIndex: index,
    windowId: `@${index}`,
    windowName: `w${index}`,
    paneIndex: 0,
    name: `xtrm-xt-claude-agent${index}`,
    role: "worker",
    title: "",
    cwd: "/tmp",
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt,
    lastWriteAt: over.lastWriteAt ?? modifiedAt,
    eventCount: 0,
    status: "working",
    statusNote: "running tools",
    ...over,
  }
}

const label = (item: TimelineItem) => `${item.kind}:${item.agentId}:${(item.at - T0) / 1_000}`

/** One settled exchange for `%9`, then a running turn for each of `running`. */
function scenario(running: string[]): { events: ViewerEvent[]; agents: ViewerAgent[] } {
  const events = [prompt("%9", 1, s(0)), reply("%9", 2, s(5))]
  running.forEach((id, index) => {
    events.push(prompt(id, 1, s(10 + index)), tool(id, 2, s(20 + index)))
  })
  const agents = [agent("%9", { status: "waiting", statusNote: "awaiting input" }), ...running.map((id) => agent(id))]
  return { events, agents }
}

test("0/1/2/3/5 running agents: each running turn leaves the timeline and becomes one entry", () => {
  for (const n of [0, 1, 2, 3, 5]) {
    const ids = Array.from({ length: n }, (_, index) => `%${index + 1}`)
    const { events, agents } = scenario(ids)
    const { timeline, presence } = splitPresence(channelTimeline(events), agents)
    assert.equal(presence.length, n, `presence size at N=${n}`)
    assert.deepEqual(
      presence.map((entry) => entry.agentId),
      ids,
      "tree order",
    )
    assert.ok(timeline.every((item) => item.kind !== "turn" || !item.turn.pending), "no pending turn in the timeline")
    // The operator prompts of running turns stay in the thread.
    assert.equal(timeline.filter((item) => item.kind === "user").length, n + 1)
    assert.ok(presence.every((entry) => entry.turn && entry.start === entry.turn.start))
  }
})

test("a settle appends at the end; earlier rows keep their order and nothing moves on a start", () => {
  const ids = ["%1", "%2"]
  const { events, agents } = scenario(ids)
  const before = splitPresence(channelTimeline(events), agents).timeline.map(label)

  // %3 starts a turn: its prompt is the only new row, appended; nothing else moves.
  const started = [...events, prompt("%3", 1, s(30)), tool("%3", 2, s(31))]
  const withThree = [...agents, agent("%3")]
  const afterStart = splitPresence(channelTimeline(started), withThree)
  assert.deepEqual(afterStart.timeline.map(label).slice(0, before.length), before)
  assert.deepEqual(afterStart.timeline.map(label).slice(before.length), ["user:%3:30"])
  assert.equal(afterStart.presence.length, 3)

  // %1 settles: its turn is appended after every earlier row and leaves presence.
  const settledEvents = [...started, reply("%1", 3, s(40))]
  const settledAgents = withThree.map((entry) => (entry.id === "%1" ? { ...entry, status: "waiting" as AgentStatus } : entry))
  const afterSettle = splitPresence(channelTimeline(settledEvents), settledAgents)
  const rows = afterSettle.timeline.map(label)
  assert.deepEqual(rows.slice(0, -1), afterStart.timeline.map(label))
  assert.equal(rows.at(-1), "turn:%1:40")
  assert.deepEqual(
    afterSettle.presence.map((entry) => entry.agentId),
    ["%2", "%3"],
  )
})

test("a stale turn of a non-working agent becomes a stopped row at Turn.end, sorted into the thread", () => {
  const events = [
    prompt("%1", 1, s(0)),
    tool("%1", 2, s(4)), // last activity of a turn that never settles
    prompt("%2", 1, s(10)),
    reply("%2", 2, s(15)),
  ]
  const agents = [
    agent("%1", { status: "idle", statusNote: "turn interrupted" }),
    agent("%2", { status: "waiting" }),
  ]
  const { timeline, presence } = splitPresence(channelTimeline(events), agents)
  assert.equal(presence.length, 0)
  assert.deepEqual(timeline.map(label), ["user:%1:0", "stopped:%1:4", "user:%2:10", "turn:%2:15"])
  const stopped = timeline[1]
  assert.equal(stopped.kind, "stopped")
  assert.equal(stopped.kind === "stopped" && stopped.note, "turn interrupted")
})

test("an error, an unknown status and a vanished pane also stop a pending turn", () => {
  const events = [prompt("%1", 1, s(0)), tool("%1", 2, s(3)), prompt("%2", 1, s(1)), tool("%2", 2, s(2)), prompt("%3", 1, s(1)), tool("%3", 2, s(5))]
  const agents = [agent("%1", { status: "error", statusNote: "last turn failed" }), agent("%2", { status: "unknown", statusNote: null })]
  const { timeline, presence } = splitPresence(channelTimeline(events), agents)
  assert.equal(presence.length, 0)
  const stopped = timeline.filter((item) => item.kind === "stopped")
  assert.deepEqual(
    stopped.map((item) => (item.kind === "stopped" ? `${item.agentId}:${item.note}` : "")),
    ["%2:unknown", "%1:last turn failed", "%3:agent gone"],
  )
})

test("waiting while the reply is in flight keeps a pending turn in presence (no stopped flash)", () => {
  const events = [prompt("%1", 1, s(0)), tool("%1", 2, s(1))]
  // The status poll saw the reply written at s(9); the thread payload does not carry it yet.
  const { presence, timeline } = splitPresence(channelTimeline(events), [agent("%1", { status: "waiting", modifiedAt: s(9), lastWriteAt: s(9) })])
  assert.equal(presence.length, 1)
  assert.ok(!timeline.some((item) => item.kind === "stopped"))
})

test("a !cmd followed by a meta write is not kept as a reply in flight", () => {
  const base = [prompt("%1", 1, s(0)), reply("%1", 2, s(5))]
  const bash = event("%1", 3, s(20), "bash", { summary: "! ls", toolName: "bash", input: "ls" })
  // The file was touched at s(60) by a model/thinking meta write; the turn's last write is s(20).
  const waiting = agent("%1", { status: "waiting", statusNote: "awaiting input", modifiedAt: s(60), lastWriteAt: s(20) })
  const { presence, timeline } = splitPresence(channelTimeline([...base, bash]), [waiting])
  assert.equal(presence.length, 0)
  assert.equal(timeline.at(-1)?.kind, "stopped")
})

test("a prompt starting with / but not a local command still leaves a stopped row", () => {
  const base = [prompt("%1", 1, s(0)), reply("%1", 2, s(5))]
  const idle = agent("%1", { status: "idle", statusNote: "quiet for 15m" })
  const asked = { ...prompt("%1", 3, s(20)), text: "/summarize the diff", summary: "/summarize the diff" }
  const local = { ...prompt("%1", 4, s(30)), text: "/model", summary: "/model" }
  assert.equal(splitPresence(channelTimeline([...base, asked]), [idle]).timeline.at(-1)?.kind, "stopped")
  assert.ok(!splitPresence(channelTimeline([...base, local]), [idle]).timeline.some((item) => item.kind === "stopped"))
})

test("local commands after a reply open no presence entry: !ls is a local row, /model adds none", () => {
  const bash = event("%1", 3, s(20), "bash", { summary: "! ls", toolName: "bash", input: "ls" })
  const base = [prompt("%1", 1, s(0)), reply("%1", 2, s(5))]
  const waiting = agent("%1", { status: "waiting", statusNote: "awaiting input", modifiedAt: s(20), lastWriteAt: s(5) })

  const ran = splitPresence(channelTimeline([...base, bash]), [waiting])
  assert.equal(ran.presence.length, 0, "a !ls is not a running agent")
  const row = ran.timeline.at(-1)
  assert.equal(row?.kind, "stopped")
  assert.equal(row?.kind === "stopped" && row.local, true)
  assert.equal(row?.kind === "stopped" && row.turn.activity[0].label, "Ran")

  const slash = prompt("%1", 3, s(20))
  const model = splitPresence(channelTimeline([...base, { ...slash, text: "/model", summary: "/model" }]), [waiting])
  assert.equal(model.presence.length, 0, "a /model is not a running agent")
  assert.deepEqual(model.timeline.map(label), ["user:%1:0", "turn:%1:5", "user:%1:20"], "only the operator row is added")
})

test("an idle agent's lone /compact adds no stopped row; an interrupted prompt still does", () => {
  const base = [prompt("%1", 1, s(0)), reply("%1", 2, s(5))]
  const idle = agent("%1", { status: "idle", statusNote: "quiet for 15m" })
  const compact = { ...prompt("%1", 3, s(20)), text: "/compact", summary: "/compact" }
  const { timeline } = splitPresence(channelTimeline([...base, compact]), [idle])
  assert.ok(!timeline.some((item) => item.kind === "stopped"))
  const interrupted = splitPresence(channelTimeline([...base, prompt("%1", 3, s(20))]), [
    agent("%1", { status: "idle", statusNote: "turn interrupted" }),
  ])
  assert.equal(interrupted.timeline.at(-1)?.kind, "stopped")
})

test("attention sorts first, then tree order; quiet stays in presence", () => {
  const ids = ["%1", "%2", "%3"]
  const { events } = scenario(ids)
  const agents = [
    agent("%1"),
    agent("%2", { status: "quiet", statusNote: "no output for 16m" }),
    agent("%3", { status: "attention", statusNote: "permission: Bash", statusDetail: "Bash command\nrm -rf x" }),
  ]
  const { presence } = splitPresence(channelTimeline(events), agents)
  assert.deepEqual(
    presence.map((entry) => `${entry.agentId}:${entry.status}`),
    ["%3:attention", "%1:working", "%2:quiet"],
  )
  assert.equal(presence[0].detail, "Bash command\nrm -rf x")
})

test("a present agent with no pending turn in the loaded events gets an entry without a turn", () => {
  const { presence } = splitPresence(channelTimeline([prompt("%9", 1, s(0)), reply("%9", 2, s(1))]), [agent("%4")])
  assert.equal(presence.length, 1)
  assert.equal(presence[0].turn, null)
  assert.equal(presence[0].start, null)
})

test("scope filtering: presence holds only the agents of the session, window or pane in scope", () => {
  const agents = [
    agent("%1", { windowIndex: 1, windowId: "@1" }),
    agent("%2", { windowIndex: 1, windowId: "@1", paneIndex: 1 }),
    agent("%3", { windowIndex: 2, windowId: "@2" }),
  ]
  const sessions: ViewerSession[] = [{ name: "xx", agents, capturedAt: T0 }]
  const events = agents.flatMap((entry, index) => [prompt(entry.id, 1, s(index)), tool(entry.id, 2, s(10 + index))])
  const run = (scope: Scope) => {
    const inScope = agentsInScope(sessions, scope)
    const ids = new Set(inScope.map((entry) => entry.id))
    const items = channelTimeline(events.filter((entry) => ids.has(entry.agentId)))
    return splitPresence(items, inScope).presence.map((entry) => entry.agentId)
  }
  assert.deepEqual(run({ kind: "session", session: "xx" }), ["%1", "%2", "%3"])
  assert.deepEqual(run({ kind: "window", session: "xx", window: 1, windowId: "@1" }), ["%1", "%2"])
  assert.deepEqual(run({ kind: "pane", session: "xx", window: 2, paneId: "%3" }), ["%3"])
})

test("channelTimeline output is unchanged by the split for settled-only input", () => {
  const events = [prompt("%1", 1, s(0)), reply("%1", 2, s(3)), prompt("%2", 1, s(1)), reply("%2", 2, s(2))]
  const items = channelTimeline(events)
  const agents = [agent("%1", { status: "waiting" }), agent("%2", { status: "waiting" })]
  assert.deepEqual(splitPresence(items, agents).timeline, items)
})

test("short names drop the launcher prefix only", () => {
  assert.equal(shortName("xtrm-xt-claude-working-design"), "working-design")
  assert.equal(shortName("xtrm-xt-pi-i1wb"), "i1wb")
  assert.equal(shortName("core.v2-xt-codex-review"), "review")
  assert.equal(shortName("lead"), "lead")
  assert.equal(shortName("Xtrm-xt-pi-a"), "Xtrm-xt-pi-a")
})

test("the collapsed line by count: 1, 2, 3, N>=4 and attention (§3.2)", () => {
  const entries = (n: number) => {
    const ids = Array.from({ length: n }, (_, index) => `%${index + 1}`)
    const { events, agents } = scenario(ids)
    return splitPresence(channelTimeline(events), agents).presence
  }
  assert.deepEqual(presenceLine([]), { text: "", short: "", step: null, since: null })
  const one = presenceLine(entries(1))
  assert.equal(one.text, "agent1 is working")
  assert.equal(one.step, "Read src/lib/thread.ts")
  assert.equal(one.since, s(10))
  assert.equal(one.short, "agent1")
  const two = presenceLine(entries(2))
  assert.equal(two.text, "agent1 and agent2 are working")
  assert.equal(two.since, s(10), "N=2 shows the longest elapsed time")
  assert.equal(two.step, null)
  assert.equal(presenceLine(entries(3)).text, "agent1, agent2 and agent3 are working")
  assert.equal(presenceLine(entries(3)).since, null)
  assert.equal(presenceLine(entries(6)).text, "6 agents are working")
  assert.equal(presenceLine(entries(6)).short, "6 working")

  const asking = entries(4).map((entry, index) => (index === 2 ? { ...entry, status: "attention" as const } : entry))
  const line = presenceLine(asking.sort((a, b) => Number(b.status === "attention") - Number(a.status === "attention")))
  assert.equal(line.text, "agent3 needs you · 3 others working")
  assert.equal(line.short, "agent3 needs you · +3")
})

test("current step is the newest activity; announcements fire on membership changes only", () => {
  const { events, agents } = scenario(["%1"])
  const [entry] = splitPresence(channelTimeline(events), agents).presence
  assert.equal(currentStep(entry.turn), "Read src/lib/thread.ts")
  assert.equal(currentStep(null), null)
  assert.equal(presenceAnnouncement([], [entry]), "agent1 started")
  assert.equal(presenceAnnouncement([entry], [entry]), null)
  assert.equal(presenceAnnouncement([entry], [{ ...entry, status: "attention" }]), "agent1 needs you")
  assert.equal(presenceAnnouncement([entry], []), "agent1 finished")
})
