import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./primitives.tsx";

/** Read-only GitHub-flavoured markdown. Links open in a new tab; raw HTML is not rendered. */
export const Markdown = memo(function Markdown({ children, className, inline }: { children: string; className?: string; inline?: boolean }) {
  if (!children.trim()) return null;
  return (
    <div className={cx("xtrm-prose", inline && "[&>p]:m-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
