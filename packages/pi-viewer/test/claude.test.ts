import { strict as assert } from "node:assert"
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  claudeAgentName,
  claudeSlug,
  claudeStatusOf,
  normalizeClaudeEvent,
  parseClaudeFile,
  resolveClaudeTranscript,
} from "../server/claude.ts"
import { channelTurns } from "../src/lib/thread.ts"
import type { ViewerEvent } from "../src/shared/types.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, "fixtures", "claude", "session.jsonl")
const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-claude-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))

const AGENT = { id: "%1", name: "lead" }

/** Copy the fixture so each test owns its own cache key. */
function fixtureCopy(label: string): string {
  const file = join(SCRATCH, `${label}.jsonl`)
  copyFileSync(FIXTURE, file)
  return file
}

function eventsOf(file: string, scope: "branch" | "all" = "branch"): ViewerEvent[] {
  const parsed = parseClaudeFile(file)
  const out: ViewerEvent[] = []
  parsed.events.forEach((entry, index) => {
    const id = typeof entry.id === "string" ? entry.id : null
    const onBranch = id === null || parsed.branchIds.has(id)
    if (scope === "branch" && !onBranch) return
    out.push(normalizeClaudeEvent(entry, AGENT, index, onBranch))
  })
  return out
}

test("slug replaces every non-alphanumeric character, dots and underscores included", () => {
  assert.equal(
    claudeSlug("/home/dawid/dev/xtrm/.xtrm/worktrees/xtrm-xt-claude-thread-lead"),
    "-home-dawid-dev-xtrm--xtrm-worktrees-xtrm-xt-claude-thread-lead",
  )
  assert.equal(claudeSlug("/work/my_proj.v2"), "-work-my-proj-v2")
  assert.equal(claudeSlug("/a b/c:d"), "-a-b-c-d")
})

test("operator prompt, final reply and peer messages are the visible thread", () => {
  const events = eventsOf(fixtureCopy("thread"))
  const kinds = events.map((event) => event.kind)
  assert.ok(kinds.includes("user"))
  const user = events.find((event) => event.kind === "user")
  assert.equal(user?.text, "start the work")
  const final = events.find((event) => event.kind === "assistant" && event.text === "All done.")
  assert.ok(final, "final assistant text present")
  assert.equal(final?.stopReason, "stop")
})

test("thinking joins the first tool call of its message; each parallel call is its own event", () => {
  const events = eventsOf(fixtureCopy("merge"))
  const first = events.find((event) => event.parts?.some((part) => part.toolCallId === "toolu_1"))
  assert.deepEqual(
    first?.parts?.map((part) => part.type),
    ["thinking", "tool-call"],
  )
  assert.equal(first?.stopReason, "toolUse")
  const second = events.find((event) => event.parts?.some((part) => part.toolCallId === "toolu_2"))
  assert.notEqual(second?.id, first?.id)
  assert.deepEqual(second?.parts?.map((part) => part.type), ["tool-call"])
})

test("tool results pair with their calls by tool_use_id and carry the tool name and error flag", () => {
  const events = eventsOf(fixtureCopy("pair"))
  const results = events.filter((event) => event.kind === "tool-result")
  const bash = results.find((event) => event.toolCallId === "toolu_1")
  const read = results.find((event) => event.toolCallId === "toolu_2")
  assert.equal(bash?.toolName, "Bash")
  assert.equal(bash?.isError, false)
  assert.match(bash?.output ?? "", /file-a/)
  assert.equal(read?.toolName, "Read")
  assert.equal(read?.isError, true)
  assert.match(read?.output ?? "", /ENOENT/)
})

test("the Channel groups the work into one turn that settles on the final text, tools and thinking collapsed", () => {
  const turns = channelTurns(eventsOf(fixtureCopy("turns"))).filter((turn) => !turn.sentOnly && turn.inbound.length === 0)
  const turn = turns.find((candidate) => candidate.final?.text === "All done.")
  assert.ok(turn, "a turn settles on the final reply")
  assert.equal(turn?.pending, false)
  assert.equal(turn?.users[0]?.text, "start the work")
  const tools = turn?.activity.filter((item) => item.kind === "tool") ?? []
  assert.equal(tools.length, 2)
  assert.ok(tools.every((item) => item.call && item.result), "each call is paired with its result")
  assert.equal(tools.find((item) => item.toolCallId === "toolu_2")?.isError, true)
  assert.equal(turn?.activity.filter((item) => item.kind === "thinking").length, 1)
})

