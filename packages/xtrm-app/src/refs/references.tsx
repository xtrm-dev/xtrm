import { createContext, useContext, useMemo, type MouseEvent, type ReactNode } from "react";
import type { IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useGithubIssue, useIssues, useProjects, usePull } from "../app/queries.ts";
import { pullStateLabel, pullUrl, resolvePullReference } from "../github/pr.ts";
import { PrKey } from "../ui/pr-key.tsx";
import { githubIssueUrl, issueStateLabel, issueStateTone, parseGithubIssueRef } from "../github/issues.ts";
import { IssueKeyPill } from "../ui/issue-key-pill.tsx";
import { lifecycleLabel } from "../issues/meta.tsx";
import { JiraChip, JiraKeyReference, useJiraIssueIndex } from "../project/jira/JiraChip.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { StatusDot, Tip, cx } from "../ui/primitives.tsx";

/**
 * Typed context reference (PRD §10). One vocabulary for drawer traversal, rendered prose,
 * and — when the Agent surface lands — composer `@` mentions.
 * `issue` resolves against the Substrate index; `jira` is an explicit `@jira:KEY-123` in the
 * repository's bound Jira project; `key` is a bare key whose provider is still unknown, so it
 * resolves Substrate first, then the bound Jira project, then prose (ADR-002 D6). `pr` is
 * `owner/repo#N`, or a bare `#N` that resolves against the repository of the reading surface.
 */
export type ContextReference =
  | { kind: "issue"; ref: string }
  | { kind: "pr"; ref: string }
  | { kind: "gh-issue"; ref: string }
  | { kind: "jira"; ref: string }
  | { kind: "key"; ref: string };

/** `@issue:XTRM-3` / `@pr:owner/repo#N` / `@jira:KEY-123` — the serialized form a composer mention emits. */
export const formatReference = (r: ContextReference) => `@${r.kind}:${r.ref}`;

const ISSUE_REF = "[A-Za-z][A-Za-z0-9]*-\\d+(?:\\.\\d+)*";
// No segment may start with a dot: `../..#5` must stay prose (same-origin
// path traversal through the PR API).
const REPO_SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9_.-]*";
const REPO_REF = `${REPO_SEGMENT}/${REPO_SEGMENT}`;
const PR_REF = `${REPO_REF}#\\d+`;
// The bridge's own key shape (ADR-002 §3). An explicit `@jira:` form outside it stays prose:
// the bridge would refuse the key as a bad request, so no chip may promise it resolves.
const JIRA_KEY = "[A-Z][A-Z0-9_]+-\\d+";

/**
 * Explicit `@issue:REF`, explicit `@jira:KEY`, explicit `@pr:owner/repo#N`, a canonical
 * `owner/repo#N`, a bare key (`XTRM-3`, `MMD-551`, `XTRM-252.13.1`), or a bare `#N` pull request
 * scoped to the reading surface. A bare key is provider-unknown: it resolves Substrate first,
 * then the repository's bound Jira project, then prose. Bare keys and bare numbers only render
 * as chips when they resolve. The canonical PR form is tried before the bare key so a repository
 * named like an issue key stays one reference, and `@jira:` is tried before the bare key so the
 * forced provider is never re-read as a Substrate key.
 */
export const REFERENCE_PATTERN = new RegExp(
  `@jira:(?<jira>${JIRA_KEY})|@issue:(?<issue>${ISSUE_REF})|@pr:(?<pr>${PR_REF})|(?<![\\w/.])(?<canonicalPr>${PR_REF})(?![0-9A-Za-z])|\\b(?<bareIssue>${ISSUE_REF})\\b|(?<![\\w/.])(?<barePr>#\\d+)(?![0-9A-Za-z])`,
  "g",
);

export function parseReference(text: string): ContextReference | null {
  const clean = text.trim();
  const gh = /^@gh-issue:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)$/.exec(clean);
  if (gh) return { kind: "gh-issue", ref: gh[1]! };
  let m = /^@issue:([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)$/.exec(clean);
  if (m) return { kind: "issue", ref: m[1]! };
  m = /^@jira:([A-Z][A-Z0-9_]+-\d+)$/.exec(clean);
  if (m) return { kind: "jira", ref: m[1]! };
  m = /^@pr:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)$/.exec(clean);
  if (m) return { kind: "pr", ref: m[1]! };
  return null;
}

