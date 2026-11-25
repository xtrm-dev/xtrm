#!/usr/bin/env node
// Redacted copy of a window of a real Pi or Claude transcript, for the replay harness
// (test/replay.test.ts, XTRM-1043).
//
//   node scripts/redact-transcript.mjs <pi|claude> <source.jsonl> <from-line> <to-line> <out.jsonl>
//
// Kept: record kinds and order, timestamps, ids and parent ids, roles, stop reasons, tool
// names and tool call ids, flags (isMeta, isSidechain, isCompactSummary, isApiErrorMessage),
// Pi custom types, Claude slash command names and the opening tag of injected text. Every
// prompt, reply, thought, tool input and output, path and summary becomes a placeholder.
// Each record gets `_src`, its line number in the source. A Pi window always starts with the
// source's session header.
import { readFileSync, writeFileSync } from "node:fs"

const [, , provider, source, fromArg, toArg, out] = process.argv
if (!["pi", "claude"].includes(provider) || !source || !out) {
  console.error("usage: redact-transcript.mjs <pi|claude> <source.jsonl> <from-line> <to-line> <out.jsonl>")
  process.exit(2)
}
const from = Number(fromArg)
const to = Number(toArg)

/** Source line of the record being redacted: placeholders carry it so distinct texts stay distinct (intercom dedupe compares bodies). */
let currentLine = 0

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

/** Classification needs these phrases; nothing else of an error text is kept. */
const ERROR_CLASSES = [
  [/prompt is too long|input is too long|context[ _-]?(?:length|window)|maximum context|too many tokens/i, "context window overflow (redacted)"],
  [/aborted/i, "operation aborted (redacted)"],
  [/rate limit|usage limit|quota|exceed/i, "rate limit exceeded (redacted)"],
]

function redactError(text) {
  if (typeof text !== "string") return text
  const status = /^\s*(\d{3})\b/.exec(text)?.[1]
  const match = ERROR_CLASSES.find(([pattern]) => pattern.test(text))
  return `${status ? `${status} ` : ""}${match ? match[1] : "error (redacted)"}`
}

/** Short stable hash: equal values stay equal, nothing of the value is kept. */
function hash(value) {
  let h = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) h = Math.imul(h ^ value.charCodeAt(index), 0x01000193) >>> 0
  return h.toString(16).padStart(8, "0")
}

/** Tag attributes keep their names; values become a hash (message ids and peers stay distinct). */
function redactTag(tag) {
  return tag.replace(/(\s[\w:-]+)=(?:"([^"]*)"|'([^']*)')/g, (_, name, double, single) => `${name}="h${hash(double ?? single ?? "")}"`)
}

/** Prompt or injected text: the leading structure the parsers classify by, nothing more. */
function redactText(text) {
  if (typeof text !== "string") return text
  if (!text.trim()) return text
  const pi = /^›\s+/.test(text) ? "› " : ""
  const body = text.replace(/^›\s+/, "")
  const interrupt = /^\s*(\[Request interrupted by user[^\]]*\])/.exec(body)
  if (interrupt) return interrupt[1]
  if (/<command-name>/.test(body)) {
    const name = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(body)?.[1] ?? "/command"
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(body)?.[1]?.trim()
    return `<command-message>${name.replace(/^\//, "")}</command-message>\n<command-name>${name}</command-name>${
      args === undefined ? "" : `\n<command-args>${args ? "[args]" : ""}</command-args>`
    }`
  }
  const envelope = /^(\s*(?:Another Claude session sent a message:\s*)?)(<cross-session-message\b[^>]*>)/.exec(body)
  if (envelope) return `${pi}${envelope[1]}${redactTag(envelope[2])}\n[message L${currentLine}]\n</cross-session-message>`
  const tag = /^\s*(<([\w-]+)\b[^>]*>)/.exec(body)
  if (tag) return `${pi}${redactTag(tag[1])}[redacted]</${tag[2]}>`
  if (/^\s*\/[a-z]/.test(body)) return `${pi}${body.trim().split(/\s+/)[0]}`
  return `${pi}[prompt]`
}

/** Tool arguments: the same keys, string values redacted; ask tools keep a placeholder question. */
function redactValue(value) {
  if (typeof value === "string") return value ? `[redacted L${currentLine}]` : ""
  if (Array.isArray(value)) return value.map(redactValue)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redactValue(inner)]))
  return value
}

function pick(record, keys) {
  const out = {}
  for (const key of keys) if (record[key] !== undefined) out[key] = record[key]
  return out
}

// ---------------------------------------------------------------- Pi
function piBlock(block) {
  if (!isRecord(block)) return block
  switch (block.type) {
    case "text":
      return { type: "text", text: redactText(block.text) }
    case "thinking":
      return { type: "thinking", thinking: block.thinking ? "[thinking]" : "" }
    case "toolCall":
      return { type: "toolCall", id: block.id, name: block.name, arguments: redactValue(block.arguments ?? {}) }
    case "image":
      return { type: "image" }
    default:
      return { type: block.type }
  }
}

