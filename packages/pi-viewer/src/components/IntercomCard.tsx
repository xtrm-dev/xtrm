import { useId, useLayoutEffect, useRef, useState } from "react"
import { ArrowRightIcon, ChevronDownIcon, CircleCheckIcon, CircleXIcon } from "lucide-react"

import { Markdown } from "@/components/Markdown"
import { clock, monogram } from "@/lib/format"
import type { ViewerEvent } from "@/shared/types"
import { cn } from "@/lib/utils"

/** Three rendered lines at the .xtrm-prose line-height. */
const COLLAPSED_HEIGHT = 3 * 25.6

function IntercomBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()

  useLayoutEffect(() => {
    const element = bodyRef.current
    if (!element) return
    const measure = () => setCanExpand(element.scrollHeight > COLLAPSED_HEIGHT + 2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  return (
    <div>
      <div
        id={bodyId}
        className="relative overflow-hidden"
        style={!expanded ? { maxHeight: COLLAPSED_HEIGHT } : undefined}
        data-slot="intercom-body"
      >
        <div ref={bodyRef}>
          <Markdown text={text} />
        </div>
        {!expanded && canExpand ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface/70 to-transparent"
            aria-hidden
          />
        ) : null}
      </div>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 flex items-center gap-1 rounded-sm text-2xs text-ink-muted transition-colors hover:text-ink"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDownIcon
            className={cn("size-3 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  )
}

/**
 * A peer message is a dispatch, not a chat bubble. The from → to line and a
 * small delivery mark make it scannable next to an agent's answer.
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
  const body = meta.body?.trim() || event.text?.trim() || "(empty message)"
  const delivery = meta.delivery?.trim() || undefined
  const error = meta.error?.trim() || undefined
  const failed = meta.failed === true || delivery === "failed"
  const delivered =
    delivery === "delivered" ||
    delivery === "received" ||
    Boolean(delivery?.startsWith("injected"))
  const status = failed ? "failed" : delivered ? "delivered" : sent ? "sent" : "received"
  const statusLabel =
    status === "failed"
      ? error
        ? `Delivery failed: ${error}`
        : "Delivery failed"
      : status === "delivered"
        ? "Delivered"
        : sent
          ? "Sent"
          : "Received"
  const hasFooter = Boolean(failed || meta.expectsReply || meta.messageId || meta.runtime)

  return (
    <div className={cn("flex gap-3", className)} data-slot="intercom-card">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-control font-mono text-2xs text-ink-muted">
        {monogram(meta.from)}
      </div>
      <div className="min-w-0 flex-1 rounded-md bg-surface/70 py-2.5 pr-3 pl-3.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-xs font-medium text-ink">{meta.from}</span>
          <ArrowRightIcon className="size-3 shrink-0 self-center text-ink-muted" aria-hidden />
          <span className="truncate text-xs text-ink-muted">{meta.to}</span>
          {failed ? (
            <CircleXIcon
              className="size-3 shrink-0 self-center text-danger"
              role="img"
              aria-label={statusLabel}
            >
              <title>{statusLabel}</title>
            </CircleXIcon>
          ) : (
            <CircleCheckIcon
              className={cn(
                "size-3 shrink-0 self-center",
                delivered ? "text-success" : "text-ink-muted",
              )}
              role="img"
              aria-label={statusLabel}
            >
              <title>{statusLabel}</title>
            </CircleCheckIcon>
          )}
          <time className="ml-auto shrink-0 text-2xs text-ink-muted">{clock(event.at)}</time>
        </div>

        <div className="mt-1.5">
          <IntercomBody text={body} />
        </div>

        {failed ? <div className="mt-1.5 text-2xs text-danger">{statusLabel}</div> : null}

        {hasFooter ? (
          <div className="mt-2 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-muted">
              {meta.expectsReply ? (
                <span className="flex items-center gap-1 text-accent">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  reply requested
                </span>
              ) : null}
              {meta.messageId ? (
                <span className="font-mono" title={meta.messageId}>
                  {meta.messageId.slice(0, 8)}
                </span>
              ) : null}
              {meta.runtime ? <span>{meta.runtime}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
