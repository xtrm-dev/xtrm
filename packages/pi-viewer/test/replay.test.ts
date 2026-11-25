import { strict as assert } from "node:assert"
import { appendFileSync, copyFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { claudeStatusOf, normalizeClaudeEvent, parseClaudeFile } from "../server/claude.ts"
import { lastWriteAt, normalizeEvent, parseSessionFile, statusOf, type ParsedFile } from "../server/session.ts"
import { splitPresence } from "../src/lib/presence.ts"
import { channelEvent, channelTimeline } from "../src/lib/thread.ts"
import type { AgentStatus, ViewerAgent } from "../src/shared/types.ts"
import { replay, type Provider, type Snapshot } from "./replay/harness.ts"

/**
 * Replay harness (XTRM-1043): redacted windows of real transcripts are written record by
 * record. For every prefix the harness asserts fresh == incremental (status and presence), no
 * stopped row that vanishes without a new operator prompt, and an open turn only while the
 * status is live. The labels below are the states a reader of the real session saw.
 * Fixtures: test/fixtures/replay/README.md.
 */

const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-replay-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))

interface Label {
  /** Line in the source transcript (`_src`). */
  src: number
  status: AgentStatus
  note?: string
  /** Presence entries, and whether the entry carries the open turn. */
  presence?: 0 | "turn"
  /** Stopped rows in the timeline (local rows included). */
  stopped?: number
}

const FIXTURES: Array<{ name: string; provider: Provider; why: string; labels: Label[] }> = [
  {
    name: "pi-i1wb-01a20df7-798",
    provider: "pi",
    why: "Pi task_notification, specialist_settled and intercom_message wake the agent: working at once, no stopped row",
    labels: [
      { src: 797, status: "waiting", presence: 0, stopped: 0 },
      { src: 798, status: "working", note: "turn in progress", presence: "turn", stopped: 0 },
      { src: 801, status: "working", presence: "turn", stopped: 0 },
      { src: 804, status: "working", note: "running tools", presence: "turn", stopped: 0 },
      { src: 820, status: "waiting", presence: 0 },
      { src: 822, status: "working", presence: "turn", stopped: 0 },
      { src: 827, status: "waiting", presence: 0, stopped: 0 },
    ],
  },
  {
    name: "pi-i1wb-01a20df7-1236",
    provider: "pi",
    why: "Pi abort, a task notification, then 502/503 retries (error, context_edit, error ...) and a new prompt",
    labels: [
      { src: 1237, status: "idle", note: "turn aborted", presence: 0, stopped: 0 },
      { src: 1239, status: "working", presence: "turn" },
      { src: 1324, status: "waiting", presence: 0 },
      { src: 1325, status: "working", note: "turn in progress", presence: "turn", stopped: 0 },
      { src: 1331, status: "error", note: "last turn failed", presence: 0, stopped: 0 },
      { src: 1332, status: "error", presence: 0, stopped: 0 },
      { src: 1337, status: "error", presence: 0, stopped: 0 },
      { src: 1339, status: "working", presence: "turn", stopped: 0 },
    ],
  },
  {
    name: "claude-oblw-2f0aa11a-6365",
    provider: "claude",
    why: "Claude manual /compact: the typed /compact, the compaction, then the caveat, the command (which makes the typed record local) and its output",
    labels: [
      { src: 6359, status: "waiting", presence: 0, stopped: 0 },
      { src: 6365, status: "working", presence: "turn" },
      { src: 6374, status: "working", note: "compacting context", presence: "turn", stopped: 0 },
      { src: 6376, status: "waiting", presence: 0, stopped: 1 },
      { src: 6377, status: "waiting", presence: 0, stopped: 1 },
      { src: 6401, status: "working", presence: "turn", stopped: 1 },
    ],
  },
  {
    name: "claude-thread-lead-8a1d4345-2117",
    provider: "claude",
    why: "Claude task notification and peer messages, an idle manual /compact, then /model",
    labels: [
      { src: 2005, status: "working", note: "turn in progress", presence: "turn" },
      { src: 2032, status: "waiting", presence: 0 },
      { src: 2052, status: "working", presence: "turn" },
      { src: 2119, status: "waiting", presence: 0, stopped: 1 },
      { src: 2121, status: "waiting", presence: 0, stopped: 1 },
      { src: 2144, status: "waiting", presence: 0, stopped: 1 },
      { src: 2145, status: "waiting", presence: 0, stopped: 1 },
      { src: 2148, status: "working", presence: "turn", stopped: 1 },
    ],
  },
  {
    name: "claude-thread-lead-8a1d4345-2803",
    provider: "claude",
    why: "Claude AskUserQuestion: attention until the answer arrives as a tool result",
    labels: [
      { src: 2803, status: "attention", note: "question", presence: "turn" },
      { src: 2822, status: "working", presence: "turn" },
    ],
  },
  {
    name: "claude-working-design-a9a8fd4e-599",
    provider: "claude",
    why: "Claude auto compaction after a settled turn: one closed row, it stays when the next turn starts",
    labels: [
      { src: 587, status: "waiting", presence: 0, stopped: 0 },
      { src: 601, status: "waiting", presence: 0, stopped: 1 },
      { src: 628, status: "working", presence: "turn", stopped: 1 },
    ],
  },
  {
    name: "claude-working-design-a9a8fd4e-2620",
    provider: "claude",
    why: "a second auto compaction in the same session",
    labels: [
      { src: 2609, status: "waiting", presence: 0, stopped: 0 },
      { src: 2622, status: "waiting", presence: 0, stopped: 1 },
      { src: 2648, status: "working", presence: "turn", stopped: 1 },
    ],
  },
  {
    name: "pi-specialists-019df732-807",
    provider: "pi",
    why: "Pi context overflow (context_length_exceeded) then compaction: the failed turn reopens and goes on",
    labels: [
      { src: 801, status: "idle", note: "turn aborted", presence: 0 },
      { src: 802, status: "working", presence: "turn" },
      { src: 807, status: "error", note: "last turn failed", presence: 0, stopped: 0 },
      { src: 808, status: "working", note: "compacting context", presence: "turn", stopped: 0 },
      { src: 809, status: "working", note: "running tools", presence: "turn", stopped: 0 },
      { src: 816, status: "waiting", presence: 0, stopped: 0 },
    ],
  },
  {
    name: "claude-e9rd-e158b382-8096",
    provider: "claude",
    why: "Claude peer message then an auto compaction before the first step: the turn stays open; the summary's older timestamp does not quiet it",
    labels: [
      { src: 8083, status: "waiting", presence: 0 },
      { src: 8096, status: "working", note: "turn in progress", presence: "turn", stopped: 0 },
      { src: 8101, status: "working", note: "compacting context", presence: "turn", stopped: 0 },
      { src: 8160, status: "working", presence: "turn", stopped: 0 },
    ],
  },
  {
    name: "claude-adapter-a09891e1",
    provider: "claude",
    why: "Claude skill commands (/using-specialists, /engineering-quality) are prompts, not local commands",
    labels: [
      { src: 15, status: "working", note: "turn in progress", presence: "turn", stopped: 0 },
      { src: 23, status: "working", presence: "turn", stopped: 0 },
      { src: 49, status: "working", note: "running tools", presence: "turn" },
    ],
  },
]

