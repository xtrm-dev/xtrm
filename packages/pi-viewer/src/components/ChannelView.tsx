import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Icon } from "@/shell/icon"
import { ActivityDisclosure } from "@/components/ActivityDisclosure"
import { EarlierTurns } from "@/components/EarlierTurns"
import { FoldToggle } from "@/components/FoldToggle"
import { IntercomCard } from "@/components/IntercomCard"
import { Markdown } from "@/components/Markdown"
import { RoleChip } from "@/components/RoleChip"
import { StatusDot } from "@/components/StatusDot"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { StoppedTurn } from "@/components/presence/StoppedTurn"
import { MessageScrollerItem, useMessageScroller } from "@/components/ui/message-scroller"
import { DELIVERY_WORD, deliveryOfOptimistic, deliveryOfUser, latestReplyAt, latestUserIds, type Delivery } from "@/lib/delivery"
import { dayKey, dayLabel, fullDate, monogram, stamp } from "@/lib/format"
import type { OptimisticMessage } from "@/lib/optimistic"
import { splitPresence } from "@/lib/presence"
import { replyAvailability, replyLabel, replyTitle } from "@/lib/reply"
import { channelTimeline, type Turn } from "@/lib/thread"
import { migrateLastSeen, newCount, newSinceIndex, saveLastSeen, shouldSaveLastSeen, unseenTimelineItems } from "@/lib/readstate"
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
  queued: "Sending: the send request is in flight.",
  typed: "Sent: the keys reached the pane. The prompt has not appeared in the transcript yet.",
  seen: "Seen: the prompt is in the agent's transcript.",
  answered: "Replied: the agent has replied since this prompt.",
  failed: "Not sent: the keys did not reach the pane.",
}

/**
 * The delivery state of the operator's newest message as a mark, not a word (operator, 2026-11-26):
 * a spinner while sending, one check when sent, two checks when seen, two accent checks when the agent
 * replied. The word stays as the accessible name and the tooltip. A failure keeps its reason as text
 * beside a danger mark, because the reason is what the operator needs to read.
 */
function DeliveryMark({ delivery, error }: { delivery: Delivery; error?: string }) {
  const title = DELIVERY_TITLE[delivery]
  if (delivery === "failed") {
    return (
      <span title={title} className="flex min-w-0 shrink items-center gap-1 text-danger">
        <Icon name="circleX" size="text" className="shrink-0" />
        <span className="min-w-0 truncate">{error ?? DELIVERY_WORD.failed}</span>
      </span>
    )
  }
  const icon = delivery === "queued" ? "loader" : delivery === "typed" ? "check" : "checkCheck"
  return (
    <span
      role="img"
      aria-label={DELIVERY_WORD[delivery]}
      title={title}
      data-delivery={delivery}
      className={cn("flex shrink-0 items-center", delivery === "answered" ? "text-accent-ink" : "text-ink-muted")}
    >
      <Icon
        name={icon}
        size="text"
        className={cn(delivery === "queued" && "animate-spin motion-reduce:animate-none")}
      />
    </span>
  )
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
      className="shrink-0 rounded-sm p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
    >
      <Icon name={copied ? "check" : "copy"} size="text" />
    </button>
  )
}

