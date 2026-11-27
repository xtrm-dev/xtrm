import { Children, isValidElement, memo, type ReactElement, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { CodeFrame } from "@/components/CodeBlock"

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
  return ""
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="xtrm-prose min-w-0 text-read">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table scrollbar-thin">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => {
            const child = Children.toArray(children)[0]
            const className = isValidElement(child)
              ? ((child as ReactElement<{ className?: string }>).props.className ?? "")
              : ""
            const language = /language-([\w+#-]+)/.exec(className)?.[1]
            return <CodeFrame text={textOf(children).replace(/\n$/, "")} language={language} />
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