const HREF_ISSUE_PREFIX = "xtrm-ref:issue:";
const HREF_PR_PREFIX = "xtrm-ref:pr:";
const HREF_JIRA_PREFIX = "xtrm-ref:jira:";
const HREF_KEY_PREFIX = "xtrm-ref:key:";

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/**
 * remark plugin: turns references in text into `xtrm-ref:` links, which `Markdown`
 * renders as `ReferenceChip`. Code, inline code, and existing links are left untouched.
 */
export function remarkReferences() {
  const split = (value: string): MdNode[] => {
    const out: MdNode[] = [];
    let last = 0;
    REFERENCE_PATTERN.lastIndex = 0;
    for (const m of value.matchAll(REFERENCE_PATTERN)) {
      const g = m.groups ?? {};
      const ref = (g.jira ?? g.pr ?? g.canonicalPr ?? g.barePr ?? g.issue ?? g.bareIssue)!;
      // The href carries the provider the text named: an explicit namespace keeps its provider,
      // a bare key stays `key` until the chip resolves it (Substrate, then Jira, then prose).
      const prefix = g.jira !== undefined
        ? HREF_JIRA_PREFIX
        : g.pr !== undefined || g.canonicalPr !== undefined || g.barePr !== undefined
          ? HREF_PR_PREFIX
          : g.bareIssue !== undefined
            ? HREF_KEY_PREFIX
            : HREF_ISSUE_PREFIX;
      if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index) });
      out.push({ type: "link", url: prefix + ref, children: [{ type: "text", value: m[0] }] });
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
  if (!href) return null;
  if (href.startsWith(HREF_ISSUE_PREFIX)) return { kind: "issue", ref: href.slice(HREF_ISSUE_PREFIX.length) };
  if (href.startsWith(HREF_PR_PREFIX)) return { kind: "pr", ref: href.slice(HREF_PR_PREFIX.length) };
  if (href.startsWith(HREF_JIRA_PREFIX)) return { kind: "jira", ref: href.slice(HREF_JIRA_PREFIX.length) };
  if (href.startsWith(HREF_KEY_PREFIX)) return { kind: "key", ref: href.slice(HREF_KEY_PREFIX.length) };
  return null;
}

/**
 * The reference kinds a host can hand to the drawer. A Jira issue opens at its browse URL and a
 * bare key has no drawer view of its own, so neither crosses this channel: the drawer vocabulary
 * stays the Substrate and GitHub entities it can actually render.
 */
export type DrawerableReference = Exclude<ContextReference, { kind: "jira" } | { kind: "key" }>;

const OpenReference = createContext<((r: DrawerableReference) => void) | null>(null);
const ReferenceRepo = createContext<string | null>(null);

/**
 * The repository that bare `#N` references resolve against: the surface's own repository
 * (`owner/name`) when it has one, else the repository selected in the shell. GitHub numbers
 * are per repository, so a bare number must never borrow another surface's scope.
 */
export function useReferenceRepo(): string {
  const scoped = useContext(ReferenceRepo);
  const shell = useShell();
  return scoped ?? shell.repo.fullName;
}

/**
 * Lets a host decide what activating a reference does (drawer traversal, page navigation) and
 * which repository bare `#N` references belong to. Defaults: inspect in the drawer, shell repo.
 */
