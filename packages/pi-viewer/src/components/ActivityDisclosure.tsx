import {
  ArchiveIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  InfoIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react"
import { useState } from "react"

import { CodeBlock } from "@/components/CodeBlock"
import { useDetail } from "@/lib/details"
import { duration } from "@/lib/format"
import { stepCount, toolCount, turnDuration, type ActivityItem, type Turn } from "@/lib/thread"
import { cn } from "@/lib/utils"

function pretty(value: string | undefined): string {
  if (!value) return ""
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function iconFor(item: ActivityItem) {
  if (item.isError) return CircleAlertIcon
  if (item.kind === "thinking") return BrainIcon
  if (item.kind === "bash") return SquareTerminalIcon
  if (item.kind === "notice") return InfoIcon
  if (item.kind === "compaction") return ArchiveIcon
  return WrenchIcon
}

export function ActivityRow({
  item,
  turn,
  session,
  expanded,
  onToggle,
}: {
  item: ActivityItem
  turn: Turn
  session: string
  expanded: boolean
  onToggle: () => void
}) {
  const call = useDetail(session, turn.agentId, item.call?.seq, expanded && Boolean(item.call))
  const result = useDetail(session, turn.agentId, item.result?.seq, expanded && Boolean(item.result))
  const event = useDetail(session, turn.agentId, item.event.seq, expanded && !item.call && !item.result)
  const Icon = iconFor(item)

  const callPart = call.event?.parts?.find((part) => part.toolCallId === item.toolCallId)
  const thought =
    item.kind === "thinking"
      ? (event.event?.parts?.[item.partIndex ?? -1]?.text ?? item.thought)
      : undefined
  const output = result.event?.output ?? event.event?.output
  const error = item.isError

  return (
    <div className="flex flex-col">
      <div className="flex gap-2">
        <span className={cn("trace-dot", error && "text-danger")}>
          <Icon className="size-3" />
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-left"
        >
          <span className={cn("shrink-0 text-xs", error ? "text-danger" : "text-ink-muted")}>
            {item.label}
          </span>
          <span className="truncate text-xs text-ink-faint">{item.summary || "—"}</span>
          <ChevronRightIcon
            className={cn(
              "ml-auto size-3 shrink-0 text-ink-faint transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
      </div>
      {expanded ? (
        <div className="mt-1 mb-2 ml-[1.25rem] flex flex-col gap-2 rounded-md bg-surface/40 px-3 py-2">
          {item.kind === "thinking" ? (
            thought ? (
              <div className="scrollbar-thin max-h-64 overflow-auto whitespace-pre-wrap text-xs text-ink-muted">
                {thought}
              </div>
            ) : (
              <div className="text-2xs text-ink-faint">No content recorded.</div>
            )
          ) : null}

          {item.kind === "notice" || item.kind === "compaction" ? (
            <div className="scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap text-xs text-ink-muted">
              {event.event?.text ?? item.summary}
            </div>
          ) : null}

          {item.kind === "tool" ? (
            <>
              {call.loading || result.loading ? (
                <div className="text-2xs text-ink-faint">Loading…</div>
              ) : null}
              {callPart?.input ? <CodeBlock text={pretty(callPart.input)} /> : null}
              {output ? <CodeBlock text={output} tone={error ? "error" : "default"} /> : null}
              {!callPart?.input && !output ? (
                <div className="text-2xs text-ink-faint">No recorded input or output.</div>
              ) : null}
            </>
          ) : null}

          {item.kind === "bash" ? (
            <>
              {event.loading ? <div className="text-2xs text-ink-faint">Loading…</div> : null}
              {event.event?.input ? <CodeBlock text={event.event.input} /> : null}
              {output ? <CodeBlock text={output} tone={error ? "error" : "default"} /> : null}
            </>
          ) : null}

          {call.error || result.error || event.error ? (
            <div className="text-2xs text-danger">{call.error ?? result.error ?? event.error}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ActivityDisclosure({
  turn,
  session,
  pending,
}: {
  turn: Turn
  session: string
  pending?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const isPending = Boolean(pending && !turn.final)
  const hasActivity = turn.activity.length > 0

  if (!hasActivity && !isPending) return null

  if (!hasActivity) {
    return (
      <div className="mt-0.5 flex items-center py-1 text-xs text-ink-faint">
        <span className="viewer-fade text-ink-muted">Working…</span>
      </div>
    )
  }

  const steps = stepCount(turn)
  const tools = toolCount(turn)
  const failed = turn.activity.filter((item) => item.isError).length
  const span = turnDuration(turn)

  function toggle(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group/trace flex w-full items-center gap-1.5 rounded-sm py-1 text-left text-xs text-ink-faint transition-colors hover:text-ink-muted"
      >
        <ChevronRightIcon
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="truncate">
          {isPending ? (
            <span className="viewer-fade text-ink-muted">Working</span>
          ) : (
            `${steps} ${steps === 1 ? "step" : "steps"}`
          )}
          {tools ? ` · ${tools} ${tools === 1 ? "tool" : "tools"}` : ""}
          {span ? ` · ${duration(span)}` : ""}
          {failed ? ` · ${failed} failed` : ""}
        </span>
      </button>

      {open ? (
        <div className="trace-rail mt-1 flex flex-col">
          {turn.activity.map((item) => (
            <ActivityRow
              key={item.key}
              item={item}
              turn={turn}
              session={session}
              expanded={expanded.has(item.key)}
              onToggle={() => toggle(item.key)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
