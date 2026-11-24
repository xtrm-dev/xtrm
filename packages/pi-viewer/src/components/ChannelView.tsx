import { useMemo } from "react"

import { ActivityDisclosure } from "@/components/ActivityDisclosure"
import { Markdown } from "@/components/Markdown"
import { StatusDot } from "@/components/StatusDot"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { MessageScrollerItem } from "@/components/ui/message-scroller"
import { clock, dayKey, dayLabel, monogram } from "@/lib/format"
import type { OptimisticMessage } from "@/lib/optimistic"
import { channelTurns, type Turn } from "@/lib/thread"
import type { ViewerAgent, ViewerEvent } from "@/shared/types"

function AgentMark({ name }: { name: string }) {
  return (
    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border-muted bg-control font-mono text-2xs text-ink-muted">
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
          <BubbleContent className="border-border-muted whitespace-pre-wrap text-ink">
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
      {turn.users.map((user) => (
        <UserMessage key={user.id} event={user} agentName={name} />
      ))}

      <Message align="start" className="gap-3">
        <AgentMark name={name} />
        <MessageContent className="gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-ink">{name}</span>
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
          ) : (
            <div className="animate-pulse py-0.5 text-xs text-ink-faint">Working…</div>
          )}

          {turn.activity.length ? (
            <ActivityDisclosure turn={turn} session={session} pending={!turn.final} />
          ) : null}
        </MessageContent>
      </Message>
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
  const turns = useMemo(() => channelTurns(events), [events])
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])

  if (!turns.length && !optimistic.length) {
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
      {turns.map((turn) => {
        const key = dayKey(turn.start)
        const divider = key !== lastDay
        lastDay = key
        return (
          <MessageScrollerItem key={turn.id} messageId={turn.id} className="flex flex-col gap-6">
            {divider ? (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border-muted" />
                <span className="text-2xs tracking-wide text-ink-faint uppercase">
                  {dayLabel(turn.start)}
                </span>
                <span className="h-px flex-1 bg-border-muted" />
              </div>
            ) : null}
            <TurnView turn={turn} agent={byId.get(turn.agentId)} session={session} />
          </MessageScrollerItem>
        )
      })}

      {optimistic.map((message) => (
        <MessageScrollerItem key={message.id} messageId={message.id}>
          <UserMessage
            event={{ text: message.text, at: message.at, summary: message.text }}
            agentName={message.agentName}
            optimistic={{ status: message.status, error: message.error }}
            onDismiss={() => onDismissOptimistic(message.id)}
          />
        </MessageScrollerItem>
      ))}
    </>
  )
}
