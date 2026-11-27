import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { gzip } from "node:zlib"
import { promisify } from "node:util"
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
import { discoverAsync, type Discovery } from "./discover.ts"
import { applyIntercomResults, intercomPairKey } from "./intercom.ts"
import { normalizeEvent, parseSessionFile, pruneFileCaches } from "./session.ts"
import { stopPlan } from "./stop.ts"
import { cachedThread, pruneCaches } from "./thread-cache.ts"
import { flattenMessage, hostVerdict, writeVerdict } from "./guard.ts"

const MAX_TEXT = 20_000
const MAX_BODY = 64 * 1024

/** The only message a 500 body carries; the detail stays in the server log (XTRM-1116, PR #512 review). */
export const INTERNAL_ERROR = "internal error"

const gzipAsync = promisify(gzip)
const execFileAsync = promisify(execFile)

/** Responses under this size are sent as they are; gzip would cost more than it saves. */
const GZIP_MIN = 1024

function wantsGzip(req: IncomingMessage): boolean {
  return /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")
}

function sendBody(res: ServerResponse, status: number, payload: string, gz: Buffer | null): void {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.setHeader("vary", "accept-encoding")
  if (gz) {
    res.setHeader("content-encoding", "gzip")
    res.end(gz)
    return
  }
  res.end(payload)
}

/**
 * Refuse a write that did not come from this machine's own viewer (XTRM-1109). 403, never 400: the
 * caller learns that writing is not permitted, not that its body was malformed.
 */
function requireWrite(req: IncomingMessage): void {
  const verdict = writeVerdict(req.headers)
  if (!verdict.ok) {
    // One line, with the reason, so an operator can tell a hostile page from a broken client.
    console.warn(`[pi-viewer] write refused: ${verdict.reason}`)
    throw new ApiError(403, verdict.reason)
  }
}

async function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): Promise<void> {
  const payload = JSON.stringify(body)
  // The thread payload is repetitive JSON; gzip cuts it by roughly 5x on the wire.
  const gz = payload.length > GZIP_MIN && wantsGzip(req) ? await gzipAsync(payload) : null
  sendBody(res, status, payload, gz)
}

/**
 * A thread response is a pure function of (query, scope, session version, cache counter,
 * revision). While those hold, the encoded body is reused instead of re-serialized and
 * re-compressed. Compression runs on the thread pool, never on the event loop.
 */
interface Frame {
  json: string
  gz: Promise<Buffer> | null
}

const FRAME_MAX = 16
const FRAME_BYTES_MAX = 24 * 1024 * 1024
const frames = new Map<string, Frame>()
let frameBytes = 0

function rememberFrame(key: string, frame: Frame): void {
  const stale = frames.get(key)
  if (stale) frameBytes -= stale.json.length
  frames.delete(key)
  frames.set(key, frame)
  frameBytes += frame.json.length
  while (frames.size > FRAME_MAX || frameBytes > FRAME_BYTES_MAX) {
    const oldest = frames.keys().next().value
    if (oldest === undefined) break
    frameBytes -= frames.get(oldest)!.json.length
    frames.delete(oldest)
  }
}