test("sidechain records are off the branch: out of the Channel, present in All events", () => {
  const file = fixtureCopy("sidechain")
  const branch = eventsOf(file, "branch")
  const all = eventsOf(file, "all")
  assert.ok(!branch.some((event) => event.summary.includes("subagent chatter")))
  const side = all.find((event) => event.summary.includes("subagent chatter"))
  assert.ok(side, "present in All events")
  assert.equal(side?.onBranch, false)
  assert.ok(all.length > branch.length)
})

test("hook-injected user records are meta, never a prompt", () => {
  const events = eventsOf(fixtureCopy("meta"))
  const injected = events.find((event) => event.summary.includes("hook injected context"))
  assert.equal(injected?.kind, "meta")
  assert.ok(!events.some((event) => event.kind === "user" && /system-reminder/.test(event.text ?? "")))
})

test("the cross-session envelope maps through the intercom parser, in both directions", () => {
  const events = eventsOf(fixtureCopy("intercom"))
  const received = events.find((event) => event.kind === "intercom" && event.intercom?.direction === "received")
  assert.equal(received?.intercom?.from, "sibling")
  assert.equal(received?.intercom?.body, "please review the diff")
  assert.equal(received?.intercom?.messageId, "m-1")
  assert.equal(received?.intercom?.expectsReply, true)
  const sent = events.find((event) => event.kind === "intercom" && event.intercom?.direction === "sent")
  assert.equal(sent?.intercom?.body, "looks fine")
  // The SendMessage delivery result is a meta row, not a tool step.
  const delivery = events.find((event) => event.toolCallId === "toolu_3")
  assert.equal(delivery?.kind, "meta")
})

test("slash commands render as the command line, not tag soup", () => {
  const events = eventsOf(fixtureCopy("slash"))
  const command = events.filter((event) => event.kind === "user").at(-1)
  assert.equal(command?.text, "/review PR 12")
})

test("bookkeeping rows are one line; wire telemetry is dropped; undated rows borrow a time", () => {
  const all = eventsOf(fixtureCopy("bookkeeping"), "all")
  assert.ok(all.some((event) => event.summary === "attachment · hook_success"))
  assert.ok(all.some((event) => event.summary.startsWith("system · turn_duration")))
  assert.ok(all.some((event) => event.summary === "file-history-snapshot"))
  assert.ok(!all.some((event) => event.summary.includes("api-request")))
  assert.ok(!all.some((event) => event.summary === "mode"))
  assert.ok(all.every((event, index) => index === 0 || event.at > 0 || all[index - 1].at === 0))
  const snapshot = all.find((event) => event.summary === "file-history-snapshot")
  assert.equal(snapshot?.kind, "meta")
})

test("session name comes from custom-title, then agent-name; the fallback is cwd basename plus a short id", () => {
  const parsed = parseClaudeFile(fixtureCopy("name"))
  assert.equal(parsed.sessionName, "lead-claude")
  assert.equal(parsed.model, "claude-opus-5-5")

  const agentOnly = join(SCRATCH, "agent-name.jsonl")
  writeFileSync(agentOnly, `${JSON.stringify({ type: "agent-name", agentName: "worker-7", sessionId: "x" })}\n`)
  assert.equal(parseClaudeFile(agentOnly).sessionName, "worker-7")

  const untitled = join(SCRATCH, "untitled.jsonl")
  writeFileSync(untitled, `${JSON.stringify({ type: "user", uuid: "u", message: { role: "user", content: "hi" } })}\n`)
  assert.equal(parseClaudeFile(untitled).sessionName, null)

  assert.equal(claudeAgentName(null, "/work/my_proj.v2", "abcdef12-3456", "w"), "my_proj.v2 · abcdef12")
  assert.equal(claudeAgentName("lead-claude", "/work/x", "abcdef12-3456", "w"), "lead-claude")
  assert.equal(claudeAgentName(null, "/", null, "window"), "window")
})

test("parsing is incremental: appended records add events, earlier sequence numbers hold", () => {
  const file = fixtureCopy("incremental")
  const before = eventsOf(file, "all")
  const firstIds = before.map((event) => event.id)
  appendFileSync(
    file,
    `${JSON.stringify({
      type: "assistant",
      uuid: "a9",
      timestamp: "2026-11-25T10:01:00.000Z",
      message: { id: "msg_Z", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "one more" }] },
    })}\n`,
  )
  const after = eventsOf(file, "all")
  assert.equal(after.length, before.length + 1)
  assert.deepEqual(after.slice(0, before.length).map((event) => event.id), firstIds)
  assert.equal(after.at(-1)?.text, "one more")
})