export function ReplyButton({
  agent,
  name,
  onReply,
}: {
  agent: ViewerAgent | undefined
  name: string
  onReply: (agent: ViewerAgent) => void
}) {
  const availability = replyAvailability(agent)
  return (
    <button
      type="button"
      aria-label={replyLabel(name)}
      title={replyTitle(availability)}
      disabled={availability === "gone"}
      onClick={() => {
        if (agent) onReply(agent)
      }}
      className="shrink-0 rounded-sm p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
    >
      <Icon name="reply" size="text" />
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
            data-fold-host="user"
            className={cn(
              "rounded-lg border-0 bg-control px-3 py-3 text-[0.875rem] leading-[1.625] whitespace-pre-wrap text-read",
              joinsAbove && "rounded-tr-sm",
              joinsBelow && "rounded-br-sm",
            )}
          >
            <div ref={ref} className={cn(folded && "xtrm-bubble-fold xtrm-fold-fade")}>
              {body}
            </div>
            {tall ? <FoldToggle className="mt-2" expanded={expanded} onToggle={() => setExpanded((value) => !value)} /> : null}
          </BubbleContent>
        </Bubble>
        {/* One line at any width (XTRM-1047): time, recipient or delivery, Reply, Copy, right aligned. The fold
            control lives inside the bubble (XTRM-1055). Labels truncate; nothing wraps. */}
        <div
          data-action-row="user"
          className="flex w-full min-w-0 items-center justify-end gap-2 text-xs whitespace-nowrap"
        >
          {/* Time and recipient reveal on hover (pinned on the newest message); the delivery mark stays
              visible at rest on every sent message, as in a chat app (operator, 2026-11-26). */}
          <div
            className="xtrm-meta ml-auto flex min-w-0 items-center gap-1.5 tabular text-ink-muted"
            data-pinned={pinned || Boolean(delivery) ? "true" : undefined}
          >
            <span className="shrink-0" title={fullDate(event.at)}>
              {stamp(event.at)}
            </span>
            <span className="shrink-0 text-border-strong">·</span>
            <span className="min-w-0 truncate">to {agentName}</span>
            {delivery && delivery !== "failed" ? <DeliveryMark delivery={delivery} /> : null}
          </div>
          {delivery === "failed" ? <DeliveryMark delivery={delivery} error={error} /> : null}
          {delivery === "failed" && onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              dismiss
            </button>
          ) : null}
          {body ? (
            <div
              className="xtrm-meta flex shrink-0 items-center pr-1"
              data-pinned={pinned || delivery === "failed" ? "true" : undefined}
            >
              <CopyButton text={body} label="Copy message" />
            </div>
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
  pinned,
  onReply,
}: {
  turn: Turn
  agent: ViewerAgent | undefined
  session: string
  pinned: boolean
  onReply?: (agent: ViewerAgent) => void
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
              data-action-row="agent"
              className="xtrm-meta flex min-w-0 items-center gap-1.5 text-xs tabular whitespace-nowrap text-ink-muted"
              data-pinned={pinned ? "true" : undefined}
            >
              <span className="shrink-0" title={fullDate(at)}>
                {stamp(at)}
              </span>
              {onReply ? <ReplyButton agent={agent} name={name} onReply={onReply} /> : null}
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
      <span className="h-px flex-1 bg-border" />
      <span className="text-2xs tracking-wide text-ink-muted uppercase tabular">
        New{count > 0 ? ` · ${count}` : ""}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export function ChannelView({
  events,
  agents,
  session,
  readKey,
  legacyReadKeys = [],
  optimistic,
  onDismissOptimistic,
  hasEarlier = false,
  earlierTurns = 0,
  earlierLoading = false,
  onLoadEarlier,
  onReply,
}: {
  events: ViewerEvent[]
  agents: ViewerAgent[]
  session: string
  /** Stable identity of the scope, prefixed with the tmux server id. */
  readKey: string
  /** Pre-migration keys (server-less scope key, old session:agentIds key). */
  legacyReadKeys?: string[]
  optimistic: OptimisticMessage[]
  onDismissOptimistic: (id: string) => void
  hasEarlier?: boolean
  earlierTurns?: number
  earlierLoading?: boolean
  onLoadEarlier?: () => void
  /** Aims the composer at an agent and focuses it (XTRM-1045). Absent: no Reply action. */
  onReply?: (agent: ViewerAgent) => void
}) {
  // Running turns live in the presence line above the composer (XTRM-1035): the thread shows
  // settled work, and a turn whose agent stopped shows as a stopped row.
  // Delivery reads the unsplit timeline (`channel`); rows render from the split one (`items`).
  const channel = useMemo(() => channelTimeline(events, optimistic), [events, optimistic])
  const items = useMemo(() => splitPresence(channel, agents).timeline, [channel, agents])
  const newest = useMemo(() => items.reduce((max, item) => Math.max(max, item.at), 0), [items])
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const latestUsers = useMemo(() => latestUserIds(channel), [channel])
  const replyTimes = useMemo(() => latestReplyAt(channel), [channel])

  // The scroller glides smoothly only while an agent in this thread works.
  const { setWorking, reportNew, atBottom, ready } = useMessageScroller()
  const anyWorking = agents.some((agent) => agent.status === "working")
  useEffect(() => setWorking(anyWorking), [anyWorking, setWorking])

  // Rows that arrived while the reader was scrolled away from the end, for the scroll pill.
  // Only rows after the leave point count: a "Load earlier" prepend is older, not new.
  const seenIds = useRef<Set<string>>(new Set(items.map((item) => item.id)))
  const leftAt = useRef(newest)
  const wasAtBottom = useRef(atBottom)
  useEffect(() => {
    if (atBottom) {
      seenIds.current = new Set(items.map((item) => item.id))
      reportNew(0)
    } else {
      if (wasAtBottom.current) leftAt.current = newest
      reportNew(unseenTimelineItems(items, seenIds.current, leftAt.current, atBottom))
    }
    wasAtBottom.current = atBottom
  }, [atBottom, items, newest, reportNew])

  // "New since you looked": the baseline is the last-read time of this scope when it was opened.
  // It stays frozen for the visit, so the divider does not walk away while the reader reads.
  const [baseline] = useState(() => migrateLastSeen(readKey, legacyReadKeys))
  const dividerAt = newSinceIndex(items, baseline)
  const unread = newCount(items, baseline)
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
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
                onReply={onReply}
              />
            ) : item.kind === "stopped" ? (
              <StoppedTurn item={item} agent={byId.get(item.agentId)} session={session} />
            ) : item.kind === "user" ? (
              <UserMessage
                event={item.event}
                agentName={byId.get(item.agentId)?.name ?? item.agentName}
                delivery={deliveryOfUser(item, replyTimes)}
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