function piContent(content) {
  if (typeof content === "string") return redactText(content)
  return Array.isArray(content) ? content.map(piBlock) : content
}

function redactPi(record) {
  const base = pick(record, ["type", "id", "parentId", "timestamp", "version"])
  switch (record.type) {
    case "session":
      return { ...base, cwd: "/redacted" }
    case "message": {
      const message = record.message ?? {}
      const kept = pick(message, ["role", "timestamp", "stopReason", "toolCallId", "toolName", "isError", "exitCode", "provider", "model"])
      if (message.errorMessage !== undefined) kept.errorMessage = redactError(message.errorMessage)
      if (message.role === "toolResult") kept.content = [{ type: "text", text: "[output]" }]
      else if (message.role === "bashExecution") Object.assign(kept, { command: "[command]", output: "[output]" })
      else kept.content = piContent(message.content)
      return { ...base, message: kept }
    }
    case "custom_message":
      return { ...base, ...pick(record, ["customType", "display"]), content: piContent(record.content) }
    case "custom":
      return { ...base, ...pick(record, ["customType"]) }
    case "compaction":
      return { ...base, ...pick(record, ["firstKeptEntryId", "tokensBefore"]), summary: "[summary]" }
    case "context_edit":
      return { ...base, ...pick(record, ["targetId", "replacement"]) }
    case "model_change":
      return { ...base, ...pick(record, ["provider", "modelId"]) }
    case "thinking_level_change":
      return { ...base, ...pick(record, ["thinkingLevel"]) }
    case "session_info":
      return { ...base, name: "[name]" }
    default:
      return base
  }
}

// ---------------------------------------------------------------- Claude
function claudeBlock(block) {
  if (!isRecord(block)) return typeof block === "string" ? redactText(block) : block
  switch (block.type) {
    case "text":
      return { type: "text", text: redactText(block.text) }
    case "thinking":
      return { type: "thinking", thinking: block.thinking ? "[thinking]" : "" }
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: redactValue(block.input ?? {}) }
    case "tool_result":
      return { type: "tool_result", tool_use_id: block.tool_use_id, is_error: block.is_error, content: "[output]" }
    case "image":
      return { type: "image" }
    default:
      return { type: block.type }
  }
}

function redactClaude(record) {
  const base = pick(record, [
    "type",
    "subtype",
    "uuid",
    "parentUuid",
    "timestamp",
    "isSidechain",
    "agentId",
    "isMeta",
    "isCompactSummary",
    "isApiErrorMessage",
    "operation",
    "durationMs",
  ])
  if (isRecord(record.origin)) base.origin = pick(record.origin, ["kind"])
  if (isRecord(record.compactMetadata)) base.compactMetadata = pick(record.compactMetadata, ["trigger"])
  switch (record.type) {
    case "user":
    case "assistant": {
      const message = record.message ?? {}
      const kept = pick(message, ["id", "role", "model", "stop_reason"])
      if (typeof message.content === "string") kept.content = record.isApiErrorMessage ? redactError(message.content) : redactText(message.content)
      else if (Array.isArray(message.content)) {
        kept.content = message.content.map((block) =>
          record.isApiErrorMessage && isRecord(block) && block.type === "text" ? { type: "text", text: redactError(block.text) } : claudeBlock(block),
        )
      }
      return { ...base, message: kept }
    }
    case "system":
      return typeof record.content === "string" ? { ...base, content: "[system]" } : base
    case "attachment":
      return { ...base, attachment: isRecord(record.attachment) ? pick(record.attachment, ["type"]) : undefined }
    case "custom-title":
      return { ...base, customTitle: "[title]" }
    case "agent-name":
      return { ...base, agentName: "[name]" }
    case "summary":
      return { ...base, summary: "[summary]" }
    default:
      return base
  }
}

const lines = readFileSync(source, "utf8").split("\n")
const picked = []
if (provider === "pi" && from > 1) picked.push(1)
for (let line = from; line <= Math.min(to, lines.length); line += 1) picked.push(line)
const output = []
for (const line of picked) {
  const text = lines[line - 1]
  if (!text?.trim()) continue
  let record
  try {
    record = JSON.parse(text)
  } catch {
    continue
  }
  currentLine = line
  const redacted = provider === "pi" ? redactPi(record) : redactClaude(record)
  output.push(JSON.stringify({ ...redacted, _src: line }))
}
writeFileSync(out, `${output.join("\n")}\n`)
console.log(`${out}: ${output.length} records from ${source.split("/").pop()} lines ${from}-${to}`)
