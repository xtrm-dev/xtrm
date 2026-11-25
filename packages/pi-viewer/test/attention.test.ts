import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  CAPTURE_AFTER_MS,
  CAPTURE_EVERY_MS,
  detectPermissionPrompt,
  panePrompt,
  resetPaneReads,
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
    eventCount: 0,
    status: "working",
    statusNote: "running tools",
    statusDetail: null,
    ...over,
  }
}

test("the pane is read only for a working agent silent for 5 s, at most once per 2 s", () => {
  const reads: string[] = []
  const capture = (id: string) => {
    reads.push(id)
    return pane("claude-bash.txt")
  }
  assert.equal(panePrompt(agent({ status: "waiting" }), NOW, capture), null)
  assert.equal(panePrompt(agent({ modifiedAt: NOW - 1_000 }), NOW, capture), null)
  assert.equal(reads.length, 0, "no read for a waiting agent or a fresh write")

  assert.equal(panePrompt(agent(), NOW, capture)?.tool, "Bash")
  assert.equal(panePrompt(agent(), NOW + CAPTURE_EVERY_MS - 1, capture)?.tool, "Bash")
  assert.equal(reads.length, 1, "the second call inside 2 s uses the cached read")
  panePrompt(agent(), NOW + CAPTURE_EVERY_MS, capture)
  assert.equal(reads.length, 2)
})

test("withPaneAttention turns a working agent into attention · permission with the prompt as detail", () => {
  const out = withPaneAttention(agent({ provider: "pi" }), NOW, () => pane("pi-gate.txt"))
  assert.equal(out.status, "attention")
  assert.equal(out.statusNote, "permission: Bash")
  assert.match(out.statusDetail ?? "", /Allow execution\?$/)
  resetPaneReads()
  const plain = agent()
  assert.equal(withPaneAttention(plain, NOW, () => null), plain, "a failed capture changes nothing")
})
