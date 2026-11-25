import { duration } from "./format.ts"
import type { ActivityItem, Turn } from "./thread.ts"

/** One rendered line in an expanded turn: a single step, or a run of tool calls folded into one line. */
export type FoldRow =
  | { kind: "row"; key: string; item: ActivityItem }
  | { kind: "group"; key: string; items: ActivityItem[]; failed: number; summary: string }

function isToolLike(item: ActivityItem): boolean {
  return item.kind === "tool" || item.kind === "bash"
}

/** `Read ×3 · Ran` — counts per verb in order of first use; a count of one is left out. */
export function groupSummary(items: ActivityItem[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1)
  return Array.from(counts, ([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join(" · ")
}

/** Runs of two or more consecutive tool calls become one group; everything else stays a row. */
export function groupActivity(items: ActivityItem[]): FoldRow[] {
  const rows: FoldRow[] = []
  let run: ActivityItem[] = []

  function flush() {
    if (run.length >= 2) {
      rows.push({
        kind: "group",
        key: `group:${run[0].key}`,
        items: run,
        failed: run.filter((item) => item.isError).length,
        summary: groupSummary(run),
      })
    } else {
      for (const item of run) rows.push({ kind: "row", key: item.key, item })
    }
    run = []
  }

  for (const item of items) {
    if (isToolLike(item)) {
      run.push(item)
      continue
    }
    flush()
    rows.push({ kind: "row", key: item.key, item })
  }
  flush()
  return rows
}

export interface FoldLine {
  /** `Worked for 1m 12s`, or a step count when the turn has no usable duration. */
  label: string
  /** `4 tools` or an empty string. */
  detail: string
  steps: number
  tools: number
  failed: number
}

/** The one line a settled turn folds into, with the failure roll-up. */
export function foldLine(turn: Turn): FoldLine {
  const steps = turn.activity.length
  const tools = turn.activity.filter(isToolLike).length
  const failed = turn.activity.filter((item) => item.isError).length
  const span = Math.max(0, (turn.final?.at ?? turn.end) - turn.start)
  const label = span >= 1000 ? `Worked for ${duration(span)}` : `${steps} ${steps === 1 ? "step" : "steps"}`
  const detail = tools ? `${tools} ${tools === 1 ? "tool" : "tools"}` : ""
  return { label, detail, steps, tools, failed }
}
