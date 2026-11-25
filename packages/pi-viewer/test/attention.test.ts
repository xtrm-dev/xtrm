import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  CAPTURE_AFTER_MS,
  CAPTURE_EVERY_MS,
  MAX_READS_IN_FLIGHT,
  detectPermissionPrompt,
  panePrompt,
  prunePaneReads,
  resetPaneReads,
  settlePaneReads,
  withPaneAttention,
} from "../server/attention.ts"
import { claudeStatusOf, parseClaudeFile } from "../server/claude.ts"
import { QUIET_MS, statusOf, type ParsedFile } from "../server/session.ts"
import type { ViewerAgent } from "../src/shared/types.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const pane = (name: string) => readFileSync(join(HERE, "fixtures", "panes", name), "utf8")
const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-attention-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))
beforeEach(() => resetPaneReads())

const NOW = Date.parse("2026-11-25T12:00:00.000Z")

function parsed(messages: Array<Record<string, unknown>>, modifiedAt = NOW): ParsedFile {
  return {
    events: messages.map((message, index) => ({ type: "message", id: `e${index}`, message })),
    seqById: new Map(),
    branchIds: new Set(),
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt,
    size: 0,
  }
}

const toolUse = (name: string, args: unknown) => ({
  role: "assistant",
  stopReason: "toolUse",
  content: [{ type: "toolCall", id: "t1", name, arguments: args }],
})

// ── attention from the transcript ──

test("an open AskUserQuestion call is attention with the question as detail", () => {
  const state = statusOf(
    parsed([{ role: "user", content: "go" }, toolUse("AskUserQuestion", { questions: [{ question: "Ship option B?" }] })]),
    NOW,
  )
  assert.deepEqual(state, { status: "attention", note: "question", detail: "Ship option B?" })
})

test("an open ExitPlanMode call is attention with the plan as detail", () => {
  const state = statusOf(parsed([toolUse("ExitPlanMode", { plan: "1. split presence\n2. mount the line" })]), NOW)
  assert.equal(state.status, "attention")
  assert.equal(state.note, "plan approval")
  assert.equal(state.detail, "1. split presence\n2. mount the line")
})

test("a question stays attention after 15 minutes; once answered the turn is working again", () => {
  const ask = toolUse("AskUserQuestion", { questions: [{ question: "Which branch?" }] })
  assert.equal(statusOf(parsed([ask], NOW - QUIET_MS - 60_000), NOW).status, "attention")
  const answered = parsed([ask, { role: "toolResult", toolCallId: "t1", content: "main" }])
  assert.equal(statusOf(answered, NOW).status, "working")
})

test("any other tool call is plain working", () => {
  assert.deepEqual(statusOf(parsed([toolUse("Bash", { command: "pwd" })]), NOW), {
    status: "working",
    note: "running tools",
  })
})

test("Claude transcript: AskUserQuestion and ExitPlanMode tool_use blocks become attention", () => {
  const now = new Date().toISOString()
  const line = (name: string, input: unknown) =>
    `${JSON.stringify({ type: "user", uuid: "u1", timestamp: now, message: { role: "user", content: "go" } })}\n` +
    `${JSON.stringify({
      type: "assistant",
      uuid: "a1",
      timestamp: now,
      message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name, input }] },
    })}\n`
  const ask = join(SCRATCH, "ask.jsonl")
  writeFileSync(ask, line("AskUserQuestion", { questions: [{ question: "Merge now?", options: [] }] }))
  assert.deepEqual(claudeStatusOf(parseClaudeFile(ask)), { status: "attention", note: "question", detail: "Merge now?" })
  const plan = join(SCRATCH, "plan.jsonl")
  writeFileSync(plan, line("ExitPlanMode", { plan: "Build option B" }))
  assert.deepEqual(claudeStatusOf(parseClaudeFile(plan)), {
    status: "attention",
    note: "plan approval",
    detail: "Build option B",
  })
})

// ── local commands open no turn ──

test("a Pi !cmd (bashExecution) after a reply keeps the agent waiting, then idle; never quiet", () => {
  const reply = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] }
  const bash = { role: "bashExecution", command: "ls", output: "a\nb", exitCode: 0 }
  assert.equal(statusOf(parsed([{ role: "user", content: "go" }, reply, bash]), NOW).status, "waiting")
  assert.deepEqual(statusOf(parsed([reply, bash], NOW - QUIET_MS - 60_000), NOW), { status: "idle", note: "quiet for 15m" })
  // A !cmd during a running turn does not end it.
  assert.equal(statusOf(parsed([toolUse("Bash", {}), bash]), NOW).status, "working")
})

