import { closeSync, openSync, readSync, statSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"
import { basename } from "node:path"

import type { AgentStatus, EventKind, ViewerEvent, ViewerPart } from "../src/shared/types.ts"
import { intercomsFromEntry, isIntercomTool } from "./intercom.ts"

type Raw = Record<string, unknown>

export interface FileCache {
  offset: number
  decoder: StringDecoder
  carry: string
  raw: Raw[]
  mtimeMs: number
  size: number
}

const fileCache = new Map<string, FileCache>()

const TEXT_CAP = 20_000
const THINKING_CAP = 6_000
const TOOL_OUTPUT_CAP = 6_000
const TOOL_INPUT_CAP = 2_000
const INTERCOM_CAP = 40_000
export const RAW_CAP = 6_000

export interface ParsedFile {
  events: Raw[]
  seqById: Map<string, number>
  branchIds: Set<string>
  sessionName: string | null
  model: string | null
  thinkingLevel: string | null
  modifiedAt: number
  size: number
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function cap(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false }
  return { text: `${value.slice(0, limit)}\n… [truncated ${value.length - limit} chars]`, truncated: true }
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const chunks: string[] = []
  for (const part of content) {
    if (typeof part === "string") {
      chunks.push(part)
      continue
    }
    if (!isRecord(part)) continue
    if (part.type === "text" && typeof part.text === "string") chunks.push(part.text)
    else if (part.type === "image") chunks.push("[image]")
  }
  return chunks.join("\n")
}

function assistantParts(content: unknown): ViewerPart[] {
  if (!Array.isArray(content)) return []
  const parts: ViewerPart[] = []
  for (const raw of content) {
    if (!isRecord(raw) || typeof raw.type !== "string") continue
    if (raw.type === "text" && typeof raw.text === "string") {
      const capped = cap(raw.text, TEXT_CAP)
      parts.push({ type: "text", text: capped.text, truncated: capped.truncated || undefined })
    } else if (raw.type === "thinking" && typeof raw.thinking === "string") {
      const capped = cap(raw.thinking, THINKING_CAP)
      parts.push({ type: "thinking", text: capped.text, truncated: capped.truncated || undefined })
    } else if (raw.type === "toolCall") {
      let input = ""
      try {
        input = JSON.stringify(raw.arguments ?? {})
      } catch {
        input = String(raw.arguments ?? "")
      }
      const capped = cap(input, TOOL_INPUT_CAP)
      parts.push({
        type: "tool-call",
        toolCallId: typeof raw.id === "string" ? raw.id : undefined,
        toolName: typeof raw.name === "string" ? raw.name : "tool",
        input: capped.text,
        summary: toolSubject(capped.text),
        truncated: capped.truncated || undefined,
      })
    } else if (raw.type === "image") {
      parts.push({ type: "image", text: "[image]" })
    }
  }
  return parts
}

export function firstLine(value: string, limit = 180): string {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function parseToolInput(input: string | undefined): Raw | null {
  if (!input) return null
  try {
    const value: unknown = JSON.parse(input)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

const SUBJECT_KEYS = [
  "command",
  "description",
  "query",
  "pattern",
  "path",
  "file_path",
  "filePath",
  "url",
  "prompt",
  "name",
  "target",
] as const

export function toolSubject(input: string | undefined): string {
  const parsed = parseToolInput(input)
  if (!parsed) return ""
  for (const key of SUBJECT_KEYS) {
    const value = parsed[key]
    if (typeof value === "string" && value.trim()) return firstLine(value, 120)
  }
  const first = Object.values(parsed).find((value) => typeof value === "string" && value.trim())
  return typeof first === "string" ? firstLine(first, 120) : ""
}

function atOf(entry: Raw): number {
  const message = isRecord(entry.message) ? entry.message : null
  const raw = message?.timestamp ?? entry.timestamp
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function mergeFile(file: string): FileCache {
  const stat = statSync(file)
  let cache = fileCache.get(file)
  if (!cache || stat.size < cache.offset) {
    cache = {
      offset: 0,
      decoder: new StringDecoder("utf8"),
      carry: "",
      raw: [],
      mtimeMs: 0,
      size: 0,
    }
    fileCache.set(file, cache)
  }
  if (stat.size > cache.offset) {
    const fd = openSync(file, "r")
    try {
      const length = stat.size - cache.offset
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, cache.offset)
      cache.offset = stat.size
      const text = cache.carry + cache.decoder.write(buffer)
      const lines = text.split("\n")
      cache.carry = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed: unknown = JSON.parse(line)
          if (isRecord(parsed)) cache.raw.push(parsed)
        } catch {
          // A partial or malformed line is not fatal; the next read may complete it.
        }
      }
    } finally {
      closeSync(fd)
    }
  }
  cache.mtimeMs = stat.mtimeMs
  cache.size = stat.size
  return cache
}

function branchIds(raw: Raw[]): Set<string> {
  const byId = new Map<string, Raw>()
  for (const entry of raw) {
    if (typeof entry.id === "string") byId.set(entry.id, entry)
  }
  const ids = new Set<string>()
  let cursor: Raw | undefined
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const candidate = raw[index]
    if (typeof candidate.id === "string") {
      cursor = candidate
      break
    }
  }
  while (cursor && typeof cursor.id === "string" && !ids.has(cursor.id)) {
    ids.add(cursor.id)
    const parent = typeof cursor.parentId === "string" ? cursor.parentId : null
    cursor = parent ? byId.get(parent) : undefined
  }
  return ids
}

const parsedCache = new Map<string, { mtimeMs: number; size: number; parsed: ParsedFile }>()

export function parseSessionFile(file: string): ParsedFile {
  const cache = mergeFile(file)
  const cached = parsedCache.get(file)
  if (cached && cached.mtimeMs === cache.mtimeMs && cached.size === cache.size) {
    return cached.parsed
  }
  const raw = cache.raw
  let sessionName: string | null = null
  let model: string | null = null
  let thinkingLevel: string | null = null

  for (const entry of raw) {
    if (entry.type === "session_info" && typeof entry.name === "string") sessionName = entry.name
    else if (entry.type === "model_change" && typeof entry.modelId === "string") {
      model = typeof entry.provider === "string" ? `${entry.provider}/${entry.modelId}` : entry.modelId
    } else if (entry.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
      thinkingLevel = entry.thinkingLevel
    }
  }
  // Older sessions carry the model on the assistant message rather than a model_change entry.
  if (!model) {
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const message = raw[index].message
      if (isRecord(message) && message.role === "assistant" && typeof message.model === "string") {
        model = typeof message.provider === "string" ? `${message.provider}/${message.model}` : message.model
        break
      }
    }
  }

  const seqById = new Map<string, number>()
  raw.forEach((entry, index) => {
    if (typeof entry.id === "string") seqById.set(entry.id, index)
  })

  const parsed = {
    events: raw,
    seqById,
    branchIds: branchIds(raw),
    sessionName,
    model,
    thinkingLevel,
    modifiedAt: cache.mtimeMs,
    size: cache.size,
  }
  parsedCache.set(file, { mtimeMs: cache.mtimeMs, size: cache.size, parsed })
  return parsed
}

