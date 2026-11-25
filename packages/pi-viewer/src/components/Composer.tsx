import { ChevronDownIcon, LoaderCircleIcon, SendIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { StatusDot, statusWord } from "@/components/StatusDot"
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
  disabled,
}: {
  agents: ViewerAgent[]
  target: ViewerAgent | null
  onTargetChange: (agent: ViewerAgent) => void
  onSend: (agent: ViewerAgent, text: string) => Promise<void>
  disabled?: boolean
}) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<"none" | "to" | "mention">("none")
  const [mention, setMention] = useState<Mention | null>(null)
  const [index, setIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

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
    setMention(next)
    setIndex(0)
    if (next && agents.length) setMenu("mention")
    else if (menu === "mention") setMenu("none")
  }

  function insertMention(agent: ViewerAgent) {
    const node = textareaRef.current
    if (!mention || !node) return
    const next = `${text.slice(0, mention.start)}@${agent.name} ${text.slice(mention.end)}`
    setText(next)
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
      setText("")
      setMention(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="shrink-0 bg-deep px-3 pt-2 pb-4 sm:px-12">
      <div ref={rootRef} className="relative mx-auto w-full max-w-[46rem]">
        <div
          className={cn(
            "relative rounded-lg bg-surface transition-colors focus-within:bg-raised",
            disabled && "opacity-60",
          )}
        >
          {menu === "mention" && matches.length ? (
            <div className="absolute right-2 bottom-full left-2 z-20 mb-2 max-h-60 overflow-y-auto rounded-lg bg-raised p-1 shadow-float sm:right-auto sm:w-80">
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

          {menu === "to" ? (
            <div className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-72 overflow-y-auto rounded-lg bg-raised p-1 shadow-float">
              <div className="px-2 py-1 text-2xs text-ink-muted">Send to agent</div>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    onTargetChange(agent)
                    setMenu("none")
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover",
                    agent.id === target?.id && "bg-pressed",
                  )}
                >
                  <StatusDot status={agent.status} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{agent.name}</span>
                  <span className="text-2xs text-ink-muted">{statusWord(agent.status)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            data-composer-input=""
            value={text}
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
                  setMention(null)
                  setMenu("none")
                  return
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            className="scrollbar-thin block max-h-52 min-h-[calc(2lh+1rem)] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[0.875rem] leading-[1.625] text-ink placeholder:text-ink-muted focus:outline-none"
          />

          <div className="flex items-center gap-2 px-2.5 pb-2">
            <button
              type="button"
              disabled={!agents.length}
              onClick={() => setMenu((value) => (value === "to" ? "none" : "to"))}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-2xs text-ink-muted transition-colors hover:text-ink"
            >
              <span>To</span>
              {target ? (
                <>
                  <StatusDot status={target.status} />
                  <span className="max-w-44 truncate text-ink-muted">{target.name}</span>
                </>
              ) : (
                <span>no agent</span>
              )}
              <ChevronDownIcon className="size-3" />
            </button>

            <span className="ml-auto hidden text-2xs text-ink-muted sm:block">
              @ to mention · Shift+Enter for a new line
            </span>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!text.trim() || !target || sending}
              aria-label="Send"
              className="flex size-7 items-center justify-center rounded-md bg-github text-github-ink transition-opacity hover:bg-github-hover disabled:opacity-30"
            >
              {sending ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <SendIcon className="size-3.5" />
              )}
            </button>
          </div>
        </div>

        {error ? <div className="mt-1 px-1 text-2xs text-danger">{error}</div> : null}
      </div>
    </div>
  )
}
