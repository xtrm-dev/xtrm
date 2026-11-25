import { CheckIcon, CopyIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { ActivityDisclosure } from "@/components/ActivityDisclosure"
import { EarlierTurns } from "@/components/EarlierTurns"
import { IntercomCard } from "@/components/IntercomCard"
import { Markdown } from "@/components/Markdown"
import { RoleChip } from "@/components/RoleChip"
import { StatusDot } from "@/components/StatusDot"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { StoppedTurn } from "@/components/presence/StoppedTurn"
import { MessageScrollerItem, useMessageScroller } from "@/components/ui/message-scroller"
import { DELIVERY_WORD, deliveryOfOptimistic, deliveryOfUser, latestUserIds, type Delivery } from "@/lib/delivery"
import { dayKey, dayLabel, fullDate, monogram, stamp } from "@/lib/format"
import type { OptimisticMessage } from "@/lib/optimistic"
import { splitPresence } from "@/lib/presence"
import { channelTimeline, type Turn } from "@/lib/thread"
import { loadLastSeen, newCount, newSinceIndex, saveLastSeen, shouldSaveLastSeen, unseenEventCount } from "@/lib/readstate"
import { cn } from "@/lib/utils"
import type { ViewerAgent, ViewerEvent } from "@/shared/types"

function AgentMark({ name }: { name: string }) {
  return (
    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-control font-mono text-2xs text-ink-muted">
      {monogram(name)}
    </div>
  )
}

const DELIVERY_TITLE: Record<Delivery, string> = {
  queued: "The send request is in flight.",
  typed: "The keys reached the pane. The prompt has not appeared in the transcript yet.",
  seen: "The prompt is in the agent's transcript.",
  answered: "The agent has replied since this prompt.",
  failed: "The keys did not reach the pane.",
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_400)
        } catch {
          // Clipboard access can be denied; the text stays selectable.
        }
      }}
      className="rounded-sm p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </button>
  )
}

function UserMessage({
  event,
  agentName,
  delivery,
  error,
  pinned,
  joinsAbove,
  joinsBelow,
  onDismiss,
}: {
  event: Pick<ViewerEvent, "text" | "at" | "summary">
  agentName: string
  delivery?: Delivery
  error?: string
  pinned: boolean
  joinsAbove: boolean
  joinsBelow: boolean
  onDismiss?: () => void
}) {
  const body = event.text ?? event.summary
  const ref = useRef<HTMLDivElement | null>(null)
  const [tall, setTall] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    // Clamp height is 11rem; measure unclamped content against the same rem.
    const limit = parseFloat(getComputedStyle(document.documentElement).fontSize) * 11
    setTall(node.scrollHeight > limit + 4)
  }, [body])

  const folded = tall && !expanded

  return (
    <Message align="end" className="group/row">
      <MessageContent className="items-end gap-1">
        <Bubble variant="muted" align="end" className="max-w-[80%]">
          <BubbleContent
            className={cn(
              "rounded-lg border-0 bg-control px-3 py-3 text-[0.875rem] leading-[1.625] whitespace-pre-wrap text-ink",
              joinsAbove && "rounded-tr-sm",
              joinsBelow && "rounded-br-sm",
            )}
          >
            <div ref={ref} className={cn(folded && "xtrm-bubble-fold")}>
              {body}
            </div>
          </BubbleContent>
        </Bubble>
        {tall ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="rounded-sm px-1 text-xs text-ink-muted hover:text-ink"
          >
            {expanded ? "Show less" : "Show full message"}
          </button>
        ) : null}
        <div
          className="xtrm-meta flex items-center gap-1.5 pr-1 text-xs tabular text-ink-muted"
          data-pinned={pinned || delivery === "failed" ? "true" : undefined}
        >
          <span title={fullDate(event.at)}>{stamp(event.at)}</span>
          <span className="text-border-strong">·</span>
          <span className="max-w-40 truncate">to {agentName}</span>
          {delivery ? (
            <span
              title={DELIVERY_TITLE[delivery]}
              className={cn(delivery === "failed" && "text-danger")}
            >
              · {delivery === "failed" ? (error ?? DELIVERY_WORD.failed) : DELIVERY_WORD[delivery]}
            </span>
          ) : null}
          {delivery === "failed" && onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              dismiss
            </button>
          ) : null}
          {body ? <CopyButton text={body} label="Copy message" /> : null}
        </div>
      </MessageContent>
    </Message>
  )
}

