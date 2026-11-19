import type { ReactNode } from "react";
import type { DataSource } from "../adapters/types.ts";
import type { ProjectBinding, ProjectHealth } from "../adapters/status-board/types.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { SourceBadge, SurfaceToolbar, ago } from "../ui/primitives.tsx";

/**
 * The repository section's one header (ADR-002 §D9, console-ui-system §5):
 * repository, binding badge and freshness, then the source badge. The header
 * never scrolls with the records; the section body owns its own scroll.
 *
 * Freshness (§4): `synced 2m ago` while the sync is healthy, `never synced` when
 * the bridge recorded no success, `checking sync` while the read is in flight.
 * A stale or dead sync is a banner from `IntegrationState`, not a red number here.
 */
export function ProjectShell({
  title,
  binding,
  health,
  freshness: freshnessOverride,
  source,
  toolbar,
  children,
}: {
  /** Accessible name of the section; the route's own surface name. */
  title: string;
  /** The section's binding badge; the header reads only `configured`. */
  binding: Pick<ProjectBinding, "configured"> | null;
  /** The board sync's health, when the section reads it: the Jira section has no sync of its own. */
  health?: ProjectHealth | null;
  /** Replaces the board-derived freshness for a section whose freshness is not a board sync. */
  freshness?: string;
  source: DataSource;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const { repo } = useShell();
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={title}>
      <SurfaceToolbar>
        <span className="flex min-w-0 items-center gap-1 pl-1">
          <Icon name="program" size="sm" className="shrink-0 text-ink-faint" />
          <span className="truncate text-sm" data-testid="project-repository">
            <span className="text-ink-faint">{repo.owner}/</span>
            <span className="text-ink">{repo.name}</span>
          </span>
        </span>
        {binding !== null && (
          <span className="shrink-0 text-xs text-ink-muted" data-testid="project-binding">
            {binding.configured ? "bound" : "unbound"}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-ink-faint tabular" data-testid="project-freshness">
          {freshnessOverride ?? freshness(health ?? null)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {toolbar}
          <SourceBadge source={source} />
        </span>
      </SurfaceToolbar>
      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </section>
  );
}

export function freshness(health: ProjectHealth | null): string {
  if (health === null) return "checking sync";
  if (!health.configured) return "not integrated";
  if (health.runInProgress === true) return "syncing now";
  const synced = health.lastSyncOkAt ? `synced ${ago(health.lastSyncOkAt)}` : "never synced";
  // `unitActive: null` is "not verified", never "the sync is down" (§4).
  return health.unitActive === null ? `${synced} · sync unverified` : synced;
}
