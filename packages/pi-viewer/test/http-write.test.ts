/**
 * HTTP-level tests for the write routes (XTRM-1109, PR #512 review).
 *
 * These drive handleApi itself, not the pure planners, because the gaps they close lived in the route:
 * a cross-site POST that reached pane validation, and the exact argv a valid send and a valid stop
 * produce. tmux is replaced by a shim on PATH that records its arguments, so no key can reach a pane
 * and no tmux server is involved at all.
 */
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import test from "node:test"

import { handleApi, overrideWriteDiscovery, resetDiscovery, seedDiscovery } from "../server/api.ts"
import type { ViewerAgent, ViewerSession } from "../src/shared/types.ts"

const PANE = "%12"
const AGENT = {
  id: PANE,
  paneId: PANE,
  panePid: 1200,
  piPid: 1201,
  provider: "pi",
  tmuxSession: "probe",
  windowIndex: 0,
  windowId: "@0",
  windowName: "w0",
  paneIndex: 12,
  name: "agent-probe",
  role: "worker",
  title: "",
  cwd: "/home/u/agent-probe",
  sessionFile: null,
  sessionId: null,
  sessionName: null,
  model: null,
  thinkingLevel: null,
  modifiedAt: 0,
  lastWriteAt: 0,
  eventCount: 0,
  status: "working",
  statusNote: null,
} as unknown as ViewerAgent

const SESSION = { name: "probe", serverId: "1:probe", agents: [AGENT] } as unknown as ViewerSession

/**
 * A PATH shim: `tmux` that appends each argument on its own line and closes the call with a marker.
 * The marker is a word no route would send, because `--` is itself part of the send argv.
 */
const fakeDir = mkdtempSync(join(tmpdir(), "pi-viewer-tmux-"))
const logFile = join(fakeDir, "calls.log")
writeFileSync(
  join(fakeDir, "tmux"),
  `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${logFile}"; done\nprintf '<<end>>\\n' >> "${logFile}"\n`,
)
chmodSync(join(fakeDir, "tmux"), 0o755)
const previousPath = process.env.PATH
process.env.PATH = `${fakeDir}:${previousPath ?? ""}`

function calls(): string[][] {
  try {
    return readFileSync(logFile, "utf8")
      .split("<<end>>\n")
      .filter((block) => block.trim().length > 0)
      .map((block) => block.split("\n").filter((line) => line.length > 0))
  } catch {
    return []
  }
}

interface Answer {
  status: number
  body: Record<string, unknown>
}

/** One request through handleApi, with a minimal Node stream standing in for the socket. */
async function call(options: {
  url: string
  body?: unknown
  headers?: Record<string, string>
  rawBody?: string
}): Promise<Answer> {
  const payload = options.rawBody ?? JSON.stringify(options.body ?? {})
  const req = Readable.from([Buffer.from(payload)]) as unknown as IncomingMessage
  req.method = "POST"
  req.url = options.url
  req.headers = { "content-type": "application/json", ...options.headers }
  let status = 0
  let text = ""
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk: Buffer | string) {
      status = (res as unknown as { statusCode: number }).statusCode
      text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
      return res
    },
  } as unknown as ServerResponse
  await handleApi(req, res)
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

const CROSS_SITE = {
  origin: "https://evil.example",
  "sec-fetch-site": "cross-site",
  "content-type": "text/plain",
}

const SAME_ORIGIN = {
  origin: "http://127.0.0.1:5199",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
}

test.beforeEach(() => {
  writeFileSync(logFile, "")
  resetDiscovery()
  seedDiscovery({ sessions: [SESSION] })
  overrideWriteDiscovery(async () => ({ sessions: [SESSION] }))
})

test.after(() => {
  resetDiscovery()
  overrideWriteDiscovery(null)
  process.env.PATH = previousPath
  rmSync(fakeDir, { recursive: true, force: true })
})

test("a cross-site POST to /api/send is refused with 403 and never reaches tmux", async () => {
  const answer = await call({ url: "/api/send", body: { paneId: PANE, text: "rm -rf /" }, headers: CROSS_SITE })
  assert.equal(answer.status, 403, `expected 403, got ${answer.status}: ${JSON.stringify(answer.body)}`)
  assert.match(String(answer.body.error), /cross-site|application\/json/)
  assert.deepEqual(calls(), [], "no tmux process may be started for a refused write")
})

test("a cross-site POST to /api/stop is refused with 403 and never reaches tmux", async () => {
  const answer = await call({ url: "/api/stop", body: { paneId: PANE }, headers: CROSS_SITE })
  assert.equal(answer.status, 403)
  assert.deepEqual(calls(), [])
})

test("a JSON body without the right content type is refused", async () => {
  const answer = await call({
    url: "/api/send",
    body: { paneId: PANE, text: "hi" },
    headers: { origin: "http://127.0.0.1:5199", "content-type": "text/plain;charset=UTF-8" },
  })
  assert.equal(answer.status, 403)
  assert.match(String(answer.body.error), /application\/json/)
})

test("an origin from another host is refused even with a JSON content type", async () => {
  const answer = await call({
    url: "/api/stop",
    body: { paneId: PANE },
    headers: { origin: "https://evil.example", "content-type": "application/json" },
  })
  assert.equal(answer.status, 403)
  assert.match(String(answer.body.error), /origin/)
})

test("a same-origin JSON send reaches tmux with the literal payload, then Enter", async () => {
  const answer = await call({ url: "/api/send", body: { paneId: PANE, text: "hello there" }, headers: SAME_ORIGIN })
  assert.equal(answer.status, 200, JSON.stringify(answer.body))
  assert.deepEqual(calls(), [
    ["send-keys", "-t", PANE, "-l", "--", "hello there"],
    ["send-keys", "-t", PANE, "Enter"],
  ])
})

test("control characters are stripped before the payload reaches tmux", async () => {
  const answer = await call({
    url: "/api/send",
    body: { paneId: PANE, text: "a\u0000b\u0007c\u001b[31mkept\ttab" },
    headers: SAME_ORIGIN,
  })
  assert.equal(answer.status, 200, JSON.stringify(answer.body))
  const sent = calls()[0]
  assert.equal(sent?.[5], "abc[31mkept\ttab", `control characters removed, tab kept (got ${JSON.stringify(sent?.[5])})`)
})

test("a same-origin JSON stop sends exactly one Escape", async () => {
  const answer = await call({ url: "/api/stop", body: { paneId: PANE }, headers: SAME_ORIGIN })
  assert.equal(answer.status, 200, JSON.stringify(answer.body))
  assert.deepEqual(calls(), [["send-keys", "-t", PANE, "Escape"]])
})

test("an unknown pane is a 404 and a malformed pane id a 400, both without tmux", async () => {
  const unknown = await call({ url: "/api/send", body: { paneId: "%99", text: "hi" }, headers: SAME_ORIGIN })
  assert.equal(unknown.status, 404)
  const malformed = await call({ url: "/api/stop", body: { paneId: "%12;kill-server" }, headers: SAME_ORIGIN })
  assert.equal(malformed.status, 400)
  assert.deepEqual(calls(), [])
})

test("a text-empty send after stripping is refused", async () => {
  const answer = await call({ url: "/api/send", body: { paneId: PANE, text: "\u0000\u0007" }, headers: SAME_ORIGIN })
  assert.equal(answer.status, 400)
  assert.deepEqual(calls(), [])
})
