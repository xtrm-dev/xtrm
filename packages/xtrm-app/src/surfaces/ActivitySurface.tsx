import { useMemo, useState } from "react";
import { projectForRepo, useActivityFeed, useProjects } from "../app/queries.ts";
import { ReferenceChip } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { EmptyState, ErrorState, LoadingState, Row, TOOLBAR_CONTROL, TOOLBAR_GHOST, TOOLBAR_REST, SurfaceToolbar, cx, relativeTime } from "../ui/primitives.tsx";
import { activityCounts, filterActivity, mergeActivity } from "../activity/merge.ts";
import type { ActivityRow, ActivitySource } from "../activity/types.ts";

/** Source chip: the one new visual element, built from the badge tone set. */
const SOURCE_LABEL: Record<ActivitySource, string> = { substrate: "substrate", github: "github", git: "git", jira: "jira" };
const SOURCE_TONE: Record<ActivitySource, BadgeTone> = { substrate: "accent", github: "neutral", git: "muted", jira: "muted" };

function SourceChip({ source }: { source: ActivitySource }) {
  return (
    <Badge tone={SOURCE_TONE[source]} size="xs" className="uppercase tracking-wide">
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

/**
 * The filter row: counts, never bare toggles. Jira stays out until it is
 * connected. A source that FAILED shows an em dash instead of 0 — a failure is
 * not "nothing happened", and the surface says so in words beside the chip.
 */
function Filters({ total, bySource, active, failedSources, onPick }: { total: number; bySource: Record<ActivitySource, number>; active: ActivitySource | null; failedSources: ReadonlySet<ActivitySource>; onPick: (s: ActivitySource | null) => void }) {
  const chips: Array<{ source: ActivitySource | null; label: string; count: number }> = [
    { source: null, label: "All", count: total },
    { source: "substrate", label: "Substrate", count: bySource.substrate },
    { source: "github", label: "GitHub", count: bySource.github },
    { source: "git", label: "Git", count: bySource.git },
  ];
  return (
    <SurfaceToolbar>
      {chips.map((chip) => {
        const on = active === chip.source;
        return (
          <button
            key={chip.label}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(chip.source)}
            className={cx(TOOLBAR_CONTROL, on ? TOOLBAR_REST : TOOLBAR_GHOST, "gap-1.5")}
          >
            <span>{chip.label}</span>
            <span className="tabular text-ink-faint">
              {chip.source !== null && failedSources.has(chip.source) ? "—" : chip.count}
            </span>
          </button>
        );
      })}
    </SurfaceToolbar>
  );
}

/** One row: an accordion, so a glance never navigates away. */
function ActivityRowView({ row, open, onToggle }: { row: ActivityRow; open: boolean; onToggle: () => void }) {
  const { inspect } = useShell();
  const ref = row.refs[0];
  return (
    <li className="border-b border-border-subtle last:border-0">
      <Row className="min-h-11 items-start py-2" onActivate={onToggle} aria-expanded={open}>
        <Icon name={open ? "open" : "forward"} size="xs" className="mt-1 shrink-0 text-ink-faint" />
        <SourceChip source={row.source} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
          <span className="min-w-0 truncate text-ink">
            {row.actor !== null && <span className="text-ink-muted">{row.actor} </span>}
            <span className="text-ink-muted">{row.verb} </span>
            <span className="font-medium">{row.object}</span>
          </span>
          {row.refs.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {row.refs.map((r) =>
                r.kind === "issue" || r.kind === "pr" || r.kind === "gh-issue" ? (
                  // The console's own chip: same reference vocabulary as prose and the drawer.
                  <ReferenceChip key={`${r.kind}:${r.ref}`} reference={{ kind: r.kind, ref: r.ref }} />
                ) : (
                  <span key={`${r.kind}:${r.ref}`} className="font-mono text-xs text-ink-faint">
                    {r.ref}
                  </span>
                ),
              )}
            </div>
          )}
        </div>
        <span className="w-10 shrink-0 text-right text-xs text-ink-faint tabular">{relativeTime(row.at)}</span>
      </Row>
      {open && (
        <div className="flex flex-col gap-2 px-6 pb-3">
          {row.meta.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.68rem] text-ink-faint">
              {row.meta.map(([k, v], i) => (
                <span key={k}>
                  {i > 0 && <span aria-hidden> · </span>}
                  {k} {v}
                </span>
              ))}
            </div>
          )}
          {row.body !== null && (
            <p className="max-h-64 overflow-auto border-l border-border-muted pl-2 text-xs whitespace-pre-wrap text-ink-muted">{row.body}</p>
          )}
          <div className="flex items-center gap-1.5">
            {ref && (
              <button
                type="button"
                className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST)}
                onClick={() => {
                  if (ref.kind === "issue") inspect({ kind: "issue", ref: ref.ref });
                  else if (ref.kind === "pr") inspect({ kind: "pr", ref: ref.ref });
                }}
              >
                <Icon name="external" size="xs" /> Open {ref.kind === "pr" ? "pull request" : "issue"}
              </button>
            )}
            <button type="button" className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST)} onClick={() => void navigator.clipboard?.writeText(row.refs[0]?.ref ?? row.id)}>
              <Icon name="copy" size="xs" /> Copy ref
            </button>
            <span className="ml-auto font-mono text-[0.68rem] text-ink-faint">{row.kind}</span>
          </div>
        </div>
      )}
    </li>
  );
}

