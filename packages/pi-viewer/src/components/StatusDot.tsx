import type { AgentStatus } from "@/shared/types"
import { cn } from "@/lib/utils"

const COLOURS: Record<AgentStatus, string> = {
  working: "bg-accent viewer-pulse",
  attention: "bg-accent",
  quiet: "bg-ink-faint",
  waiting: "bg-success",
  error: "bg-danger",
  idle: "bg-ink-faint/50",
  unknown: "bg-ink-faint/30",
}

const WORDS: Record<AgentStatus, string> = {
  working: "working",
  attention: "needs you",
  quiet: "quiet",
  waiting: "waiting",
  error: "failed",
  idle: "idle",
  unknown: "unknown",
}

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", COLOURS[status], className)}
      title={WORDS[status]}
      aria-label={WORDS[status]}
    />
  )
}

export function statusWord(status: AgentStatus): string {
  return WORDS[status]
}
