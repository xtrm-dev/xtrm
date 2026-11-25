import { ChevronUpIcon, ChevronRightIcon } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"

import { Elapsed } from "@/lib/ticker"
import { PresenceDetail } from "@/components/presence/PresenceDetail"
import { StatusDot } from "@/components/StatusDot"
import { monogram } from "@/lib/format"
import { currentStep, presenceAnnouncement, presenceLine, type PresenceEntry } from "@/lib/presence"
import { cn } from "@/lib/utils"
import type { ViewerAgent } from "@/shared/types"

/** Below the `sm` breakpoint the panel is a bottom sheet (§3.10). */
function useNarrow(): boolean {
  const query = "(max-width: 639px)"
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setNarrow(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return narrow
}

function Mark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md bg-control font-mono text-[0.625rem] leading-none text-ink-muted ring-2 ring-deep",
        className,
      )}
    >
      {monogram(name)}
    </span>
  )
}

function Marks({ entries }: { entries: PresenceEntry[] }) {
  const shown = entries.slice(0, 3)
  const more = entries.length - shown.length
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((entry, index) => (
        <Mark key={entry.agentId} name={entry.name} className={index ? "-ml-1" : undefined} />
      ))}
      {more > 0 ? <span className="ml-1.5 text-2xs text-ink-faint tabular-nums">+{more}</span> : null}
    </span>
  )
}

type View = { kind: "list" } | { kind: "detail"; agentId: string }

/**
 * The working presence line (design §3): one fixed-height row above the composer, outside the
 * scroller, reserved even when nothing runs. It opens a panel (desktop) or a bottom sheet
 * (mobile) with the running agents and, one step further, one agent's live turn.
 *
 * Presence never sends a key to an agent (operator ruling, XTRM-1035): it only shows.
 */