function TurnView({
  turn,
  agent,
  session,
  pinned,
}: {
  turn: Turn
  agent: ViewerAgent | undefined
  session: string
  pinned: boolean
}) {
  const name = agent?.name ?? turn.agentName
  const status = agent?.status ?? "unknown"
  const finalText = turn.final?.text?.trim() ?? ""
  const at = turn.final?.at ?? turn.start

  return (
    <div className="viewer-turn group/row flex flex-col gap-4">
      <Message align="start" className="gap-3">
        <AgentMark name={name} />
        <MessageContent className="gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-ink">{name}</span>
            <RoleChip role={agent?.role} />
            <StatusDot status={turn.final ? status : "working"} />
          </div>

          <ActivityDisclosure turn={turn} session={session} pending={!turn.final} />

          {turn.final ? (
            finalText ? (
              <Markdown text={finalText} />
            ) : (
              <div className="text-xs text-ink-muted">
                {turn.final.stopReason === "error"
                  ? "The turn ended with an error."
                  : "The turn ended without a reply."}
              </div>
            )
          ) : null}

          {turn.final ? (
            <div
              className="xtrm-meta flex items-center gap-1.5 text-xs tabular text-ink-muted"
              data-pinned={pinned ? "true" : undefined}
            >
              <span title={fullDate(at)}>{stamp(at)}</span>
              {finalText ? <CopyButton text={finalText} label="Copy reply" /> : null}
            </div>
          ) : null}
        </MessageContent>
      </Message>
    </div>
  )
}

function DayDivider({ at }: { at: number }) {
  return (
    <div className="flex items-center justify-center">
      <span className="text-2xs tracking-wide text-ink-muted uppercase">{dayLabel(at)}</span>
    </div>
  )
}

function NewDivider({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={`${count} new since you looked`}>
      <span className="h-px flex-1 bg-accent/30" />
      <span className="text-2xs tracking-wide text-accent-ink uppercase tabular">
        New{count > 0 ? ` · ${count}` : ""}
      </span>
      <span className="h-px flex-1 bg-accent/30" />
    </div>
  )
}

