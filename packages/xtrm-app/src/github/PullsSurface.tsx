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
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceHeader, ago, cx } from "../ui/primitives.tsx";
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
    <Row className="h-11" data-testid="pull-row" selected={selected} onActivate={onOpen}>
      <StatusDot tone={pullStateTone(pull.state)} label={pullStateLabel(pull.state, pull.draft)} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-xs text-ink-faint">#{pull.number}</span>
          <span className="truncate text-ink">{pull.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 truncate text-xs text-ink-faint">
          <span className="truncate">
            {pull.author} · {pull.headBranch} → {pull.baseBranch}
          </span>
          <IssueChips pull={pull} />
        </span>
      </div>
      <span className="hidden shrink-0 items-center gap-1 text-xs text-ink-faint tabular md:inline-flex" title={checkLabel(pull.checks)}>
        <StatusDot tone={checkTone(pull.checks)} label={checkLabel(pull.checks)} />
        {pull.checks === "none" ? "—" : checkLabel(pull.checks).replace("checks ", "")}
      </span>
      <span className="hidden w-24 shrink-0 truncate text-right text-xs text-ink-faint lg:inline" title={reviewLabel(pull.review)}>
        {reviewLabel(pull.review)}
      </span>
      <span className="w-10 shrink-0 text-right text-xs text-ink-faint tabular" title={new Date(pull.updatedAt).toLocaleString()}>
        {ago(pull.updatedAt)}
      </span>
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
          rowHeight={44}
          getKey={(p) => `${p.number}`}
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
      <SurfaceHeader
        title="Pull requests"
        meta={
          <>
            <span>{repo.fullName}</span>
            <SourceBadge source={github.source} />
            {pulls.data && <span className="tabular">{rows.length} of {pulls.data.length}</span>}
          </>
        }
      >
        <OptionsMenu
          label="Pull request options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void pulls.refetch() },
            { label: "Open on GitHub", icon: "external", onSelect: () => void window.open(`https://github.com/${repo.fullName}/pulls`, "_blank", "noreferrer") },
          ]}
        />
      </SurfaceHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-muted px-4 py-2">
        <div role="tablist" aria-label="Pull request state" className="flex items-center gap-1">
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
              <span className="text-xs text-ink-faint tabular">{visibleCounts[v.id]}</span>
            </button>
          ))}
        </div>
        <label className="flex h-7 min-w-40 flex-1 items-center gap-2 rounded-md border border-border-muted px-2 text-sm text-ink-faint focus-within:border-border-strong sm:max-w-64">
          <Icon name="search" size="xs" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, author, branch…"
            aria-label="Filter pull requests"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        <label className="flex h-7 items-center gap-1.5 text-xs text-ink-faint">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as PullSort)}
            aria-label="Sort pull requests"
            className="h-7 rounded-md border border-border-muted bg-surface px-1.5 text-xs text-ink outline-none focus:border-border-strong"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GithubNotice repo={repo.fullName} />
      {body}
    </section>
  );
}