export function ReferenceActionsProvider({ open, repo, children }: { open: (r: DrawerableReference) => void; repo?: string; children: ReactNode }) {
  return (
    <ReferenceRepo.Provider value={repo ?? null}>
      <OpenReference.Provider value={open}>{children}</OpenReference.Provider>
    </ReferenceRepo.Provider>
  );
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
 * PR references (`owner/repo#N`) render with the pull icon and open the PR drawer.
 */
export function ReferenceChip({
  reference,
  showTitle,
  fallback,
  unresolved,
  showAlias = true,
  className,
}: {
  reference: ContextReference;
  showTitle?: boolean;
  fallback?: string;
  /** Rendered as-is when the reference does not resolve (e.g. prose text that only looks like a key, such as UTF-8). */
  unresolved?: ReactNode;
  /** `false` renders the primary key alone; the alias moves to the tooltip (§4.5 Linked cell). */
  showAlias?: boolean;
  className?: string;
}) {
  if (reference.kind === "gh-issue") return <GithubIssueReferenceChip reference={reference} showTitle={showTitle} fallback={fallback} className={className} />;
  if (reference.kind === "pr") return <PullReferenceChip reference={reference} showTitle={showTitle} fallback={fallback} className={className} />;
  if (reference.kind === "jira") return <JiraReferenceChip reference={reference} fallback={fallback} />;
  if (reference.kind === "key") {
    return <KeyReferenceChip reference={reference} showTitle={showTitle} fallback={fallback} unresolved={unresolved} showAlias={showAlias} className={className} />;
  }
  return <IssueReferenceChip reference={reference} showTitle={showTitle} fallback={fallback} unresolved={unresolved} showAlias={showAlias} className={className} />;
}


/**
 * A reference chip is an inline group: the chip itself inspects (the app convention), and the
 * GitHub arrow beside the chip opens the same reference on github.com
 * without leaving the reader without an in-app route. `Ctrl`/`⌘`-click and middle-click open
 * github.com directly, matching browser link habits.
 */
function GithubOpen({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-faint outline-none hover:bg-hover hover:text-accent-ink focus-visible:bg-hover"
    >
      <Icon name="external" size="xs" />
    </a>
  );
}

/** True when the gesture means "open outside the app" rather than "inspect here". */
const openOutside = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;

/**
 * GitHub issue chip (`owner/repo#N`). Deliberately carries the GitHub mark: a
 * repository tracker item is never an XTRM work contract (PRD §34.3).
 */
function GithubIssueReferenceChip({ reference, showTitle, fallback, className }: { reference: { kind: "gh-issue"; ref: string }; showTitle?: boolean; fallback?: string; className?: string }) {
  const shell = useShell();
  const hostOpen = useContext(OpenReference);
  const parsed = parseGithubIssueRef(reference.ref);
  const issue = useGithubIssue(parsed?.fullName ?? "", parsed?.number ?? null);
  if (!parsed) return <span className={cx("font-mono text-xs text-ink-muted", className)}>{fallback ?? reference.ref}</span>;

  const target: ContextReference = { kind: "gh-issue", ref: `${parsed.fullName}#${parsed.number}` };
  const href = issue.data?.url ?? githubIssueUrl(parsed.fullName, parsed.number);
  const title = issue.data?.title;
  const chip = (
    <span className={cx("group/ref inline-flex max-w-full min-w-0 items-center gap-0.5 align-baseline", className)}>
      <button
        type="button"
        data-reference={formatReference(target)}
        aria-label={`GitHub issue ${parsed.fullName}#${parsed.number}${title ? ` ${title}` : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (openOutside(e)) {
            window.open(href, "_blank", "noreferrer");
            return;
          }
          if (hostOpen) hostOpen(target);
          else shell.inspect(target);
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          window.open(href, "_blank", "noreferrer");
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm px-1 align-baseline leading-5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        {issue.data ? <StatusDot tone={issueStateTone(issue.data.state)} label={issueStateLabel(issue.data.state)} /> : <Icon name="comment" size="xs" className="shrink-0 text-ink-faint" />}
        <span className="truncate font-mono text-xs text-accent-ink">
          #{parsed.number}
          <span className="text-ink-faint"> {parsed.fullName}</span>
        </span>
        {showTitle && title && <span className="truncate text-sm text-ink">{title}</span>}
      </button>
      <GithubOpen href={href} label={`Open ${parsed.fullName}#${parsed.number} on GitHub`} />
    </span>
  );
  return !showTitle && title ? <Tip label={title}>{chip}</Tip> : chip;
}

function PullReferenceChip({ reference, showTitle, fallback, className }: { reference: { kind: "pr"; ref: string }; showTitle?: boolean; fallback?: string; className?: string }) {
  const shell = useShell();
  const hostOpen = useContext(OpenReference);
  const ambientRepo = useReferenceRepo();
  const parsed = resolvePullReference(reference.ref, ambientRepo);
  const pull = usePull(parsed?.fullName ?? "", parsed?.number ?? null);
  if (!parsed) return <span className={cx("font-mono text-xs text-ink-muted", className)}>{fallback ?? reference.ref}</span>;
  // Unresolved prose stays prose, never a dead chip: a bare `#N` is a guess until the read proves
  // it is a pull request, and a wrong repository (or a backend outage) leaves plain text.
  if (!pull.data) return <>{fallback ?? reference.ref}</>;

  const href = pullUrl(parsed.fullName, parsed.number);
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (openOutside(e)) {
      window.open(href, "_blank", "noreferrer");
      return;
    }
    const target: ContextReference = { kind: "pr", ref: parsed.fullName + "#" + parsed.number };
    if (hostOpen) hostOpen(target);
    else shell.inspect(target);
  };

  const title = pull.data?.title;
  const state = pull.data?.state;
  const chip = (
    <span className={cx("group/ref inline-flex max-w-full min-w-0 items-center gap-0.5 align-baseline", className)}>
      <button
        type="button"
        data-reference={formatReference({ kind: "pr", ref: `${parsed.fullName}#${parsed.number}` })}
        aria-label={`${parsed.fullName}#${parsed.number}${state ? ` ${pullStateLabel(state, pull.data.draft)}` : ""}${title ? ` ${title}` : ""}`}
        onClick={open}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          window.open(href, "_blank", "noreferrer");
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm px-1 align-baseline leading-5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        <PrKey number={parsed.number} state={state ?? null} draft={pull.data.draft} glyph={false} className="shrink-0" />
        {/* Truncation order (2026-11-26 ruling): the key is never cut, the repository is cut first,
            the title last — the repository is almost always this surface's own repo. */}
        <span className="min-w-0 shrink-[4] truncate font-mono text-xs text-ink-faint">{parsed.fullName}</span>
        {title && (
          <span className={cx("min-w-0 shrink truncate text-ink", showTitle ? "text-sm" : "text-xs text-ink-muted")} data-testid="pr-chip-title">
            {title}
          </span>
        )}
      </button>
      <GithubOpen href={href} label={`Open ${parsed.fullName}#${parsed.number} on GitHub`} />
    </span>
  );
  if (!showTitle && title && state) return <Tip label={`${title} · ${pullStateLabel(state, pull.data?.draft ?? false)}`}>{chip}</Tip>;
  return chip;
}

function IssueReferenceChip({
  reference,
  showTitle,
  fallback,
  unresolved,
  showAlias = true,
  className,
}: {
  reference: { kind: "issue"; ref: string };
  showTitle?: boolean;
  fallback?: string;
  unresolved?: ReactNode;
  showAlias?: boolean;
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
      aria-label={`${issue.locator ?? issue.ref} ${issue.title}`}
      onClick={open}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cx(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm px-1 align-baseline leading-5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40",
        className,
      )}
    >
      <IssueKeyPill locator={issue.locator} humanRef={issue.ref} className="shrink-0" />
      {showTitle && <span className={cx("min-w-0 truncate text-sm", issue.lifecycle === "open" ? "text-ink" : "text-ink-muted")}>{issue.title}</span>}
    </button>
  );
  // The pill always carries the flat ref, so the tooltip never repeats it.
  // No status dot (2026-11-25 ruling): the lifecycle lives in the tooltip instead.
  // The tooltip wrapper is a flex item in every relations row, so it has to be shrinkable: a bare
  // `<span title>` computes `min-width: auto` and cannot shrink below its chip, which overflows the
  // inspector drawer horizontally instead of ellipsising the title.
  return showTitle ? (
    <span title={lifecycleLabel(issue.lifecycle)} className="inline-flex min-w-0 max-w-full">
      {chip}
    </span>
  ) : (
    <Tip label={`${issue.title} · ${lifecycleLabel(issue.lifecycle)}`}>{chip}</Tip>
  );
}