/** Latest session_info name in a file, without invoking the incremental event cache. */
const nameCache = new Map<string, { mtimeMs: number; name: string | null }>()

export function readSessionName(file: string): string | null {
  try {
    const stat = statSync(file)
    const cached = nameCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.name
    const limit = Math.min(stat.size, 512 * 1024)
    const fd = openSync(file, "r")
    let text = ""
    try {
      const buffer = Buffer.alloc(limit)
      const read = readSync(fd, buffer, 0, limit, 0)
      text = buffer.subarray(0, read).toString("utf8")
    } finally {
      closeSync(fd)
    }
    let name: string | null = null
    for (const line of text.split("\n")) {
      if (!line.includes('"session_info"')) continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (isRecord(parsed) && parsed.type === "session_info" && typeof parsed.name === "string") {
          name = parsed.name
        }
      } catch {
        // ignore partial line
      }
    }
    nameCache.set(file, { mtimeMs: stat.mtimeMs, name })
    return name
  } catch {
    return null
  }
}

function metaDetail(entry: Raw): { kind: EventKind; summary: string; text?: string } {
  const type = typeof entry.type === "string" ? entry.type : "event"
  if (type === "session") {
    const cwd = typeof entry.cwd === "string" ? entry.cwd : ""
    return { kind: "meta", summary: `session start${cwd ? ` · ${cwd}` : ""}` }
  }
  if (type === "session_info") {
    return { kind: "meta", summary: `session named ${String(entry.name ?? "?")}` }
  }
  if (type === "model_change") {
    return { kind: "meta", summary: `model ${String(entry.provider ?? "")}/${String(entry.modelId ?? "")}` }
  }
  if (type === "thinking_level_change") {
    return { kind: "meta", summary: `thinking ${String(entry.thinkingLevel ?? "?")}` }
  }
  if (type === "context_edit") {
    return { kind: "meta", summary: `context edited · target ${String(entry.targetId ?? "?")}` }
  }
  if (type === "compaction") {
    const summary = typeof entry.summary === "string" ? entry.summary : ""
    const capped = cap(summary, 12_000)
    return {
      kind: "compaction",
      summary: `context compacted · ${firstLine(summary)}`,
      text: capped.text,
    }
  }
  if (type === "custom_message") {
    const text = contentText(entry.content)
    const capped = cap(text, TEXT_CAP)
    return {
      kind: "notice",
      summary: `notice · ${firstLine(text)}`,
      text: capped.text,
    }
  }
  if (type === "custom") {
    const customType = typeof entry.customType === "string" ? entry.customType : "custom"
    return { kind: "meta", summary: `custom · ${customType}` }
  }
  return { kind: "meta", summary: type }
}