export function PresenceLine({
  entries,
  session,
  onMessage,
  onOpenPane,
}: {
  entries: PresenceEntry[]
  session: string
  onMessage: (agent: ViewerAgent) => void
  onOpenPane: (agent: ViewerAgent) => void
}) {
  const narrow = useNarrow()
  const panelId = useId()
  const lineRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ kind: "list" })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const pushed = useRef(false)

  const line = useMemo(() => presenceLine(entries), [entries])
  const count = entries.length
  const attention = entries.some((entry) => entry.status === "attention")

  // The last seen entry of each agent, so a detail stays readable after its turn settles.
  const lastSeen = useRef(new Map<string, PresenceEntry>())
  const settledAt = useRef(new Map<string, number>())
  for (const entry of entries) {
    lastSeen.current.set(entry.agentId, entry)
    settledAt.current.delete(entry.agentId)
  }

  // Announce membership changes only (§3.9), never the ticking time.
  const previous = useRef<PresenceEntry[]>([])
  useEffect(() => {
    const words = presenceAnnouncement(previous.current, entries)
    previous.current = entries
    if (words) setAnnouncement(words)
  }, [entries])

  function closePanel(returnFocus = true) {
    setOpen(false)
    setView({ kind: "list" })
    if (pushed.current) {
      pushed.current = false
      window.history.back()
    }
    if (returnFocus) lineRef.current?.focus()
  }

  // After the sheet's history entry is popped, run a follow-up action (Open pane pushes its own).
  function closeThen(action: () => void) {
    if (pushed.current) {
      pushed.current = false
      setOpen(false)
      setView({ kind: "list" })
      const after = () => {
        window.removeEventListener("popstate", after)
        action()
      }
      window.addEventListener("popstate", after)
      window.history.back()
      return
    }
    closePanel(false)
    action()
  }

  function openPanel() {
    if (!count) return
    setOpen(true)
    setView({ kind: "list" })
    setFocusId(entries[0]?.agentId ?? null)
    if (narrow) {
      window.history.pushState({ presenceSheet: true }, "", window.location.href)
      pushed.current = true
    }
  }

  // The system back gesture closes the sheet.
  useEffect(() => {
    if (!open) return
    const onPop = () => {
      if (!pushed.current) return
      pushed.current = false
      setOpen(false)
      setView({ kind: "list" })
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [open])

  // A click outside the panel closes it (desktop; the sheet has its scrim).
  useEffect(() => {
    if (!open || narrow) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePanel(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  })

  // Nothing left to show: the panel closes, unless a detail is open on a turn that just settled.
  useEffect(() => {
    if (open && !count && view.kind === "list") closePanel(false)
  })

  // Roving focus inside the list.
  useEffect(() => {
    if (!open || view.kind !== "list" || !focusId) return
    rowRefs.current.get(focusId)?.focus()
  }, [open, view, focusId])

  const detailEntry =
    view.kind === "detail"
      ? (entries.find((entry) => entry.agentId === view.agentId) ?? lastSeen.current.get(view.agentId) ?? null)
      : null
  const detailSettled =
    view.kind === "detail" && detailEntry && !entries.some((entry) => entry.agentId === view.agentId)
  if (detailSettled && !settledAt.current.has(view.agentId)) settledAt.current.set(view.agentId, Date.now())

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const ids = entries.map((entry) => entry.agentId)
    const at = Math.max(0, ids.indexOf(focusId ?? ""))
    if (event.key === "ArrowDown") setFocusId(ids[Math.min(ids.length - 1, at + 1)])
    else if (event.key === "ArrowUp") setFocusId(ids[Math.max(0, at - 1)])
    else if (event.key === "Home") setFocusId(ids[0])
    else if (event.key === "End") setFocusId(ids[ids.length - 1])
    else if (event.key === "ArrowRight" && focusId) setView({ kind: "detail", agentId: focusId })
    else if (event.key === "Escape") closePanel()
    else return
    event.preventDefault()
  }

  function onDetailKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA"
    if (event.key === "Escape") closePanel()
    else if (!typing && (event.key === "ArrowLeft" || event.key === "Backspace")) backToList()
    else return
    event.preventDefault()
  }

  function backToList() {
    const id = view.kind === "detail" ? view.agentId : null
    setView({ kind: "list" })
    if (id && entries.some((entry) => entry.agentId === id)) setFocusId(id)
    else setFocusId(entries[0]?.agentId ?? null)
    if (!count) closePanel()
  }

  function showReply(entry: PresenceEntry) {
    const id = entry.turn ? `turn:${entry.turn.id}` : null
    closeThen(() => {
      if (!id) return
      const node = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
      node?.scrollIntoView({ block: "end", behavior: "smooth" })
    })
  }

  const list = (
    <div role="listbox" aria-label="Running agents" onKeyDown={onListKey} className="flex flex-col">
      <div className="flex items-center justify-between px-2 pt-0.5 pb-1">
        <span className="text-2xs text-ink-faint">
          Working · {count}
        </span>
        <button
          type="button"
          onClick={() => closePanel()}
          className="rounded-md px-1.5 py-0.5 text-2xs text-ink-faint hover:bg-hover hover:text-ink-muted"
        >
          Close
        </button>
      </div>
      <div className={cn("overflow-y-auto", narrow ? "max-h-[calc(75dvh-3rem)]" : "max-h-[calc(1.75rem+6*2rem)]")}>
        {entries.map((entry) => {
          const step = entry.status === "quiet" ? null : currentStep(entry.turn)
          return (
            <button
              key={entry.agentId}
              ref={(node) => {
                if (node) rowRefs.current.set(entry.agentId, node)
                else rowRefs.current.delete(entry.agentId)
              }}
              type="button"
              role="option"
              aria-selected={entry.agentId === focusId}
              tabIndex={entry.agentId === focusId ? 0 : -1}
              title={entry.agent.name}
              onFocus={() => setFocusId(entry.agentId)}
              onClick={() => setView({ kind: "detail", agentId: entry.agentId })}
              className={cn(
                "presence-in flex w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover focus-visible:bg-pressed focus-visible:outline-none",
                narrow ? "min-h-11 py-1" : "h-8",
              )}
            >
              <StatusDot status={entry.status} />
              <Mark name={entry.name} className="ring-0" />
              <span className={cn("flex min-w-0 flex-1", narrow ? "flex-col" : "items-center gap-2")}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs text-ink">{entry.name}</span>
                  {entry.agent.role && !narrow ? (
                    <span className="shrink-0 text-2xs text-ink-faint">{entry.agent.role}</span>
                  ) : null}
                </span>
                <span className="min-w-0 truncate text-2xs text-ink-faint">
                  {entry.status === "attention"
                    ? `needs you · ${entry.note ?? "waiting"}`
                    : [narrow ? entry.agent.role : null, step].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-2xs text-ink-faint tabular-nums">
                {entry.status === "quiet" ? (
                  (entry.note?.replace(/^no output for /, "quiet ") ?? "quiet")
                ) : entry.start ? (
                  <Elapsed start={entry.start} />
                ) : (
                  "Working…"
                )}
              </span>
              <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-ink-faint" />
            </button>
          )
        })}
      </div>
    </div>
  )

  const body =
    view.kind === "detail" && detailEntry ? (
      <PresenceDetail
        entry={detailEntry}
        settled={detailSettled ? { at: settledAt.current.get(view.agentId) ?? Date.now() } : null}
        session={session}
        onBack={backToList}
        onKeyDown={onDetailKey}
        onMessage={() => closeThen(() => onMessage(detailEntry.agent))}
        onOpenPane={() => closeThen(() => onOpenPane(detailEntry.agent))}
        onShowReply={() => showReply(detailEntry)}
      />
    ) : (
      list
    )

  return (
    <div ref={rootRef} className="relative mx-auto w-full max-w-3xl">
      {open && !narrow ? (
        <div
          id={panelId}
          className="absolute right-0 bottom-full left-0 z-30 mb-1 flex max-h-[60vh] flex-col rounded-lg bg-raised p-1 shadow-float"
        >
          {body}
        </div>
      ) : null}
      {open && narrow ? (
        <div className="fixed inset-0 z-40">
          <div aria-hidden className="absolute inset-0 bg-deep/60" onClick={() => closePanel()} />
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Running agents"
            className="absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-lg bg-raised p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-float"
          >
            {body}
          </div>
        </div>
      ) : null}

      <button
        ref={lineRef}
        type="button"
        data-presence-line=""
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-disabled={!count || undefined}
        tabIndex={count ? 0 : -1}
        aria-label={count ? `${line.text}. Show running agents` : undefined}
        onClick={() => (open ? closePanel() : openPanel())}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left sm:h-7",
          count ? "hover:bg-hover focus-visible:bg-hover focus-visible:outline-none" : "pointer-events-none",
        )}
      >
        {count ? (
          <>
            <StatusDot status={attention ? "attention" : entries[0].status === "quiet" && count === 1 ? "quiet" : "working"} />
            <Marks entries={entries} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs whitespace-nowrap">
              <span className="min-w-0 truncate text-ink-muted">
                <span className="hidden sm:inline">{line.text}</span>
                <span className="sm:hidden">{line.short}</span>
              </span>
              {line.step ? (
                <span className="min-w-0 truncate text-ink-faint">
                  <span aria-hidden>· </span>
                  {line.step}
                </span>
              ) : null}
              {line.since ? (
                <span className="shrink-0 text-ink-faint">
                  <span aria-hidden>· </span>
                  <Elapsed start={line.since} />
                </span>
              ) : count === 1 && !line.step && entries[0].status !== "quiet" && !attention ? (
                <span className="shrink-0 text-ink-faint">· Working…</span>
              ) : null}
            </span>
            <ChevronUpIcon
              aria-hidden
              className={cn("size-3.5 shrink-0 text-ink-faint transition-transform", open && "rotate-180")}
            />
          </>
        ) : null}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
