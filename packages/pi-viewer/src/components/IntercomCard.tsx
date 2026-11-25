import { ArrowRightIcon } from "lucide-react"

import { Markdown } from "@/components/Markdown"
import { clock, monogram } from "@/lib/format"
import type { ViewerEvent } from "@/shared/types"
import { cn } from "@/lib/utils"

/**
 * A peer message is a dispatch, not a chat bubble. The hairline rail and the
 * from → to line make it scannable next to an agent's answer.
 */
export function IntercomCard({
  event,
  className,
}: {
  event: ViewerEvent
  className?: string
}) {
  const meta = event.intercom
  if (!meta) return null
  const sent = meta.direction === "sent"
  const body = meta.body || event.text || event.summary
  const delivery =
    meta.delivery && meta.delivery !== (sent ? "sent" : "received") ? meta.delivery : null
  const hasFooter = Boolean(delivery || meta.messageId || meta.runtime)

  return (
    <div className={cn("flex gap-3", className)} data-slot="intercom-card">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-control font-mono text-2xs text-ink-muted">
        {monogram(meta.from)}
      </div>
      <div className="min-w-0 flex-1 rounded-md bg-surface/70 py-2.5 pr-3 pl-3.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-xs font-medium text-ink">{meta.from}</span>
          <ArrowRightIcon className="size-3 shrink-0 self-center text-ink-faint" aria-hidden />
          <span className="truncate text-xs text-ink-muted">{meta.to}</span>
          <time className="ml-auto shrink-0 text-2xs text-ink-faint">{clock(event.at)}</time>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs tracking-wide text-ink-faint uppercase">
          <span>Agent message</span>
          <span className="text-border-strong">·</span>
          <span>{sent ? "sent" : "received"}</span>
          {meta.expectsReply ? (
            <>
              <span className="ml-1 size-1.5 rounded-full bg-accent" aria-hidden />
              <span className="text-accent">reply requested</span>
            </>
          ) : null}
        </div>

        <div className="mt-1.5">
          <Markdown text={body} />
        </div>

        {hasFooter ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-faint">
            {delivery ? <span>{delivery}</span> : null}
            {meta.messageId ? (
              <span className="font-mono" title={meta.messageId}>
                {meta.messageId.slice(0, 8)}
              </span>
            ) : null}
            {meta.runtime ? <span>{meta.runtime}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
