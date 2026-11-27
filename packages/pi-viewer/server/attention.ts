import { execFile } from "node:child_process"

import type { AgentProvider, ViewerAgent } from "../src/shared/types.ts"

/**
 * Permission prompts never reach the transcript: while one is open the agent reads as
 * `working · running tools`. This module reads the visible pane with `tmux capture-pane -p`
 * (operator ruling on XTRM-1026, 2026-11-25: read-only, no attach, no keys) and recognises
 * the prompts of Claude Code and of the Pi permission gate.
 *
 * Bounds: only an agent that is `working` or `quiet` and has written nothing for 5 s is read;
 * reads run in the background (never on the request path), one pane at most once per 2 s, at
 * most four at once; only the last 60 lines of the visible screen are matched; the prompt text
 * sent to the browser is capped; reads of panes that are gone are dropped.
 */

export interface PanePrompt {
  /** Short tool label for the status note, e.g. `Bash`. */
  tool: string
  /** The prompt block as the operator sees it, without borders, capped. */
  text: string
}

const SCREEN_LINES = 60
/** The prompt must sit in the bottom part of the screen, where an open dialog is drawn. */
const PROMPT_WINDOW = 30
const TEXT_CAP = 1_500
export const CAPTURE_AFTER_MS = 5_000
export const CAPTURE_EVERY_MS = 2_000

/** A rule or box edge: three or more line glyphs at the start, an optional label after. */
const BORDER = /^\s*[─━═╭╮╰╯┌┐└┘╌┄]{3,}/
const BOX_EDGE = /^\s*[│┃|]\s?|\s?[│┃|]\s*$/g

/** Strips up to three levels of box edges (a dialog box can nest a diff box) and trailing space. */
function clean(line: string): string {
  let out = line
  for (let level = 0; level < 3; level += 1) {
    const next = out.replace(BOX_EDGE, "")
    if (next === out) break
    out = next
  }
  return out.replace(/\s+$/, "")
}

