import { useAdapters, type RepoEvent } from "../adapters/index.tsx";
import { useEvents } from "../app/queries.ts";
import { GithubNotice } from "../github/auth.tsx";
import { activityRef, eventTitle } from "../shell/Inspector.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, SurfaceToolbar, relativeTime } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

const ICON: Record<RepoEvent["kind"], IconName> = {
  push: "commit",
  pull_request: "pull",
  issue_comment: "comment",
  issue: "comment",
  release: "release",
  create: "branch",
  delete: "delete",
  other: "activity",
};

export function ActivitySurface() {
  const { repo, inspect, inspected, layout } = useShell();
  const { github } = useAdapters();
  const follow = layout.inspector.followLive && inspected?.kind === "activity";
  const events = useEvents(repo.fullName, follow);

  let body;
  if (events.isPending) body = <LoadingState label="Loading activity" />;
  else if (events.isError) body = <ErrorState title="GitHub backend is unavailable" error={events.error} />;
  else if (!events.data.length) body = <EmptyState icon="activity" title={`No recorded activity for ${repo.fullName}`} />;
  else
    body = (
      <VirtualList
        label="Repository activity"
        items={events.data}
        rowHeight={44}
        getKey={(e) => e.id}
        renderRow={(e) => {
          const ref = activityRef(e);
          return (
            <Row className="h-11" selected={inspected?.kind === "activity" && inspected.ref === ref} onActivate={() => inspect({ kind: "activity", ref })}>
              <Icon name={ICON[e.kind]} size="xs" className="shrink-0 text-ink-faint" />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-ink">{eventTitle(e)}</span>
                <span className="truncate text-xs text-ink-faint">
                  {e.actor}
                  {e.action && ` ${e.action}`}
                  {e.branch && ` · ${e.branch}`}
                </span>
              </div>
              {e.additions != null && (
                <span className="shrink-0 text-xs tabular">
                  <span className="text-diff-add">+{e.additions}</span> <span className="text-diff-del">−{e.deletions ?? 0}</span>
                </span>
              )}
              <span className="w-10 shrink-0 text-right text-xs text-ink-faint tabular">{relativeTime(e.createdAt)}</span>
            </Row>
          );
        }}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Repository activity">
      <SurfaceToolbar>
        <span className="truncate text-[11px] text-ink-faint">{repo.fullName}</span>
        <SourceBadge source={github.source} />
        {events.data && <span className="text-[11px] text-ink-faint tabular">{events.data.length} events</span>}
        <div className="ml-auto" />
        <OptionsMenu
          label="Activity options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void events.refetch() },
            { label: "Open on GitHub", icon: "external", onSelect: () => void window.open(`https://github.com/${repo.fullName}`, "_blank", "noreferrer") },
          ]}
        />
      </SurfaceToolbar>
      <GithubNotice repo={repo.fullName} />
      {body}
    </section>
  );
}