export function normalizeEvent(
  entry: Raw,
  agent: { id: string; name: string },
  seq: number,
  onBranch: boolean,
): ViewerEvent {
  const at = atOf(entry)
  const base = {
    id: `${agent.id}:${seq}`,
    agentId: agent.id,
    agentName: agent.name,
    seq,
    at,
    onBranch,
    raw: (() => {
      let json = ""
      try {
        json = JSON.stringify(entry)
      } catch {
        json = String(entry)
      }
      return cap(json, RAW_CAP).text
    })(),
  } satisfies Pick<ViewerEvent, "id" | "agentId" | "agentName" | "seq" | "at" | "onBranch" | "raw">

  const intercoms = intercomsFromEntry(entry, agent)
  const assistantMessage =
    entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant"
      ? entry.message
      : null
  const hasOtherToolCalls = assistantMessage
    ? assistantParts(assistantMessage.content).some(
        (part) => part.type === "tool-call" && !isIntercomTool(part.toolName),
      )
    : false
  if (intercoms.length === 1 && (!assistantMessage || !hasOtherToolCalls)) {
    const intercom = intercoms[0]
    const body = cap(intercom.body, INTERCOM_CAP)
    return {
      ...base,
      kind: "intercom",
      role: typeof entry.type === "string" ? entry.type : "intercom",
      summary:
        intercom.direction === "sent"
          ? `→ ${intercom.to} · ${intercom.summary ?? firstLine(intercom.body)}`
          : `← ${intercom.from} · ${intercom.summary ?? firstLine(intercom.body)}`,
      intercom: { ...intercom, body: body.text, truncated: body.truncated || undefined },
      truncated: body.truncated || undefined,
      detail:
        intercom.direction === "sent"
          ? `intercom sent to ${intercom.to}`
          : `intercom received from ${intercom.from}`,
    }
  }

  if (entry.type !== "message" || !isRecord(entry.message)) {
    const detail = metaDetail(entry)
    return {
      ...base,
      kind: detail.kind,
      role: typeof entry.type === "string" ? entry.type : null,
      summary: detail.summary,
      text: detail.text,
      detail: detail.summary,
    }
  }

  const message = entry.message
  const role = typeof message.role === "string" ? message.role : null
  const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined

  if (role === "user") {
    const rawText = contentText(message.content)
    const skill = /^<skill\s+name="([^"]+)"/.exec(rawText.trim())
    if (skill) {
      return {
        ...base,
        kind: "meta",
        role,
        summary: `skill loaded · ${skill[1]}`,
        detail: "skill",
      }
    }
    // Pi records the operator prompt with its TUI marker; the marker is not user content.
    const text = rawText.replace(/^›\s+/, "")
    const capped = cap(text, TEXT_CAP)
    return {
      ...base,
      kind: "user",
      role,
      summary: firstLine(text),
      text: capped.text,
      truncated: capped.truncated || undefined,
    }
  }

  if (role === "assistant") {
    const parts = assistantParts(message.content)
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
    const calls = parts.filter((part) => part.type === "tool-call")
    const first = calls[0]
    const subject = first ? toolSubject(first.input) : ""
    const extra = calls.length > 1 ? ` +${calls.length - 1}` : ""
    const summary = first
      ? `${first.toolName ?? "tool"}${subject ? ` · ${subject}` : ""}${extra}`
      : firstLine(
          text ||
            parts.find((part) => part.type === "thinking")?.text ||
            (stopReason === "error" ? "failed · no reply" : "no reply"),
        )
    const cappedIntercoms = intercoms.map((meta) => {
      const capped = cap(meta.body, INTERCOM_CAP)
      return { ...meta, body: capped.text, truncated: capped.truncated || undefined }
    })
    return {
      ...base,
      kind: "assistant",
      role,
      summary,
      text: text || undefined,
      parts,
      stopReason,
      ...(cappedIntercoms.length
        ? {
            intercoms: cappedIntercoms,
            truncated: cappedIntercoms.some((meta) => meta.truncated) || undefined,
          }
        : {}),
      detail: stopReason ? `stopReason: ${stopReason}` : undefined,
    }
  }

  if (role === "toolResult") {
    const output = contentText(message.content)
    const capped = cap(output, TOOL_OUTPUT_CAP)
    const toolName = typeof message.toolName === "string" ? message.toolName : "tool"
    if (isIntercomTool(toolName)) {
      return {
        ...base,
        kind: "meta",
        role,
        toolName,
        toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
        isError: message.isError === true,
        summary: `intercom · ${firstLine(output, 140) || (message.isError === true ? "failed" : "delivered")}`,
        output: capped.text,
        truncated: capped.truncated || undefined,
        detail: "intercom delivery",
      }
    }
    return {
      ...base,
      kind: "tool-result",
      role,
      toolName,
      toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
      isError: message.isError === true,
      summary: `${toolName} · ${firstLine(output, 140) || (message.isError === true ? "failed" : "done")}`,
      output: capped.text,
      truncated: capped.truncated || undefined,
    }
  }

  if (role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command : ""
    const output = typeof message.output === "string" ? message.output : ""
    const capped = cap(output, TOOL_OUTPUT_CAP)
    const exitCode = typeof message.exitCode === "number" ? message.exitCode : null
    return {
      ...base,
      kind: "bash",
      role,
      toolName: "bash",
      isError: exitCode !== null && exitCode !== 0,
      summary: `! ${firstLine(command, 140)}${exitCode !== null && exitCode !== 0 ? ` · exit ${exitCode}` : ""}`,
      input: command,
      output: capped.text,
      text: command,
      truncated: capped.truncated || undefined,
    }
  }

  if (role === "system") {
    const text = contentText(message.content)
    const capped = cap(text, 2_000)
    const snippet = firstLine(text)
    return {
      ...base,
      kind: "meta",
      role,
      summary: snippet ? `system · ${snippet}` : "system",
      text: capped.text,
    }
  }

  const fallback = firstLine(contentText(message.content))
  return {
    ...base,
    kind: "meta",
    role,
    summary: fallback ? `${role ?? "message"} · ${fallback}` : (role ?? "message"),
    text: contentText(message.content),
    detail: role ?? undefined,
  }
}

