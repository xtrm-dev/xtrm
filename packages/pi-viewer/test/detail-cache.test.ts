import { strict as assert } from "node:assert"
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { detailOf } from "../server/api.ts"
import type { ViewerAgent } from "../src/shared/types.ts"

const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-detail-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))

function agent(file: string, overrides: Partial<ViewerAgent> = {}): ViewerAgent {
  return {
    id: "%9",
    paneId: "%9",
    panePid: 1,
    provider: "claude",
    piPid: null,
    tmuxSession: "xx",
    windowIndex: 1,
    windowId: "@1",
    windowName: "work",
    paneIndex: 1,
    name: "lead",
    role: null,
    title: "lead",
    cwd: "/tmp",
    sessionFile: file,
    sessionId: "s",
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt: 0, lastWriteAt: 0,
    eventCount: 1,
    status: "idle",
    statusNote: null,
    ...overrides,
  }
}

function claudeRecord(block: Record<string, unknown>, stop: string | null = null): string {
  return `${JSON.stringify({
    type: "assistant",
    uuid: `u-${Math.random()}`,
    sessionId: "s",
    timestamp: "2026-01-01T00:00:00Z",
    message: {
      id: "m1",
      role: "assistant",
      model: "claude-sonnet",
      content: [block],
      stop_reason: stop,
    },
  })}\n`
}

test("a Claude entry that grows in place is not served from a stale detail cache", () => {
  const file = join(SCRATCH, "grow.jsonl")
  writeFileSync(file, claudeRecord({ type: "text", text: "working" }))
  const view = agent(file)

  const first = detailOf(view, 0)
  assert.deepEqual(
    first.parts?.map((part) => part.type),
    ["text"],
  )

  appendFileSync(
    file,
    claudeRecord({ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }, "tool_use"),
  )

  const second = detailOf(view, 0)
  assert.deepEqual(
    second.parts?.map((part) => part.type),
    ["text", "tool-call"],
  )
  assert.equal(second.parts?.[1]?.toolCallId, "toolu_1")
  assert.equal(second.stopReason, "toolUse")
})

test("the detail cache is keyed by agent identity, not only by transcript file", () => {
  const file = join(SCRATCH, "identity.jsonl")
  writeFileSync(file, claudeRecord({ type: "text", text: "same file" }))

  const lead = detailOf(agent(file), 0)
  const worker = detailOf(agent(file, { id: "%10", paneId: "%10", name: "worker" }), 0)

  assert.equal(lead.agentName, "lead")
  assert.equal(worker.agentName, "worker")
})
