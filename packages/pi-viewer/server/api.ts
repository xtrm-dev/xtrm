import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
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
import { applyIntercomResults } from "./intercom.ts"
import { normalizeEvent, parseSessionFile } from "./session.ts"

const MAX_TEXT = 20_000
const MAX_BODY = 64 * 1024

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.setHeader("vary", "accept-encoding")
  // The thread payload is repetitive JSON; gzip cuts it by roughly 5x on the wire.
  if (payload.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
    const compressed = gzipSync(payload)
    res.setHeader("content-encoding", "gzip")
    res.end(compressed)
    return
  }
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
function lite(event: ViewerEvent, scope: "branch" | "all"): ViewerEvent {
  const base: ViewerEvent = {
    id: event.id,
    agentId: event.agentId,
    agentName: event.agentName,
    seq: event.seq,
    at: event.at,
    kind: event.kind,
    role: event.role,
    onBranch: event.onBranch,
    summary: event.summary,
  }
  if (event.isError) base.isError = true

  // The inspection view renders summaries only; every body is fetched on expand.
  if (scope === "all") {
    if (event.kind === "intercom" && event.intercom) {
      // Keep the pair identity for the paired marker, without the body.
      base.intercom = { ...event.intercom, body: event.intercom.body.slice(0, 160) }
    }
    return base
  }

  switch (event.kind) {
    case "user":
      return { ...base, text: event.text }
    case "intercom":
      return { ...base, intercom: event.intercom }
    case "assistant": {
      const intercoms = scope === "branch" && event.intercoms ? { intercoms: event.intercoms } : {}
      if (isFinal(event)) {
        // The turn renders text; parts would duplicate it and are only needed on expand.
        return { ...base, stopReason: event.stopReason, text: event.text, ...intercoms }
      }
      return {
        ...base,
        stopReason: event.stopReason,
        ...intercoms,
        parts: event.parts?.map((part) =>
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

    case "tool-result":
      return {
        ...base,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
      }
    case "bash":
      return { ...base, toolName: event.toolName, isError: event.isError }
    case "notice":
    case "compaction":
      return { ...base, text: event.text }
    default:
      return base
  }
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
  const normalized: ViewerEvent[] = []
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
      normalized.push(
        reader.normalize(entry, { id: agent.id, name: agent.name }, index, onBranch),
      )
    })
  }
  const events = applyIntercomResults(normalized)
    // Channel turns never render meta events; the inspection view fetches them with scope=all.
    .filter((event) => scope === "all" || event.kind !== "meta")
    .map((event) => lite(event, scope))
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

/**
 * A normalized transcript is append-only until it shrinks. Expanding a row therefore
 * normalizes only the entries appended since the last expand, then resolves by seq.
 */
interface DetailEntry {
  events: ViewerEvent[]
  applied: number
}

const detailCache = new Map<string, DetailEntry>()
const DETAIL_CACHE_MAX = 6

function detailOf(agent: ViewerAgent, seq: number): ViewerEvent {
  if (!agent.sessionFile) throw new ApiError(404, "agent has no session file")
  const reader = readerFor(agent)
  const parsed = reader.parse(agent.sessionFile)
  if (!parsed.events[seq]) throw new ApiError(404, `event ${seq} not found`)

  let entry = detailCache.get(agent.sessionFile)
  if (entry && entry.events.length > parsed.events.length) entry = undefined
  if (!entry) entry = { events: [], applied: 0 }

  if (parsed.events.length > entry.events.length) {
    const fresh = parsed.events.slice(entry.events.length).map((raw, offset) => {
      const index = entry!.events.length + offset
      const id = typeof raw.id === "string" ? raw.id : null
      const onBranch = id === null || parsed.branchIds.has(id)
      return reader.normalize(raw, { id: agent.id, name: agent.name }, index, onBranch)
    })
    entry.events = entry.events.concat(fresh)
  }
  if (entry.applied !== entry.events.length) {
    entry.events = applyIntercomResults(entry.events)
    entry.applied = entry.events.length
  }
  detailCache.delete(agent.sessionFile)
  detailCache.set(agent.sessionFile, entry)
  if (detailCache.size > DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value
    if (oldest !== undefined) detailCache.delete(oldest)
  }
  const event = entry.events[seq]
  if (!event) throw new ApiError(404, `event ${seq} not found`)
  return event
}


async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (!url.pathname.startsWith("/api/")) return false
  const method = req.method ?? "GET"

  if (url.pathname === "/api/health" && method === "GET") {
    sendJson(req, res, 200, { ok: true, pid: process.pid })
    return true
  }

  if (url.pathname === "/api/sessions" && method === "GET") {
    const found = discover()
    const payload: SessionsPayload = {
      sessions: found.sessions,
      capturedAt: Date.now(),
      error: found.error,
    }
    sendJson(req, res, found.error ? 503 : 200, payload)
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
      sendJson(req, res, 200, meta)
      return true
    }
    const scope = url.searchParams.get("scope") === "all" ? "all" : "branch"
    sendJson(req, res, 200, threadOf(session, scope))
    return true
  }

  if (url.pathname === "/api/event" && method === "GET") {
    const { session } = resolveSession(url.searchParams.get("session"))
    const paneId = url.searchParams.get("paneId") ?? ""
    const seq = Number(url.searchParams.get("seq"))
    if (!Number.isInteger(seq) || seq < 0) throw new ApiError(400, "invalid seq")
    const agent = session.agents.find((entry) => entry.paneId === paneId)
    if (!agent) throw new ApiError(404, "unknown pane in this session")
    sendJson(req, res, 200, detailOf(agent, seq))
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
    sendJson(req, res, 200, { ok: true, paneId, at: Date.now() })
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
      sendJson(req, res, error.status, { error: error.message })
      return true
    }
    const message = error instanceof Error ? error.message : String(error)
    sendJson(req, res, 500, { error: message })
    return true
  }
}