export function statusOf(parsed: ParsedFile): { status: AgentStatus; note: string | null } {
  const age = Date.now() - parsed.modifiedAt
  let last: Raw | null = null
  for (let index = parsed.events.length - 1; index >= 0; index -= 1) {
    const entry = parsed.events[index]
    if (entry.type === "message" && isRecord(entry.message)) {
      last = entry
      break
    }
  }
  if (!last) return { status: "idle", note: "no messages" }
  const message = isRecord(last.message) ? last.message : {}
  const role = typeof message.role === "string" ? message.role : ""
  const stopReason = typeof message.stopReason === "string" ? message.stopReason : ""
  if (stopReason === "error") return { status: "error", note: "last turn failed" }
  if (age > 15 * 60 * 1000) return { status: "idle", note: "quiet for 15m" }
  if (role === "assistant") {
    if (stopReason === "toolUse") return { status: "working", note: "running tools" }
    if (stopReason === "aborted") return { status: "idle", note: "turn aborted" }
    return { status: "waiting", note: "awaiting input" }
  }
  return { status: "working", note: "turn in progress" }
}

export function sessionIdFromFile(file: string): string | null {
  const name = basename(file, ".jsonl")
  const index = name.indexOf("_")
  return index === -1 ? name : name.slice(index + 1)
}

