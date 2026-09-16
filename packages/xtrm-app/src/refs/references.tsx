import { createContext, useContext, useMemo, type MouseEvent, type ReactNode } from "react";
import type { IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { IssueKey, lifecycleLabel, lifecycleTone } from "../issues/meta.tsx";
import { useShell } from "../shell/context.tsx";
import { StatusDot, Tip, cx } from "../ui/primitives.tsx";

/**
 * Typed context reference (PRD §10). One vocabulary for drawer traversal, rendered prose,
 * and — when the Agent surface lands — composer `@` mentions. Only `issue` exists today;
 * add kinds (agent, frame, pr, …) to this union when their surfaces exist.
 */
export type ContextReference = { kind: "issue"; ref: string };

/** `@issue:XTRM-3` — the serialized form a composer mention will emit. */
export const formatReference = (r: ContextReference) => `@${r.kind}:${r.ref}`;

/** Explicit `@issue:REF` or a bare issue key (`XTRM-3`, `XTRM-252.13.1`). Bare keys only render as chips when they resolve. */
export const REFERENCE_PATTERN = /@issue:([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)|\b([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)\b/g;

export function parseReference(text: string): ContextReference | null {
  const m = /^@issue:([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)$/.exec(text.trim());
  return m ? { kind: "issue", ref: m[1]! } : null;
}

const HREF_PREFIX = "xtrm-ref:issue:";

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/**
 * remark plugin: turns issue references in text into `xtrm-ref:` links, which `Markdown`
 * renders as `ReferenceChip`. Code, inline code, and existing links are left untouched.
 */
export function remarkReferences() {
  const split = (value: string): MdNode[] => {
    const out: MdNode[] = [];
    let last = 0;
    for (const m of value.matchAll(REFERENCE_PATTERN)) {
      const ref = m[1] ?? m[2]!;
      if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index) });
      out.push({ type: "link", url: HREF_PREFIX + ref, children: [{ type: "text", value: m[0] }] });
      last = m.index! + m[0].length;
    }
    if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    return out;
  };
  const walk = (node: MdNode) => {
    if (!node.children || node.type === "link" || node.type === "linkReference") return;
    node.children = node.children.flatMap((child) => (child.type === "text" && child.value ? split(child.value) : (walk(child), [child])));
  };
  return (tree: MdNode) => walk(tree);
}

/** Reference href → reference, for the markdown `a` renderer. */
export function referenceFromHref(href: string | undefined): ContextReference | null {
  return href?.startsWith(HREF_PREFIX) ? { kind: "issue", ref: href.slice(HREF_PREFIX.length) } : null;
}

const OpenReference = createContext<((r: ContextReference) => void) | null>(null);

/** Lets a host decide what activating a reference does (drawer traversal, page navigation). Default: inspect in the drawer. */
export function ReferenceActionsProvider({ open, children }: { open: (r: ContextReference) => void; children: ReactNode }) {
  return <OpenReference.Provider value={open}>{children}</OpenReference.Provider>;
}

/** Issues of the current repository, addressable by flat ref and by locator. */
export function useIssueIndex() {
  const { repo } = useShell();
  const projects = useProjects();
  const issues = useIssues(projectForRepo(projects.data, repo)?.id);
  return useMemo(() => {
    const map = new Map<string, IssueSummary>();
    for (const i of issues.data ?? []) {
      map.set(i.ref, i);
      map.set(i.locator, i);
    }
    return map;
  }, [issues.data]);
}

/**
 * The one chip for a referenced entity: status, hierarchical key (flat ref dimmed), optional title.
 * Unresolved references render as their plain text, never as a dead link.
 */
export function ReferenceChip({
  reference,
  showTitle,
  fallback,
  unresolved,
  className,
}: {
  reference: ContextReference;
  showTitle?: boolean;
  fallback?: string;
  /** Rendered as-is when the reference does not resolve (e.g. prose text that only looks like a key, such as UTF-8). */
  unresolved?: ReactNode;
  className?: string;
}) {
  const index = useIssueIndex();
  const shell = useShell();
  const hostOpen = useContext(OpenReference);
  const issue = index.get(reference.ref);
  if (!issue && unresolved !== undefined) return <>{unresolved}</>;
  if (!issue) return <span className={cx("font-mono text-xs text-ink-muted", className)}>{fallback ?? reference.ref}</span>;

  const open = (e: MouseEvent) => {
    e.stopPropagation();
    const target: ContextReference = { kind: "issue", ref: issue.ref };
    if (hostOpen) hostOpen(target);
    else shell.inspect(target);
  };

  const chip = (
    <button
      type="button"
      data-reference={formatReference({ kind: "issue", ref: issue.ref })}
      aria-label={`${issue.locator} ${issue.title}`}
      onClick={open}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cx(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm px-1 align-baseline leading-5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40",
        className,
      )}
    >
      <StatusDot tone={lifecycleTone(issue.lifecycle)} label={lifecycleLabel(issue.lifecycle)} />
      <IssueKey locator={issue.locator} humanRef={issue.ref} />
      {showTitle && <span className={cx("truncate text-sm", issue.lifecycle === "open" ? "text-ink" : "text-ink-muted")}>{issue.title}</span>}
    </button>
  );
  return showTitle ? chip : <Tip label={`${issue.title} · ${lifecycleLabel(issue.lifecycle)}`}>{chip}</Tip>;
}
