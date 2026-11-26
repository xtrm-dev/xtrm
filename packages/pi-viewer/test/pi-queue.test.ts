import { strict as assert } from "node:assert"
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { normalizeEvent, parseSessionFile } from "../server/session.ts"
import type { ViewerEvent } from "../src/shared/types.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const BUSY = join(HERE, "fixtures", "pi", "busy-turn.jsonl")
const DELIVERED = join(HERE, "fixtures", "pi", "delivered-prompt.jsonl")
const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-pi-queue-"))
after(() => rmSync(SCRATCH, { recursive: true, force: true }))
const AGENT = { id: "%1", name: "worker" }

function eventsOf(file: string): ViewerEvent[] {
  const parsed = parseSessionFile(file)
  return parsed.events.map((entry, seq) => {
    const id = typeof entry.id === "string" ? entry.id : null
    return normalizeEvent(entry, AGENT, seq, id === null || parsed.branchIds.has(id))
  })
}

/**
 * Pi keeps steering and follow-up prompts in memory until delivery. It has no queue record
 * type: the first transcript write is the delivered user message. The fixture is a real
 * busy-turn shape, not a hand-made queue record.
 */
test("a prompt queued into a busy Pi pane has no transcript record until delivery", () => {
  const file = join(SCRATCH, "busy.jsonl")
  copyFileSync(BUSY, file)
  assert.equal(eventsOf(file).filter((event) => event.kind === "user").length, 0)

  appendFileSync(file, readFileSync(DELIVERED))
  const users = eventsOf(file).filter((event) => event.kind === "user")
  assert.equal(users.length, 1)
  assert.equal(users[0].text, "also check the sidebar")
  assert.equal(users[0].queued, undefined)
})