test("a half-written tool turn stays pending instead of looking settled", () => {
  const file = join(SCRATCH, "pending.jsonl")
  const record = (extra: Record<string, unknown>) => `${JSON.stringify(extra)}\n`
  writeFileSync(
    file,
    record({ type: "user", uuid: "u1", timestamp: "2026-11-25T10:00:00.000Z", message: { role: "user", content: "go" } }) +
      record({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-11-25T10:00:01.000Z",
        message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "thinking", thinking: "hmm" }] },
      }),
  )
  const early = eventsOf(file)
  assert.equal(early.length, 1, "the tail with no tool_use block yet is held back")
  assert.equal(channelTurns(early).at(-1)?.pending, true)
  assert.equal(claudeStatusOf(parseClaudeFile(file)).status, "working")
  appendFileSync(
    file,
    record({
      type: "assistant",
      uuid: "a2",
      timestamp: "2026-11-25T10:00:02.000Z",
      message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pwd" } }] },
    }),
  )
  const late = eventsOf(file)
  assert.equal(late.length, 2)
  assert.deepEqual(late[1].parts?.map((part) => part.type), ["thinking", "tool-call"])
})

test("status: an interrupted turn is idle, a finished reply waits for input", () => {
  // The fixture ends on an operator prompt: the agent is mid-turn.
  assert.equal(claudeStatusOf(parseClaudeFile(fixtureCopy("status"))).status, "working")
  const interrupted = join(SCRATCH, "interrupted.jsonl")
  const now = new Date().toISOString()
  writeFileSync(
    interrupted,
    `${JSON.stringify({ type: "user", uuid: "u1", timestamp: now, message: { role: "user", content: "go" } })}\n` +
      `${JSON.stringify({ type: "user", uuid: "u2", timestamp: now, message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } })}\n`,
  )
  assert.deepEqual(claudeStatusOf(parseClaudeFile(interrupted)), { status: "idle", note: "turn interrupted" })

  const waiting = join(SCRATCH, "waiting.jsonl")
  writeFileSync(
    waiting,
    `${JSON.stringify({ type: "assistant", uuid: "a1", timestamp: now, message: { id: "m", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } })}\n`,
  )
  assert.equal(claudeStatusOf(parseClaudeFile(waiting)).status, "waiting")
})

test("bulk strings keep the session.ts caps", () => {
  const file = join(SCRATCH, "caps.jsonl")
  writeFileSync(
    file,
    `${JSON.stringify({ type: "user", uuid: "u1", message: { role: "user", content: "x".repeat(50_000) } })}\n` +
      `${JSON.stringify({ type: "assistant", uuid: "a1", message: { id: "m", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "y".repeat(10_000) } }] } })}\n` +
      `${JSON.stringify({ type: "user", uuid: "r1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "z".repeat(50_000) }] } })}\n`,
  )
  const events = eventsOf(file)
  assert.ok((events[0].text ?? "").length < 20_100 && events[0].truncated)
  assert.ok((events[1].parts?.[0].input ?? "").length < 2_100)
  assert.ok((events[2].output ?? "").length < 6_100 && events[2].truncated)
  assert.ok((events[0].raw ?? "").length < 6_100)
})

// ---------------------------------------------------------------------------
// Pane to transcript matching
// ---------------------------------------------------------------------------

function makeConfig(label: string): string {
  const dir = join(SCRATCH, label)
  mkdirSync(join(dir, "sessions"), { recursive: true })
  mkdirSync(join(dir, "projects"), { recursive: true })
  return dir
}

