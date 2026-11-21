import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import type { FollowUp } from "../../adapters/status-board/types.ts";
import { useShell } from "../../shell/context.tsx";
import { ErrorState, LoadingState } from "../../ui/primitives.tsx";
import { SectionHeader } from "../../ui/section.tsx";
import { IntegrationState } from "../IntegrationState.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { FOLLOWUP_COLUMNS, FollowUpRow } from "./FollowUpRow.tsx";
import { logContractGap } from "../workers/model.ts";

/**
 * Project Follow-ups (console-ui-system §5/§6 sibling, XTRM-819): the board's
 * `followups/*` commitment list — ref, title, priority, status, owner, when, and the
 * typed refs that made the commitment.
 *
 * Every ref resolves through the app's reference system and renders as plain text
 * when it does not (CONSTRAINTS: never a dead chip). Read-only, ADR-002 assumption 3.
 */

/** Priority order the operator writes (`P0` most urgent); anything else sorts last, unguessed. */
export function priorityRank(priority: string | undefined): number {
  const m = /^P(\d+)$/.exec(priority ?? "");
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

const STATUS_ORDER = ["open", "deferred", "done", "cancelled"];

export function groupFollowUps(followUps: FollowUp[]): Array<{ status: string | null; rows: FollowUp[] }> {
  const buckets = new Map<string | null, FollowUp[]>();
  for (const f of followUps) {
    const status = f.status ?? null;
    if (status !== null && !STATUS_ORDER.includes(status)) logContractGap(`follow-up status "${status}" is not in the known set`);
    buckets.set(status, [...(buckets.get(status) ?? []), f]);
  }
  const rank = (status: string | null) => {
    const i = status === null ? STATUS_ORDER.length : STATUS_ORDER.indexOf(status);
    return i === -1 ? STATUS_ORDER.length + 1 : i;
  };
  return [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || String(a[0]).localeCompare(String(b[0])))
    .map(([status, rows]) => ({
      status,
      rows: rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.ref.localeCompare(b.ref)),
    }));
}

export function FollowUpsSurface() {
  const { repo } = useShell();
  const { statusBoard } = useAdapters();
  const repository = repo.fullName;
  const base = `/rep/${repo.owner}/${repo.name}`;

  const binding = useQuery({ queryKey: ["project", "binding", repository], queryFn: () => statusBoard.binding(repository), staleTime: 60_000 });
  const bound = binding.data?.configured === true;
  const health = useQuery({ queryKey: ["project", "health", repository], queryFn: () => statusBoard.health(repository), staleTime: 60_000, enabled: bound });
  const followUps = useQuery({ queryKey: ["project", "followups", repository], queryFn: () => statusBoard.listFollowUps(repository), staleTime: 60_000, enabled: bound });

  const rows = (followUps.data?.records ?? []).map((r) => r.doc);
  const groups = groupFollowUps(rows);

  const shell = (children: ReactNode) => (
    <ProjectShell
      title="Follow-ups"
      binding={binding.data ?? null}
      health={bound ? (health.data ?? null) : null}
      source={statusBoard.source}
      toolbar={<span className="text-xs text-ink-faint" data-testid="followups-count">{rows.length} follow-ups</span>}
    >
      {children}
    </ProjectShell>
  );

  if (!bound) return shell(<IntegrationState binding={binding.data ?? null} health={null} base={base} />);
  if (followUps.isLoading) return shell(<LoadingState label="Loading follow-ups" />);
  if (followUps.error) return shell(<ErrorState title="Follow-ups could not be read" error={followUps.error} />);

  return shell(
    <div data-testid="followups-list">
      {groups.length === 0 && <p className="px-3 py-2 text-xs text-ink-faint">No follow-ups on this board.</p>}
      {/* Column labels share the row grid, so the reading order is stable down the list. */}
      <div className="px-3 pt-2 pb-1 text-xs text-ink-faint" data-testid="followups-columns" aria-hidden>
        <div className={FOLLOWUP_COLUMNS}>
          <span>follow-up</span>
          <span className="text-right">pri</span>
          <span>state</span>
          <span>owner</span>
          <span>when</span>
          <span>refs</span>
        </div>
      </div>
      {groups.map((group) => (
        <section key={group.status ?? "no-status"} aria-label={`Follow-ups ${group.status ?? "without a status"}`}>
          <SectionHeader title={group.status ?? "no status"} count={group.rows.length} inset="list" level={3} />
          {group.rows.map((f) => (
            <FollowUpRow key={`${f.ref}:${f.title ?? f.plain ?? ""}`} followUp={f} />
          ))}
        </section>
      ))}
    </div>,
  );
}
