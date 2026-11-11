import { useMemo, useState } from "react";
import type { PullRequestSummary } from "../adapters/index.tsx";
import { usePulls } from "../app/queries.ts";
import { extractIssueKeys, filterPulls, pullStateLabel, pullStateTone, checkLabel, checkTone, reviewLabel, sortPulls, type PullSort, type PullView } from "./pr.ts";
import { ReferenceActionsProvider, ReferenceChip, useIssueIndex } from "../refs/references.tsx";
import { GithubNotice } from "./auth.tsx";
import { useShell } from "../shell/context.tsx";
import { useAdapters } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceToolbar, TOOLBAR_CONTROL, TOOLBAR_GHOST, TOOLBAR_REST, ago, cx } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

const VIEWS: Array<{ id: PullView; label: string }> = [
  { id: "open", label: "Open" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
];

const SORTS: Array<{ id: PullSort; label: string }> = [
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Newest" },
  { id: "comments", label: "Most commented" },
];

/** The row grid: one line per PR, same column rhythm as the issues table. */
const COLUMNS: Array<{ key: string; label: string; width: string; align?: "right"; sort?: PullSort }> = [
  { key: "state", label: "", width: "1.75rem" },
  { key: "pull", label: "Pull request", width: "minmax(0,1fr)" },
  { key: "author", label: "Author", width: "6.5rem" },
  { key: "diff", label: "Diff", width: "5.5rem", align: "right" },
  { key: "checks", label: "Checks", width: "6.5rem" },
  { key: "review", label: "Review", width: "6rem" },
  { key: "comments", label: "Comments", width: "5rem", align: "right", sort: "comments" },
  { key: "updated", label: "Updated", width: "4.5rem", align: "right", sort: "updated" },
];
const GRID = { gridTemplateColumns: COLUMNS.map((c) => c.width).join(" ") };
const CELL = "flex h-full min-w-0 items-center px-2";

function IssueChips({ pull }: { pull: PullRequestSummary }) {
  const index = useIssueIndex();
  const keys = useMemo(() => {
    // Dedupe by resolved issue: a locator and its flat ref (XTRM-300.1 / XTRM-301)
    // point at the same row and must not render twice.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of extractIssueKeys(pull.title, pull.headBranch, pull.body)) {
      const resolved = index.get(key)?.ref ?? key;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(key);
      }
    }
    return out;
  }, [pull.title, pull.headBranch, pull.body, index]);
  if (!keys.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {keys.slice(0, 3).map((key) => (
        <ReferenceChip key={key} reference={{ kind: "issue", ref: key }} />
      ))}
    </span>
  );
}

function PullRow({ pull, selected, onOpen }: { pull: PullRequestSummary; selected: boolean; onOpen: () => void }) {
  return (
    <Row density="table" data-testid="pull-row" selected={selected} onActivate={onOpen}>
      <div className="grid h-full w-full items-center overflow-hidden" style={GRID}>
        <div className={CELL}>
          <StatusDot tone={pullStateTone(pull.state)} label={pullStateLabel(pull.state, pull.draft)} />
        </div>
        <div className={cx(CELL, "gap-2")}>
          <span className="shrink-0 font-mono text-xs text-ink-faint">#{pull.number}</span>
          <span className="truncate text-ink" title={`${pull.headBranch} → ${pull.baseBranch}`}>
            {pull.title}
          </span>
          <IssueChips pull={pull} />
        </div>
        <div className={cx(CELL, "text-xs text-ink-faint")}>
          <span className="truncate">{pull.author}</span>
        </div>
        <div className={cx(CELL, "justify-end gap-1.5 text-xs tabular")}>
          <span className="text-success">+{pull.additions}</span>
          <span className="text-danger">−{pull.deletions}</span>
        </div>
        <div className={cx(CELL, "gap-1.5 text-xs text-ink-faint")} title={checkLabel(pull.checks)}>
          <StatusDot tone={checkTone(pull.checks)} label={checkLabel(pull.checks)} />
          <span className="truncate">{pull.checks === "none" ? "—" : checkLabel(pull.checks).replace("checks ", "")}</span>
        </div>
        <div className={cx(CELL, "text-xs text-ink-faint")} title={reviewLabel(pull.review)}>
          <span className="truncate">{reviewLabel(pull.review)}</span>
        </div>
        <div className={cx(CELL, "justify-end gap-1 text-xs text-ink-faint tabular")} title={`${pull.comments} comments`}>
          <Icon name="comment" size="xs" />
          {pull.comments}
        </div>
        <div className={cx(CELL, "justify-end text-xs text-ink-faint tabular")} title={new Date(pull.updatedAt).toLocaleString()}>
          {ago(pull.updatedAt)}
        </div>
      </div>
    </Row>
  );
}

