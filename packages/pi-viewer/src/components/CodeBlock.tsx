import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

export function CodeBlock({
  text,
  tone = "default",
  className,
}: {
  text: string
  tone?: "default" | "error"
  className?: string
}) {
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
        className="absolute top-1.5 right-1.5 rounded-sm bg-deep p-1 text-ink-faint opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-ink focus-visible:opacity-100"
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
    </div>
  )
}