function check(snapshot: Snapshot, label: Label, name: string): void {
  const where = `${name} source line ${label.src} [${snapshot.record}]`
  assert.equal(snapshot.status.status, label.status, `${where}: status`)
  if (label.note !== undefined) assert.equal(snapshot.status.note, label.note, `${where}: note`)
  if (label.presence === 0) assert.equal(snapshot.presence.length, 0, `${where}: no presence entry`)
  if (label.presence === "turn") {
    assert.equal(snapshot.presence.length, 1, `${where}: one presence entry`)
    assert.ok(!snapshot.presence[0].endsWith(":-"), `${where}: the presence entry carries the open turn`)
  }
  if (label.stopped !== undefined) assert.equal(snapshot.stopped.length, label.stopped, `${where}: stopped rows ${snapshot.stopped.join(", ")}`)
}

for (const fixture of FIXTURES) {
  test(`replay ${fixture.name}: ${fixture.why}`, () => {
    const result = replay(join(import.meta.dirname, "fixtures", "replay", `${fixture.name}.jsonl`), fixture.provider, SCRATCH, fixture.name)
    assert.deepEqual(result.violations, [], "fresh == incremental, no flicker, open turn only while live")
    for (const label of fixture.labels) {
      const snapshot = result.snapshots.find((item) => item.src === label.src)
      assert.ok(snapshot, `${fixture.name}: source line ${label.src} is in the fixture`)
      check(snapshot, label, fixture.name)
    }
  })
}

