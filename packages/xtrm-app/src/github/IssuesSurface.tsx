import { useMemo, useState } from "react";
import type { GithubIssueSummary } from "../adapters/index.tsx";
import { useAdapters } from "../adapters/index.tsx";
import { useGithubIssues } from "../app/queries.ts";
import { GithubNotice } from "./auth.tsx";
import { filterIssues, githubIssueRef, issueStateLabel, issueStateTone, type IssueView } from "./issues.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceHeader, ago, cx } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

const VIEWS: Array<{ id: IssueView; label: string }> = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];

/** GitHub labels: name only. The backend row carries no colour, so none is invented. */
function Labels({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <span className="hidden min-w-0 shrink items-center gap-1 sm:flex">
      {labels.slice(0, 3).map((l) => (
        <span key={l} className="max-w-28 truncate rounded-sm bg-control px-1.5 py-px text-xs text-ink-muted" title={l}>
          {l}
        </span>
      ))}
      {labels.length > 3 && <span className="text-xs text-ink-faint tabular">+{labels.length - 3}</span>}
    </span>
  );
}

function IssueRow({ issue, selected, onOpen }: { issue: GithubIssueSummary; selected: boolean; onOpen: () => void }) {
  return (
    <Row className="h-11" selected={selected} onActivate={onOpen}>
      <StatusDot tone={issueStateTone(issue.state)} label={issueStateLabel(issue.state)} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-xs text-ink-faint">#{issue.number}</span>
          <span className="truncate text-ink">{issue.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 truncate text-xs text-ink-faint">
          <span className="truncate">{issue.author}</span>
          <Labels labels={issue.labels} />
        </span>
      </div>
      {issue.comments > 0 && (
        <span className="hidden shrink-0 items-center gap-1 text-xs text-ink-faint tabular md:inline-flex" title={`${issue.comments} comments`}>
          <Icon name="comment" size="xs" />
          {issue.comments}
        </span>
      )}
      <span className="w-10 shrink-0 text-right text-xs text-ink-faint tabular" title={new Date(issue.updatedAt).toLocaleString()}>
        {ago(issue.updatedAt)}
      </span>
    </Row>
  );
}

/** GitHub Issues — the repository's own tracker, distinct from XTRM Issues (PRD §34.3). */
export function GithubIssuesSurface() {
  const { repo, inspect, inspected } = useShell();
  const { github } = useAdapters();
  const [view, setView] = useState<IssueView>("open");
  const [query, setQuery] = useState("");
  const issues = useGithubIssues(repo.fullName);

  const rows = useMemo(() => (issues.data ? filterIssues(issues.data, view, query) : []), [issues.data, view, query]);
  const counts = useMemo(
    () => ({
      open: issues.data?.filter((i) => i.state === "open").length ?? 0,
      closed: issues.data?.filter((i) => i.state === "closed").length ?? 0,
    }),
    [issues.data],
  );

  let body;
  if (issues.isPending) body = <LoadingState label="Loading GitHub issues" />;
  else if (issues.isError) body = <ErrorState title="GitHub backend is unavailable" error={issues.error} />;
  else if (!rows.length)
    body = (
      <EmptyState icon="comment" title={`No ${view} GitHub issues${query ? ` matching “${query}”` : ` for ${repo.fullName}`}`}>
        {query ? "Clear the filter or try the other view." : "This repository tracks executable work in XTRM Issues; GitHub issues appear here once the backend poller records them."}
      </EmptyState>
    );
  else
    body = (
      <VirtualList
        label="GitHub issues"
        items={rows}
        rowHeight={44}
        getKey={(i) => `${i.number}`}
        renderRow={(i) => (
          <IssueRow
            issue={i}
            selected={inspected?.kind === "gh-issue" && inspected.ref === githubIssueRef(repo.fullName, i.number)}
            onOpen={() => inspect({ kind: "gh-issue", ref: githubIssueRef(repo.fullName, i.number) })}
          />
        )}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="GitHub Issues">
      <SurfaceHeader
        title="GitHub Issues"
        meta={
          <>
            <span>{repo.fullName}</span>
            <SourceBadge source={github.source} />
            <span className="text-ink-faint">GitHub tracker, not XTRM Issues</span>
            {issues.data && <span className="tabular">{rows.length} of {issues.data.length}</span>}
          </>
        }
      >
        <OptionsMenu
          label="GitHub issue options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void issues.refetch() },
            { label: "Open on GitHub", icon: "external", onSelect: () => void window.open(`https://github.com/${repo.fullName}/issues`, "_blank", "noreferrer") },
          ]}
        />
      </SurfaceHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-muted px-4 py-2">
        <div role="tablist" aria-label="GitHub issue state" className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cx(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm outline-none focus-visible:bg-hover",
                view === v.id ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted",
              )}
            >
              {v.label}
              <span className="text-xs text-ink-faint tabular">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        <label className="flex h-7 min-w-40 flex-1 items-center gap-2 rounded-md border border-border-muted px-2 text-sm text-ink-faint focus-within:border-border-strong sm:max-w-64">
          <Icon name="search" size="xs" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, author, label…"
            aria-label="Filter GitHub issues"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
      <GithubNotice repo={repo.fullName} />
      {body}
    </section>
  );
}