export function ActivitySurface() {
  const { repo } = useShell();
  const projects = useProjects();
  const projectId = projectForRepo(projects.data, repo)?.id ?? null;
  // No activity inspector is opened from this surface, so a "follow the drawer"
  // interval would be dead plumbing; Refresh is the explicit control instead.
  const { states, loadOlder, refetch } = useActivityFeed({ repo: repo.fullName, projectId });
  const [active, setActive] = useState<ActivitySource | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => activityCounts(states), [states]);
  // One feed, not three stacked lists: merge (dedupe by row id) then sort
  // newest-first, then filter. `mergeActivity` is the single ordering authority.
  const rows = useMemo(() => filterActivity(mergeActivity(states.map((s) => s.rows)), active), [states, active]);
  const failed = states.filter((s) => s.error !== null);
  const failedSources = new Set(failed.map((s) => s.source));
  const loading = states.every((s) => s.pending);
  // Older pages exist per source; with "All" selected the button says which
  // source it extends, so one source's history never masquerades as another's.
  const olderSources = states.filter((s) => s.cursor !== null && (active === null || s.source === active));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SurfaceToolbar>
        <Filters total={counts.all} bySource={counts.bySource} active={active} failedSources={failedSources} onPick={setActive} />
        <button type="button" className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST, "ml-auto")} onClick={() => refetch()}>
          <Icon name="live" size="xs" /> Refresh
        </button>
      </SurfaceToolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {failed.map((s) => (
          <div key={s.source} className="border-b border-border-subtle px-3 py-2">
            <ErrorState title={`${s.source} source unavailable`} error={s.error} />
          </div>
        ))}
        {loading ? (
          <LoadingState label="Loading activity" />
        ) : rows.length === 0 ? (
          failed.length > 0 ? (
            <EmptyState icon="activity" title="Some sources could not be read">
              The failing sources are named above. The ones that answered have nothing in this window — that is a real zero, not a hidden failure.
            </EmptyState>
          ) : (
            <EmptyState icon="activity" title={active === null ? `No recorded activity for ${repo.fullName}` : `No ${active} activity for ${repo.fullName}`} />
          )
        ) : (
          <ol aria-label="Activity feed" className="flex flex-col">
            {rows.map((row) => (
              <ActivityRowView key={row.id} row={row} open={openId === row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} />
            ))}
            {olderSources.length > 0 && (
              <li className="flex flex-wrap gap-1.5 p-2">
                {olderSources.map((s) => (
                  <button
                    key={s.source}
                    type="button"
                    className={cx(TOOLBAR_CONTROL, TOOLBAR_REST)}
                    onClick={() => void loadOlder(s.source as Exclude<ActivitySource, "jira">)}
                  >
                    Load older {s.source} activity
                  </button>
                ))}
              </li>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