export function ChannelView({
  events,
  agents,
  session,
  readKey,
  optimistic,
  onDismissOptimistic,
  hasEarlier = false,
  earlierTurns = 0,
  earlierLoading = false,
  onLoadEarlier,
}: {
  events: ViewerEvent[]
  agents: ViewerAgent[]
  session: string
  /** Stable identity of the scope: session, window id, or pane id. */
  readKey: string
  optimistic: OptimisticMessage[]
  onDismissOptimistic: (id: string) => void
  hasEarlier?: boolean
  earlierTurns?: number
  earlierLoading?: boolean
  onLoadEarlier?: () => void
}) {
  // Running turns live in the presence line above the composer (XTRM-1035): the thread shows
  // settled work, and a turn whose agent stopped shows as a stopped row.
  // Delivery reads the unsplit timeline (`channel`); rows render from the split one (`items`).
  const channel = useMemo(() => channelTimeline(events, optimistic), [events, optimistic])
  const items = useMemo(() => splitPresence(channel, agents).timeline, [channel, agents])
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const latestUsers = useMemo(() => latestUserIds(channel), [channel])

  // The scroller glides smoothly only while an agent in this thread works.
  const { setWorking, reportNew, atBottom, ready } = useMessageScroller()
  const anyWorking = agents.some((agent) => agent.status === "working")
  useEffect(() => setWorking(anyWorking), [anyWorking, setWorking])

  // Events that arrived while the reader was scrolled away from the end, for the scroll pill.
  // One turn row can carry many events, so the count is the event count, not the row count.
  const awayBase = useRef(events.length)
  useEffect(() => {
    if (atBottom) awayBase.current = events.length
    reportNew(unseenEventCount(events.length, awayBase.current, atBottom))
  }, [atBottom, events.length, reportNew])

  // "New since you looked": the baseline is the last-read time of this scope when it was opened.
  // It stays frozen for the visit, so the divider does not walk away while the reader reads.
  const [baseline] = useState(() => loadLastSeen(readKey))
  const dividerAt = newSinceIndex(items, baseline)
  const unread = newCount(items, baseline)
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  const newest = items.reduce((max, item) => Math.max(max, item.at), 0)
  useEffect(() => {
    // The scroll provider has applied (or given up on) the remembered position by now.
    if (shouldSaveLastSeen({ ready, atBottom, visible, newest })) saveLastSeen(readKey, newest)
  }, [ready, atBottom, visible, newest, readKey])

  // Rows that arrive after the first paint fade in; the rows present at mount never animate.
  const known = useRef<Set<string> | null>(null)
  const isFresh = (id: string) => known.current !== null && !known.current.has(id)
  useEffect(() => {
    if (!items.length) return
    known.current ??= new Set()
    for (const item of items) known.current.add(item.id)
  }, [items])

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <div className="text-sm text-ink-muted">No messages in this session yet.</div>
        <div className="text-xs text-ink-muted">Send a prompt below to start the thread.</div>
      </div>
    )
  }

  let lastDay = ""
  const isOperator = (index: number) =>
    index >= 0 && index < items.length && (items[index].kind === "user" || items[index].kind === "optimistic")

  return (
    <>
      {hasEarlier && onLoadEarlier ? (
        <EarlierTurns count={earlierTurns} loading={earlierLoading} onLoad={onLoadEarlier} />
      ) : null}
      {items.map((item, index) => {
        const key = dayKey(item.at)
        const divider = key !== lastDay
        lastDay = key
        const pinned = index === items.length - 1
        const joinsAbove = isOperator(index - 1) && !divider
        const joinsBelow = isOperator(index + 1)
        return (
          <MessageScrollerItem
            key={item.id}
            messageId={item.id}
            className={cn("flex flex-col gap-6", isFresh(item.id) && "xtrm-fade-in")}
          >
            {divider ? <DayDivider at={item.at} /> : null}
            {index === dividerAt ? <NewDivider count={unread} /> : null}
            {item.kind === "turn" ? (
              <TurnView
                turn={item.turn}
                agent={byId.get(item.turn.agentId)}
                session={session}
                pinned={pinned}
              />
            ) : item.kind === "stopped" ? (
              <StoppedTurn item={item} agent={byId.get(item.agentId)} session={session} />
            ) : item.kind === "user" ? (
              <UserMessage
                event={item.event}
                agentName={byId.get(item.agentId)?.name ?? item.agentName}
                delivery={latestUsers.has(item.id) ? deliveryOfUser(item, channel) : undefined}
                pinned={pinned || latestUsers.has(item.id)}
                joinsAbove={joinsAbove}
                joinsBelow={joinsBelow}
              />
            ) : item.kind === "intercom" ? (
              <IntercomCard event={item.event} />
            ) : (
              <UserMessage
                event={{ text: item.message.text, at: item.message.at, summary: item.message.text }}
                agentName={item.message.agentName}
                delivery={deliveryOfOptimistic(item.message.status)}
                error={item.message.error}
                pinned
                joinsAbove={joinsAbove}
                joinsBelow={joinsBelow}
                onDismiss={() => onDismissOptimistic(item.message.id)}
              />
            )}
          </MessageScrollerItem>
        )
      })}
    </>
  )
}