function transcript(config: string, cwd: string, sessionId: string, mtimeSec: number): string {
  const dir = join(config, "projects", claudeSlug(cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sessionId}.jsonl`)
  writeFileSync(file, `${JSON.stringify({ type: "user", uuid: sessionId, message: { role: "user", content: "x" } })}\n`)
  utimesSync(file, mtimeSec, mtimeSec)
  return file
}

function registry(config: string, pid: number, sessionId: string, cwd: string, procStart: string): void {
  writeFileSync(join(config, "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId, cwd, procStart, name: "n" }))
}

const CWD = "/work/my_proj.v2/.wt"
const ID_A = "aaaaaaaa-0000-4000-8000-000000000001"
const ID_B = "bbbbbbbb-0000-4000-8000-000000000002"

test("matching rule 1: the registry entry of the pid names the transcript, even when a newer one shares the cwd", () => {
  const config = makeConfig("registry")
  const mine = transcript(config, CWD, ID_A, 1_000)
  transcript(config, CWD, ID_B, 2_000)
  registry(config, 4242, ID_A, CWD, "777")
  const found = resolveClaudeTranscript({
    pid: 4242,
    cwds: [CWD],
    configDir: config,
    start: { ticks: "777", ms: 500_000 },
    claimed: new Set(),
  })
  assert.equal(found.rule, "registry")
  assert.equal(found.file, mine)
  assert.equal(found.sessionId, ID_A)
})

test("a registry entry whose procStart differs (recycled pid) is not trusted", () => {
  const config = makeConfig("recycled")
  transcript(config, CWD, ID_A, 5_000)
  registry(config, 4243, ID_A, CWD, "111")
  const found = resolveClaudeTranscript({
    pid: 4243,
    cwds: [CWD],
    configDir: config,
    start: { ticks: "999", ms: 1_000_000 },
    claimed: new Set(),
  })
  assert.notEqual(found.rule, "registry")
})

test("matching rule 2: without a registry entry, the newest transcript written since the process started wins", () => {
  const config = makeConfig("fallback")
  transcript(config, CWD, ID_A, 1_000)
  const fresh = transcript(config, CWD, ID_B, 9_000)
  const found = resolveClaudeTranscript({
    pid: 4244,
    cwds: [CWD],
    configDir: config,
    start: { ticks: null, ms: 5_000_000 },
    claimed: new Set(),
  })
  assert.equal(found.rule, "newest-since-start")
  assert.equal(found.file, fresh)
})

test("two panes sharing a cwd get different transcripts: claimed and foreign-registered files are excluded", () => {
  const config = makeConfig("shared-cwd")
  // Pane 1 has a registry entry; pane 2 does not, so it must not adopt pane 1's newer file.
  const first = transcript(config, CWD, ID_A, 9_000)
  const second = transcript(config, CWD, ID_B, 8_000)
  registry(config, process.pid, ID_A, CWD, "1")
  const claimed = new Set<string>()
  const noRegistry = resolveClaudeTranscript({
    pid: 4245,
    cwds: [CWD],
    configDir: config,
    start: { ticks: null, ms: 1_000 },
    claimed,
  })
  assert.equal(noRegistry.file, second, "the foreign registered session is skipped")

  const config2 = makeConfig("shared-cwd-2")
  transcript(config2, CWD, ID_A, 9_000)
  const older = transcript(config2, CWD, ID_B, 8_000)
  const claimed2 = new Set<string>([join(config2, "projects", claudeSlug(CWD), `${ID_A}.jsonl`)])
  const next = resolveClaudeTranscript({ pid: 4246, cwds: [CWD], configDir: config2, start: { ticks: null, ms: 1_000 }, claimed: claimed2 })
  assert.equal(next.file, older, "a transcript claimed by another pane is skipped")
  assert.notEqual(first, second)
})

test("a transcript older than the process is never adopted", () => {
  const config = makeConfig("stale")
  transcript(config, CWD, ID_A, 1_000)
  const found = resolveClaudeTranscript({
    pid: 4247,
    cwds: [CWD],
    configDir: config,
    start: { ticks: null, ms: 9_000_000 },
    claimed: new Set(),
  })
  assert.equal(found.file, null)
  assert.equal(found.rule, null)
})

test("slugs over 200 characters resolve through the truncated-prefix directory", () => {
  const config = makeConfig("long")
  const longCwd = `/${"segment_".repeat(40)}end`
  const slug = claudeSlug(longCwd)
  assert.ok(slug.length > 200)
  const dir = join(config, "projects", `${slug.slice(0, 200)}-hash123`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${ID_A}.jsonl`)
  writeFileSync(file, "{}\n")
  registry(config, 4248, ID_A, longCwd, "5")
  const found = resolveClaudeTranscript({ pid: 4248, cwds: [longCwd], configDir: config, start: { ticks: "5", ms: 1 }, claimed: new Set() })
  assert.equal(found.file, file)
})
