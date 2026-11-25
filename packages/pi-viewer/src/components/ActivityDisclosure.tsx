import {
  ArchiveIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  InfoIcon,
  SquareTerminalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { CodeBlock } from "@/components/CodeBlock"
import { Shimmer } from "@/components/Shimmer"
import { useDetail } from "@/lib/details"
import { foldLine, groupActivity } from "@/lib/fold"
import { clock } from "@/lib/format"
import type { ActivityItem, Turn } from "@/lib/thread"
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
  // The active call of a running turn: a tool or command with no result yet.
  const live = turn.pending && !item.result && (item.kind === "tool" || item.kind === "bash")

  return (
    <div className="group/row flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={error ? `${item.label} (tool call failed)` : undefined}
        className="flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm px-0.5 text-left text-sm transition-colors hover:bg-hover"
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            error ? "text-danger" : "text-ink-muted",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className={cn("shrink-0 font-medium", error ? "text-danger" : "text-ink-muted")}>
          {live ? <Shimmer>{item.label}</Shimmer> : item.label}
        </span>
        <span className="min-w-0 truncate text-ink-muted">{item.summary || "—"}</span>
        {error ? <XIcon className="size-3 shrink-0 text-danger" /> : null}
        <span className="xtrm-meta ml-auto shrink-0 pl-2 text-xs tabular text-ink-muted">
          {clock(item.at)}
        </span>
        <ChevronRightIcon
          className={cn("size-3.5 shrink-0 text-ink-muted transition-transform", expanded && "rotate-90")}
        />
      </button>
      {expanded ? (
        <div className="mt-0.5 mb-1.5 ml-7 flex flex-col gap-2 rounded-md bg-inset/40 px-3 py-2">
          {item.kind === "thinking" ? (
            thought ? (
              <div className="scrollbar-thin max-h-64 overflow-auto whitespace-pre-wrap text-xs text-ink-muted">
                {thought}
              </div>
            ) : (
              <div className="text-2xs text-ink-muted">No content recorded.</div>
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
                <div className="text-2xs text-ink-muted">Loading…</div>
              ) : null}
              {callPart?.input ? <CodeBlock text={pretty(callPart.input)} /> : null}
              {output ? <CodeBlock text={output} tone={error ? "error" : "default"} /> : null}
              {!callPart?.input && !output ? (
                <div className="text-2xs text-ink-muted">No recorded input or output.</div>
              ) : null}
            </>
          ) : null}

          {item.kind === "bash" ? (
            <>
              {event.loading ? <div className="text-2xs text-ink-muted">Loading…</div> : null}
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

function GroupRow({
  group,
  open,
  onToggle,
  children,
}: {
  group: Extract<ReturnType<typeof groupActivity>[number], { kind: "group" }>
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm px-0.5 text-left text-sm transition-colors hover:bg-hover"
      >
        <span className="flex size-6 shrink-0 items-center justify-center text-ink-muted">
          <WrenchIcon className="size-3.5" />
        </span>
        <span className="min-w-0 truncate text-ink-muted">
          <span className="font-medium">{group.items.length} tool calls</span> · {group.summary}
        </span>
        {group.failed ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-danger">
            <span className="size-1.5 rounded-full bg-danger" />
            {group.failed} failed
          </span>
        ) : null}
        <ChevronRightIcon
          className={cn("ml-auto size-3.5 shrink-0 text-ink-muted transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? <div className="ml-3 flex flex-col">{children}</div> : null}
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
  const rows = useMemo(() => groupActivity(turn.activity), [turn.activity])

  if (!hasActivity && !isPending) return null

  if (!hasActivity) {
    return (
      <div className="mt-0.5 flex items-center py-1 text-xs text-ink-muted">
        <span className="viewer-fade text-ink-muted">Working…</span>
      </div>
    )
  }

  const line = foldLine(turn)

  function toggle(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function renderRow(item: ActivityItem) {
    return (
      <ActivityRow
        key={item.key}
        item={item}
        turn={turn}
        session={session}
        expanded={expanded.has(item.key)}
        onToggle={() => toggle(item.key)}
      />
    )
  }

  return (
    <div className="mt-0.5 pb-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group/trace flex min-h-6 w-full items-center gap-1.5 rounded-sm px-0.5 text-left text-sm text-ink-muted tabular transition-colors hover:text-ink"
      >
        <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="truncate">
          {isPending ? <span className="viewer-fade">Working</span> : line.label}
          {line.detail ? ` · ${line.detail}` : ""}
        </span>
        {line.failed ? (
          <span className="flex shrink-0 items-center gap-1 text-danger">
            <span className="size-1.5 rounded-full bg-danger" />
            {line.failed} failed
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-1 flex flex-col">
          {rows.map((row) =>
            row.kind === "row" ? (
              renderRow(row.item)
            ) : (
              <GroupRow
                key={row.key}
                group={row}
                open={expanded.has(row.key)}
                onToggle={() => toggle(row.key)}
              >
                {row.items.map(renderRow)}
              </GroupRow>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}
