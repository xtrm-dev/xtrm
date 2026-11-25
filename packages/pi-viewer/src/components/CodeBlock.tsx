import { CheckIcon, CopyIcon, WrapTextIcon } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

function useCopy(text: string) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_400)
    } catch {
      // Clipboard access can be denied; the text stays selectable.
    }
  }
  return { copied, copy }
}

/** Tool input and output: a quiet well with a hover copy button. */
export function CodeBlock({
  text,
  tone = "default",
  className,
}: {
  text: string
  tone?: "default" | "error"
  className?: string
}) {
  const { copied, copy } = useCopy(text)

  return (
    <div
      className={cn(
        "group/code relative mt-1.5 overflow-hidden rounded-md bg-deep",
        tone === "error" ? "bg-danger/5" : "",
        className,
      )}
    >
      <pre className="scrollbar-thin max-h-80 overflow-auto px-3 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-ink-muted">
        {text}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy"
        className="absolute top-1.5 right-1.5 rounded-sm bg-deep p-1 text-ink-muted opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-ink focus-visible:opacity-100"
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
    </div>
  )
}

/**
 * A fenced code block in assistant prose: frame, language label, wrap toggle and copy
 * (audit 3.6, goodie 10). Radius is rem-based `rounded-md` (8px), per the console doc.
 */
export function CodeFrame({ text, language }: { text: string; language?: string }) {
  const { copied, copy } = useCopy(text)
  const [wrap, setWrap] = useState(false)

  return (
    <div className="xtrm-code my-[0.7rem] overflow-hidden rounded-md leading-snug">
      <div className="flex items-center justify-between gap-2 pt-1 pr-1 pl-3 select-none">
        <span className="font-mono text-2xs text-ink-muted">{language || "text"}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setWrap((value) => !value)}
            aria-label="Wrap lines"
            aria-pressed={wrap}
            className={cn(
              "rounded-sm p-1 text-ink-muted hover:bg-hover hover:text-ink",
              wrap && "bg-control text-ink",
            )}
          >
            <WrapTextIcon className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label="Copy"
            className="rounded-sm p-1 text-ink-muted hover:bg-hover hover:text-ink"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>
      <pre
        className={cn(
          "scrollbar-thin m-0 overflow-x-auto bg-transparent px-3 pt-1 pb-2.5 font-mono text-xs leading-relaxed text-ink",
          wrap && "whitespace-pre-wrap [overflow-wrap:anywhere]",
        )}
      >
        <code className="bg-transparent p-0 text-[inherit]">{text}</code>
      </pre>
    </div>
  )
}
