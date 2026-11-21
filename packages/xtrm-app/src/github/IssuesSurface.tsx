import { useMemo, useState } from "react";
import type { GithubIssueSummary } from "../adapters/index.tsx";
import { useAdapters } from "../adapters/index.tsx";
import { useGithubIssues } from "../app/queries.ts";
import { GithubNotice } from "./auth.tsx";
import { filterIssues, githubIssueRef, issueStateLabel, issueStateTone, type IssueView } from "./issues.ts";
import { useShell } from "../shell/context.tsx";
import { Badge } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceToolbar, ago, cx } from "../ui/primitives.tsx";
import { ListFilter, ToolbarTabs } from "../ui/toolbar.tsx";
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
        <Badge key={l} size="xs" className="max-w-full truncate" title={l} style={{ flexShrink: 1, minWidth: 0 }}>
          {l}
        </Badge>
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
                      "flex h-full w-full items-center overflow-hidden text-xs font-normal outline-none hover:text-ink focus-visible:bg-hover",
                      c.align === "right" && "justify-end",
                      sort === c.sort ? "text-ink" : "text-ink-faint",
                    )}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span className={cx("truncate text-xs font-normal text-ink-faint", c.align === "right" && "w-full text-right")}>{c.label}</span>
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
        <ToolbarTabs label="GitHub issue state" value={view} onChange={(id) => setView(id as IssueView)} tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, count: counts[v.id] }))} />
        <ListFilter value={query} onChange={setQuery} placeholder="Filter GitHub issues" count={rows.length} total={issues.data?.length} />
        <span className="ml-auto hidden truncate text-xs text-ink-faint xl:inline">GitHub tracker, not XTRM Issues</span>
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
