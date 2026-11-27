import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { handleApi, resetDiscovery, seedDiscovery } from "../server/api.ts"
import { parseClaudeFile } from "../server/claude.ts"
import { contextUsageOfParsed } from "../server/discover.ts"
import { setModelRegistryForTests } from "../server/model-windows.ts"
import { parseSessionFile } from "../server/session.ts"
import { contextPercent } from "../src/lib/context-usage.ts"
import type { SessionsPayload, ViewerAgent } from "../src/shared/types.ts"

const SCRATCH = mkdtempSync(join(tmpdir(), "pi-viewer-context-"))
after(() => resetDiscovery())

function write(name: string, records: unknown[]): string {
  const file = join(SCRATCH, name)
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n")
  return file
}

const T0 = Date.parse("2026-11-26T16:00:00.000Z")

function claudeFile(): string {
  return write("claude.jsonl", [
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: null,
      timestamp: new Date(T0).toISOString(),
      message: {
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 2, cache_creation_input_tokens: 46_393, cache_read_input_tokens: 0, output_tokens: 4 },
      },
    },
  ])
}

function piFile(): string {
  return write("pi.jsonl", [
    { type: "session", version: 3, id: "s", timestamp: new Date(T0).toISOString(), cwd: "/tmp" },
    { type: "model_change", id: "m", parentId: null, timestamp: new Date(T0).toISOString(), provider: "opencode-go", modelId: "deepseek-v4.1-flash" },
    {
      type: "message",
      id: "u",
      parentId: "m",
      timestamp: new Date(T0 + 1_000).toISOString(),
      message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: T0 + 1_000 },
    },
    {
      type: "message",
      id: "a",
      parentId: "u",
      timestamp: new Date(T0 + 2_000).toISOString(),
      message: {
        role: "assistant",
        model: "deepseek-v4.1-flash",
        content: [{ type: "text", text: "ok" }],
        stopReason: "stop",
        timestamp: T0 + 2_000,
        usage: { input: 525, output: 340, cacheRead: 103_552, cacheWrite: 0, totalTokens: 104_417 },
      },
    },
  ])
}

function agent(id: string, provider: "claude" | "pi", file: string, context: ViewerAgent["context"]): ViewerAgent {
  return {
    id,
    paneId: id,
    panePid: 1,
    piPid: 2,
    provider,
    tmuxSession: "ctx",
    windowIndex: 0,
    windowId: "@1",
    windowName: "ctx",
    paneIndex: 0,
    name: id,
    role: null,
    title: id,
    cwd: "/tmp",
    repo: undefined,
    sessionFile: file,
    sessionId: id,
    sessionName: id,
    model: null,
    thinkingLevel: null,
    modifiedAt: T0,
    lastWriteAt: T0,
    eventCount: 1,
    status: "waiting",
    statusNote: null,
    context,
  }
}

test("the sessions payload carries context for a Claude and a Pi fixture", async () => {
  setModelRegistryForTests({ "opencode-go": { models: [{ id: "deepseek-v4.1-flash", contextWindow: 1_000_000 }] } })
  const claude = parseClaudeFile(claudeFile())
  const pi = parseSessionFile(piFile())
  const agents = [
    agent("%1", "claude", claudeFile(), contextUsageOfParsed(claude)),
    agent("%2", "pi", piFile(), contextUsageOfParsed(pi)),
  ]
  assert.deepEqual(agents[0].context, { used: 46_395, window: 1_000_000 })
  assert.deepEqual(agents[1].context, { used: 104_077, window: 1_000_000 })
  assert.equal(contextPercent(agents[1].context!), 10, "Pi's ring must match its footer percentage")

  seedDiscovery({ sessions: [{ name: "ctx", serverId: "s", agents, capturedAt: Date.now() }] })
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/api/sessions`)
    assert.equal(reply.status, 200)
    const payload = (await reply.json()) as SessionsPayload
    const found = payload.sessions[0].agents
    assert.deepEqual(found[0].context, { used: 46_395, window: 1_000_000 })
    assert.deepEqual(found[1].context, { used: 104_077, window: 1_000_000 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    setModelRegistryForTests(null)
  }
})
