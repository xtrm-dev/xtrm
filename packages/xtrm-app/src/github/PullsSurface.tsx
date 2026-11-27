import { useMemo, useState } from "react";
import type { PullRequestSummary } from "../adapters/index.tsx";
import { usePulls } from "../app/queries.ts";
import { ALL_PULL_STATES, filterPulls, usePrLinkedRefs, checkLabel, checkShortLabel, reviewLabel, sortPulls, type PullSort, type PullState } from "./pr.ts";
import { ReferenceActionsProvider } from "../refs/references.tsx";
import { GithubNotice } from "./auth.tsx";
import { useShell } from "../shell/context.tsx";
import { useAdapters } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { EmptyState, ErrorState, LoadingState, SourceBadge, SurfaceToolbar, ago } from "../ui/primitives.tsx";
import { ListFilter, ToolbarButton, ToolbarMultiFilter } from "../ui/toolbar.tsx";
import { LinkedRefs } from "../ui/linked-refs.tsx";
import { PrStateChip, prStateMeta } from "../ui/pr-key.tsx";
import { KeyChip, ListRow } from "../ui/list-row.tsx";
import { RowAction } from "../ui/row-action.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

const SORTS: Array<{ id: PullSort; label: string }> = [
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Newest" },
  { id: "comments", label: "Most commented" },
];

/** Tint pills for the rollups: green and red only where the state asks for action or is done. */
const CHECK_TONE: Record<NonNullable<PullRequestSummary["checks"]> | "unknown", BadgeTone> = {
  passing: "success",
  failing: "danger",
  pending: "neutral",
  none: "muted",
  unknown: "muted",
};
const REVIEW_TONE: Record<NonNullable<PullRequestSummary["review"]> | "unknown", BadgeTone> = {
  approved: "success",
  changes_requested: "danger",
  commented: "neutral",
  pending: "neutral",
  none: "muted",
  unknown: "muted",
};

function PullRow({ pull, fullName, selected, onOpen }: { pull: PullRequestSummary; fullName: string; selected: boolean; onOpen: () => void }) {
  const refs = usePrLinkedRefs(pull);
  const hasDiff = pull.additions !== null && pull.deletions !== null;
  return (
    // One line, no columns (2026-11-24 ruling): identity, state, title, then the rollups at the right
    // edge. The trailing cluster sheds widest-first (linked, then review), so nothing is dropped by a
    // measured column width and no header has to name a track.
    <ListRow
      testId="pull-row"
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
      leading={
        <>
          <KeyChip label={`Pull request #${pull.number}`} title={`#${pull.number} · ${prStateMeta(pull.state, pull.draft).word}`}>
            #{pull.number}
          </KeyChip>
          <PrStateChip state={pull.state} draft={pull.draft} size="xs" />
        </>
      }
      title={<span title={`${pull.headBranch ?? "unknown"} → ${pull.baseBranch ?? "unknown"}`}>{pull.title}</span>}
      titleClassName={pull.state === "merged" || pull.state === "closed" ? "text-ink-muted" : undefined}
      trailing={
        <>
          <span className="hidden items-center 2xl:inline-flex">
            <LinkedRefs refs={refs} max={1} />
          </span>
          <span className="truncate" title={pull.author}>
            {pull.author}
          </span>
          {/* An absent metric is stated, not shouted: it keeps its accessible name and drops to the
              faint ink, so a poller that has not enriched a row does not turn the list into noise. */}
          {/* The diff reads in GitHub's own colours, bold, so the size of a change is the first
              thing the eye finds in the cluster (XTRM-1136). */}
          {hasDiff ? (
            <span className="inline-flex gap-1 font-semibold tabular" data-testid="pull-diff" title={`${pull.additions} added, ${pull.deletions} removed`}>
              <span className="text-success-ink">+{pull.additions}</span>{" "}
              <span className="text-danger">−{pull.deletions}</span>
            </span>
          ) : (
            <span className="tabular text-ink-faint" data-testid="pull-diff" title="Diff counts unknown">
              unknown
            </span>
          )}
          <Badge tone={CHECK_TONE[pull.checks ?? "unknown"]} size="xs" title={checkLabel(pull.checks)} data-testid="pull-checks">
            {checkShortLabel(pull.checks)}
          </Badge>
          {/* The wrapper sheds the pill below xl: a Badge emits its own inline-flex, which would win over
              a `hidden` class on the Badge itself. */}
          <span className="hidden xl:inline-flex">
            <Badge
              tone={REVIEW_TONE[pull.review ?? "unknown"]}
              size="xs"
              title={pull.reviewCount ? `${reviewLabel(pull.review)} · ${pull.reviewCount} reviews` : `Review state: ${reviewLabel(pull.review)}`}
              data-testid="pull-review"
            >
              {reviewLabel(pull.review)}
            </Badge>
          </span>
          <span
            className="inline-flex items-center gap-1 tabular"
            title={pull.comments === null ? "Conversation comment count unknown" : `${pull.comments} conversation comments · review comments excluded`}
          >
            <Icon name="comment" size="micro" />
            {pull.comments ?? "unknown"}
          </span>
          <span className="tabular" title={new Date(pull.updatedAt).toLocaleString()}>
            {ago(pull.updatedAt)}
          </span>
        </>
      }
    />
  );
}

export function PullsSurface() {
  const { repo, inspect, inspected } = useShell();
  const { github } = useAdapters();
  const [states, setStates] = useState<ReadonlySet<PullState>>(() => new Set(ALL_PULL_STATES));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PullSort>("updated");
  const pulls = usePulls(repo.fullName, "all", false);

  const rows = useMemo(() => {
    if (!pulls.data) return [];
    return sortPulls(filterPulls(pulls.data, states, query), sort);
  }, [pulls.data, states, query, sort]);

  const stateCounts = useMemo(() => {
    const counts: Record<PullState, number> = { open: 0, merged: 0, closed: 0 };
    for (const pull of pulls.data ?? []) counts[pull.state] += 1;
    return counts;
  }, [pulls.data]);

  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? "Recently updated";

  let body;
  if (pulls.isPending) body = <LoadingState label="Loading pull requests" />;
  else if (pulls.isError) body = <ErrorState title="GitHub backend is unavailable" error={pulls.error} />;
  else if (!rows.length)
    body = (
      <EmptyState
        icon="pull"
        title={
          states.size === 0
            ? "No state is selected"
            : `No pull requests${query ? ` matching “${query}”` : ` for ${repo.fullName}`}`
        }
      >
        {states.size === 0
          ? "Open the State filter and choose at least one state, or use Select all."
          : query
            ? "Clear the filter or widen the state filter."
            : "Pull requests appear here once the backend poller records them."}
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
          minWidth="24rem"
          getKey={(p) => `${p.number}`}
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
        <ToolbarMultiFilter
          label="State"
          values={states}
          options={ALL_PULL_STATES.map((state) => ({ value: state, label: state[0]!.toUpperCase() + state.slice(1), count: stateCounts[state] }))}
          onChange={setStates}
        />
        <ListFilter value={query} onChange={setQuery} placeholder="Filter pull requests" count={rows.length} total={pulls.data?.length} />
        <OptionsMenu
          label="Sort pull requests"
          trigger={
            <ToolbarButton>
              {sortLabel} <Icon name="chevronDown" size="micro" className="text-ink-faint" />
            </ToolbarButton>
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
