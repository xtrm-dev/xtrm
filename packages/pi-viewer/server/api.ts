import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import type {
  SessionsPayload,
  ThreadMeta,
  ThreadPayload,
  ViewerAgent,
  ViewerEvent,
  ViewerSession,
} from "../src/shared/types.ts"
import { normalizeClaudeEvent, parseClaudeFile } from "./claude.ts"
import { discover } from "./discover.ts"
import { normalizeEvent, parseSessionFile } from "./session.ts"

const MAX_TEXT = 20_000
const MAX_BODY = 64 * 1024

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.end(payload)
}

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new ApiError(413, "request body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function versionOf(session: ViewerSession): string {
  const parts = session.agents.map(
    (agent) => `${agent.paneId}:${agent.sessionFile ?? ""}:${agent.modifiedAt}:${agent.eventCount}`,
  )
  return createHash("sha1").update(`${session.name}|${parts.join("|")}`).digest("hex").slice(0, 16)
}

function isFinal(event: ViewerEvent): boolean {
  if (event.kind !== "assistant") return false
  return !event.parts?.some((part) => part.type === "tool-call")
}

/**
 * Bulk payloads carry summaries only. Full text, tool input/output, thinking, and raw
 * JSON are fetched per event when a row is expanded.
 */
function lite(event: ViewerEvent): ViewerEvent {
  const { raw: _raw, ...rest } = event
  if (rest.kind === "user") return { ...rest, parts: undefined }
  if (rest.kind === "intercom") return { ...rest, text: undefined, parts: undefined, input: undefined, output: undefined }
  if (isFinal(rest)) return { ...rest, parts: rest.parts?.filter((part) => part.type === "text") }
  if (rest.kind === "notice" || rest.kind === "compaction") {
    return { ...rest, parts: undefined, output: undefined, input: undefined }
  }
  if (rest.kind === "assistant") {
    return {
      ...rest,
      text: undefined,
      output: undefined,
      input: undefined,
      parts: rest.parts?.map((part) =>
        part.type === "thinking"
          ? { type: "thinking", text: part.text?.slice(0, 160), truncated: true }
          : part.type === "tool-call"
            ? {
                type: "tool-call",
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                summary: part.summary,
              }
            : part,
      ),
    }
  }
  return { ...rest, text: undefined, parts: undefined, output: undefined, input: undefined }
}

/** Pick the transcript parser and event normalizer for the agent's runtime. */
function readerFor(agent: ViewerAgent): {
  parse: typeof parseSessionFile
  normalize: typeof normalizeEvent
} {
  return agent.provider === "claude"
    ? { parse: parseClaudeFile, normalize: normalizeClaudeEvent }
    : { parse: parseSessionFile, normalize: normalizeEvent }
}

function threadOf(session: ViewerSession, scope: "branch" | "all"): ThreadPayload {
  const events: ViewerEvent[] = []
  for (const agent of session.agents) {
    if (!agent.sessionFile) continue
    const reader = readerFor(agent)
    let parsed: ReturnType<typeof parseSessionFile>
    try {
      parsed = reader.parse(agent.sessionFile)
    } catch {
      continue
    }
    parsed.events.forEach((entry, index) => {
      const id = typeof entry.id === "string" ? entry.id : null
      const onBranch = id === null || parsed.branchIds.has(id)
      if (scope === "branch" && !onBranch) return
      events.push(lite(reader.normalize(entry, { id: agent.id, name: agent.name }, index, onBranch)))
    })
  }
  events.sort((a, b) => a.at - b.at || a.agentId.localeCompare(b.agentId) || a.seq - b.seq)
  return {
    session: session.name,
    version: versionOf(session),
    agents: session.agents,
    capturedAt: Date.now(),
    events,
  }
}

function resolveSession(name: string | null): { session: ViewerSession; all: ViewerSession[] } {
  const found = discover()
  if (!found.sessions.length) {
    throw new ApiError(404, found.error || "no tmux session with a running pi or claude pane found")
  }
  const session = name
    ? found.sessions.find((entry) => entry.name === name)
    : (found.sessions.find((entry) => entry.name === "xx") ?? found.sessions[0])
  if (!session) throw new ApiError(404, `tmux session ${name} has no running pi or claude pane`)
  return { session, all: found.sessions }
}