/**
 * A forced `@jira:KEY-123` reference (ADR-002 D6). The explicit provider is final: this never
 * falls back to the Substrate index, and a key that does not resolve inside the bound project
 * stays the author's prose instead of becoming a chip.
 */
function JiraReferenceChip({ reference, fallback }: { reference: { kind: "jira"; ref: string }; fallback?: string }) {
  const repo = useReferenceRepo();
  return <JiraKeyReference repo={repo} jiraKey={reference.ref} fallback={fallback ?? formatReference(reference)} />;
}

/**
 * A bare key in prose: Substrate first, then the repository's bound Jira project, then prose.
 * The Substrate read is the authority, so a key that exists there never borrows the Jira chip,
 * and the Jira page is read only after Substrate came back empty.
 */
function KeyReferenceChip({
  reference,
  showTitle,
  fallback,
  unresolved,
  showAlias = true,
  className,
}: {
  reference: { kind: "key"; ref: string };
  showTitle?: boolean;
  fallback?: string;
  unresolved?: ReactNode;
  showAlias?: boolean;
  className?: string;
}) {
  const index = useIssueIndex();
  const repo = useReferenceRepo();
  const issue = index.get(reference.ref);
  const jira = useJiraIssueIndex(repo, issue === undefined);
  if (issue) {
    return (
      <IssueReferenceChip
        reference={{ kind: "issue", ref: issue.ref }}
        showTitle={showTitle}
        fallback={fallback}
        showAlias={showAlias}
        className={className}
      />
    );
  }
  const bound = jira.byKey.get(reference.ref);
  if (bound !== undefined) return <JiraChip issue={bound} />;
  if (unresolved !== undefined) return <>{unresolved}</>;
  return <span className={cx("font-mono text-xs text-ink-muted", className)}>{fallback ?? reference.ref}</span>;
}