// ------------------------------------------------------------------ reproductions and nits

const T = Math.floor(Date.now() / 1000) * 1000 - 120_000
const iso = (offset: number) => new Date(T + offset).toISOString()
const line = (value: Record<string, unknown>, offset: number) => `${JSON.stringify({ timestamp: iso(offset), ...value })}\n`

function agentOf(provider: Provider, parsed: ParsedFile, status: AgentStatus, note: string | null): ViewerAgent {
  return {
    id: "%1", paneId: "%1", panePid: 1, provider, piPid: 1, tmuxSession: "t", windowIndex: 0, windowId: "@1", windowName: "w",
    paneIndex: 0, name: "a", role: null, title: "a", cwd: "/r", sessionFile: null, sessionId: null, sessionName: null,
    model: null, thinkingLevel: null, modifiedAt: parsed.modifiedAt, lastWriteAt: lastWriteAt(parsed),
    eventCount: parsed.events.length, status, statusNote: note,
  }
}

/** Status, presence and stopped rows of a transcript, with the agent's status overridden when given. */
function viewOf(provider: Provider, parsed: ParsedFile, now: number, override?: AgentStatus) {
  const state = provider === "pi" ? statusOf(parsed, now) : claudeStatusOf(parsed, now)
  const agent = agentOf(provider, parsed, override ?? state.status, override ? null : state.note)
  const normalize = provider === "pi" ? normalizeEvent : normalizeClaudeEvent
  const events = parsed.events
    .map((entry, seq) => normalize(entry, agent, seq, typeof entry.id !== "string" || parsed.branchIds.has(entry.id), { raw: false }))
    .filter(channelEvent)
  const { timeline, presence } = splitPresence(channelTimeline(events), [agent])
  return {
    status: state.status,
    note: state.note,
    presence: presence.map((entry) => `${entry.status}${entry.turn ? "+turn" : ""}`),
    stopped: timeline.flatMap((item) => (item.kind === "stopped" ? [`${item.local ? "local" : "stopped"}:${item.note}`] : [])),
  }
}

function write(name: string, lines: string[], mtimeOffset: number): string {
  const file = join(SCRATCH, name)
  writeFileSync(file, lines.join(""))
  utimesSync(file, (T + mtimeOffset) / 1000, (T + mtimeOffset) / 1000)
  return file
}

test("restart.ts: Pi reply, !ls, then a model change 10 s later reads the same incrementally and after a restart", () => {
  const file = write(
    "restart.jsonl",
    [
      line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
      line({ type: "message", id: "u1", parentId: "s", message: { role: "user", timestamp: T + 1_000, content: [{ type: "text", text: "go" }] } }, 1_000),
      line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", timestamp: T + 2_000, stopReason: "stop", content: [{ type: "text", text: "done" }] } }, 3_000),
      line({ type: "message", id: "b1", parentId: "a1", message: { role: "bashExecution", command: "ls", output: "a", exitCode: 0, timestamp: T + 10_000 } }, 10_000),
    ],
    10_000,
  )
  parseSessionFile(file) // the viewer was already running
  appendFileSync(file, line({ type: "model_change", id: "m1", parentId: "b1", provider: "p", modelId: "x" }, 20_000))
  utimesSync(file, (T + 20_000) / 1000, (T + 20_000) / 1000)
  const fresh = join(SCRATCH, "restart-fresh.jsonl")
  copyFileSync(file, fresh)
  utimesSync(fresh, (T + 20_000) / 1000, (T + 20_000) / 1000)

  const incremental = viewOf("pi", parseSessionFile(file), T + 25_000)
  const restarted = viewOf("pi", parseSessionFile(fresh), T + 25_000)
  assert.deepEqual(restarted, incremental, "a restart reads what the running viewer reads")
  assert.equal(incremental.status, "waiting")
  assert.deepEqual(incremental.presence, [], "a !ls is not agent work")
  assert.deepEqual(incremental.stopped, ["local:ran in the pane"], "the !ls is its own closed row")
  assert.equal(lastWriteAt(parseSessionFile(file)), T + 3_000, "the reply's own write time; the !ls and the model change do not move it")
})

const claudeBase = [
  line({ type: "user", uuid: "u0", message: { role: "user", content: "hi" } }, 0),
  line({ type: "assistant", uuid: "a0", parentUuid: "u0", message: { id: "m0", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "hello" }] } }, 1_000),
]
const command = (name: string, uuid: string, offset: number) =>
  line({ type: "user", uuid, message: { role: "user", content: `<command-message>${name.slice(1)}</command-message>\n<command-name>${name}</command-name>\n<command-args>PR 12</command-args>` } }, offset)
