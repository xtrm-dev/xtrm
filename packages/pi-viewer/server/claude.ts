import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { ViewerEvent } from "../src/shared/types.ts"
import {
  RAW_CAP,
  cap,
  contentText,
  firstLine,
  mergeFile,
  normalizeEvent,
  compactedState,
  statusOf,
  type AgentState,
  type ParsedFile,
} from "./session.ts"

/**
 * Claude Code adapter.
 *
 * Claude Code writes one JSONL transcript per session under
 * `<config>/projects/<slug(cwd)>/<session-id>.jsonl`. The viewer reads it without
 * attaching, the same way it reads Pi's sessions. Transcript records are converted into
 * Pi-shaped entries so `normalizeEvent`, the intercom mapping and the browser's turn
 * grouping stay the single implementation for both runtimes.
 */

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

// ---------------------------------------------------------------------------
// Pane to transcript matching
// ---------------------------------------------------------------------------

/** Claude Code names a project directory after the cwd, every non-alphanumeric becoming "-". */
export function claudeSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-")
}

/** Claude truncates slugs longer than this and appends a hash. */
const SLUG_LIMIT = 200

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/

export function defaultConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
}

/** The claude process may run with its own CLAUDE_CONFIG_DIR; its environment is the truth. */
export function configDirOf(pid: number | null): string {
  if (pid) {
    try {
      for (const entry of readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
        if (entry.startsWith("CLAUDE_CONFIG_DIR=") && entry.length > "CLAUDE_CONFIG_DIR=".length) {
          return entry.slice("CLAUDE_CONFIG_DIR=".length)
        }
      }
    } catch {
      // not readable: fall back to the viewer's own environment
    }
  }
  return defaultConfigDir()
}

export interface ProcStart {
  /** `starttime` of /proc/<pid>/stat, in clock ticks since boot (string, as Claude records it). */
  ticks: string | null
  /** Wall-clock start in epoch milliseconds. */
  ms: number | null
}

export function readProcStart(pid: number): ProcStart {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    // Field 2 (comm) may contain spaces and parentheses: split after the last ")".
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    const ticks = rest[19] ?? null
    let ms: number | null = null
    const btime = /^btime\s+(\d+)/m.exec(readFileSync("/proc/stat", "utf8"))?.[1]
    if (ticks && btime) ms = (Number(btime) + Number(ticks) / 100) * 1000
    return { ticks, ms }
  } catch {
    return { ticks: null, ms: null }
  }
}

export interface ClaudeRegistryEntry {
  pid: number
  sessionId: string
  cwd: string | null
  procStart: string | null
  name: string | null
}

/** `<config>/sessions/<pid>.json`, written by every interactive claude process. */
export function readClaudeRegistry(configDir: string, pid: number): ClaudeRegistryEntry | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(configDir, "sessions", `${pid}.json`), "utf8"))
    if (!isRecord(parsed)) return null
    const sessionId = asString(parsed.sessionId)
    if (!sessionId || !SESSION_ID.test(sessionId)) return null
    return {
      pid,
      sessionId,
      cwd: asString(parsed.cwd) ?? null,
      procStart: parsed.procStart === undefined ? null : String(parsed.procStart),
      name: asString(parsed.name) ?? null,
    }
  } catch {
    return null
  }
}

function projectDirs(configDir: string, cwds: string[]): string[] {
  const root = join(configDir, "projects")
  const found: string[] = []
  const names = new Set<string>()
  for (const cwd of cwds) {
    if (!cwd) continue
    names.add(claudeSlug(cwd))
    try {
      names.add(claudeSlug(realpathSync(cwd)))
    } catch {
      // cwd may have been removed
    }
  }
  let listing: string[] | null = null
  for (const name of names) {
    if (name.length <= SLUG_LIMIT) {
      const dir = join(root, name)
      if (existsSync(dir)) found.push(dir)
      continue
    }
    try {
      listing ??= readdirSync(root)
    } catch {
      listing = []
    }
    const prefix = name.slice(0, SLUG_LIMIT)
    for (const entry of listing) if (entry.startsWith(prefix)) found.push(join(root, entry))
  }
  return found
}

