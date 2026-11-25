import { strict as assert } from "node:assert"
import { appendFileSync, copyFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { claudeStatusOf, parseClaudeFile } from "../server/claude.ts"
import { lastWriteAt, parseSessionFile, statusOf, QUIET_MS } from "../server/session.ts"

const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-real-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))

// Shapes copied from real transcripts (redacted): Claude auto-compact, Claude /model + !ls,
// Pi context overflow. Field names and nesting are kept; text and ids are redacted.
const iso = (ms: number) => new Date(ms).toISOString()
const claude = (value: Record<string, unknown>, at = Date.now()) => `${JSON.stringify({ timestamp: iso(at), ...value })}\n`
const pi = (value: Record<string, unknown>, at = Date.now()) => `${JSON.stringify({ timestamp: iso(at), ...value })}\n`

function claudeStatus(lines: string[]): string {
  const file = join(SCRATCH, `claude-${Math.random().toString(36).slice(2)}.jsonl`)
  writeFileSync(file, lines.join(""))
  return claudeStatusOf(parseClaudeFile(file), Date.now() + 1_000).status
}

test("real Claude auto-compact (tool_use -> tool_result -> compact) stays working, not waiting", () => {
  // Redacted from ~/.claude/projects/-home-dawid-dev-xtrm--.../2f0aa11a-...jsonl: line 6372.
  const status = claudeStatus([
    claude({ type: "user", uuid: "u1", message: { role: "user", content: "finish the review" } }),
    claude({
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      message: {
        id: "m1",
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_redacted", name: "Bash", input: { command: "git status" } }],
      },
    }),
    claude({
      type: "user",
      uuid: "r1",
      parentUuid: "a1",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_redacted", content: "clean", is_error: false }] },
    }),
    claude({ type: "system", subtype: "compact_boundary", uuid: "b1", parentUuid: null }),
    claude({ type: "user", uuid: "s1", parentUuid: "b1", isCompactSummary: true, message: { role: "user", content: "This session is being continued" } }),
  ])
  assert.equal(status, "working")
})

test("real Claude /model then !ls does not stay working", () => {
  // Redacted from ~/.claude/projects/.../e158b382-...jsonl line 93: /model + local output.
  assert.equal(
    claudeStatus([
      claude({ type: "user", uuid: "u1", message: { role: "user", content: "go" } }),
      claude({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } }),
      claude({ type: "user", uuid: "c1", parentUuid: "a1", message: { role: "user", content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>" } }),
      claude({ type: "user", uuid: "c2", parentUuid: "c1", message: { role: "user", content: "<local-command-stdout>Set model</local-command-stdout>" } }),
    ]),
    "waiting",
  )
})

test("probe B: Claude /model followed by !ls returns waiting", () => {
  const status = claudeStatus([
    claude({ type: "user", uuid: "u1", message: { role: "user", content: "go" } }),
    claude({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } }),
    claude({ type: "user", uuid: "c1", parentUuid: "a1", message: { role: "user", content: "<command-name>/model</command-name>" } }),
    claude({ type: "user", uuid: "c2", parentUuid: "c1", message: { role: "user", content: "<local-command-stdout>Set model</local-command-stdout>" } }),
    claude({ type: "user", uuid: "b1", parentUuid: "c2", message: { role: "user", content: "<bash-input>ls</bash-input>" } }),
    claude({ type: "user", uuid: "b2", parentUuid: "b1", message: { role: "user", content: "<bash-stdout>a</bash-stdout><bash-stderr></bash-stderr>" } }),
  ])
  assert.equal(status, "waiting")
})

test("probe C: real Pi overflow (error -> context_edit -> compaction) stays working, not waiting", () => {
  const now = Date.now()
  const file = join(SCRATCH, "pi-overflow.jsonl")
  writeFileSync(
    file,
    [
      pi({ type: "session", version: 3, id: "s", cwd: "/tmp" }, now - 5_000),
      pi({ type: "message", id: "e1", parentId: "s", message: { role: "toolResult", timestamp: now - 4_000, content: [] } }, now - 4_000),
      pi({ type: "message", id: "e2", parentId: "e1", message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Codex error: context_length_exceeded: Your input exceeds the context window",
        timestamp: now - 3_000,
        content: [],
      } }, now - 3_000),
      pi({ type: "context_edit", id: "x1", parentId: "e2", targetId: "e2" }, now - 2_000),
      pi({ type: "compaction", id: "c1", parentId: "x1", summary: "## Goal\n- continue" }, now - 1_000),
    ].join(""),
  )
  const parsed = parseSessionFile(file)
  assert.deepEqual(statusOf(parsed, now + 1_000), { status: "working", note: "compacting context" })
  assert.equal(statusOf(parsed, now + 31_000).status, "working", "no 30s timer flips a retrying turn")
  assert.equal(statusOf(parsed, now + QUIET_MS + 1_000).status, "quiet", "only a long silence quiets it")
})

test("lastWriteAt is the record's own write time: a meta-only append and a fresh parse do not move it", () => {
  const now = Math.floor(Date.now() / 1000) * 1000
  const file = join(SCRATCH, "pi-long-reply.jsonl")
  writeFileSync(
    file,
    [
      pi({ type: "message", id: "u1", message: { role: "user", timestamp: now - 60_000, content: [{ type: "text", text: "write the long answer" }] } }, now - 60_000),
      // Pi stamps the entry when it is appended (stream end); message.timestamp is the stream start.
      pi({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", timestamp: now - 60_000, stopReason: "stop", content: [{ type: "text", text: "a very long final answer" }] } }, now),
    ].join(""),
  )
  const writeAt = now / 1000
  utimesSync(file, writeAt, writeAt)
  const first = parseSessionFile(file)
  assert.equal(lastWriteAt(first), now, "the entry write time, not the message stream start")

  appendFileSync(file, pi({ type: "model_change", id: "m1", parentId: "a1", provider: "p", modelId: "m" }, now + 10_000))
  utimesSync(file, writeAt + 10, writeAt + 10)
  const second = parseSessionFile(file)
  assert.equal(lastWriteAt(second), now, "a model-only write does not move it")

  const fresh = join(SCRATCH, "pi-long-reply-fresh.jsonl")
  copyFileSync(file, fresh)
  utimesSync(fresh, writeAt + 10, writeAt + 10)
  assert.equal(lastWriteAt(parseSessionFile(fresh)), now, "a fresh parse gives the same value")
})
