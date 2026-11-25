import { useMemo } from "react"

import { ActivityDisclosure } from "@/components/ActivityDisclosure"
import { IntercomCard } from "@/components/IntercomCard"
import { Markdown } from "@/components/Markdown"
import { RoleChip } from "@/components/RoleChip"
import { StatusDot } from "@/components/StatusDot"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { StoppedTurn } from "@/components/presence/StoppedTurn"
import { MessageScrollerItem } from "@/components/ui/message-scroller"
import { clock, dayKey, dayLabel, monogram } from "@/lib/format"
import type { OptimisticMessage } from "@/lib/optimistic"
import { splitPresence } from "@/lib/presence"
import { channelTimeline, type Turn } from "@/lib/thread"
import type { ViewerAgent, ViewerEvent } from "@/shared/types"

function AgentMark({ name }: { name: string }) {
  return (
    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-control font-mono text-2xs text-ink-muted">
      {monogram(name)}
    </div>
  )
}

function UserMessage({
  event,
  agentName,
  optimistic,
  onDismiss,
}: {
  event: Pick<ViewerEvent, "text" | "at" | "summary">
  agentName: string
  optimistic?: { status: OptimisticMessage["status"]; error?: string }
  onDismiss?: () => void
}) {
  return (
    <Message align="end">
      <MessageContent className="items-end gap-1">
        <Bubble variant="muted" align="end" className="max-w-[85%]">
          <BubbleContent className="border-0 bg-control whitespace-pre-wrap text-ink">
            {event.text ?? event.summary}
          </BubbleContent>
        </Bubble>
        <div className="flex items-center gap-1.5 text-2xs text-ink-faint">
          <span>{clock(event.at)}</span>
          <span className="text-border-strong">·</span>
          <span className="max-w-40 truncate">to {agentName}</span>
          {optimistic?.status === "sending" ? <span>· sending…</span> : null}
          {optimistic?.status === "error" ? (
            <span className="text-danger">
              · {optimistic.error ?? "not sent"}
              {onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="ml-1.5 text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
                >
                  dismiss
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      </MessageContent>
    </Message>
  )
}

function TurnView({
  turn,
  agent,
  session,
}: {
  turn: Turn
  agent: ViewerAgent | undefined
  session: string
}) {
  const name = agent?.name ?? turn.agentName
  const status = agent?.status ?? "unknown"
  const finalText = turn.final?.text?.trim() ?? ""

  return (
    <div className="viewer-turn flex flex-col gap-4">
      <Message align="start" className="gap-3">
        <AgentMark name={name} />
        <MessageContent className="gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-ink">{name}</span>
            <RoleChip role={agent?.role} />
            <StatusDot status={turn.final ? status : "working"} />
            <span className="shrink-0 text-2xs text-ink-faint">
              {clock(turn.final?.at ?? turn.start)}
            </span>
          </div>

          {turn.final ? (
            finalText ? (
              <Markdown text={finalText} />
            ) : (
              <div className="text-xs text-ink-faint">
                {turn.final.stopReason === "error"
                  ? "The turn ended with an error."
                  : "The turn ended without a reply."}
              </div>
            )
          ) : null}

          <ActivityDisclosure turn={turn} session={session} pending={!turn.final} />
        </MessageContent>
      </Message>
    </div>
  )
}

function DayDivider({ at }: { at: number }) {
  return (
    <div className="flex items-center justify-center">
      <span className="text-2xs tracking-wide text-ink-faint uppercase">{dayLabel(at)}</span>
    </div>
  )
}

export function ChannelView({
  events,
  agents,
  session,
  optimistic,
  onDismissOptimistic,
}: {
  events: ViewerEvent[]
  agents: ViewerAgent[]
  session: string
  optimistic: OptimisticMessage[]
  onDismissOptimistic: (id: string) => void
}) {
  // Running turns live in the presence line above the composer (XTRM-1035): the thread shows
  // settled work, and a turn whose agent stopped shows as a stopped row.
  const items = useMemo(
    () => splitPresence(channelTimeline(events, optimistic), agents).timeline,
    [events, optimistic, agents],
  )
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <div className="text-sm text-ink-muted">No messages in this session yet.</div>
        <div className="text-xs text-ink-faint">Send a prompt below to start the thread.</div>
      </div>
    )
  }

  let lastDay = ""

  return (
    <>
      {items.map((item) => {
        const key = dayKey(item.at)
        const divider = key !== lastDay
        lastDay = key
        return (
          <MessageScrollerItem key={item.id} messageId={item.id} className="flex flex-col gap-6">
            {divider ? <DayDivider at={item.at} /> : null}
            {item.kind === "turn" ? (
              <TurnView turn={item.turn} agent={byId.get(item.turn.agentId)} session={session} />
            ) : item.kind === "stopped" ? (
              <StoppedTurn item={item} agent={byId.get(item.agentId)} session={session} />
            ) : item.kind === "user" ? (
              <UserMessage
                event={item.event}
                agentName={byId.get(item.agentId)?.name ?? item.agentName}
              />
            ) : item.kind === "intercom" ? (
              <IntercomCard event={item.event} />
            ) : (
              <UserMessage
                event={{ text: item.message.text, at: item.message.at, summary: item.message.text }}
                agentName={item.message.agentName}
                optimistic={{ status: item.message.status, error: item.message.error }}
                onDismiss={() => onDismissOptimistic(item.message.id)}
              />
            )}
          </MessageScrollerItem>
        )
      })}
    </>
  )
}
