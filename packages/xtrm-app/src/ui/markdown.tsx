import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ReferenceChip, referenceFromHref, remarkReferences } from "../refs/references.tsx";
import { cx } from "./primitives.tsx";

/** Read-only GitHub-flavoured markdown. Links open in a new tab; issue references render as chips; raw HTML is not rendered. */
export const Markdown = memo(function Markdown({ children, className, inline }: { children: string; className?: string; inline?: boolean }) {
  if (!children.trim()) return null;
  return (
    <div className={cx("xtrm-prose", inline && "[&>p]:m-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkReferences]}
        urlTransform={(url) => (referenceFromHref(url) ? url : defaultUrlTransform(url))}
        components={{
          // A wide table scrolls inside its own box instead of squeezing every column (XTRM-397).
          table: ({ node: _node, children, ...props }) => (
            <div className="thin-scrollbar my-2.5 max-w-full overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
          a: ({ node: _node, href, children, ...props }) => {
            const reference = referenceFromHref(href);
            if (reference) {
              const text = String(children);
              return <ReferenceChip reference={reference} fallback={text} unresolved={text.startsWith("@") ? undefined : text} />;
            }
            return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
