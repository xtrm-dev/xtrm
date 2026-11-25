import type { ReactNode } from "react"

import { CodeBlock } from "@/components/CodeBlock"
import { Markdown } from "@/components/Markdown"
import type { ViewerEvent, ViewerPart } from "@/shared/types"
import { cn } from "@/lib/utils"

function pretty(value: string | undefined): string {
  if (!value) return ""
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function Thinking({ part }: { part: ViewerPart }) {
  if (!part.text) return null
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-ink-faint hover:text-ink-muted">Thought</summary>
      <div className="scrollbar-thin mt-1 max-h-64 overflow-auto rounded-md bg-surface/40 px-3 py-2 whitespace-pre-wrap text-ink-muted">
        {part.text}
      </div>
    </details>
  )
}

function Part({ part }: { part: ViewerPart }) {
  if (part.type === "thinking") return <Thinking part={part} />
  if (part.type === "tool-call") {
    return (
      <div className="mt-1">
        <div className="font-mono text-2xs text-ink-faint">{part.toolName}</div>
        {part.input ? <CodeBlock text={pretty(part.input)} /> : null}
      </div>
    )
  }
  if (part.type === "text" && part.text) return <Markdown text={part.text} />
  return null
}

export function EventBody({ event, className }: { event: ViewerEvent; className?: string }) {
  let body: ReactNode = null

  if (event.kind === "user") {
    body = <div className="whitespace-pre-wrap text-ink">{event.text ?? event.summary}</div>
  } else if (event.kind === "assistant") {
    body = event.parts?.length ? (
      <div className="flex flex-col gap-1">
        {event.parts.map((part, index) => (
          <Part key={`${part.type}:${part.toolCallId ?? index}`} part={part} />
        ))}
      </div>
    ) : (
      <Markdown text={event.text ?? event.summary} />
    )
  } else if (event.kind === "tool-result") {
    body = (
      <div>
        <div className="flex items-center gap-2 text-2xs text-ink-faint">
          <span className="font-mono">{event.toolName ?? "tool"}</span>
          <span>{event.isError ? "failed" : "result"}</span>
        </div>
        {event.output ? (
          <CodeBlock text={event.output} tone={event.isError ? "error" : "default"} />
        ) : (
          <div className="mt-1 text-xs text-ink-faint">No output</div>
        )}
      </div>
    )
  } else if (event.kind === "bash") {
    body = (
      <div>
        {event.input ? <CodeBlock text={event.input} /> : null}
        {event.output ? <CodeBlock text={event.output} tone={event.isError ? "error" : "default"} /> : null}
      </div>
    )
  } else if (event.intercoms?.length) {
    body = (
      <div className="flex flex-col gap-4">
        {event.intercoms.map((meta, index) => (
          <div key={meta.toolCallId ?? index} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2 text-2xs text-ink-faint">
              <span className="font-medium text-ink">{meta.from}</span>
              <span>→</span>
              <span className="text-ink-muted">{meta.to}</span>
              <span>{meta.direction}</span>
              {meta.expectsReply ? <span className="text-accent">reply requested</span> : null}
            </div>
            <Markdown text={meta.body} />
            {meta.failed && meta.error ? (
              <div className="text-2xs text-danger">{meta.error}</div>
            ) : null}
            <div className="flex flex-wrap gap-x-3 text-2xs text-ink-faint">
              {meta.failed ? (
                <span className="text-danger">failed</span>
              ) : meta.delivery ? (
                <span>{meta.delivery}</span>
              ) : null}
              {meta.messageId ? <span className="font-mono">{meta.messageId}</span> : null}
              {meta.runtime ? <span>{meta.runtime}</span> : null}
            </div>
          </div>
        ))}
      </div>
    )
  } else if (event.kind === "intercom" && event.intercom) {
    const meta = event.intercom
    body = (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 text-2xs text-ink-faint">
          <span className="font-medium text-ink">{meta.from}</span>
          <span>→</span>
          <span className="text-ink-muted">{meta.to}</span>
          <span className="uppercase tracking-wide">{meta.direction}</span>
          {meta.expectsReply ? <span className="text-accent">reply requested</span> : null}
        </div>
        <Markdown text={meta.body || event.text || event.summary} />
        {meta.failed && meta.error ? (
          <div className="text-2xs text-danger">{meta.error}</div>
        ) : null}
        <div className="flex flex-wrap gap-x-3 text-2xs text-ink-faint">
          {meta.failed ? (
            <span className="text-danger">failed</span>
          ) : meta.delivery ? (
            <span>{meta.delivery}</span>
          ) : null}
          {meta.messageId ? <span className="font-mono">{meta.messageId}</span> : null}
          {meta.runtime ? <span>{meta.runtime}</span> : null}
        </div>
      </div>
    )
  } else if (event.kind === "notice" || event.kind === "compaction") {
    body = event.text ? (
      <div className="scrollbar-thin max-h-96 overflow-auto whitespace-pre-wrap text-ink-muted">{event.text}</div>
    ) : (
      <div className="text-ink-muted">{event.summary}</div>
    )
  } else {
    body = <div className="text-ink-muted">{event.text ?? event.summary}</div>
  }

  return (
    <div className={cn("flex flex-col gap-2 text-xs", className)}>
      {body}
      {event.stopReason ? <div className="text-2xs text-ink-faint">stop reason: {event.stopReason}</div> : null}
      {event.raw ? (
        <details>
          <summary className="cursor-pointer text-2xs text-ink-faint hover:text-ink-muted">Raw event</summary>
          <CodeBlock text={event.raw} className="max-h-96" />
        </details>
      ) : null}
    </div>
  )
}