function detailOf(agent: ViewerAgent, seq: number): ViewerEvent {
  if (!agent.sessionFile) throw new ApiError(404, "agent has no session file")
  const reader = readerFor(agent)
  const parsed = reader.parse(agent.sessionFile)
  const entry = parsed.events[seq]
  if (!entry) throw new ApiError(404, `event ${seq} not found`)
  const id = typeof entry.id === "string" ? entry.id : null
  const onBranch = id === null || parsed.branchIds.has(id)
  return reader.normalize(entry, { id: agent.id, name: agent.name }, seq, onBranch)
}


async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (!url.pathname.startsWith("/api/")) return false
  const method = req.method ?? "GET"

  if (url.pathname === "/api/health" && method === "GET") {
    sendJson(res, 200, { ok: true, pid: process.pid })
    return true
  }

  if (url.pathname === "/api/sessions" && method === "GET") {
    const found = discover()
    const payload: SessionsPayload = {
      sessions: found.sessions,
      capturedAt: Date.now(),
      error: found.error,
    }
    sendJson(res, found.error ? 503 : 200, payload)
    return true
  }

  if (url.pathname === "/api/thread" && method === "GET") {
    const { session } = resolveSession(url.searchParams.get("session"))
    if (url.searchParams.get("meta") === "1") {
      const meta: ThreadMeta = {
        session: session.name,
        version: versionOf(session),
        agents: session.agents,
        capturedAt: Date.now(),
      }
      sendJson(res, 200, meta)
      return true
    }
    const scope = url.searchParams.get("scope") === "all" ? "all" : "branch"
    sendJson(res, 200, threadOf(session, scope))
    return true
  }

  if (url.pathname === "/api/event" && method === "GET") {
    const { session } = resolveSession(url.searchParams.get("session"))
    const paneId = url.searchParams.get("paneId") ?? ""
    const seq = Number(url.searchParams.get("seq"))
    if (!Number.isInteger(seq) || seq < 0) throw new ApiError(400, "invalid seq")
    const agent = session.agents.find((entry) => entry.paneId === paneId)
    if (!agent) throw new ApiError(404, "unknown pane in this session")
    sendJson(res, 200, detailOf(agent, seq))
    return true
  }

  if (url.pathname === "/api/send" && method === "POST") {
    const raw = await readBody(req)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ApiError(400, "invalid JSON body")
    }
    if (typeof body !== "object" || body === null) throw new ApiError(400, "invalid body")
    const record = body as Record<string, unknown>
    const paneId = typeof record.paneId === "string" ? record.paneId : ""
    const text = typeof record.text === "string" ? record.text.trim() : ""
    if (!/^%\d+$/.test(paneId)) throw new ApiError(400, "invalid pane id")
    if (!text) throw new ApiError(400, "empty message")
    const target = discover().sessions.some((session) =>
      session.agents.some((agent) => agent.paneId === paneId),
    )
    if (!target) throw new ApiError(404, "pane is not a pi or claude agent in an open tmux session")
    if (text.length > MAX_TEXT) throw new ApiError(400, "message too long")

    // One line per send: a literal newline would submit the prompt early.
    const flat = text.replace(/\r?\n+/g, " ")
    try {
      execFileSync("tmux", ["send-keys", "-t", paneId, "-l", "--", flat], { timeout: 5_000 })
      execFileSync("tmux", ["send-keys", "-t", paneId, "Enter"], { timeout: 5_000 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ApiError(502, `tmux send-keys failed: ${message}`)
    }
    sendJson(res, 200, { ok: true, paneId, at: Date.now() })
    return true
  }

  throw new ApiError(404, "unknown api route")
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (!url.pathname.startsWith("/api/")) return false
  try {
    return await route(req, res)
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, { error: error.message })
      return true
    }
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { error: message })
    return true
  }
}