const injected = (text: string, uuid: string, offset: number, meta = true) =>
  line({ type: "user", uuid, ...(meta ? { isMeta: true } : {}), message: { role: "user", content: text } }, offset)

test("slash.ts: a prompt-type skill command opens a turn and keeps its stopped row when the agent is gone", () => {
  const cases: Record<string, string[]> = {
    skill: [command("/review", "c1", 5_000), injected("Base directory for this skill: ... review the PR", "c2", 5_001)],
    plain: [line({ type: "user", uuid: "c1", message: { role: "user", content: "review PR 12" } }, 5_000)],
  }
  for (const [name, lines] of Object.entries(cases)) {
    const parsed = parseClaudeFile(write(`slash-${name}.jsonl`, [...claudeBase, ...lines], 5_001))
    const live = viewOf("claude", parsed, T + 6_000)
    assert.equal(live.status, "working", `${name}: the model runs`)
    assert.deepEqual(live.presence, ["working+turn"], `${name}: in presence`)
    const gone = viewOf("claude", parsed, T + 6_000, "unknown")
    assert.deepEqual(gone.presence, [], `${name}: gone agent leaves presence`)
    assert.deepEqual(gone.stopped, ["stopped:unknown"], `${name}: the unanswered turn stays as a stopped row`)
  }
})

test("local commands: the caveat or the local output marks a slash command local; it opens no turn", () => {
  const cases: Record<string, string[]> = {
    // /model: caveat, command, output (the common shape).
    model: [
      injected("<local-command-caveat>Caveat: the command below was run locally.</local-command-caveat>", "c0", 5_000),
      command("/model", "c1", 5_000),
      injected("<local-command-stdout>Set model to opus</local-command-stdout>", "c2", 5_001, false),
    ],
    // /goal: no caveat, the output alone proves it.
    goal: [command("/goal", "c1", 5_000), injected("<local-command-stdout>Goal set</local-command-stdout>", "c2", 5_001, false)],
  }
  for (const [name, lines] of Object.entries(cases)) {
    const parsed = parseClaudeFile(write(`local-${name}.jsonl`, [...claudeBase, ...lines], 5_001))
    for (const override of [undefined, "unknown"] as const) {
      const view = viewOf("claude", parsed, T + 6_000, override)
      assert.deepEqual(view.presence, [], `${name}: no presence`)
      assert.deepEqual(view.stopped, [], `${name}: no stopped row (the operator row shows it)`)
    }
    assert.equal(viewOf("claude", parsed, T + 6_000).status, "waiting", `${name}: still waiting`)
  }
  // Incrementally: the /goal command alone first, then its output arrives.
  const file = write("local-goal-split.jsonl", [...claudeBase, command("/goal", "c1", 5_000)], 5_000)
  assert.equal(viewOf("claude", parseClaudeFile(file), T + 6_000).status, "working", "before its output a command reads as a prompt")
  appendFileSync(file, injected("<local-command-stdout>Goal set</local-command-stdout>", "c2", 5_001, false))
  utimesSync(file, (T + 5_001) / 1000, (T + 5_001) / 1000)
  const parsed = parseClaudeFile(file)
  assert.equal(viewOf("claude", parsed, T + 6_000).status, "waiting", "the output marks it local")
  assert.ok((parsed.entryVersions ?? []).some((version) => version > 0), "the command entry got a new revision, so caches re-read it")
})

test("a rate-limit error ('exceeded') is not resumable: a compaction after it settles; a context overflow resumes", () => {
  const pi = (error: string, name: string) => {
    const file = write(
      `exceed-${name}.jsonl`,
      [
        line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
        line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
        line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] } }, 2_000),
        line({ type: "message", id: "r1", parentId: "a1", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "x" }] } }, 3_000),
        line({ type: "message", id: "a2", parentId: "r1", message: { role: "assistant", stopReason: "error", errorMessage: error, content: [] } }, 4_000),
        line({ type: "compaction", id: "c1", parentId: "a2", summary: "s" }, 5_000),
      ],
      5_000,
    )
    return statusOf(parseSessionFile(file), T + 6_000)
  }
  assert.deepEqual(pi('429 {"type":"rate_limit_error","message":"Rate limit exceeded"}', "rate"), { status: "waiting", note: "awaiting input" })
  assert.deepEqual(pi("400 prompt is too long: 210000 tokens > 200000 maximum", "overflow"), { status: "working", note: "compacting context" })
})

