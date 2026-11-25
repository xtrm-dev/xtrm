import { ActivityDisclosure } from "@/components/ActivityDisclosure"
import { StatusDot } from "@/components/StatusDot"
import { Message, MessageContent } from "@/components/ui/message"
import { clock, monogram } from "@/lib/format"
import type { StoppedItem } from "@/lib/presence"
import type { ViewerAgent } from "@/shared/types"

/**
 * A turn that never settled because its agent stopped (interrupted, aborted, failed, gone).
 * It sits in the thread at its last activity, reads as finished, and keeps its steps (§3.6).
 */
export function StoppedTurn({
  item,
  agent,
  session,
}: {
  item: StoppedItem
  agent: ViewerAgent | undefined
  session: string
}) {
  const name = agent?.name ?? item.agentName
  return (
    <div className="viewer-turn flex flex-col gap-4" data-presence-stopped="">
      <Message align="start" className="gap-3">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-control font-mono text-2xs text-ink-muted">
          {monogram(name)}
        </div>
        <MessageContent className="gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-ink">{name}</span>
            <StatusDot status={agent?.status ?? "unknown"} />
            <span className="shrink-0 text-2xs text-ink-faint">{clock(item.at)}</span>
          </div>
          <div className="text-xs text-ink-faint">Stopped without a reply · {item.note}</div>
          <ActivityDisclosure turn={item.turn} session={session} pending={false} />
        </MessageContent>
      </Message>
    </div>
  )
}