function findTranscript(configDir: string, sessionId: string, cwds: string[]): string | null {
  for (const dir of projectDirs(configDir, cwds)) {
    const file = join(dir, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  // The project directory may carry another spelling of the cwd: look for the id across projects.
  const root = join(configDir, "projects")
  try {
    for (const name of readdirSync(root)) {
      const file = join(root, name, `${sessionId}.jsonl`)
      if (existsSync(file)) return file
    }
  } catch {
    return null
  }
  return null
}

/** Session ids that a live claude process has registered; no other pane may adopt them. */
function registeredSessionIds(configDir: string, exceptPid: number): Set<string> {
  const ids = new Set<string>()
  try {
    for (const name of readdirSync(join(configDir, "sessions"))) {
      const match = /^(\d+)\.json$/.exec(name)
      if (!match) continue
      const pid = Number(match[1])
      if (pid === exceptPid || !existsSync(`/proc/${pid}`)) continue
      const entry = readClaudeRegistry(configDir, pid)
      if (entry) ids.add(entry.sessionId)
    }
  } catch {
    // no registry directory
  }
  return ids
}

export type ClaudeMatchRule = "registry" | "newest-since-start"

export interface ClaudeTranscript {
  file: string | null
  rule: ClaudeMatchRule | null
  sessionId: string | null
}

export interface ClaudeTranscriptQuery {
  pid: number
  /** Candidate cwds of the pane, most trusted first (process cwd, pane path). */
  cwds: string[]
  configDir: string
  start: ProcStart
  /** Transcripts already assigned to another pane in this discovery pass. */
  claimed: Set<string>
  /** True when another claude process shares this cwd: the pairing must then stay stable across polls. */
  contested?: boolean
}

/** Fallback pairings per pid, kept while the pid (start time) and the transcript stay the same. */
const assignments = new Map<number, { ticks: string | null; file: string }>()

/**
 * Pick the transcript a claude pane is writing.
 *
 * 1. registry: `<config>/sessions/<pid>.json` names the session id of that exact process.
 *    The entry is trusted only when its `procStart` equals the process start time in
 *    /proc/<pid>/stat, so a recycled pid cannot borrow another process's session.
 *    A valid entry whose transcript does not exist yet (a session with no message) yields
 *    no file: the heuristic below never overrides a valid registry entry.
 * 2. newest-since-start: only when there is no valid registry entry. The newest transcript in
 *    the cwd's project directory that was written after the process started, excluding
 *    transcripts claimed by another pane and session ids registered by other live claude
 *    processes. When another claude process shares the cwd, the pairing is remembered per
 *    pid (start time) and kept while its transcript exists, so mtimes that flip between
 *    polls cannot swap two panes. `resolveClaudeTranscripts` orders the panes.
 */
export function resolveClaudeTranscript(query: ClaudeTranscriptQuery): ClaudeTranscript {
  const { pid, cwds, configDir, start, claimed } = query
  const registry = readClaudeRegistry(configDir, pid)
  const registryValid = registry !== null && (registry.procStart === null || start.ticks === null || registry.procStart === start.ticks)

  if (registry && registryValid) {
    const file = findTranscript(configDir, registry.sessionId, registry.cwd ? [registry.cwd, ...cwds] : cwds)
    assignments.delete(pid)
    if (file) {
      claimed.add(file)
      return { file, rule: "registry", sessionId: registry.sessionId }
    }
    return { file: null, rule: null, sessionId: registry.sessionId }
  }

  const others = registeredSessionIds(configDir, pid)
  const remembered = assignments.get(pid)
  if (query.contested && remembered && remembered.ticks === start.ticks) {
    const id = transcriptSessionId(remembered.file)
    if (existsSync(remembered.file) && !claimed.has(remembered.file) && !(id && others.has(id))) {
      claimed.add(remembered.file)
      return { file: remembered.file, rule: "newest-since-start", sessionId: id }
    }
  }
  const candidates: Array<{ file: string; mtimeMs: number }> = []
  for (const dir of projectDirs(configDir, cwds)) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue
      const id = name.slice(0, -".jsonl".length)
      const file = join(dir, name)
      if (claimed.has(file) || others.has(id)) continue
      try {
        const mtimeMs = statSync(file).mtimeMs
        if (start.ms !== null && mtimeMs < start.ms - 2_000) continue
        candidates.push({ file, mtimeMs })
      } catch {
        // vanished during listing
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const best = candidates[0]
  if (!best) {
    assignments.delete(pid)
    return { file: null, rule: null, sessionId: null }
  }
  claimed.add(best.file)
  assignments.set(pid, { ticks: start.ticks, file: best.file })
  return { file: best.file, rule: "newest-since-start", sessionId: transcriptSessionId(best.file) }
}

export interface ClaudePaneQuery extends Omit<ClaudeTranscriptQuery, "claimed" | "contested"> {
  paneId: string
}

function paneNumber(paneId: string): number {
  const value = Number(paneId.replace(/^%/, ""))
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

/**
 * Resolve every claude pane of one discovery pass together. Panes are ordered by process
 * start time, then pane id, so which pane meets a shared transcript first never depends on
 * tmux's pane order. Remembered pairings of pids that are gone are dropped.
 */
export function resolveClaudeTranscripts(queries: ClaudePaneQuery[]): Map<number, ClaudeTranscript> {
  const ordered = [...queries].sort(
    (a, b) =>
      (a.start.ticks === null ? Number.MAX_SAFE_INTEGER : Number(a.start.ticks)) -
        (b.start.ticks === null ? Number.MAX_SAFE_INTEGER : Number(b.start.ticks)) ||
      paneNumber(a.paneId) - paneNumber(b.paneId),
  )
  const perCwd = new Map<string, number>()
  for (const query of ordered) {
    const key = query.cwds[0] ?? ""
    perCwd.set(key, (perCwd.get(key) ?? 0) + 1)
  }
  const claimed = new Set<string>()
  const found = new Map<number, ClaudeTranscript>()
  for (const query of ordered) {
    const { paneId: _paneId, ...rest } = query
    const contested = (perCwd.get(query.cwds[0] ?? "") ?? 0) > 1
    found.set(query.pid, resolveClaudeTranscript({ ...rest, claimed, contested }))
  }
  const live = new Set(queries.map((query) => query.pid))
  for (const pid of assignments.keys()) if (!live.has(pid)) assignments.delete(pid)
  return found
}

export function transcriptSessionId(file: string): string | null {
  const name = file.slice(file.lastIndexOf("/") + 1)
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : null
}

/** Name for a pane: the transcript's title, else the cwd's last segment plus a short session id. */
export function claudeAgentName(sessionName: string | null, cwd: string, sessionId: string | null, fallback: string): string {
  if (sessionName) return sessionName
  const base = cwd.split("/").filter(Boolean).pop() || fallback
  return sessionId ? `${base} · ${sessionId.slice(0, 8)}` : base
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

/** Bookkeeping and wire telemetry that carries no conversation: never shown. */
const SKIPPED_TYPES = new Set([
  "api-request",
  "api-request-blob",
  "api-request-shape",
  "data-flow-records",
  "data-flow-incomplete",
  "last-prompt",
  "mode",
  "permission-mode",
  "session-owner",
  "atis-latch",
  "tools-used",
])

interface ClaudeState {
  /** The raw array of the file cache this state was built from; a new array means a reset. */
  rawRef: Raw[]
  processed: number
  entries: Raw[]
  versions: number[]
  branchIds: Set<string>
  /** Assistant message id to the entry still accepting thinking/text/the first tool_use. */
  openEntry: Map<string, number>
  toolNames: Map<string, string>
  lastTimestamp: string | number | null
  customTitle: string | null
  agentName: string | null
  model: string | null
}

const states = new Map<string, ClaudeState>()
const parsedCache = new Map<string, { mtimeMs: number; size: number; count: number; parsed: ParsedFile }>()

function freshState(rawRef: Raw[]): ClaudeState {
  return {
    rawRef,
    processed: 0,
    entries: [],
    versions: [],
    branchIds: new Set(),
    openEntry: new Map(),
    toolNames: new Map(),
    lastTimestamp: null,
    customTitle: null,
    agentName: null,
    model: null,
  }
}

function stopReasonOf(record: Raw, message: Raw): string | undefined {
  if (record.isApiErrorMessage === true) return "error"
  switch (asString(message.stop_reason)) {
    case "tool_use":
      return "toolUse"
    case "end_turn":
    case "stop_sequence":
      return "stop"
    case "max_tokens":
      return "length"
    default:
      return undefined
  }
}

function hideRecords(entry: Raw, records: Raw[]): void {
  // Non-enumerable: the originals stay reachable for `raw` without being re-serialized
  // into the converted entry.
  Object.defineProperty(entry, "_records", { value: records, enumerable: false, writable: true })
}

function addEntry(state: ClaudeState, entry: Raw, record: Raw, sidechain: boolean): void {
  const id = typeof entry.id === "string" ? entry.id : `claude:${state.entries.length}`
  entry.id = id
  entry._sidechain = sidechain
  hideRecords(entry, [record])
  state.entries.push(entry)
  state.versions.push(0)
  if (!sidechain) state.branchIds.add(id)
}

function eventEntry(label: string, summary: string, text?: string): Raw {
  return { type: "claude-event", _label: label, _summary: summary, _text: text }
}

function assistantBlock(state: ClaudeState, block: unknown): Raw | null {
  if (!isRecord(block)) return null
  if (block.type === "text" && typeof block.text === "string") return { type: "text", text: block.text }
  if (block.type === "thinking" && typeof block.thinking === "string") {
    // Claude stores redacted thinking as an empty string with a signature.
    return block.thinking.trim() ? { type: "thinking", thinking: block.thinking } : null
  }
  if (block.type === "tool_use" && typeof block.id === "string") {
    const name = typeof block.name === "string" ? block.name : "tool"
    state.toolNames.set(block.id, name)
    return { type: "toolCall", id: block.id, name, arguments: block.input ?? {} }
  }
  return null
}

function newAssistantEntry(record: Raw, message: Raw, stopReason: string | undefined): Raw {
  return {
    type: "message",
    id: asString(record.uuid),
    parentId: asString(record.parentUuid),
    timestamp: record.timestamp,
    message: { role: "assistant", content: [] as Raw[], stopReason, model: asString(message.model) },
  }
}

/**
 * One Claude message arrives as one record per content block, with other records (tool
 * results) written between them. Thinking and text join the message's open entry. Each
 * tool_use closes that entry or gets an entry of its own, so every event carries the calls
 * it issued and the browser pairs a result with the call that precedes it, in file order.
 */
function ingestAssistant(state: ClaudeState, record: Raw, sidechain: boolean): void {
  const message = isRecord(record.message) ? record.message : null
  if (!message || !Array.isArray(message.content)) return
  const messageId = asString(message.id)
  const stopReason = stopReasonOf(record, message)
  const model = asString(message.model)
  if (model && model !== "<synthetic>" && !sidechain) state.model = model

  const touch = (entry: Raw): void => {
    const records = (entry as { _records?: Raw[] })._records
    if (records && records[records.length - 1] !== record) records.push(record)
    if (stopReason) (entry.message as Raw).stopReason = stopReason
    const index = state.entries.indexOf(entry)
    if (index >= 0) state.versions[index] += 1
  }

  const blocks = message.content.map((block) => assistantBlock(state, block)).filter((block): block is Raw => block !== null)
  if (!blocks.length) {
    // Nothing visible (redacted thinking): keep the message known so a later block can join it.
    if (messageId !== undefined && !state.openEntry.has(messageId)) {
      const entry = newAssistantEntry(record, message, stopReason)
      addEntry(state, entry, record, sidechain)
      state.openEntry.set(messageId, state.entries.length - 1)
    } else if (messageId !== undefined) {
      touch(state.entries[state.openEntry.get(messageId) as number])
    }
    return
  }

  for (const block of blocks) {
    const open = messageId !== undefined ? state.openEntry.get(messageId) : undefined
    let entry: Raw
    if (open !== undefined) {
      entry = state.entries[open]
      touch(entry)
    } else {
      entry = newAssistantEntry(record, message, stopReason)
      addEntry(state, entry, record, sidechain)
      if (messageId !== undefined) state.openEntry.set(messageId, state.entries.length - 1)
    }
    ;((entry.message as Raw).content as Raw[]).push(block)
    if (block.type === "toolCall" && messageId !== undefined) state.openEntry.delete(messageId)
  }
}

const ENVELOPE = /^\s*(?:Another Claude session sent a message:\s*)?<cross-session-message\b/
/** Output of a local slash command (`/model`): proof that the command ran without the model. */
const LOCAL_OUTPUT = /^\s*<local-command-(?:stdout|stderr)\b/
const INJECTED = /^\s*<(?:system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|user-prompt-submit-hook|task-notification|command-stdout)\b/

function slashCommand(text: string): string | null {
  const name = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text)?.[1]
  if (!name) return null
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  return args ? `${name} ${args}` : name
}

function ingestUserText(state: ClaudeState, record: Raw, text: string, sidechain: boolean, suffix: string): void {
  const uuid = asString(record.uuid)
  const id = uuid ? `${uuid}${suffix}` : undefined
  const origin = isRecord(record.origin) ? asString(record.origin.kind) : undefined
  const base = { id, parentId: asString(record.parentUuid), timestamp: record.timestamp }

  if (ENVELOPE.test(text)) {
    // Peer message: server/intercom.ts reads the envelope.
    addEntry(state, { type: "message", ...base, message: { role: "user", content: text } }, record, sidechain)
    return
  }
  if (record.isCompactSummary === true) {
    addEntry(state, { type: "compaction", ...base, summary: text }, record, sidechain)
    return
  }
  if (/^\s*\[Request interrupted by user/.test(text)) {
    const entry = { ...eventEntry("interrupt", firstLine(text), text), ...base, _interrupt: true }
    addEntry(state, entry, record, sidechain)
    return
  }
  const injected =
    record.isMeta === true || INJECTED.test(text) || (origin !== undefined && origin !== "human" && origin !== "peer")
  if (injected) {
    const label = origin && origin !== "human" ? origin : "injected"
    const body = text.replace(/<\/?system-reminder>/g, "")
    const entry = { ...eventEntry("injected", `${label} · ${firstLine(body) || "context"}`, body), ...base }
    addEntry(state, LOCAL_OUTPUT.test(text) ? { ...entry, _localOutput: true } : entry, record, sidechain)
    return
  }
  const slash = slashCommand(text)
  const message = { type: "message", ...base, message: { role: "user", content: slash ?? text } }
  addEntry(state, slash ? { ...message, _slash: true } : message, record, sidechain)
}

function ingestUser(state: ClaudeState, record: Raw, sidechain: boolean): void {
  const message = isRecord(record.message) ? record.message : null
  if (!message) return
  const content = message.content
  const blocks = Array.isArray(content) ? content : []
  const results = blocks.filter((block): block is Raw => isRecord(block) && block.type === "tool_result")
  const uuid = asString(record.uuid)

  results.forEach((block, index) => {
    const toolUseId = asString(block.tool_use_id)
    const entry: Raw = {
      type: "message",
      id: uuid ? (results.length > 1 ? `${uuid}:r${index}` : uuid) : undefined,
      parentId: asString(record.parentUuid),
      timestamp: record.timestamp,
      message: {
        role: "toolResult",
        toolCallId: toolUseId,
        toolName: (toolUseId ? state.toolNames.get(toolUseId) : undefined) ?? "tool",
        content: block.content,
        isError: block.is_error === true,
      },
    }
    addEntry(state, entry, record, sidechain)
  })

  const rest = results.length ? contentText(blocks.filter((block) => !(isRecord(block) && block.type === "tool_result"))) : contentText(content)
  if (rest.trim()) ingestUserText(state, record, rest, sidechain, results.length ? ":t" : "")
}

function ingestSystem(state: ClaudeState, record: Raw, sidechain: boolean): void {
  const subtype = asString(record.subtype) ?? "event"
  const duration = typeof record.durationMs === "number" ? ` · ${Math.round(record.durationMs / 100) / 10}s` : ""
  const hooks = typeof record.hookCount === "number" ? ` · ${record.hookCount} hooks` : ""
  const text = asString(record.content) ?? asString(record.message)
  const tail = text ? ` · ${firstLine(text, 120)}` : ""
  addEntry(
    state,
    { ...eventEntry("system", `system · ${subtype}${duration}${hooks}${tail}`, text), id: asString(record.uuid), timestamp: record.timestamp },
    record,
    sidechain,
  )
}

function ingest(state: ClaudeState, record: Raw): void {
  const type = asString(record.type) ?? "event"
  if (record.timestamp !== undefined && (typeof record.timestamp === "string" || typeof record.timestamp === "number")) {
    state.lastTimestamp = record.timestamp
  }
  // Bookkeeping records carry no timestamp: borrow the previous one so All events stays ordered.
  const sidechain = record.isSidechain === true || typeof record.agentId === "string"
  const carried = record.timestamp ?? state.lastTimestamp ?? undefined
  const stamped = { id: asString(record.uuid), timestamp: carried }

  switch (type) {
    case "assistant":
      ingestAssistant(state, record, sidechain)
      return
    case "user":
      ingestUser(state, record, sidechain)
      return
    case "system":
      ingestSystem(state, record, sidechain)
      return
    case "custom-title": {
      const title = asString(record.customTitle)
      if (!title || title === state.customTitle) return
      state.customTitle = title
      addEntry(state, { ...eventEntry("title", `session titled ${title}`), ...stamped }, record, sidechain)
      return
    }
    case "agent-name": {
      const name = asString(record.agentName)
      if (!name || name === state.agentName) return
      state.agentName = name
      addEntry(state, { ...eventEntry("agent-name", `agent named ${name}`), ...stamped }, record, sidechain)
      return
    }
    case "attachment": {
      const attachment = isRecord(record.attachment) ? asString(record.attachment.type) : undefined
      addEntry(state, { ...eventEntry("attachment", `attachment · ${attachment ?? "?"}`), ...stamped }, record, sidechain)
      return
    }
    case "queue-operation": {
      const operation = asString(record.operation) ?? "?"
      addEntry(state, { ...eventEntry("queue", `queue · ${operation}`), ...stamped }, record, sidechain)
      return
    }
    case "summary": {
      const summary = asString(record.summary) ?? ""
      addEntry(state, { ...eventEntry("summary", `summary · ${firstLine(summary)}`, summary), ...stamped }, record, sidechain)
      return
    }
    default:
      addEntry(state, { ...eventEntry(type, type), ...stamped }, record, sidechain)
  }
}

/** True while the newest assistant record has announced tool use but its tool_use block is not yet written. */
function hasPendingTail(entry: Raw | undefined): boolean {
  if (!entry || entry.type !== "message" || !isRecord(entry.message)) return false
  const message = entry.message
  if (message.role !== "assistant" || message.stopReason !== "toolUse") return false
  return !(message.content as Raw[]).some((block) => block.type === "toolCall")
}

/** Incremental: only bytes appended since the last call are read and only new records are converted. */
export function parseClaudeFile(file: string): ParsedFile {
  const cache = mergeFile(file)
  let state = states.get(file)
  if (!state || state.rawRef !== cache.raw || state.processed > cache.raw.length) {
    state = freshState(cache.raw)
    states.set(file, state)
    parsedCache.delete(file)
  }

  for (; state.processed < cache.raw.length; state.processed += 1) {
    const record = cache.raw[state.processed]
    const type = asString(record.type)
    if (type && SKIPPED_TYPES.has(type)) {
      // Drop the payload (api-request blobs are large) and keep the slot.
      cache.raw[state.processed] = { type }
      continue
    }
    ingest(state, record)
  }

  const cached = parsedCache.get(file)
  if (cached && cached.mtimeMs === cache.mtimeMs && cached.size === cache.size && cached.count === state.entries.length) {
    return cached.parsed
  }

  const events = hasPendingTail(state.entries[state.entries.length - 1]) ? state.entries.slice(0, -1) : state.entries
  const seqById = new Map<string, number>()
  events.forEach((entry, index) => {
    if (typeof entry.id === "string") seqById.set(entry.id, index)
  })
  const parsed: ParsedFile = {
    events,
    seqById,
    branchIds: state.branchIds,
    entryVersions: state.versions.slice(0, events.length),
    sessionName: state.customTitle ?? state.agentName,
    model: state.model,
    thinkingLevel: null,
    modifiedAt: cache.mtimeMs,
    size: cache.size,
  }
  parsedCache.set(file, { mtimeMs: cache.mtimeMs, size: cache.size, count: state.entries.length, parsed })
  return parsed
}

/**
 * Status from the main conversation only. Walking back from the newest record:
 * sidechain records and bookkeeping rows (system, attachment, queue-operation, ...) are skipped,
 * an interrupt marker means idle, and the first main-line message decides the rest.
 */
export function claudeStatusOf(parsed: ParsedFile, now = Date.now()): AgentState {
  const events = parsed.events
  // A slash command followed by local-command output (`/model`, `/clear`) ran without the model:
  // it opens no turn, so the status comes from the message before it.
  let localOutput = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = events[index]
    if (entry._sidechain === true) continue
    if (entry._interrupt === true) return { status: "idle", note: "turn interrupted" }
    if (entry._localOutput === true) {
      localOutput = true
      continue
    }
    if (entry.type === "compaction") return compactedState(parsed, now)
    if (entry.type !== "message") continue
    if (localOutput && entry._slash === true) {
      localOutput = false
      continue
    }
    localOutput = false
    return statusOf(index === events.length - 1 ? parsed : { ...parsed, events: events.slice(0, index + 1) }, now)
  }
  return statusOf({ ...parsed, events: [] }, now)
}

export function normalizeClaudeEvent(
  entry: Raw,
  agent: { id: string; name: string },
  seq: number,
  onBranch: boolean,
  options: { raw?: boolean } = {},
): ViewerEvent {
  const event = normalizeEvent(entry, agent, seq, onBranch, options)
  if (entry.type === "claude-event") {
    event.kind = "meta"
    event.summary = typeof entry._summary === "string" ? entry._summary : event.summary
    event.detail = typeof entry._label === "string" ? entry._label : event.detail
    if (typeof entry._text === "string" && entry._text) {
      const capped = cap(entry._text, 2_000)
      event.text = capped.text
      event.truncated = capped.truncated || undefined
    }
  }
  const records = (entry as { _records?: Raw[] })._records
  if (records?.length) {
    let json = ""
    try {
      json = JSON.stringify(records.length === 1 ? records[0] : records)
    } catch {
      json = String(records[0])
    }
    event.raw = cap(json, RAW_CAP).text
  }
  return event
}
