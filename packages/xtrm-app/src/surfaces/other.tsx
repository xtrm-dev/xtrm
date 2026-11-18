import { useMemo } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { repoHref } from "../app/destinations.ts";
import { useRepoStats, useRepos } from "../app/queries.ts";
import { GithubNotice } from "../github/auth.tsx";
import { useGo } from "../shell/ContextSidebar.tsx";
import type { IconName } from "../ui/icon.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, SurfaceToolbar, relativeTime } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

/** Explicit deferred placeholder: the route is real, the surface is not built in this vertical. */
export function DeferredSurface({ title, icon, reason }: { title: string; icon: IconName; reason: string }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={title}>
      <SurfaceToolbar>
        <span className="text-[11px] text-ink-faint">{title}</span>
        <span className="text-xs text-ink-faint">deferred</span>
      </SurfaceToolbar>
      <EmptyState icon={icon} title={`${title} is not part of this vertical`} className="flex-1">
        {reason}
      </EmptyState>
    </section>
  );
}

export function RepositoriesSurface() {
  const { github } = useAdapters();
  const repos = useRepos();
  const stats = useRepoStats();
  const go = useGo();

  const ordered = useMemo(() => {
    const byName = new Map(stats.data?.map((s) => [s.fullName, s]));
    return (repos.data ?? [])
      .map((r) => ({ repo: r, stats: byName.get(r.fullName) }))
      .sort((a, b) => (b.stats?.lastEventAt ?? "").localeCompare(a.stats?.lastEventAt ?? "") || a.repo.fullName.localeCompare(b.repo.fullName));
  }, [repos.data, stats.data]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Repositories">
      <SurfaceToolbar>
        <span className="text-[11px] text-ink-faint tabular">{ordered.length}</span>
        <SourceBadge source={github.source} />
      </SurfaceToolbar>
      <GithubNotice />
      {repos.isPending ? (
        <LoadingState label="Loading repositories" />
      ) : repos.isError ? (
        <ErrorState title="GitHub backend is unavailable" error={repos.error} />
      ) : (
        <VirtualList
          label="Repositories"
          items={ordered}
          rowHeight={36}
          getKey={(x) => x.repo.fullName}
          renderRow={({ repo, stats: s }) => (
            <Row onActivate={() => go(repoHref(repo, "/work/issues"))}>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-ink-faint">{repo.owner}/</span>
                <span className="text-ink">{repo.name}</span>
              </span>
              {s && (
                <span className="shrink-0 text-xs text-ink-faint tabular" title="Console v1 reports 24h event counts, not open totals">
                  {s.pushes} pushes · {s.prEvents24h} PR events (24h)
                </span>
              )}
              <span className="w-10 shrink-0 text-right text-xs text-ink-faint tabular">{relativeTime(s?.lastEventAt ?? null)}</span>
            </Row>
          )}
        />
      )}
    </section>
  );
}
