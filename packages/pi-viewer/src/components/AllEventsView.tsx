import { ChevronRightIcon } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { EventBody } from "@/components/EventDetail"
import { RoleChip } from "@/components/RoleChip"
import { useDetail } from "@/lib/details"
import { clockWithSeconds, dayKey, dayLabel } from "@/lib/format"
import type { ViewerAgent, ViewerEvent } from "@/shared/types"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<ViewerEvent["kind"], string> = {
  user: "user",
  assistant: "agent",
  "tool-result": "tool",
  bash: "bash",
  notice: "notice",
  compaction: "compact",
  intercom: "intercom",
  meta: "meta",
}

function EventRow({
  event,
  session,
  paired,
}: {
  event: ViewerEvent
  session: string
  paired: boolean
}) {
  const [open, setOpen] = useState(false)
  const detail = useDetail(session, event.agentId, event.seq, open)

  return (
    <div className="viewer-row">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="grid w-full grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-1.5 text-left hover:bg-hover sm:grid-cols-[3.5rem_8rem_minmax(0,1fr)]"
      >
        <span className="font-mono text-2xs whitespace-nowrap text-ink-muted">
          {clockWithSeconds(event.at)}
        </span>
        <span className="truncate text-2xs text-ink-muted">{event.agentName}</span>
        <span className="col-span-2 flex min-w-0 items-baseline gap-2 sm:col-span-1">
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 self-center text-ink-muted transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="w-14 shrink-0 text-2xs tracking-wide text-ink-muted uppercase">
            {KIND_LABEL[event.kind]}
          </span>
          <span
            className={cn(
              "truncate text-xs",
              event.kind === "user" ? "text-ink" : "text-ink-muted",
              event.isError && "text-danger",
            )}
          >
            {event.summary || "—"}
          </span>
          {!event.onBranch ? (
            <span className="shrink-0 text-2xs text-ink-muted">off-branch</span>
          ) : null}
          {paired ? <span className="shrink-0 text-2xs text-ink-muted">paired</span> : null}
        </span>
      </button>
      {open ? (
        <div className="bg-surface/40 px-3 py-3 sm:pl-[calc(3.5rem+8rem+1.25rem)]">
          {detail.loading ? (
            <div className="text-2xs text-ink-muted">Loading event…</div>
          ) : detail.error ? (
            <div className="text-2xs text-danger">{detail.error}</div>
          ) : (
            <EventBody event={detail.event ?? event} />
          )}
        </div>
      ) : null}
    </div>
  )
}

export function AllEventsView({
  events,
  agents,
  session,
}: {
  events: ViewerEvent[]
  agents: ViewerAgent[]
  session: string
}) {
  const [filter, setFilter] = useState<string>("all")

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const event of events) map.set(event.agentId, (map.get(event.agentId) ?? 0) + 1)
    return map
  }, [events])

  const paired = useMemo(() => {
    const groups = new Map<string, { sent: string[]; received: string[] }>()
    for (const event of events) {
      const meta = event.intercom
      if (!meta) continue
      const pair = [meta.from, meta.to].sort().join("|")
      const key = `${pair}|${(meta.body ?? "").replace(/\s+/g, " ").trim()}`
      const group = groups.get(key) ?? { sent: [], received: [] }
      if (meta.direction === "sent") group.sent.push(event.id)
      else group.received.push(event.id)
      groups.set(key, group)
    }
    const ids = new Set<string>()
    for (const group of groups.values()) {
      if (!group.sent.length || !group.received.length) continue
      for (const id of [...group.sent, ...group.received]) ids.add(id)
    }
    return ids
  }, [events])

  const shown = filter === "all" ? events : events.filter((event) => event.agentId === filter)
  const activeAgent = agents.find((agent) => agent.id === filter)

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 -mx-5 bg-deep">
        <div className="relative">
          <div className="flex items-center gap-1 overflow-x-auto px-5">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={cn(
            "flex shrink-0 items-baseline gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
            filter === "all"
              ? "bg-pressed text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          All
          <span className="text-2xs text-ink-muted">{events.length}</span>
        </button>
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => setFilter(agent.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              filter === agent.id
                ? "bg-pressed text-ink"
                : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            <span className="max-w-44 truncate">{agent.name}</span>
            <RoleChip role={agent.role} />
            <span className="text-2xs text-ink-muted">{counts.get(agent.id) ?? 0}</span>
          </button>
        ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-deep to-transparent" />
        </div>
      </div>

      {activeAgent ? (
        <div className="flex items-center gap-2 py-2 text-2xs text-ink-muted">
          <RoleChip role={activeAgent.role} />
          <span className="truncate font-mono">{activeAgent.sessionFile ?? "no session file"}</span>
        </div>
      ) : (
        <div className="py-2 text-2xs text-ink-muted">
          Chronological raw events from {agents.length === 1 ? "this agent" : `the ${agents.length} agents in this scope`}. Select a row for full
          input, output, and JSON.
        </div>
      )}

      {shown.length ? (
        <div>
          {shown.map((event, index) => {
            const key = dayKey(event.at)
            const previous = index === 0 ? "" : dayKey(shown[index - 1].at)
            return (
              <Fragment key={event.id}>
                {key !== previous ? (
                  <div className="flex items-center pt-3 pb-1.5">
                    <span className="text-2xs tracking-wide text-ink-muted uppercase">
                      {dayLabel(event.at)}
                    </span>
                  </div>
                ) : null}
                <EventRow event={event} session={session} paired={paired.has(event.id)} />
              </Fragment>
            )
          })}
        </div>
      ) : (
        <div className="py-16 text-center text-xs text-ink-muted">No events for this filter.</div>
      )}
    </div>
  )
}
