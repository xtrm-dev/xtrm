import { strict as assert } from "node:assert"
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { claudeStatusOf, dropClaudeCache, normalizeClaudeEvent, parseClaudeFile } from "../server/claude.ts"
import { deliveryOfUser } from "../src/lib/delivery.ts"
import { channelTimeline } from "../src/lib/thread.ts"
import type { ViewerEvent } from "../src/shared/types.ts"

const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-queue-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))
const AGENT = { id: "%1", name: "lead" }

function fileOf(label: string): string {
  return join(SCRATCH, `${label}.jsonl`)
}

function write(file: string, records: unknown[]): void {
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n")
}

function append(file: string, records: unknown[]): void {
  appendFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n")
}

function eventsOf(file: string): ViewerEvent[] {
  const parsed = parseClaudeFile(file)
  return parsed.events.map((entry, index) =>
    normalizeClaudeEvent(entry, AGENT, index, parsed.branchIds.has(String(entry.id))),
  )
}

const AT = "2026-11-25T11:59:51.507Z"
const LATER = "2026-11-25T12:01:02.004Z"
const TEXT = "run the focused queue tests"

/** A real queue-operation enqueue record: content is the operator prompt. */
const enqueue = {
  type: "queue-operation",
  operation: "enqueue",
  timestamp: AT,
  sessionId: "11111111-2222-3333-4444-555555555555",
  uuid: "queue-1",
  content: TEXT,
}

/** A real remove record: delivery follows as a queued_command attachment. */
const remove = {
  type: "queue-operation",
  operation: "remove",
  timestamp: LATER,
  sessionId: "11111111-2222-3333-4444-555555555555",
  uuid: "queue-2",
  content: TEXT,
}

/** A real delivered mid-turn prompt attachment. */
const attachment = {
  type: "attachment",
  uuid: "attach-1",
  parentUuid: "queue-1",
  timestamp: LATER,
  sessionId: "11111111-2222-3333-4444-555555555555",
  attachment: {
    type: "queued_command",
    source_uuid: "queue-1",
    delivery_id: "delivery-1",
    commandMode: "prompt",
    origin: { kind: "human" },
    prompt: TEXT,
  },
}

test("a prompt queued into a busy pane is visible as queued before delivery", () => {
  const file = fileOf("pending")
  dropClaudeCache(file)
  write(file, [enqueue])
  const [queued] = eventsOf(file).filter((event) => event.kind === "user")
  assert.equal(queued.text, TEXT)
  assert.equal(queued.queued, true)
  const items = channelTimeline(eventsOf(file))
  const row = items.find((item) => item.kind === "user")
  assert.ok(row && row.kind === "user")
  assert.equal(deliveryOfUser(row, items), "pending")
})

test("remove plus queued_command attachment updates the queued row in place, once", () => {
  const file = fileOf("delivered")
  dropClaudeCache(file)
  write(file, [enqueue, remove, attachment])
  const users = eventsOf(file).filter((event) => event.kind === "user")
  assert.equal(users.length, 1)
  assert.equal(users[0].text, TEXT)
  assert.equal(users[0].queued, undefined)
  assert.equal(users[0].at, Date.parse(LATER))
})

test("the queued row keeps its key when the attachment arrives later", () => {
  const file = fileOf("incremental")
  dropClaudeCache(file)
  write(file, [enqueue])
  const before = eventsOf(file).filter((event) => event.kind === "user")
  assert.equal(before.length, 1)
  const id = before[0].id
  append(file, [remove, attachment])
  const after = eventsOf(file).filter((event) => event.kind === "user")
  assert.equal(after.length, 1)
  assert.equal(after[0].id, id)
  assert.equal(after[0].queued, undefined)
})

test("dequeue plus a normal user record shows the turn once, not the queued row", () => {
  const file = fileOf("dequeued")
  dropClaudeCache(file)
  write(file, [
    enqueue,
    {
      type: "queue-operation",
      operation: "dequeue",
      timestamp: LATER,
      sessionId: "11111111-2222-3333-4444-555555555555",
      uuid: "queue-3",
      content: TEXT,
    },
    {
      type: "user",
      uuid: "user-1",
      parentUuid: "queue-3",
      timestamp: LATER,
      sessionId: "11111111-2222-3333-4444-555555555555",
      message: { role: "user", content: [{ type: "text", text: TEXT }] },
    },
  ])
  const users = eventsOf(file).filter((event) => event.kind === "user")
  assert.equal(users.length, 1)
  assert.equal(users[0].text, TEXT)
  assert.equal(users[0].queued, undefined)
})

test("a queued prompt does not change an open tool turn", () => {
  const file = fileOf("status")
  dropClaudeCache(file)
  write(file, [
    {
      type: "assistant",
      uuid: "assistant-1",
      parentUuid: null,
      timestamp: AT,
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "sleep 1" } }],
      },
    },
    enqueue,
  ])
  const parsed = parseClaudeFile(file)
  assert.equal(claudeStatusOf(parsed, Date.parse(LATER) + 1).status, "working")
})

test("plugin and task-notification queue entries are not operator rows", () => {
  const file = fileOf("not-operator")
  dropClaudeCache(file)
  write(file, [
    { ...enqueue, content: '<channel source="plugin:test">hello</channel>' },
    { ...enqueue, timestamp: LATER, content: "<task-notification>done</task-notification>" },
  ])
  assert.equal(eventsOf(file).filter((event) => event.kind === "user").length, 0)
})
