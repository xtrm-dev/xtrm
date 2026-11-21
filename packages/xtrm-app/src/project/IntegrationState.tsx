import type { ProjectBinding, ProjectHealth } from "../adapters/status-board/types.ts";
import { useGo } from "../shell/ContextSidebar.tsx";
import { Badge } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { EmptyState, ago } from "../ui/primitives.tsx";

/**
 * The honest state of one repository's Project integration (ADR-002 §D2/§D7, §4).
 *
 * Unbound: one block, not empty sections — no banner pretends the board was read.
 * Stale or dead sync: one read-only banner with the facts the bridge verified; the
 * surface below keeps showing the last records and their cache age.
 *
 * Nothing here renders when the binding is live, fresh and running.
 */
export function IntegrationState({ binding, health, base }: { binding: ProjectBinding | null; health: ProjectHealth | null; base: string }) {
  const go = useGo();
  const unbound = binding !== null && !binding.configured;
  const stale = health?.stale === true;
  const dead = health?.unitActive === false;
  if (!unbound && !stale && !dead) return null;

  if (unbound) {
    const reason =
      binding.reason === "config_absent"
        ? "This deployment has no project-management configuration, so no repository has a status-board binding."
        : `No project-management binding names ${binding.repository}. The board is not read for this repository.`;
    return (
      <div data-testid="integration-unbound" className="flex min-h-0 flex-1 flex-col">
        <EmptyState icon="program" title="This repository is not integrated" className="flex-1">
          <p>{reason}</p>
          <p className="mt-2 text-ink-faint">
            Project reads the status board only through a binding. Until one exists, Overview shows no counts and makes no board request.
          </p>
          <button
            type="button"
            onClick={() => go(`${base}/project/settings`)}
            className="mt-3 text-xs text-ink-muted underline decoration-border-strong underline-offset-2 outline-none hover:text-ink focus-visible:text-ink"
          >
            Open the Integration surface
          </button>
        </EmptyState>
      </div>
    );
  }

  const lastSync = health?.lastSyncOkAt ? `last successful sync ${ago(health.lastSyncOkAt)}` : "no recorded successful sync";
  const label = stale ? "The board sync is stale" : `The board sync unit ${health?.timerUnit ? `(${health.timerUnit}) ` : ""}is not running`;
  const detail = stale
    ? `Records below are the last read; ${lastSync}.`
    : `Records stop updating until the unit runs again; ${lastSync}.`;

  return (
    <div data-testid="integration-stale" role="status" className="flex items-start gap-2 border-b border-border-muted px-3 py-2">
      <Icon name="alert" size="text" className="mt-px shrink-0 text-danger" />
      <div className="min-w-0 flex-1 text-xs">
        <p className="flex items-center gap-2 text-ink">
          {label}
          <Badge tone="danger" size="xs">
            read-only
          </Badge>
        </p>
        <p className="text-ink-faint">
          {detail}
          {health?.driftCount ? ` ${health.driftCount} drifted record${health.driftCount === 1 ? "" : "s"}.` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => go(`${base}/project/settings`)}
        className="shrink-0 text-xs text-ink-muted outline-none hover:text-ink focus-visible:text-ink"
      >
        Integration →
      </button>
    </div>
  );
}
