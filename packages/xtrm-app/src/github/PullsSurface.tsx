import { useMemo, useState } from "react";
import type { PullRequestSummary } from "../adapters/index.tsx";
import { usePulls } from "../app/queries.ts";
import { filterPulls, usePrLinkedRefs, checkLabel, checkShortLabel, checkTone, reviewLabel, sortPulls, type PullSort, type PullView } from "./pr.ts";
import { ReferenceActionsProvider } from "../refs/references.tsx";
import { GithubNotice } from "./auth.tsx";
import { useShell } from "../shell/context.tsx";
import { useAdapters } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceToolbar, TOOLBAR_CONTROL, TOOLBAR_GHOST, ago, cx } from "../ui/primitives.tsx";
import { LinkedRefs } from "../ui/linked-refs.tsx";
import { PrKey } from "../ui/pr-key.tsx";
import { RowAction } from "../ui/row-action.tsx";
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
  { key: "pull", label: "Pull request", width: "minmax(0,1fr)" },
  { key: "linked", label: "Linked", width: "9.5rem" },
  { key: "author", label: "Author", width: "6.5rem" },
  { key: "diff", label: "Diff", width: "5.5rem", align: "right" },
  { key: "checks", label: "Checks", width: "6.5rem" },
  { key: "review", label: "Review", width: "6rem" },
  { key: "comments", label: "Comments", width: "5rem", align: "right", sort: "comments" },
  { key: "updated", label: "Updated", width: "4.5rem", align: "right", sort: "updated" },
];
const GRID = { gridTemplateColumns: COLUMNS.map((c) => c.width).join(" ") };
const CELL = "flex h-full min-w-0 items-center px-2";

function PullRow({ pull, fullName, selected, onOpen }: { pull: PullRequestSummary; fullName: string; selected: boolean; onOpen: () => void }) {
  const refs = usePrLinkedRefs(pull);
  return (
    <Row
      density="table"
      data-testid="pull-row"
      selected={selected}
      onActivate={onOpen}
      actions={
        <RowAction
          icon="copy"
          label={`Copy ${fullName}#${pull.number}`}
          doneLabel="Copied"
          onAct={() => void navigator.clipboard?.writeText(`${fullName}#${pull.number}`)}
        />
      }
    >
      <div className="grid h-full w-full items-center overflow-hidden" style={GRID}>
        <div className={cx(CELL, "gap-2")}>
          <PrKey number={pull.number} state={pull.state} draft={pull.draft} />
          <span className="truncate text-ink" title={`${pull.headBranch ?? "unknown"} → ${pull.baseBranch ?? "unknown"}`}>
            {pull.title}
          </span>
        </div>
        <div className={cx(CELL, "text-xs")}>
          <LinkedRefs refs={refs} max={1} />
        </div>
        <div className={cx(CELL, "text-xs text-ink-faint")}>
          <span className="truncate">{pull.author}</span>
        </div>
        <div
          className={cx(CELL, "justify-end gap-1.5 text-xs tabular")}
          title={pull.additions === null || pull.deletions === null ? "Diff counts unknown" : `${pull.additions} added, ${pull.deletions} removed`}
        >
          {pull.additions === null || pull.deletions === null ? (
            <span className="text-ink-faint">unknown</span>
          ) : (
            <>
              <span className="text-success">+{pull.additions}</span>
              <span className="text-danger">−{pull.deletions}</span>
            </>
          )}
        </div>
        <div className={cx(CELL, "gap-1.5 text-xs text-ink-faint")} title={checkLabel(pull.checks)}>
          <StatusDot tone={checkTone(pull.checks)} label={checkLabel(pull.checks)} />
          <span className="truncate">
            {checkShortLabel(pull.checks)}
          </span>
        </div>
        <div
          className={cx(CELL, "text-xs text-ink-faint")}
          title={pull.reviewCount === null ? `Review state: ${reviewLabel(pull.review)}` : `${reviewLabel(pull.review)} · ${pull.reviewCount} reviews`}
        >
          <span className="truncate">
            {reviewLabel(pull.review)}
            {pull.reviewCount !== null && pull.reviewCount > 0 && <span className="tabular"> · {pull.reviewCount}</span>}
          </span>
        </div>
        <div
          className={cx(CELL, "justify-end gap-1 text-xs text-ink-faint tabular")}
          title={
            pull.comments === null
              ? "Conversation comment count unknown"
              : `${pull.comments} conversation comments · review comments excluded`
          }
        >
          <Icon name="comment" size="xs" />
          {pull.comments ?? "unknown"}
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
              fullName={repo.fullName}
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
            <button type="button" className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST)}>
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