/** The block's text lines, rules dropped, common indentation removed, capped. */
function capText(lines: string[]): string {
  const kept = lines.filter((line) => line.trim() && !BORDER.test(line))
  const indent = Math.min(...kept.map((line) => line.length - line.trimStart().length))
  const text = kept.map((line) => line.slice(indent)).join("\n")
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}\n…` : text
}

const CLAUDE_ASK = /^\s*Do you want to (?:proceed|make this edit|create|allow|run|fetch|use|overwrite|delete|write)\b.*\?\s*$/
const CLAUDE_YES = /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/
const CLAUDE_OPTION = /^\s*(?:[❯›>]\s*)?\d\.\s+\S/

const CLAUDE_TOOLS: Array<[RegExp, string]> = [
  [/^Bash command\b/, "Bash"],
  [/^Edit file\b/, "Edit"],
  [/^Create file\b/, "Write"],
  [/^Overwrite file\b/, "Write"],
  [/^Read file\b/, "Read"],
  [/^Fetch\b/, "WebFetch"],
  [/^Web Search\b/, "WebSearch"],
  [/^Tool use\b/, "MCP tool"],
]

function claudeTool(title: string): string {
  for (const [pattern, tool] of CLAUDE_TOOLS) if (pattern.test(title)) return tool
  return title.length > 40 ? `${title.slice(0, 39)}…` : title
}

/** Claude Code: a dialog with a title, the request, `Do you want to …?` and numbered options. */
function claudePrompt(lines: string[]): PanePrompt | null {
  const from = Math.max(0, lines.length - PROMPT_WINDOW)
  for (let index = lines.length - 1; index >= from; index -= 1) {
    if (!CLAUDE_ASK.test(lines[index])) continue
    const options = lines.slice(index + 1, index + 5)
    if (!options.some((line) => CLAUDE_YES.test(line))) return null
    let end = index + 1
    while (end < lines.length && end < index + 6 && CLAUDE_OPTION.test(lines[end])) end += 1
    // The block starts at a known dialog title within 20 lines above the ask, else after the
    // nearest rule above it (a diff or a nested box can sit between the title and the ask).
    const top = Math.max(0, index - 20)
    let start = -1
    for (let line = index - 1; line >= top; line -= 1) {
      if (CLAUDE_TOOLS.some(([pattern]) => pattern.test(lines[line].trim()))) {
        start = line
        break
      }
    }
    if (start < 0) {
      start = index
      while (start > top && !BORDER.test(lines[start - 1])) start -= 1
    }
    const block = lines.slice(start, end)
    const title = block.find((line) => line.trim() && !BORDER.test(line))?.trim() ?? "permission"
    return { tool: claudeTool(title), text: capText(block) }
  }
  return null
}

const PI_ASK = /^\s*Allow execution\?\s*$/
/** Matched on the lines after the question joined by a space: Pi wraps the key hint in a narrow pane. */
const PI_KEYS = /y\/enter:\s+allow/
const PI_TITLE = /^\s*Dangerous Command Detected\s*$/
const PI_HINT_START = /^\s*↑\/↓ or j\/k:/

/** Pi permission gate (@aliou/pi-guardrails): a red-bordered block ending in `Allow execution?`. */
function piPrompt(lines: string[]): PanePrompt | null {
  const from = Math.max(0, lines.length - PROMPT_WINDOW)
  for (let index = lines.length - 1; index >= from; index -= 1) {
    if (!PI_ASK.test(lines[index])) continue
    // The key hint is the first text under the question and the dialog's closing rule follows it.
    // Requiring both, and the opening rule above the title, keeps prose that quotes the dialog out.
    const after = lines.slice(index + 1, index + 7)
    const first = after.findIndex((line) => line.trim())
    if (first < 0 || !PI_HINT_START.test(after[first])) return null
    const close = after.findIndex((line, at) => at > first && BORDER.test(line))
    if (close < 0) return null
    const hint = after
      .slice(first, close)
      .map((line) => line.trim())
      .join(" ")
    if (!PI_KEYS.test(hint)) return null
    // The command viewport is 12 rows (pi-guardrails COMMAND_VIEWPORT_LINES), so the title sits
    // well inside the prompt window even when the reason and the rows wrap in a narrow pane.
    let start = index
    while (start > 0 && index - start < PROMPT_WINDOW && !PI_TITLE.test(lines[start])) start -= 1
    if (!PI_TITLE.test(lines[start]) || start === 0 || !BORDER.test(lines[start - 1])) return null
    return { tool: "Bash", text: capText(lines.slice(start, index + 1)) }
  }
  return null
}

/** Recognises an open permission prompt on a captured pane screen. Pure; tested on fixtures. */
export function detectPermissionPrompt(screen: string, provider: AgentProvider): PanePrompt | null {
  const lines = screen.split("\n").slice(-SCREEN_LINES).map(clean)
  return provider === "claude" ? claudePrompt(lines) : piPrompt(lines)
}

export type CapturePane = (paneId: string) => Promise<string | null>

/**
 * `tmux capture-pane -p` of the visible screen: a read, never an attach, never a key. Async, so
 * a slow tmux never blocks the request that discovers agents.
 */
export const capturePane: CapturePane = (paneId) =>
  new Promise((resolve) => {
    execFile(
      "tmux",
      ["capture-pane", "-p", "-J", "-t", paneId],
      { encoding: "utf8", timeout: 1_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })

/** At most this many pane reads run at once, across all requests. */
export const MAX_READS_IN_FLIGHT = 4

interface PaneRead {
  at: number
  prompt: PanePrompt | null
}

const lastRead = new Map<string, PaneRead>()
const inFlight = new Map<string, Promise<void>>()
/**
 * Reads are asynchronous, and the pane can change while one runs. `epoch` invalidates every
 * read started before a reset; `generations` invalidates the reads of one pane that became
 * waiting, fresh, or gone. A result from an older read must never repopulate the cache.
 */
let epoch = 0
const generations = new Map<string, number>()

function bump(paneId: string): void {
  generations.set(paneId, (generations.get(paneId) ?? 0) + 1)
}

/** Forget the cache and wait for nothing (tests). */
export function resetPaneReads(): void {
  epoch += 1
  generations.clear()
  lastRead.clear()
  inFlight.clear()
}

/** Resolves when every pane read started so far has finished (tests). */
export async function settlePaneReads(): Promise<void> {
  await Promise.all(Array.from(inFlight.values()))
}

/** Drops cached reads of panes that no longer hold an agent; called once per discovery. */
export function prunePaneReads(live: ReadonlySet<string>): void {
  for (const paneId of new Set([...lastRead.keys(), ...inFlight.keys()])) {
    if (live.has(paneId)) continue
    bump(paneId)
    lastRead.delete(paneId)
  }
}

/** Statuses during which a permission prompt can be open: a turn that runs or went quiet. */
const READ_WHILE = new Set<ViewerAgent["status"]>(["working", "quiet"])

/**
 * The permission prompt open on an agent's pane, from the last read, or null. The pane is read
 * in the background, never on the caller's path: only for a working or quiet agent that has been
 * silent for 5 s, at most once per 2 s per pane, and with at most four reads in flight. A
 * prompt found by one read is reported by the next discovery (about one poll later).
 */
export function panePrompt(
  agent: Pick<ViewerAgent, "paneId" | "provider" | "status" | "modifiedAt">,
  now = Date.now(),
  capture: CapturePane = capturePane,
): PanePrompt | null {
  if (!READ_WHILE.has(agent.status) || now - agent.modifiedAt < CAPTURE_AFTER_MS) {
    bump(agent.paneId)
    lastRead.delete(agent.paneId)
    return null
  }
  const cached = lastRead.get(agent.paneId)
  const stale = !cached || now - cached.at >= CAPTURE_EVERY_MS
  if (stale && !inFlight.has(agent.paneId) && inFlight.size < MAX_READS_IN_FLIGHT) {
    const readEpoch = epoch
    const readGeneration = generations.get(agent.paneId) ?? 0
    const read = capture(agent.paneId)
      .catch(() => null)
      .then((screen) => {
        if (readEpoch !== epoch) return
        if ((generations.get(agent.paneId) ?? 0) !== readGeneration) return
        lastRead.set(agent.paneId, {
          at: now,
          prompt: screen === null ? null : detectPermissionPrompt(screen, agent.provider),
        })
      })
      .finally(() => {
        if (inFlight.get(agent.paneId) === read) inFlight.delete(agent.paneId)
      })
    inFlight.set(agent.paneId, read)
  }
  return cached?.prompt ?? null
}

/** Applies an open permission prompt to a discovered agent: `attention · permission: <tool>`. */
export function withPaneAttention(agent: ViewerAgent, now = Date.now(), capture: CapturePane = capturePane): ViewerAgent {
  const prompt = panePrompt(agent, now, capture)
  if (!prompt) return agent
  return { ...agent, status: "attention", statusNote: `permission: ${prompt.tool}`, statusDetail: prompt.text }
}