export function PullsSurface() {
  const { repo, inspect, inspected } = useShell();
  const { github } = useAdapters();
  const [view, setView] = useState<PullView>("open");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PullSort>("updated");
  const pulls = usePulls(repo.fullName, "all", false);

  const rows = useMemo(() => {
    if (!pulls.data) return [];
    return sortPulls(filterPulls(pulls.data, view, query), sort);
  }, [pulls.data, view, query, sort]);

  const visibleCounts = useMemo(() => {
    if (!pulls.data) return { open: 0, merged: 0, closed: 0 };
    return {
      open: pulls.data.filter((p) => p.state === "open").length,
      merged: pulls.data.filter((p) => p.state === "merged").length,
      closed: pulls.data.filter((p) => p.state === "closed").length,
    };
  }, [pulls.data]);

  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? "Recently updated";

  let body;
  if (pulls.isPending) body = <LoadingState label="Loading pull requests" />;
  else if (pulls.isError) body = <ErrorState title="GitHub backend is unavailable" error={pulls.error} />;
  else if (!rows.length)
    body = (
      <EmptyState icon="pull" title={`No ${view} pull requests${query ? ` matching “${query}”` : ` for ${repo.fullName}`}`}>
        {query ? "Clear the filter or try another view." : "Open PRs appear here once the backend poller records them."}
      </EmptyState>
    );
  else
    body = (
      <ReferenceActionsProvider open={(r) => r.kind === "issue" && inspect(r)}>
        <VirtualList
          label="Pull requests"
          items={rows}
          rowHeight={32}
          flush
          minWidth="28rem"
          getKey={(p) => `${p.number}`}
          header={
            <div role="row" data-testid="pulls-table-head" className="grid h-8 shrink-0 border-b border-border-subtle" style={GRID}>
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
          renderRow={(p) => (
            <PullRow
              pull={p}
              selected={inspected?.kind === "pr" && inspected.ref === `${repo.fullName}#${p.number}`}
              onOpen={() => inspect({ kind: "pr", ref: `${repo.fullName}#${p.number}` })}
            />
          )}
        />
      </ReferenceActionsProvider>
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Pull requests">
      <SurfaceToolbar>
        <SourceBadge source={github.source} />
        <div role="tablist" aria-label="Pull request state" className="flex items-center gap-0.5">
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
              <span className="text-ink-faint tabular">{visibleCounts[v.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-pressed px-1.5 text-ink-faint transition-colors focus-within:bg-hover">
          <Icon name="search" size="xs" className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, author, branch…"
            aria-label="Filter pull requests"
            className="w-52 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <OptionsMenu
          label="Sort pull requests"
          trigger={
            <button type="button" className={cx(TOOLBAR_CONTROL, TOOLBAR_REST)}>
              {sortLabel} <Icon name="chevronDown" size="xs" className="text-ink-faint" />
            </button>
          }
          items={SORTS.map((s) => ({ label: s.label, onSelect: () => setSort(s.id) }))}
        />
        <div className="ml-auto">
          <OptionsMenu
            label="Pull request options"
            items={[
              { label: "Refresh", icon: "live", onSelect: () => void pulls.refetch() },
              { label: "Open on GitHub", icon: "external", onSelect: () => void window.open(`https://github.com/${repo.fullName}/pulls`, "_blank", "noreferrer") },
            ]}
          />
        </div>
      </SurfaceToolbar>
      <GithubNotice repo={repo.fullName} />
      {body}
    </section>
  );
}
