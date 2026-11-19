import { useAdapters, type Release } from "../adapters/index.tsx";
import { useReleases } from "../app/queries.ts";
import { ReferenceActionsProvider } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, SourceBadge, SurfaceToolbar, ago } from "../ui/primitives.tsx";

function ReleaseEntry({ release, latest }: { release: Release; latest: boolean }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      <span aria-hidden className="absolute top-4 bottom-0 left-[5px] w-px bg-border-muted" />
      <span className={`mt-1.5 size-[0.6875rem] shrink-0 rounded-full border ${latest ? "border-accent bg-accent" : "border-border-strong bg-surface"}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-ink">{release.name}</h3>
          <span className="rounded-sm bg-control px-1.5 py-px font-mono text-xs text-ink-muted">{release.tag}</span>
          {latest && <span className="rounded-sm bg-accent-soft px-1.5 py-px text-xs text-accent-ink">latest</span>}
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
            {release.author && <span>{release.author}</span>}
            {release.publishedAt ? (
              <time dateTime={release.publishedAt} title={new Date(release.publishedAt).toLocaleString()} className="tabular">
                {ago(release.publishedAt)}
              </time>
            ) : (
              <span>unpublished</span>
            )}
            <a href={release.url} target="_blank" rel="noreferrer" aria-label={`Open ${release.tag} on GitHub`} className="text-ink-faint hover:text-ink">
              <Icon name="external" size="xs" />
            </a>
          </span>
        </div>
        {release.notes ? (
          <div className="rounded-md border border-border-muted px-3 py-2">
            <Markdown>{release.notes}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No release notes.</p>
        )}
      </div>
    </li>
  );
}

/** Releases timeline. Issue keys in the notes render as reference chips through the shared Markdown component. */
export function ReleasesSurface() {
  const { repo, inspect } = useShell();
  const { github } = useAdapters();
  const releases = useReleases(repo.fullName);

  let body;
  if (releases.isPending) body = <LoadingState label="Loading releases" />;
  else if (releases.isError) body = <ErrorState title="GitHub backend is unavailable" error={releases.error} />;
  else if (!releases.data.length)
    body = (
      <EmptyState icon="release" title={`No releases for ${repo.fullName}`}>
        Published releases appear here once the backend poller records them.
      </EmptyState>
    );
  else
    body = (
      <ReferenceActionsProvider open={(r) => inspect(r)}>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ol className="flex flex-col">
            {releases.data.map((r, i) => (
              <ReleaseEntry key={r.id} release={r} latest={i === 0} />
            ))}
          </ol>
        </div>
      </ReferenceActionsProvider>
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Releases">
      <SurfaceToolbar>
        <SourceBadge source={github.source} />
        {releases.data && <span className="px-1 text-xs text-ink-faint tabular">{releases.data.length} releases</span>}
        <div className="ml-auto">
          <OptionsMenu
            label="Release options"
            items={[
              { label: "Refresh", icon: "live", onSelect: () => void releases.refetch() },
              { label: "Open on GitHub", icon: "external", onSelect: () => void window.open(`https://github.com/${repo.fullName}/releases`, "_blank", "noreferrer") },
            ]}
          />
        </div>
      </SurfaceToolbar>
      {body}
    </section>
  );
}