async function sendFrame(req: IncomingMessage, res: ServerResponse, key: string, build: () => string): Promise<void> {
  let frame = frames.get(key)
  if (!frame) {
    frame = { json: build(), gz: null }
    rememberFrame(key, frame)
  }
  let gz: Buffer | null = null
  if (frame.json.length > GZIP_MIN && wantsGzip(req)) {
    frame.gz ??= gzipAsync(frame.json)
    try {
      gz = await frame.gz
    } catch (error) {
      frame.gz = null
      throw error
    }
  }
  sendBody(res, 200, frame.json, gz)
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
  if (event.queued) base.queued = true
  if (event.effect) base.effect = event.effect
  if (event.overflow) base.overflow = true

  // The inspection view renders summaries only; every body is fetched on expand.
  if (scope === "all") {
    if (event.kind === "intercom" && event.intercom) {
      // Normalize before the display cut, and keep a hash so a shared 160-char prefix
      // cannot pair two different messages.
      const body = event.intercom.body.replace(/\s+/g, " ").trim()
      base.intercom = {
        ...event.intercom,
        body: body.slice(0, 160),
        pairKey: intercomPairKey(event.intercom.body),
      }
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

/** `lite` is pure per event object; unchanged events keep their object across polls, so the summary is reused. */
const liteMemo = { branch: new WeakMap<ViewerEvent, ViewerEvent>(), all: new WeakMap<ViewerEvent, ViewerEvent>() }

function liteOf(event: ViewerEvent, scope: "branch" | "all"): ViewerEvent {
  const memo = liteMemo[scope]
  let value = memo.get(event)
  if (!value) {
    value = lite(event, scope)
    memo.set(event, value)
  }
  return value
}

/**
 * The agents of the requested pane (`p=%N`) or window (`w=@N`, or a window index): the client's
 * `agentsInScope`, applied to the session snapshot. No parameter means the whole session (null).
 * A scope that matches nothing is an empty list, which the cache answers with an empty thread.
 */
export function scopeAgentIds(session: ViewerSession, window: string | null, pane: string | null): string[] | null {
  if (pane !== null && pane !== "") {
    if (!/^%\d+$/.test(pane)) throw new ApiError(400, "invalid pane id")
    return session.agents.filter((agent) => agent.paneId === pane).map((agent) => agent.id)
  }
  if (window !== null && window !== "") {
    const byId = /^@\d+$/.test(window)
    if (!byId && !/^\d+$/.test(window)) throw new ApiError(400, "invalid window id")
    return session.agents
      .filter((agent) => agent.paneId && (byId ? agent.windowId === window : agent.windowIndex === Number(window)))
      .map((agent) => agent.id)
  }
  return null
}

function threadOf(
  session: ViewerSession,
  scope: "branch" | "all",
  query: {
    limit?: number
    before?: number | null
    since?: number | null
    revision?: string | null
    agentIds?: readonly string[] | null
  },
): ThreadPayload {
  return cachedThread(
    {
      name: session.name,
      serverId: session.serverId,
      agents: session.agents,
      version: versionOf(session),
      capturedAt: Date.now(),
    },
    { scope, ...query },
  )
}

/**
 * Discovery (tmux, ps, /proc, transcript stats) runs on a timer, off the request path. A request
 * reads the last snapshot; only the very first one waits. The timer runs while the viewer is in
 * use and stops after a minute without a request, so an idle server does no work.
 */
export const DISCOVERY_INTERVAL_MS = 2_000
const DISCOVERY_IDLE_MS = 60_000
const DISCOVERY_STALE_MS = 6_000

let snapshot: Discovery | null = null
let snapshotAt = 0
let refreshing: Promise<Discovery> | null = null
let discoveryTimer: ReturnType<typeof setTimeout> | null = null
let lastRequestAt = 0

/** One discovery at a time; concurrent callers share it. */
export function refreshDiscovery(): Promise<Discovery> {
  refreshing ??= discoverAsync()
    .then((found) => {
      snapshot = found
      snapshotAt = Date.now()
      // Keep both caches proportional to what is actually running (XTRM-1109, PR #512 review, Low).
      pruneCaches(
        new Set(found.sessions.flatMap((session) => session.agents.map((agent) => agent.id))),
        new Set(found.sessions.map((session) => session.name)),
      )
      pruneFileCaches(
        new Set(
          found.sessions.flatMap((session) =>
            session.agents.map((agent) => agent.sessionFile).filter((file): file is string => Boolean(file)),
          ),
        ),
      )
      return found
    })
    .catch((error: unknown) => {
      // Discovery itself failing (tmux gone, /proc empty) keeps the last good picture: a viewer that
      // shows the previous snapshot is better than one that answers 500 until tmux returns (XTRM-1109).
      if (!snapshot) throw error
      console.warn("[pi-viewer] discovery failed, keeping the last snapshot", error instanceof Error ? error.message : error)
      return snapshot
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function scheduleDiscovery(): void {
  if (discoveryTimer) return
  discoveryTimer = setTimeout(() => {
    discoveryTimer = null
    if (Date.now() - lastRequestAt > DISCOVERY_IDLE_MS) return
    void refreshDiscovery()
      .catch(() => undefined)
      .finally(scheduleDiscovery)
  }, DISCOVERY_INTERVAL_MS)
  discoveryTimer.unref()
}

async function currentDiscovery(): Promise<Discovery> {
  lastRequestAt = Date.now()
  scheduleDiscovery()
  // The timer keeps the snapshot a few seconds old at most; after an idle stop it may be older.
  if (!snapshot || Date.now() - snapshotAt > DISCOVERY_STALE_MS) return refreshDiscovery()
  return snapshot
}

/**
 * Test hook: answer the write routes from this discovery instead of a fresh refresh. The write routes
 * check a live picture on purpose, so an HTTP test cannot seed the timer snapshot and still see them
 * succeed; this seam keeps that check in production while letting a test hold the pane list
 * (XTRM-1109). Only code inside this process can set it.
 */
let writeDiscoveryOverride: (() => Promise<Discovery>) | null = null

export function overrideWriteDiscovery(source: (() => Promise<Discovery>) | null): void {
  writeDiscoveryOverride = source
}

function writeDiscovery(): Promise<Discovery> {
  return writeDiscoveryOverride ? writeDiscoveryOverride() : refreshDiscovery()
}

/** Test hook: serve this discovery as the snapshot, with no tmux. */
export function seedDiscovery(found: Discovery): void {
  snapshot = found
  snapshotAt = Date.now()
}

/** Test hook: forget the snapshot and stop the timer. */
export function resetDiscovery(): void {
  snapshot = null
  snapshotAt = 0
  if (discoveryTimer) clearTimeout(discoveryTimer)
  discoveryTimer = null
  lastRequestAt = 0
}

async function resolveSession(name: string | null): Promise<{ session: ViewerSession; all: ViewerSession[] }> {
  const found = await currentDiscovery()
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
  /** Parser revision per entry; Claude can mutate an entry after it was first read. */
  versions: number[]
  applied: number
}

function detailKey(agent: ViewerAgent): string {
  return `${agent.id}|${agent.name}|${agent.sessionFile ?? ""}`
}

const detailCache = new Map<string, DetailEntry>()
const DETAIL_CACHE_MAX = 6

export function detailOf(agent: ViewerAgent, seq: number): ViewerEvent {
  if (!agent.sessionFile) throw new ApiError(404, "agent has no session file")
  const reader = readerFor(agent)
  let parsed: ReturnType<typeof reader.parse>
  try {
    parsed = reader.parse(agent.sessionFile)
  } catch (error) {
    // The file went away or turned unreadable under us: answer for this one event instead of failing
    // the whole route (XTRM-1109, PR #512 review).
    console.warn(
      `[pi-viewer] transcript unreadable for event detail: ${agent.sessionFile}`,
      error instanceof Error ? error.message : error,
    )
    throw new ApiError(404, "transcript is not readable right now")
  }
  if (!parsed.events[seq]) throw new ApiError(404, `event ${seq} not found`)

  const key = detailKey(agent)
  let entry = detailCache.get(key)
  if (entry && entry.events.length > parsed.events.length) entry = undefined
  if (!entry) entry = { events: [], versions: [], applied: 0 }

  let changed = false
  const shared = Math.min(entry.events.length, parsed.events.length)
  for (let index = 0; index < shared; index += 1) {
    const raw = parsed.events[index]
    const id = typeof raw.id === "string" ? raw.id : null
    const onBranch = id === null || parsed.branchIds.has(id)
    const version = parsed.entryVersions?.[index]
    if (version !== undefined) {
      if (entry.versions[index] !== version) {
        entry.events[index] = reader.normalize(raw, { id: agent.id, name: agent.name }, index, onBranch)
        entry.versions[index] = version
        changed = true
      }
      continue
    }
    // Pi has no entry revisions; its tree can still extend and make a cached line on-branch.
    if (entry.events[index].onBranch !== onBranch) {
      entry.events[index] = { ...entry.events[index], onBranch }
    }
  }

  if (parsed.events.length > entry.events.length) {
    const fresh = parsed.events.slice(entry.events.length).map((raw, offset) => {
      const index = entry!.events.length + offset
      const id = typeof raw.id === "string" ? raw.id : null
      const onBranch = id === null || parsed.branchIds.has(id)
      return reader.normalize(raw, { id: agent.id, name: agent.name }, index, onBranch)
    })
    entry.events = entry.events.concat(fresh)
    if (parsed.entryVersions) {
      entry.versions = entry.versions.concat(parsed.entryVersions.slice(entry.events.length - fresh.length))
    }
    changed = true
  }
  if (changed || entry.applied !== entry.events.length) {
    entry.events = applyIntercomResults(entry.events)
    entry.applied = entry.events.length
  }
  detailCache.delete(key)
  detailCache.set(key, entry)
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
    await sendJson(req, res, 200, { ok: true, pid: process.pid })
    return true
  }

  if (url.pathname === "/api/sessions" && method === "GET") {
    const found = await currentDiscovery()
    const payload: SessionsPayload = {
      sessions: found.sessions,
      capturedAt: Date.now(),
      error: found.error,
    }
    await sendJson(req, res, found.error ? 503 : 200, payload)
    return true
  }

  if (url.pathname === "/api/thread" && method === "GET") {
    const { session } = await resolveSession(url.searchParams.get("session"))
    if (url.searchParams.get("meta") === "1") {
      const meta: ThreadMeta = {
        session: session.name,
        serverId: session.serverId,
        version: versionOf(session),
        agents: session.agents,
        capturedAt: Date.now(),
      }
      await sendJson(req, res, 200, meta)
      return true
    }
    const scope = url.searchParams.get("scope") === "all" ? "all" : "branch"
    const number = (key: string): number | null => {
      const raw = url.searchParams.get(key)
      if (raw == null || raw === "") return null
      const value = Number(raw)
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    }
    const agentIds = scopeAgentIds(session, url.searchParams.get("w"), url.searchParams.get("p"))
    const query = {
      limit: number("limit") ?? undefined,
      before: number("before"),
      since: number("since"),
      revision: url.searchParams.get("revision"),
      agentIds,
    }
    // Everything the body depends on is in the key: a repeat poll that changed nothing is one lookup.
    const payload = threadOf(session, scope, query)
    const key = [
      session.name,
      scope,
      agentIds ? [...agentIds].sort().join(",") : "*",
      query.limit ?? "",
      query.before ?? "",
      query.since ?? "",
      query.revision ?? "",
      // The body carries the agent list; its status and attention change without a file change.
      createHash("sha1").update(JSON.stringify(payload.agents)).digest("base64url").slice(0, 16),
      payload.cursor,
      payload.revision,
      "reset" in payload && payload.reset ? "r" : "",
    ].join("|")
    await sendFrame(req, res, key, () =>
      JSON.stringify({ ...payload, events: payload.events.map((event) => liteOf(event, scope)) }),
    )
    return true
  }

  if (url.pathname === "/api/event" && method === "GET") {
    const { session } = await resolveSession(url.searchParams.get("session"))
    const paneId = url.searchParams.get("paneId") ?? ""
    const seq = Number(url.searchParams.get("seq"))
    if (!Number.isInteger(seq) || seq < 0) throw new ApiError(400, "invalid seq")
    const agent = session.agents.find((entry) => entry.paneId === paneId)
    if (!agent) throw new ApiError(404, "unknown pane in this session")
    await sendJson(req, res, 200, detailOf(agent, seq))
    return true
  }

  if (url.pathname === "/api/send" && method === "POST") {
    requireWrite(req)
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
    // A send checks the pane against a fresh discovery, not the snapshot.
    const target = (await writeDiscovery()).sessions.some((session) =>
      session.agents.some((agent) => agent.paneId === paneId),
    )
    if (!target) throw new ApiError(404, "pane is not a pi or claude agent in an open tmux session")
    if (text.length > MAX_TEXT) throw new ApiError(400, "message too long")

    // One line per send: a literal newline would submit the prompt early. Control characters would be
    // interpreted by the pane as keys, so they are removed before anything reaches tmux (XTRM-1109).
    const flat = flattenMessage(text)
    if (!flat.trim()) throw new ApiError(400, "empty message")
    try {
      // Async, so a slow or wedged tmux cannot block the event loop that serves every other reader.
      await execFileAsync("tmux", ["send-keys", "-t", paneId, "-l", "--", flat], { timeout: 5_000 })
      await execFileAsync("tmux", ["send-keys", "-t", paneId, "Enter"], { timeout: 5_000 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ApiError(502, `tmux send-keys failed: ${message}`)
    }
    await sendJson(req, res, 200, { ok: true, paneId, at: Date.now() })
    return true
  }

  // A stop sends one Escape to the pane of a listed agent and nothing else (XTRM-1088). The pane is
  // checked against a fresh discovery, exactly like a send, so a stale snapshot cannot address a pane
  // that has since been reused by another program.
  if (url.pathname === "/api/stop" && method === "POST") {
    requireWrite(req)
    const raw = await readBody(req)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ApiError(400, "invalid JSON body")
    }
    if (typeof body !== "object" || body === null) throw new ApiError(400, "invalid body")
    const record = body as Record<string, unknown>
    const plan = stopPlan(
      (await writeDiscovery()).sessions.flatMap((session) => session.agents),
      typeof record.paneId === "string" ? record.paneId : "",
    )
    if (!plan.ok) throw new ApiError(plan.code, plan.reason)
    try {
      await execFileAsync("tmux", plan.argv, { timeout: 5_000 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ApiError(502, `tmux stop failed: ${message}`)
    }
    await sendJson(req, res, 200, { ok: true, paneId: plan.paneId, at: Date.now() })
    return true
  }

  throw new ApiError(404, "unknown api route")
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  let pathname = "?"
  try {
    // Inside the try: a malformed request target used to throw past this catch, and the transport
    // answered 500 with the raw message (XTRM-1116, PR #512 review).
    const url = new URL(req.url ?? "/", "http://localhost")
    pathname = url.pathname
    if (!url.pathname.startsWith("/api/")) return false
    // Reads too: a rebinding page could otherwise page through transcripts (XTRM-1109 round 2).
    const host = hostVerdict(req.headers)
    if (!host.ok) {
      const kind = (req.method ?? "GET") === "GET" ? "read" : "write"
      console.warn(`[pi-viewer] ${kind} refused: ${host.reason}`)
      throw new ApiError(403, host.reason)
    }
    return await route(req, res)
  } catch (error) {
    if (error instanceof ApiError) {
      await sendJson(req, res, error.status, { error: error.message })
      return true
    }
    // The detail stays in the server log; the client gets a fixed message, never a stack or a path.
    console.error("[pi-viewer] api error", pathname, error)
    await sendJson(req, res, 500, { error: INTERNAL_ERROR })
    return true
  }
}
