import { useMemo, useState } from "react";
import type { GithubIssueSummary } from "../adapters/index.tsx";
import { useAdapters } from "../adapters/index.tsx";
import { useGithubIssues } from "../app/queries.ts";
import { GithubNotice } from "./auth.tsx";
import { filterIssues, githubIssueRef, issueStateLabel, issueStateTone, type IssueView } from "./issues.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceToolbar, TOOLBAR_CONTROL, TOOLBAR_GHOST, ago, cx } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

const VIEWS: Array<{ id: IssueView; label: string }> = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];

type Sort = "updated" | "created" | "comments";

/** Same column rhythm as the pull requests table: one line per row. */
const COLUMNS: Array<{ key: string; label: string; width: string; align?: "right"; sort?: Sort }> = [
  { key: "state", label: "", width: "1.75rem" },
  { key: "issue", label: "Issue", width: "minmax(0,1fr)" },
  { key: "author", label: "Author", width: "6.5rem" },
  { key: "labels", label: "Labels", width: "10rem" },
  { key: "comments", label: "Comments", width: "5rem", align: "right", sort: "comments" },
  { key: "updated", label: "Updated", width: "4.5rem", align: "right", sort: "updated" },
];
const GRID = { gridTemplateColumns: COLUMNS.map((c) => c.width).join(" ") };
const CELL = "flex h-full min-w-0 items-center px-2";

const SORTERS: Record<Sort, (a: GithubIssueSummary, b: GithubIssueSummary) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  comments: (a, b) => b.comments - a.comments,
};

/** GitHub labels: name only. The backend row carries no colour, so none is invented. */
function Labels({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {labels.slice(0, 2).map((l) => (
        <span key={l} className="min-w-0 truncate rounded-sm bg-control px-1.5 py-px text-xs text-ink-muted" title={l}>
          {l}
        </span>
      ))}
      {labels.length > 2 && <span className="shrink-0 text-xs text-ink-faint tabular">+{labels.length - 2}</span>}
    </span>
  );
}

function IssueRow({ issue, selected, onOpen }: { issue: GithubIssueSummary; selected: boolean; onOpen: () => void }) {
  return (
    <Row density="table" data-testid="gh-issue-row" selected={selected} onActivate={onOpen}>
      <div className="grid h-full w-full items-center overflow-hidden" style={GRID}>
        <div className={CELL}>
          <StatusDot tone={issueStateTone(issue.state)} label={issueStateLabel(issue.state)} />
        </div>
        <div className={cx(CELL, "gap-2")}>
          <span className="shrink-0 font-mono text-xs text-ink-faint">#{issue.number}</span>
          <span className="truncate text-ink">{issue.title}</span>
        </div>
        <div className={cx(CELL, "text-xs text-ink-faint")}>
          <span className="truncate">{issue.author}</span>
        </div>
        <div className={CELL}>
          <Labels labels={issue.labels} />
        </div>
        <div className={cx(CELL, "justify-end gap-1 text-xs text-ink-faint tabular")} title={`${issue.comments} comments`}>
          <Icon name="comment" size="xs" />
          {issue.comments}
        </div>
        <div className={cx(CELL, "justify-end text-xs text-ink-faint tabular")} title={new Date(issue.updatedAt).toLocaleString()}>
          {ago(issue.updatedAt)}
        </div>
      </div>
    </Row>
  );
}

/** GitHub Issues — the repository's own tracker, distinct from XTRM Issues (PRD §34.3). */
export function GithubIssuesSurface() {
  const { repo, inspect, inspected } = useShell();
  const { github } = useAdapters();
  const [view, setView] = useState<IssueView>("open");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const issues = useGithubIssues(repo.fullName);

  const rows = useMemo(() => (issues.data ? [...filterIssues(issues.data, view, query)].sort(SORTERS[sort]) : []), [issues.data, view, query, sort]);
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
        rowHeight={32}
        flush
        minWidth="28rem"
        getKey={(i) => `${i.number}`}
        header={
          <div role="row" data-testid="gh-issues-table-head" className="grid h-8 shrink-0 border-b border-border-subtle" style={GRID}>
            {COLUMNS.map((c) => (
              <div key={c.key} role="columnheader" aria-sort={c.sort && sort === c.sort ? "descending" : "none"} className={CELL}>
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => setSort(c.sort!)}
                    className={cx(
                      "flex h-full w-full items-center overflow-hidden text-[11px] font-normal outline-none hover:text-ink focus-visible:bg-hover",
                      c.align === "right" && "justify-end",
                      sort === c.sort ? "text-ink" : "text-ink-faint",
                    )}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span className={cx("truncate text-[11px] font-normal text-ink-faint", c.align === "right" && "w-full text-right")}>{c.label}</span>
                )}
              </div>
            ))}
          </div>
        }
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
      <SurfaceToolbar>
        <SourceBadge source={github.source} />
        <div role="tablist" aria-label="GitHub issue state" className="flex items-center gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cx(TOOLBAR_CONTROL, view === v.id ? "bg-pressed text-ink" : TOOLBAR_GHOST)}
            >
              {v.label}
              <span className="text-ink-faint tabular">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-pressed px-1.5 text-ink-faint transition-colors focus-within:bg-hover">
          <Icon name="search" size="xs" className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, author, label…"
            aria-label="Filter GitHub issues"
            className="w-52 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <span className="ml-auto hidden truncate text-[11px] text-ink-faint xl:inline">GitHub tracker, not XTRM Issues</span>
        <OptionsMenu
          label="GitHub issue options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void issues.refetch() },
            { label: "Open on GitHub", icon: "external", onSelect: () => void window.open(`https://github.com/${repo.fullName}/issues`, "_blank", "noreferrer") },
          ]}
        />
      </SurfaceToolbar>
      <GithubNotice repo={repo.fullName} />
      {body}
    </section>
  );
}