test("a Claude tool_use block with stop_sequence is a step, not a reply", () => {
  const parsed = parseClaudeFile(
    write(
      "stop-sequence.jsonl",
      [
        ...claudeBase,
        line({ type: "user", uuid: "u1", parentUuid: "a0", message: { role: "user", content: "run it" } }, 2_000),
        line({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "stop_sequence", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }, 3_000),
      ],
      3_000,
    ),
  )
  assert.deepEqual(claudeStatusOf(parsed, T + 4_000), { status: "working", note: "running tools" })
})

test("a Claude interrupt closes the turn: its stopped row stays when the next prompt arrives", () => {
  const lines = [
    ...claudeBase,
    line({ type: "user", uuid: "u1", parentUuid: "a0", message: { role: "user", content: "do it" } }, 2_000),
    line({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } }, 3_000),
    line({ type: "user", uuid: "r1", parentUuid: "a1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "interrupted" }, { type: "text", text: "[Request interrupted by user for tool use]" }] } }, 4_000),
  ]
  const interrupted = viewOf("claude", parseClaudeFile(write("interrupt.jsonl", lines, 4_000)), T + 5_000)
  assert.equal(interrupted.status, "idle")
  assert.equal(interrupted.note, "turn interrupted")
  assert.deepEqual(interrupted.stopped, ["stopped:turn interrupted"])
  const next = viewOf(
    "claude",
    parseClaudeFile(write("interrupt-next.jsonl", [...lines, line({ type: "user", uuid: "u2", parentUuid: "r1", message: { role: "user", content: "again" } }, 9_000)], 9_000)),
    T + 10_000,
  )
  assert.equal(next.status, "working")
  assert.deepEqual(next.stopped, ["stopped:turn interrupted"], "the interrupted turn does not merge into the new prompt's turn")
})

test("a Pi notice that wakes nobody (skill_suggestion) is a closed local row, never a pending turn", () => {
  const lines = [
    line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
    line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] } }, 2_000),
    line({ type: "custom_message", id: "n1", parentId: "a1", customType: "skill_suggestion", display: true, content: "try /skill" }, 3_000),
  ]
  const view = viewOf("pi", parseSessionFile(write("skill-suggestion.jsonl", lines, 3_000)), T + 4_000)
  assert.equal(view.status, "waiting")
  assert.deepEqual(view.presence, [])
  assert.deepEqual(view.stopped, ["local:ran in the pane"])
})

test("Claude blocks merged into one entry read the same fresh and incrementally (record by record)", () => {
  const fixture = write(
    "merged-blocks.jsonl",
    [
      ...claudeBase,
      line({ type: "user", uuid: "u1", parentUuid: "a0", message: { role: "user", content: "go" } }, 2_000),
      line({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "thinking", thinking: "plan" }] } }, 3_000),
      line({ type: "assistant", uuid: "a2", parentUuid: "a1", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "text", text: "running" }] } }, 3_001),
      line({ type: "assistant", uuid: "a3", parentUuid: "a2", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } }, 3_002),
      line({ type: "user", uuid: "r1", parentUuid: "a3", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }, 4_000),
      line({ type: "assistant", uuid: "a4", parentUuid: "r1", message: { id: "m2", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } }, 5_000),
    ],
    5_000,
  )
  const result = replay(fixture, "claude", SCRATCH, "merged")
  assert.deepEqual(result.violations, [])
  assert.deepEqual(
    result.snapshots.map((snapshot) => snapshot.status.status),
    ["working", "waiting", "working", "working", "working", "working", "working", "waiting"],
  )
})

test("a Pi message aborted during a SendMessage call closes the turn (whole-transcript sweep, 1qkh line 4689)", () => {
  const lines = [
    line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
    line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }] } }, 2_000),
    line({ type: "message", id: "r1", parentId: "a1", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "x" }] } }, 3_000),
    line({ type: "message", id: "a2", parentId: "r1", message: { role: "assistant", stopReason: "aborted", content: [{ type: "toolCall", id: "t2", name: "SendMessage", arguments: { to: "peer", message: "done" } }] } }, 4_000),
  ]
  const fixture = write("abort-send.jsonl", lines, 4_000)
  const result = replay(fixture, "pi", SCRATCH, "abort-send")
  assert.deepEqual(result.violations, [], "no open turn while idle")
  const last = result.snapshots.at(-1)!
  assert.equal(last.status.note, "turn aborted")
  assert.deepEqual(last.stopped.map((row) => row.split("|")[1]), ["turn aborted"])
})

