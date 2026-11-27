import { ChevronDownIcon, LoaderCircleIcon, SendIcon, SquareIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { StatusDot, statusWord } from "@/components/StatusDot"
import { composerMeta } from "@/lib/composer-meta"
import { ContextRing } from "@/components/ContextRing"
import { monogram } from "@/lib/format"
import { escapeClearsReply } from "@/lib/reply"
import type { ViewerAgent } from "@/shared/types"
import { cn } from "@/lib/utils"

interface Mention {
  query: string
  start: number
  end: number
}

function findMention(value: string, caret: number): Mention | null {
  const before = value.slice(0, caret)
  const match = /(^|\s)@([\w.-]*)$/.exec(before)
  if (!match) return null
  const query = match[2] ?? ""
  return { query, start: caret - query.length - 1, end: caret }
}

export function Composer({
  agents,
  target,
  onTargetChange,
  onSend,
  onStop,
  disabled,
  replyTo = null,
  onClearReply,
}: {
  agents: ViewerAgent[]
  target: ViewerAgent | null
  onTargetChange: (agent: ViewerAgent) => void
  onSend: (agent: ViewerAgent, text: string) => Promise<void>
  /** Stop the target's running turn: one Escape to its own pane (XTRM-1088). Absent means no control. */
  onStop?: (agent: ViewerAgent) => Promise<void>
  disabled?: boolean
  /** The agent a Reply click aimed the composer at: shows the "Replying to" bar (XTRM-1045). */
  replyTo?: ViewerAgent | null
  onClearReply?: () => void
}) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<"none" | "to" | "mention">("none")
  const [mention, setMention] = useState<Mention | null>(null)
  // The current mention, readable from a callback scheduled before the last render: onChange runs
  // syncMention in a requestAnimationFrame, whose closure would otherwise hold the mention from
  // before the keystroke and reset the highlight after a fast ArrowDown.
  const mentionRef = useRef<Mention | null>(null)
  const [index, setIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The under-row carries the two fields the presence detail shows, and omits a missing one.
  const meta = composerMeta(target)
  // Stop is offered only while the target is actually working, the same signal the presence line reads:
  // sending Escape to an idle pane would type into a prompt nobody asked to interrupt (XTRM-1088).
  const working = Boolean(target && target.status === "working" && onStop)

  const matches = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    return agents.filter((agent) => agent.name.toLowerCase().includes(query))
  }, [agents, mention])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(node.scrollHeight, parseFloat(getComputedStyle(document.documentElement).fontSize) * 13)}px`
  }, [text])

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenu("none")
      }
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  function syncMention() {
    const node = textareaRef.current
    if (!node) return
    const next = findMention(node.value, node.selectionStart ?? node.value.length)
    const previous = mentionRef.current
    mentionRef.current = next
    setMention(next)
    // Keep the highlighted agent while the same @-query is open: syncMention also runs on keyup, so an
    // unconditional reset sent every ArrowUp/ArrowDown back to the first row (operator, 2026-11-26).
    if (!next || !previous || next.start !== previous.start || next.query !== previous.query) setIndex(0)
    if (next && agents.length) setMenu("mention")
    else if (menu === "mention") setMenu("none")
  }

  function insertMention(agent: ViewerAgent) {
    const node = textareaRef.current
    if (!mention || !node) return
    const next = `${text.slice(0, mention.start)}@${agent.name} ${text.slice(mention.end)}`
    setText(next)
    mentionRef.current = null
    setMention(null)
    setMenu("none")
    onTargetChange(agent)
    const caret = mention.start + agent.name.length + 2
    requestAnimationFrame(() => {
      node.focus()
      node.setSelectionRange(caret, caret)
    })
  }

  function choose(agent: ViewerAgent) {
    if (mention && matches.length) insertMention(agent)
    else setMenu("none")
  }

  async function submit() {
    const value = text.trim()
    if (!value || !target || sending) return
    setSending(true)
    setError(null)
    try {
      await onSend(target, value)
      onClearReply?.()
      setText("")
      mentionRef.current = null
      setMention(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSending(false)
    }
  }

  // One Escape per press, to the target's own pane, and only while it is working. The server checks the
  // pane against a fresh discovery, so a stale target cannot reach a pane that has been reused.
  async function stop() {
    if (!target || !onStop || stopping) return
    setStopping(true)
    setError(null)
    try {
      await onStop(target)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="shrink-0 bg-canvas px-3 pt-2 pb-4 sm:px-12">
      <div ref={rootRef} className="xtrm-lane relative mx-auto w-full">
        {menu === "mention" && matches.length ? (
          <div
            data-composer-menu=""
            className="absolute right-2 bottom-full left-2 z-20 mb-2 max-h-60 overflow-y-auto rounded-lg bg-raised p-1 shadow-float sm:right-auto sm:w-80">
            <div className="px-2 py-1 text-2xs text-ink-muted">Send to agent</div>
            {matches.map((agent, position) => (
              <button
                key={agent.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(agent)}
                onMouseEnter={() => setIndex(position)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  position === index ? "bg-pressed" : "hover:bg-hover",
                )}
              >
                <StatusDot status={agent.status} />
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{agent.name}</span>
                <span className="text-2xs text-ink-muted">{statusWord(agent.status)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "xtrm-composer-box relative flex flex-col rounded-lg",
            disabled && "opacity-60",
          )}
        >
          {replyTo ? (
            <div
              data-reply-bar=""
              className="flex items-center gap-2 px-3 pt-2.5 text-2xs text-ink-muted"
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-control font-mono text-2xs text-ink-muted"
              >
                {monogram(replyTo.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                Replying to <span className="font-medium text-ink">{replyTo.name}</span>
              </span>
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => {
                  onClearReply?.()
                  textareaRef.current?.focus()
                }}
                className="rounded-sm p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              >
                <XIcon className="size-[0.8125rem]" />
              </button>
            </div>
          ) : null}

          {/* One row, sized from the text (operator, 2026-11-26, after Claude Desktop): 16/24 prompt text, a
              32px send button (twice the text size) around a 16px glyph (the text size), and one 12px inset on
              every side of the row. The send button is a flex item, not an overlay, bottom-aligned with the
              text column: in the one-line state it is centred on the line (12px above, below and right of it),
              and as the text grows it stays on the last line. The text column scrolls inside its own box, so
              text never runs under the button or into the box's border. */}
          <div data-composer-row="" className="flex items-end gap-2 p-3">
          <textarea
            ref={textareaRef}
            data-composer-input=""
            value={text}
            // Optical centring (XTRM-1087): inside the 24px line box the painted band (cap to descender) sits
            // 0.75px low, so the top padding is 0.75px smaller than the bottom. The pair still sums to 8px, which
            // keeps the one-line box at 56px.
            rows={1}
            disabled={disabled || !target}
            placeholder={target ? `Message ${target.name}…` : "No agent pane available"}
            onChange={(event) => {
              setText(event.target.value)
              requestAnimationFrame(syncMention)
            }}
            onKeyUp={syncMention}
            onClick={syncMention}
            onKeyDown={(event) => {
              if (mention && matches.length) {
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setIndex((value) => (value + 1) % matches.length)
                  return
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setIndex((value) => (value - 1 + matches.length) % matches.length)
                  return
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  const agent = matches[index]
                  if (agent) choose(agent)
                  return
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  mentionRef.current = null
                  setMention(null)
                  setMenu("none")
                  return
                }
              }
              if (event.key === "Escape" && escapeClearsReply(Boolean(replyTo), text)) {
                event.preventDefault()
                onClearReply?.()
                return
              }
              // Esc in an empty box stops the running turn: the same request the Stop button sends
              // (XTRM-1088). A box with text in it keeps Esc free for the menus and the reply bar.
              if (event.key === "Escape" && !text.trim() && working) {
                event.preventDefault()
                void stop()
                return
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            className="scrollbar-thin block max-h-52 min-h-[calc(1lh+0.5rem)] min-w-0 flex-1 resize-none bg-transparent px-0 pt-[3.25px] pb-[4.75px] text-[1rem] leading-6 text-ink placeholder:text-ink-muted focus:outline-none"
          />

            <div data-composer-controls="" className="flex shrink-0 items-center gap-2">
              {working ? (
                <button
                  type="button"
                  data-composer-stop=""
                  onClick={() => void stop()}
                  disabled={stopping}
                  aria-label={`Stop ${target?.name ?? "agent"}`}
                  title="Stop (Esc)"
                  className="flex size-8 items-center justify-center rounded-md text-ink transition-opacity outline-none hover:opacity-60 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-30"
                >
                  {stopping ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <SquareIcon className="size-3.5" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!text.trim() || !target || sending}
                aria-label="Send"
                className="flex size-8 items-center justify-center rounded-md text-github transition-[color,opacity] outline-none hover:text-github-hover focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-30"
              >
                {sending ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <SendIcon className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* The agent selector lives under the box, as in Claude Desktop (XTRM-1054): right-aligned on
            one line, the target, its model and its bare effort, muted at the 13px step against the
            14px prompt, 12px apart, no chips and no borders. */}
        {/* The row's right edge meets the send button's right edge, not the box's outer edge
            (XTRM-1056): the group ends at the same 12px inset the box uses for its text and send. */}
        <div data-composer-under-row="" className="mt-1.5 flex min-w-0 items-center gap-3 pl-1 pr-3">
          <span className="hidden min-w-0 truncate text-2xs text-ink-muted sm:block">
            @ to mention
          </span>

          <div data-composer-target-meta="" className="relative ml-auto flex min-w-0 items-center gap-3">
            {/* The agent menu opens upward from the selector it belongs to (operator, 2026-11-26): it is
                anchored to this right-aligned group, so its right edge meets the selector group's right
                edge (the send button's right edge), it overlays the box above as Claude Desktop's model
                menu does, and it sizes to its rows between 14rem and 20rem, never wider than the screen. */}
            {menu === "to" ? (
              <div
                data-composer-menu=""
                className="absolute right-0 bottom-full z-20 mb-2 max-h-72 w-max min-w-56 max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-raised p-1 shadow-float"
              >
                <div className="px-2.5 pt-1.5 pb-1 text-xs text-ink-muted">Send to agent</div>
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onTargetChange(agent)
                      setMenu("none")
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover",
                      agent.id === target?.id && "bg-pressed",
                    )}
                  >
                    <StatusDot status={agent.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{agent.name}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{statusWord(agent.status)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              disabled={!agents.length}
              onClick={() => setMenu((value) => (value === "to" ? "none" : "to"))}
              aria-expanded={menu === "to"}
              aria-label={`Target: ${target ? [target.name, meta.label].filter(Boolean).join(", ") : "no agent"}`}
              className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-md text-base text-ink-muted transition-colors hover:text-ink"
            >
              <StatusDot status={target?.status ?? "unknown"} decorative />
              {target ? (
                <span className="max-w-44 truncate">{target.name}</span>
              ) : (
                <span>no agent</span>
              )}
              <ChevronDownIcon className="size-[0.8125rem]" />
            </button>

            {meta.model ? (
              <span data-composer-context="" className="flex min-w-0 items-center gap-1.5">
                {target?.context ? <ContextRing usage={target.context} /> : null}
                <span
                  data-composer-target-model=""
                  title={meta.label ?? meta.model}
                  className="min-w-0 max-w-56 truncate text-base text-ink-muted"
                >
                  {meta.model}
                </span>
              </span>
            ) : null}
            {meta.effort ? (
              <span
                data-composer-target-effort=""
                title={`thinking ${meta.effort}`}
                className="shrink-0 text-base text-ink-muted"
              >
                {meta.effort}
              </span>
            ) : null}
          </div>
        </div>

        {error ? <div className="mt-1 px-1 text-2xs text-danger">{error}</div> : null}
      </div>
    </div>
  )
}