test("a Claude local slash command (/model) opens no turn; a prompt-type slash command does", () => {
  const now = new Date().toISOString()
  const rec = (value: Record<string, unknown>) => `${JSON.stringify({ timestamp: now, ...value })}\n`
  const settled =
    rec({ type: "user", uuid: "u1", message: { role: "user", content: "go" } }) +
    rec({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } })
  const local = join(SCRATCH, "local.jsonl")
  writeFileSync(
    local,
    settled +
      rec({ type: "user", uuid: "c0", parentUuid: "a1", isMeta: true, message: { role: "user", content: "<local-command-caveat>Caveat: local commands</local-command-caveat>" } }) +
      rec({ type: "user", uuid: "c1", parentUuid: "c0", message: { role: "user", content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>" } }) +
      rec({ type: "user", uuid: "c2", parentUuid: "c1", message: { role: "user", content: "<local-command-stdout>Set model to opus</local-command-stdout>" } }),
  )
  assert.equal(claudeStatusOf(parseClaudeFile(local)).status, "waiting")

  const prompted = join(SCRATCH, "prompted.jsonl")
  writeFileSync(
    prompted,
    settled +
      rec({ type: "user", uuid: "c1", parentUuid: "a1", message: { role: "user", content: "<command-name>/review</command-name>\n<command-args>42</command-args>" } }),
  )
  assert.equal(claudeStatusOf(parseClaudeFile(prompted)).status, "working", "a slash command with no local output runs the model")
})

test("a compaction after a settled turn settles (waiting, then idle); after an unanswered prompt the turn stays open", () => {
  const open = { role: "user", content: "a prompt the agent has not answered yet" }
  const reply = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] }
  const compacted = (messages: Array<Record<string, unknown>>, modifiedAt: number): ParsedFile => ({
    ...parsed(messages, modifiedAt),
    events: [...messages.map((message, index) => ({ type: "message", id: `e${index}`, message })), { type: "compaction", id: "c1", summary: "…" }],
  })
  assert.equal(statusOf(compacted([open, reply], NOW), NOW).status, "waiting")
  assert.equal(statusOf(compacted([open, reply], NOW - QUIET_MS - 60_000), NOW).status, "idle")
  // An auto compaction between a prompt and the first step (e9rd line 8097): the turn goes on.
  assert.deepEqual(statusOf(compacted([open], NOW), NOW), { status: "working", note: "compacting context" })

  // Claude: the typed /compact record, the summary, then the slash command and its local output.
  // The local command makes the typed record local too.
  const now = new Date().toISOString()
  const rec = (value: Record<string, unknown>) => `${JSON.stringify({ timestamp: now, ...value })}\n`
  const file = join(SCRATCH, "compact.jsonl")
  writeFileSync(
    file,
    rec({ type: "user", uuid: "u1", message: { role: "user", content: "/compact" } }) +
      rec({ type: "system", subtype: "compact_boundary", uuid: "b1", parentUuid: null }) +
      rec({ type: "user", uuid: "s1", parentUuid: "b1", isCompactSummary: true, message: { role: "user", content: "This session is being continued…" } }) +
      rec({ type: "user", uuid: "c1", parentUuid: "s1", message: { role: "user", content: "<command-name>/compact</command-name>" } }) +
      rec({ type: "user", uuid: "c2", parentUuid: "c1", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } }),
  )
  assert.equal(claudeStatusOf(parseClaudeFile(file)).status, "waiting")
})

test("a compaction inside an open tool loop keeps the turn working, then closes after the retry window", () => {
  const at = NOW - 5_000
  const tool = { type: "message", id: "e0", timestamp: at, message: toolUse("Bash", { command: "build" }) }
  const compact = { type: "compaction", id: "c1", timestamp: new Date(NOW).toISOString(), summary: "…" }
  const mid: ParsedFile = { ...parsed([], NOW), events: [tool, compact] }
  assert.deepEqual(statusOf(mid, NOW), { status: "working", note: "compacting context" })
  assert.deepEqual(statusOf(mid, NOW + 31_000), { status: "working", note: "compacting context" }, "no fixed retry timer flips the turn")

  // Claude auto-compact mid tool loop: the compact summary is followed by /compact and its output.
  const now = new Date(NOW).toISOString()
  const rec = (value: Record<string, unknown>) => `${JSON.stringify({ timestamp: now, ...value })}\n`
  const file = join(SCRATCH, "compact-tool.jsonl")
  writeFileSync(
    file,
    rec({ type: "user", uuid: "u1", message: { role: "user", content: "build it" } }) +
      rec({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "build" } }] } }) +
      rec({ type: "user", uuid: "s1", parentUuid: "a1", isCompactSummary: true, message: { role: "user", content: "This session is being continued…" } }) +
      rec({ type: "user", uuid: "c1", parentUuid: "s1", message: { role: "user", content: "<command-name>/compact</command-name>" } }) +
      rec({ type: "user", uuid: "c2", parentUuid: "c1", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } }),
  )
  assert.equal(claudeStatusOf(parseClaudeFile(file), NOW + 1_000).status, "working")
})

