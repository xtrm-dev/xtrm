import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { ActivityRow } from "@/components/ActivityDisclosure"
import { formatElapsed } from "@/lib/elapsed"
import { Elapsed } from "@/lib/ticker"
import { StatusDot, statusWord } from "@/components/StatusDot"
import { clockWithSeconds } from "@/lib/format"
import type { PresenceEntry } from "@/lib/presence"
import { stepCount, toolCount } from "@/lib/thread"

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-2xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate text-xs text-ink-muted">{children}</dd>
    </>
  )
}

/** The cwd shortened from the left, so the project end of the path stays visible. */
function shortPath(path: string, limit = 52): string {
  if (path.length <= limit) return path
  const parts = path.split("/")
  let tail = parts.pop() ?? ""
  while (parts.length && tail.length + parts[parts.length - 1].length + 1 <= limit - 2) {
    tail = `${parts.pop()}/${tail}`
  }
  return `…/${tail}`
}

/**
 * One agent's live turn inside the presence panel (§3.4): actions, metadata, the request the
 * agent waits on (read-only: no key is ever sent from here), and the live activity list.
 */
export function PresenceDetail({
  entry,
  settled,
  session,
  onBack,
  onMessage,
  onOpenPane,
  onShowReply,
  onKeyDown,
}: {
  entry: PresenceEntry
  /** Set when the agent left presence while its detail was open: the turn settled or stopped. */
  settled: { at: number } | null
  session: string
  onBack: () => void
  onMessage: () => void
  onOpenPane: () => void
  onShowReply: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const { agent, turn } = entry
  const backRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    backRef.current?.focus()
  }, [entry.agentId])

  // The activity list follows the newest step unless the operator scrolled it up.
  const count = turn?.activity.length ?? 0
  useLayoutEffect(() => {
    const node = listRef.current
    if (node && followRef.current) node.scrollTop = node.scrollHeight
  }, [count])

  const failed = turn?.activity.filter((item) => item.isError).length ?? 0
  const steps = turn ? stepCount(turn) : 0
  const tools = turn ? toolCount(turn) : 0
  const last = turn?.activity.at(-1)
  const running = !settled && last && (last.kind === "tool" || last.kind === "bash") && !last.result

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 px-1 pb-1">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label="Back to the agent list"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-hover hover:text-ink-muted focus-visible:bg-hover focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="min-w-0 truncate text-xs font-medium text-ink" title={agent.name}>
          {agent.name}
        </span>
        <StatusDot status={settled ? "waiting" : agent.status} />
        <span className="shrink-0 text-2xs text-ink-faint">
          {settled ? "settled" : statusWord(agent.status)}
        </span>
        <span className="flex-1" />
        {settled ? (
          <button
            type="button"
            onClick={onShowReply}
            className="rounded-md px-2 py-1 text-2xs text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-none"
          >
            Show reply
          </button>
        ) : null}
        <button
          type="button"
          onClick={onMessage}
          className="rounded-md px-2 py-1 text-2xs text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-none"
        >
          Message
        </button>
        <button
          type="button"
          onClick={onOpenPane}
          className="rounded-md px-2 py-1 text-2xs text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-none"
        >
          Open pane
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto px-2 pb-1">
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-1.5">
          <Row label="Status">
            {settled
              ? `settled${entry.start ? ` · ${formatElapsed(settled.at - entry.start)}` : ""}`
              : `${statusWord(agent.status)}${agent.statusNote ? ` · ${agent.statusNote}` : ""}`}
          </Row>
          <Row label="Turn">
            {entry.start ? (
              <>
                started {clockWithSeconds(entry.start)}
                {settled ? null : (
                  <>
                    {" · "}
                    <Elapsed start={entry.start} />
                  </>
                )}
              </>
            ) : (
              "Working…"
            )}
          </Row>
          {turn ? (
            <Row label="Steps">
              {`${steps} ${steps === 1 ? "step" : "steps"} · ${tools} ${tools === 1 ? "tool" : "tools"}`}
              {failed ? <span className="text-danger">{` · ${failed} failed`}</span> : null}
            </Row>
          ) : null}
          {agent.model ? (
            <Row label="Model">{agent.thinkingLevel ? `${agent.model} · thinking ${agent.thinkingLevel}` : agent.model}</Row>
          ) : null}
          <Row label="Place">{`${agent.tmuxSession} · window ${agent.windowIndex} · pane ${agent.paneId}`}</Row>
          <Row label="Directory">
            <span className="font-mono text-2xs" title={agent.cwd}>
              {shortPath(agent.cwd)}
            </span>
          </Row>
        </dl>

        {entry.status === "attention" && !settled ? (
          <section aria-label="Pending request" className="mt-1 rounded-md bg-control px-2.5 py-2">
            <div className="text-2xs text-ink-faint">
              Waiting for you{entry.note ? ` · ${entry.note}` : ""} · answer it in the agent's pane
            </div>
            {entry.detail ? (
              <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-2xs whitespace-pre-wrap text-ink-muted">
                {entry.detail}
              </pre>
            ) : null}
          </section>
        ) : null}

        {turn && turn.activity.length ? (
          <div className="mt-2">
            <div className="px-0.5 pb-1 text-2xs text-ink-faint">
              Activity{running ? <span className="xtrm-shimmer"> · running</span> : null}
            </div>
            <div
              ref={listRef}
              onScroll={(event) => {
                const node = event.currentTarget
                followRef.current = node.scrollTop + node.clientHeight >= node.scrollHeight - 4
              }}
              className="trace-rail flex max-h-64 flex-col overflow-y-auto"
            >
              {turn.activity.map((item) => (
                <ActivityRow
                  key={item.key}
                  item={item}
                  turn={turn}
                  session={session}
                  expanded={expanded.has(item.key)}
                  onToggle={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous)
                      if (next.has(item.key)) next.delete(item.key)
                      else next.add(item.key)
                      return next
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
