/** Context usage per agent: how much of the model's window the agent's transcript has filled.
 *
 * Both runtimes record a `usage` block on every assistant message, and both keep that block in the
 * transcript the viewer already parses. The prompt size of the newest assistant message is the amount
 * of context the next turn starts from: the input tokens plus the cached prefix (read and written).
 * The window is a property of the model, so it comes from a table; a model the table does not know
 * reports `null` and the viewer draws no ring rather than a guess.
 */

import type { ContextUsage } from "../shared/types.ts"

/** One model family's context window, matched against the model id the transcript reports. */
interface WindowRule {
  pattern: RegExp
  window: number
}

/**
 * The windows of the models this fleet runs. A `[1m]` suffix marks the long-context variant of a
 * Claude model (pi reports it that way, e.g. `claude-opus-5-5[1m]`), so the long-context rules come
 * first and the family rules after them.
 */
const WINDOWS: WindowRule[] = [
  { pattern: /\[1m\]$/i, window: 1_000_000 },
  { pattern: /^claude-(opus|sonnet|haiku)-[\d.]*(-|$)/i, window: 200_000 },
  { pattern: /^claude-(opus|sonnet|haiku)$/i, window: 200_000 },
  { pattern: /^(anthropic\/)?claude-(opus|sonnet|haiku)[-\d.]*$/i, window: 200_000 },
]

/** The context window of a model id, or null when the table does not know the model. */
export function contextWindowFor(model: string | null | undefined): number | null {
  if (!model) return null
  const id = model.trim()
  if (!id) return null
  for (const rule of WINDOWS) if (rule.pattern.test(id)) return rule.window
  return null
}

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Read one number that either runtime names differently: `input`/`input_tokens`, and so on. */
function pick(usage: Raw, pi: string, claude: string): number {
  return number(usage[pi]) || number(usage[claude])
}

/** The usage block of a transcript record, at either nesting the two runtimes use. */
function usageOf(record: unknown): Raw | null {
  if (!isRecord(record)) return null
  if (isRecord(record.message) && isRecord(record.message.usage)) return record.message.usage
  if (isRecord(record.usage)) return record.usage
  if (isRecord(record.response) && isRecord(record.response.usage)) return record.response.usage
  return null
}

/** True when a record is an assistant message from either runtime. */
function isAssistant(record: unknown): boolean {
  if (!isRecord(record)) return false
  if (isRecord(record.message)) return record.message.role === "assistant"
  return record.role === "assistant"
}

/**
 * The prompt size of the newest assistant message that carries usage, in tokens: input plus the
 * cached prefix that was read and written. Null when no record carries usage. Output tokens are
 * excluded: the ring reports what the next turn has to fit into the window, not what was produced.
 */
export function contextTokensUsed(records: readonly unknown[]): number | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (!isAssistant(record)) continue
    const usage = usageOf(record)
    if (!usage) continue
    const input = pick(usage, "input", "input_tokens")
    const cacheRead = pick(usage, "cacheRead", "cache_read_input_tokens")
    const cacheWrite = pick(usage, "cacheWrite", "cache_creation_input_tokens")
    const used = input + cacheRead + cacheWrite
    if (used > 0) return used
  }
  return null
}

/** Usage for one agent: its transcript records and its model id, or null when either is unknown. */
export function contextUsageOf(records: readonly unknown[], model: string | null | undefined): ContextUsage | null {
  const window = contextWindowFor(model)
  if (!window) return null
  const used = contextTokensUsed(records)
  if (used === null) return null
  return { used, window }
}

/** Whole percent of the window used, clamped to 0..100 for the ring. */
export function contextPercent(usage: ContextUsage): number {
  if (usage.window <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((usage.used / usage.window) * 100)))
}

/** The ring's tone: calm below 75% of the window, warm to the last quarter, hot in the last tenth. */
export function contextTone(usage: ContextUsage): "calm" | "warm" | "hot" {
  const percent = contextPercent(usage)
  if (percent >= 90) return "hot"
  if (percent >= 75) return "warm"
  return "calm"
}

/** Compact token count for the tooltip: 165000 -> "165k", 1000000 -> "1M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(0)}k`
  }
  return String(tokens)
}

/** The tooltip and accessible name of the ring: "42% of 200k tokens". */
export function contextLabel(usage: ContextUsage): string {
  return `${contextPercent(usage)}% of ${formatTokens(usage.window)} tokens`
}