test("Claude bash mode is a local command, not a user turn", () => {
  const now = new Date(NOW).toISOString()
  const rec = (value: Record<string, unknown>) => `${JSON.stringify({ timestamp: now, ...value })}\n`
  const file = join(SCRATCH, "bash-mode.jsonl")
  writeFileSync(
    file,
    rec({ type: "user", uuid: "u1", message: { role: "user", content: "go" } }) +
      rec({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } }) +
      rec({ type: "user", uuid: "b1", parentUuid: "a1", message: { role: "user", content: "<bash-input>ls</bash-input>" } }) +
      rec({ type: "user", uuid: "b2", parentUuid: "b1", message: { role: "user", content: "<bash-stdout>a\nb</bash-stdout>" } }),
  )
  assert.deepEqual(claudeStatusOf(parseClaudeFile(file), NOW + 1_000), { status: "waiting", note: "awaiting input" })
})

// ── quiet ──

test("an open turn with no write for 15 minutes is quiet, not idle", () => {
  const old = NOW - QUIET_MS - 60_000
  assert.deepEqual(statusOf(parsed([toolUse("Bash", { command: "sleep 3600" })], old), NOW), {
    status: "quiet",
    note: "no output for 16m",
  })
  assert.equal(statusOf(parsed([{ role: "user", content: "go" }], old), NOW).status, "quiet")
  // Just under the threshold it is still working.
  assert.equal(statusOf(parsed([toolUse("Bash", {})], NOW - QUIET_MS + 1_000), NOW).status, "working")
})

test("a finished or aborted turn older than 15 minutes stays idle; an error stays an error", () => {
  const old = NOW - QUIET_MS - 60_000
  assert.deepEqual(statusOf(parsed([{ role: "assistant", stopReason: "stop", content: [] }], old), NOW), {
    status: "idle",
    note: "quiet for 15m",
  })
  assert.equal(statusOf(parsed([{ role: "assistant", stopReason: "aborted", content: [] }], old), NOW).status, "idle")
  assert.equal(statusOf(parsed([{ role: "assistant", stopReason: "error", content: [] }], old), NOW).status, "error")
})

// ── permission prompts on the pane ──

test("Claude Code permission prompt: tool and the request text, borders removed", () => {
  const prompt = detectPermissionPrompt(pane("claude-bash.txt"), "claude")
  assert.ok(prompt)
  assert.equal(prompt.tool, "Bash")
  assert.match(prompt.text, /^Bash command\n/)
  assert.match(prompt.text, /npm test --prefix packages\/pi-viewer/)
  assert.match(prompt.text, /Do you want to proceed\?/)
  assert.match(prompt.text, /3\. No, and tell Claude what to do differently/)
  assert.doesNotMatch(prompt.text, /─{3}/)
  assert.doesNotMatch(prompt.text, /Running…/, "transcript lines above the dialog are not part of it")
})

test("Claude Code boxed edit prompt with a nested diff box keeps its title", () => {
  const prompt = detectPermissionPrompt(pane("claude-edit-boxed.txt"), "claude")
  assert.ok(prompt)
  assert.equal(prompt.tool, "Edit")
  assert.match(prompt.text, /^Edit file\n/)
  assert.match(prompt.text, /Do you want to make this edit to thread\.ts\?/)
  assert.doesNotMatch(prompt.text, /│/)
})

test("Pi permission gate: Bash with the command, the reason and the question", () => {
  const prompt = detectPermissionPrompt(pane("pi-gate.txt"), "pi")
  assert.ok(prompt)
  assert.equal(prompt.tool, "Bash")
  assert.equal(
    prompt.text,
    "Dangerous Command Detected\nThis command contains recursive delete:\n 1 rm -rf /home/u/.cache/XTRM-1035/build\nAllow execution?",
  )
})

test("no prompt: idle panes, prose that quotes the question, the bypass-permissions footer", () => {
  assert.equal(detectPermissionPrompt(pane("claude-idle.txt"), "claude"), null)
  assert.equal(detectPermissionPrompt(pane("pi-idle.txt"), "pi"), null)
  // A prompt of the other runtime is not matched.
  assert.equal(detectPermissionPrompt(pane("pi-gate.txt"), "claude"), null)
  assert.equal(detectPermissionPrompt(pane("claude-bash.txt"), "pi"), null)
})

test("a prompt that scrolled above the bottom 30 lines is not open", () => {
  const screen = `${pane("claude-bash.txt")}${"● later output\n".repeat(31)}`
  assert.equal(detectPermissionPrompt(screen, "claude"), null)
})

// ── read bounds ──