test("the quiet period counts from the newest record that moves a turn, not from bookkeeping writes", () => {
  const lines = [
    line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
    line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] } }, 2_000),
    // A model change 20 minutes later moves the file time, not the turn.
    line({ type: "model_change", id: "m1", parentId: "a1", provider: "p", modelId: "x" }, 2_000 + 20 * 60_000),
  ]
  const parsed = parseSessionFile(write("quiet-bookkeeping.jsonl", lines, 2_000 + 20 * 60_000))
  assert.equal(statusOf(parsed, T + 2_000 + 20 * 60_000 + 1_000).status, "quiet")
  assert.equal(lastWriteAt(parsed), T + 2_000)
})

test("a peer message merged as a duplicate still opens its agent's turn (whole-transcript sweep, w2w9 line 3381)", () => {
  const envelope = (id: string) =>
    `<cross-session-message message-id="${id}" from="uds:/peer.sock" from-name="peer">\nAck, nothing outstanding.\n</cross-session-message>`
  const lines = [
    line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
    line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] } }, 2_000),
    line({ type: "custom_message", id: "n1", parentId: "a1", customType: "intercom_message", display: true, content: envelope("m-1") }, 3_000),
    line({ type: "message", id: "a2", parentId: "n1", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "noted" }] } }, 4_000),
    // The same text again, under a new message id: one card, but a second wake-up.
    line({ type: "custom_message", id: "n2", parentId: "a2", customType: "intercom_message", display: true, content: envelope("m-2") }, 5_000),
  ]
  const result = replay(write("duplicate-wake.jsonl", lines, 5_000), "pi", SCRATCH, "duplicate-wake")
  assert.deepEqual(result.violations, [])
  const last = result.snapshots.at(-1)!
  assert.equal(last.status.status, "working")
  assert.equal(last.pending.length, 1, "the duplicate's wake-up opens a turn")
})

test("two context overflows in a row, with no prompt between them, still reopen the turn on compaction", () => {
  const overflow = (id: string, parentId: string, offset: number) =>
    line({ type: "message", id, parentId, message: { role: "assistant", stopReason: "error", errorMessage: "400 prompt is too long: 210000 tokens > 200000 maximum", content: [] } }, offset)
  const lines = [
    line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
    line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] } }, 2_000),
    line({ type: "message", id: "r1", parentId: "a1", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "x" }] } }, 3_000),
    overflow("e1", "r1", 4_000),
    overflow("e2", "e1", 5_000),
    line({ type: "compaction", id: "c1", parentId: "e2", summary: "s" }, 6_000),
    line({ type: "message", id: "a2", parentId: "c1", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "t2", name: "bash", arguments: {} }] } }, 7_000),
  ]
  const result = replay(write("double-overflow.jsonl", lines, 7_000), "pi", SCRATCH, "double-overflow")
  assert.deepEqual(result.violations, [])
  const promptTurn = result.snapshots[1].pending
  assert.equal(promptTurn.length, 1)
  const compacted = result.snapshots[6]
  assert.deepEqual([compacted.status.status, compacted.status.note], ["working", "compacting context"])
  assert.deepEqual(compacted.pending, promptTurn, "the compaction reopens the prompt's turn")
  assert.deepEqual(result.snapshots.at(-1)!.pending, promptTurn)
  assert.deepEqual(result.snapshots.at(-1)!.stopped, [], "no local row for the compaction")
})

test("a record stamped in the future cannot hold off quiet: the clock stops at the file time", () => {
  const lines = [
    line({ type: "session", version: 3, id: "s", cwd: "/r" }, 0),
    line({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "go" }] } }, 1_000),
    // Clock skew: the step claims to be written a day later than the file was.
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] } }, 2_000 + 24 * 3_600_000),
  ]
  const parsed = parseSessionFile(write("future-record.jsonl", lines, 2_000))
  assert.equal(lastWriteAt(parsed), T + 2_000)
  assert.equal(statusOf(parsed, T + 2_000 + 16 * 60_000).status, "quiet")
})
