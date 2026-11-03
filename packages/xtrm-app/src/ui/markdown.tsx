import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { ReferenceChip, referenceFromHref, remarkReferences } from "../refs/references.tsx";
import { cx } from "./primitives.tsx";
import { useThemeAttribute } from "./theme.ts";

type MdNode = { type: string; value?: string; children?: MdNode[] };

/** Soft line breaks render as line breaks, as in chat replies (XTRM-615). Code is untouched: it is never a `text` node. */
function remarkSoftBreaks() {
  const split = (value: string): MdNode[] =>
    value.split("\n").flatMap((part, i): MdNode[] => [...(i ? [{ type: "break" }] : []), ...(part ? [{ type: "text", value: part }] : [])]);
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => (child.type === "text" && child.value?.includes("\n") ? split(child.value) : (walk(child), [child])));
  };
  return (tree: MdNode) => walk(tree);
}

/**
 * GitHub's sanitizer schema plus the three attributes GitHub's own renderer keeps and the library
 * default drops: image alt/width/height and a `<source>` media query. pr-lens posts a `<picture>`
 * with a light and a dark SVG, sized by `width`. Everything else (script, style, iframe, inline
 * `svg`, `on*`, `javascript:`) stays stripped: comment bodies are third-party input.
 */
const githubHtmlSchema: Parameters<typeof rehypeSanitize>[0] = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), "alt", "width", "height"],
    source: [...(defaultSchema.attributes?.source ?? []), "media", "type"],
    details: ["open"],
  },
};

/** `srcset="a.svg 1x, b.svg 2x"` and array properties both resolve to their first candidate. */
const firstUrl = (value: unknown): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  const url = first.split(/\s+/)[0] ?? "";
  return url || null;
};

const num = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const GITHUB_RAW = [/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/, /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/];

/** A diagram links `github.com/<repo>/raw/<ref>/<path>`. The browser cannot load that from another
 * origin on a private repository: github.com sets its session cookies SameSite=Lax, so the request
 * arrives unauthenticated and answers 404. The console serves the bytes with its own token instead.
 * Returns the address unchanged when it is not a repository SVG. */
export function proxyGithubAsset(src: string): string {
  for (const pattern of GITHUB_RAW) {
    const match = pattern.exec(src);
    if (!match) continue;
    const [, owner, repo, ref, path] = match;
    if (!path?.endsWith(".svg")) return src;
    return `/api/github/repo/${owner}/${repo}/raw-svg?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref!)}`;
  }
  return src;
}

/** A body image: follows the app theme when the author supplied a dark counterpart. */
function GithubImage({ src, darkSrc, alt, width, height }: { src: string | null; darkSrc: string | null; alt: string; width?: number; height?: number }) {
  const theme = useThemeAttribute();
  const chosen = theme === "dark" && darkSrc ? darkSrc : src;
  if (!chosen) return null;
  return <img src={proxyGithubAsset(chosen)} alt={alt} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="xtrm-prose-image" />;
}

/** Read-only GitHub-flavoured markdown. Links open in a new tab; issue references render as chips.
 * `breaks` keeps single newlines; `html` renders author-written HTML through GitHub's sanitizer
 * (used for GitHub bodies and comments, which are HTML-heavy). */
export const Markdown = memo(function Markdown({
  children,
  className,
  inline,
  breaks,
  html,
}: {
  children: string;
  className?: string;
  inline?: boolean;
  breaks?: boolean;
  html?: boolean;
}) {
  if (!children.trim()) return null;
  return (
    <div className={cx("xtrm-prose", inline && "[&>p]:m-0", className)}>
      <ReactMarkdown
        remarkPlugins={breaks ? [remarkGfm, remarkReferences, remarkSoftBreaks] : [remarkGfm, remarkReferences]}
        rehypePlugins={html ? [rehypeRaw, [rehypeSanitize, githubHtmlSchema]] : []}
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
          // A `<picture>` carries the light `src` plus a dark `<source>`; pick one by app theme instead
          // of leaving the choice to `prefers-color-scheme`, which the app does not follow.
          picture: ({ node }) => {
            const elements = (node?.children ?? []).filter((c) => c.type === "element");
            const image = elements.find((c) => c.type === "element" && c.tagName === "img");
            if (!image || image.type !== "element") return null;
            const dark = elements.find((c) => c.type === "element" && c.tagName === "source" && String(c.properties?.media ?? "").includes("dark"));
            return (
              <GithubImage
                src={firstUrl(image.properties?.src)}
                darkSrc={dark && dark.type === "element" ? firstUrl(dark.properties?.srcSet) : null}
                alt={String(image.properties?.alt ?? "")}
                width={num(image.properties?.width)}
                height={num(image.properties?.height)}
              />
            );
          },
          img: ({ node: _node, src, alt, width, height }) => <GithubImage src={src ?? null} darkSrc={null} alt={alt ?? ""} width={num(width)} height={num(height)} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