function agent(over: Partial<ViewerAgent> = {}): ViewerAgent {
  return {
    id: "%7",
    paneId: "%7",
    panePid: 1,
    provider: "claude",
    piPid: 2,
    tmuxSession: "xx",
    windowIndex: 1,
    windowId: "@1",
    windowName: "w",
    paneIndex: 0,
    name: "worker",
    role: null,
    title: "",
    cwd: "/tmp",
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt: NOW - CAPTURE_AFTER_MS,
    lastWriteAt: NOW - CAPTURE_AFTER_MS,
    eventCount: 0,
    status: "working",
    statusNote: "running tools",
    statusDetail: null,
    ...over,
  }
}

test("the pane is read in the background for a working or quiet agent silent for 5 s, at most once per 2 s", async () => {
  const reads: string[] = []
  const capture = async (id: string) => {
    reads.push(id)
    return pane("claude-bash.txt")
  }
  assert.equal(panePrompt(agent({ status: "waiting" }), NOW, capture), null)
  assert.equal(panePrompt(agent({ status: "idle" }), NOW, capture), null)
  assert.equal(panePrompt(agent({ modifiedAt: NOW - 1_000 }), NOW, capture), null)
  assert.equal(reads.length, 0, "no read for a waiting or idle agent or a fresh write")

  // The first call starts a read and answers from the (empty) cache: nothing waits on tmux.
  assert.equal(panePrompt(agent(), NOW, capture), null)
  assert.equal(panePrompt(agent(), NOW, capture), null)
  assert.equal(reads.length, 1, "a read in flight is not started twice")
  await settlePaneReads()
  assert.equal(panePrompt(agent(), NOW + CAPTURE_EVERY_MS - 1, capture)?.tool, "Bash")
  assert.equal(reads.length, 1, "a call inside 2 s uses the cached read")
  panePrompt(agent(), NOW + CAPTURE_EVERY_MS, capture)
  await settlePaneReads()
  assert.equal(reads.length, 2)
})

test("a permission prompt open past 15 minutes stays attention: quiet agents are read too", async () => {
  const quiet = agent({ provider: "pi", status: "quiet", statusNote: "no output for 16m", modifiedAt: NOW - QUIET_MS - 60_000 })
  const capture = async () => pane("pi-gate.txt")
  assert.equal(withPaneAttention(quiet, NOW, capture).status, "quiet", "the first poll only starts the read")
  await settlePaneReads()
  const out = withPaneAttention(quiet, NOW + 1_500, capture)
  assert.equal(out.status, "attention")
  assert.equal(out.statusNote, "permission: Bash")
})

test("withPaneAttention turns a working agent into attention · permission with the prompt as detail", async () => {
  const capture = async () => pane("pi-gate.txt")
  withPaneAttention(agent({ provider: "pi" }), NOW, capture)
  await settlePaneReads()
  const out = withPaneAttention(agent({ provider: "pi" }), NOW + 1_500, capture)
  assert.equal(out.status, "attention")
  assert.equal(out.statusNote, "permission: Bash")
  assert.match(out.statusDetail ?? "", /Allow execution\?$/)
  resetPaneReads()
  const plain = agent()
  withPaneAttention(plain, NOW, async () => null)
  await settlePaneReads()
  assert.equal(withPaneAttention(plain, NOW + 1_500, async () => null), plain, "a failed capture changes nothing")
})

test("a late capture cannot repopulate a pane after it was pruned or answered", async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const slow = agent({ paneId: "%9" })
  assert.equal(panePrompt(slow, NOW, async () => {
    await gate
    return pane("claude-bash.txt")
  }), null)
  prunePaneReads(new Set())
  release()
  await settlePaneReads()
  // The pruned pane's slow read finished, but its result must be discarded. A fresh call
  // starts a new read; it must not see the expired prompt from the cache.
  assert.equal(panePrompt(agent({ paneId: "%9" }), NOW + 1, async () => null), null)
})

test("at most four reads run at once; reads of panes that are gone are dropped", async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reads: string[] = []
  const capture = async (id: string) => {
    reads.push(id)
    await gate
    return pane("claude-bash.txt")
  }
  for (let index = 1; index <= 6; index += 1) panePrompt(agent({ paneId: `%${index}` }), NOW, capture)
  assert.equal(reads.length, MAX_READS_IN_FLIGHT)
  release()
  await settlePaneReads()
  assert.equal(panePrompt(agent({ paneId: "%1" }), NOW + 1, capture)?.tool, "Bash")
  prunePaneReads(new Set(["%2"]))
  // %1 was pruned: its next call starts a fresh read and has no cached prompt.
  assert.equal(panePrompt(agent({ paneId: "%1" }), NOW + 2, capture), null)
  assert.equal(panePrompt(agent({ paneId: "%2" }), NOW + 2, capture)?.tool, "Bash")
  await settlePaneReads()
})
