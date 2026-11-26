import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { projectForRepo, useActivityFeed, useProjects } from "../app/queries.ts";
import { JournalBody } from "../issues/IssueJournal.tsx";
import { ReferenceChip, type ContextReference } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { RowAction } from "../ui/row-action.tsx";
import { ListRow } from "../ui/list-row.tsx";
import { EmptyState, ErrorState, LoadingState, SurfaceToolbar, cx, relativeTime } from "../ui/primitives.tsx";
import { ListFilter, ToolbarButton, ToolbarTabs } from "../ui/toolbar.tsx";
import { activityCounts, filterActivity, mergeActivity } from "../activity/merge.ts";
import type { ActivityRefKind, ActivityRow, ActivitySource } from "../activity/types.ts";
import { pullUrl } from "../github/pr.ts";
import { githubIssueUrl } from "../github/issues.ts";

/**
 * The feed's vocabulary. Each kind gets a short name, a glyph, and — only where the event
 * changes the state of work — a solid chip. Everything else is the dim chip, because a feed
 * that colours every row has no emphasis left.
 */
type KindStyle = { label: string; glyph: IconName; tone?: BadgeTone };

const KIND: Record<string, KindStyle> = {
  "journal.note": { label: "note", glyph: "comment" },
  "journal.finding": { label: "finding", glyph: "search" },
  "journal.decision": { label: "decision", glyph: "decision" },
  "journal.blocker": { label: "blocker", glyph: "alert", tone: "danger" },
  "journal.milestone": { label: "milestone", glyph: "release" },
  "journal.handoff": { label: "handoff", glyph: "forward" },
  "journal.result": { label: "result", glyph: "done", tone: "success" },
  "journal.checkpoint": { label: "checkpoint", glyph: "pin" },
  "journal.compaction": { label: "compaction", glyph: "work" },
  "journal.cancel": { label: "cancelled", glyph: "close" },
  "journal.unreadable": { label: "unreadable", glyph: "alert", tone: "danger" },
  "pr.opened": { label: "PR opened", glyph: "pull", tone: "accent" },
  "pr.merged": { label: "PR merged", glyph: "merge", tone: "accent" },
  "pr.closed": { label: "PR closed", glyph: "pullClosed", tone: "neutral" },
  "pr.draft": { label: "PR draft", glyph: "pullDraft", tone: "neutral" },
  "issue.opened": { label: "issue opened", glyph: "issues", tone: "accent" },
  "issue.closed": { label: "issue closed", glyph: "issues", tone: "success" },
  "review.approved": { label: "approved", glyph: "check", tone: "success" },
  "review.changes_requested": { label: "changes requested", glyph: "alert", tone: "danger" },
  "review.commented": { label: "reviewed", glyph: "comment" },
  issue_comment: { label: "comment", glyph: "comment" },
  // A push is one row per push, not per commit (XTRM-757 reversed 2026-11-26): the branch is the
  // reference and the commit count is metadata. The `commit` kind left with the git source.
  push: { label: "push", glyph: "commit" },
  // Releases ride the events feed as ReleaseEvent; CreateEvent and DeleteEvent stay excluded.
  release: { label: "release", glyph: "release" },
};

/** A kind the loaders have grown but this map has not: keeps the event, names it plainly. */
function styleOf(kind: string): KindStyle {
  const known = KIND[kind];
  if (known !== undefined) return known;
  const family = kind.startsWith("pr.") ? "pull" : kind.startsWith("review.") ? "comment" : kind.startsWith("issue") ? "issues" : "comment";
  return { label: kind, glyph: family };
}

/**
 * One event. The line is `<glyph><chip><actor> <verb> <link>`: a GitHub event names its target once, in
 * the reference chip that carries the number and the title, so the event is not reported twice. The body
 * of a journal event opens underneath — through `JournalBody`, the very renderer the inspector uses, so
 * there is one renderer for an entry's body and not two that can drift.
 */
function FeedRow({
  row,
  open,
  onToggle,
  onInspect,
  onOpen,
  href,
}: {
  row: ActivityRow;
  open: boolean;
  onToggle: () => void;
  onInspect?: () => void;
  onOpen?: () => void;
  href: string | null;
}) {
  const style = styleOf(row.kind);
  const github = row.source === "github";
  const link = row.refs.find((r) => r.kind === "pr" || r.kind === "gh-issue");
  const issue = row.refs.find((r) => r.kind === "issue");
  // GitHub events point at the pull request or tracker issue; a Substrate event points at the work
  // issue it was recorded on, whose chip already carries the key and the title.
  const target: ContextReference | null =
    github && link !== undefined
      ? { kind: link.kind === "pr" ? "pr" : "gh-issue", ref: link.ref }
      : !github && issue !== undefined
        ? { kind: "issue", ref: issue.ref }
        : null;
  const expandable = row.body !== null;
  return (
    <li data-source={row.source} data-kind={row.kind} className="flex flex-col">
      <ListRow
        testId="activity-row"
        className="h-row"
        onActivate={onInspect}
        onDoubleClick={onOpen}
        leading={
          <>
            {expandable ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={open ? "Hide the entry body" : "Show the entry body"}
                data-testid="activity-expand"
                onClick={(e) => {
                  // The row inspects; the chevron only opens the body.
                  e.stopPropagation();
                  onToggle();
                }}
                className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-ink-faint outline-none hover:text-ink focus-visible:bg-hover focus-visible:text-ink"
              >
                <Icon name={open ? "chevronDown" : "chevronRight"} size="micro" />
              </button>
            ) : (
              <span aria-hidden className="size-3.5 shrink-0" />
            )}
            {/* The chip names the event. The glyph only survives where it adds a signal the chip
                cannot: the danger tone. Anywhere else it repeats the chip and eats row width. */}
            {style.tone === "danger" && (
              <Icon name={style.glyph} size="xs" className="shrink-0 text-danger" />
            )}
            {/* The chip names the event; only a state change of real work earns a solid fill. */}
            <Badge size="xs" tone={style.tone ?? "neutral"} variant={style.tone === undefined ? "tint" : "solid"}>
              {style.label}
            </Badge>
          </>
        }
        titleClassName="flex min-w-0 items-center gap-2"
        title={
          <>
            {/* The actor is an entity, not filler: it keeps its full width and never ellipsises. The
                target behind it gives up width instead. */}
            {row.actor !== null && <span className="shrink-0 whitespace-nowrap text-ink-muted">{row.actor}</span>}
            <span className="shrink-0 whitespace-nowrap text-ink-muted">{!github && target !== null ? `${row.verb} on` : row.verb}</span>
            {target !== null ? (
              // The event names its target once, and only the target's title truncates: the key inside
              // the chip is shrink-0, so a narrow row ellipsises the title and keeps the key readable.
              <span className="flex min-w-0 flex-1 items-center overflow-hidden" data-testid="activity-target">
                {/* One key, not the locator plus its alias: the alias belongs in the tooltip. */}
                <ReferenceChip reference={target} showTitle={target.kind === "issue"} showAlias={false} />
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-ink">{row.object}</span>
            )}
          </>
        }
        trailing={
          <>
            {target === null && row.refs.length > 0 && (
              <span className="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex" data-testid="activity-refs">
                {row.refs.map((r) =>
                  r.kind === "issue" || r.kind === "pr" || r.kind === "gh-issue" ? (
                    <ReferenceChip key={`${r.kind}:${r.ref}`} reference={{ kind: r.kind, ref: r.ref }} showAlias={false} />
                  ) : (
                    <span key={`${r.kind}:${r.ref}`} className="truncate font-mono text-xs text-ink-faint">
                      {r.ref}
                    </span>
                  ),
                )}
              </span>
            )}
            <span className="w-10 text-right text-xs text-ink-faint tabular">{relativeTime(row.at)}</span>
          </>
        }
        actions={
          <>
            {href !== null && <RowAction icon="external" label="Open on GitHub" onAct={() => void window.open(href, "_blank", "noreferrer")} />}
            <RowAction
              icon="copy"
              label="Copy reference"
              doneLabel="Copied"
              failLabel="Copy failed"
              onAct={() => navigator.clipboard?.writeText(row.refs[0]?.ref ?? row.id)}
            />
          </>
        }
      />
      {open && row.body !== null && (
        <div data-testid="activity-body" className="pb-3 pl-16 pr-3">
          <JournalBody text={row.body} />
        </div>
      )}
    </li>
  );
}

const SOURCE_LABEL: Record<ActivitySource, string> = { substrate: "Substrate", github: "GitHub", git: "Git", jira: "Jira" };

/** The references the inspector can open; a bare branch or path stays text. */
const OPENABLE = new Set<ActivityRefKind>(["issue", "pr", "gh-issue", "commit"]);

export function ActivitySurface() {
  const { repo, inspect } = useShell();
  const navigate = useNavigate();
  const projects = useProjects();
  const projectId = projectForRepo(projects.data, repo)?.id ?? null;
  // No activity inspector is opened from this surface, so a "follow the drawer"
  // interval would be dead plumbing; Refresh is the explicit control instead.
  const { states, loadOlder, refetch } = useActivityFeed({ repo: repo.fullName, projectId });
  const [active, setActive] = useState<ActivitySource | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => activityCounts(states), [states]);
  // One feed, not three stacked lists: merge (dedupe by row id) then sort
  // newest-first, then filter. `mergeActivity` is the single ordering authority.
  const merged = useMemo(() => filterActivity(mergeActivity(states.map((s) => s.rows)), active), [states, active]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return merged;
    return merged.filter((row) => `${row.actor ?? ""} ${row.verb} ${row.object} ${row.kind} ${row.refs.map((r) => r.ref).join(" ")}`.toLowerCase().includes(q));
  }, [merged, query]);
  const failed = states.filter((s) => s.error !== null);
  const failedSources = new Set(failed.map((s) => s.source));
  const loading = states.every((s) => s.pending);
  // A failure is not "nothing happened": the tab loses its number instead of claiming a zero.
  const live = (["substrate", "github", "git"] as const).filter((s) => !failedSources.has(s));
  const tabs = [
    { id: "all", label: "All", count: counts.all },
    ...live.map((s) => ({ id: s, label: SOURCE_LABEL[s], count: counts.bySource[s] })),
    ...failed.map((s) => ({ id: s.source, label: SOURCE_LABEL[s.source], count: "—" })),
  ];
  // Older pages exist per source; with "All" selected the row says which source
  // it extends, so one source's history never masquerades as another's.
  const olderSources = states.filter((s) => s.cursor !== null && (active === null || s.source === active));
  const olderFailures = states.filter((s) => s.olderError !== null && (active === null || s.source === active));

  /** The row opens where its first openable reference lives — the same gesture as every other list. */
  const inspectRow = (row: ActivityRow) => {
    const ref = row.refs.find((r) => OPENABLE.has(r.kind));
    if (ref === undefined) return;
    inspect({ kind: ref.kind as "issue" | "pr" | "gh-issue" | "commit", ref: ref.ref });
  };
  /** The same reference, opened on GitHub: the row's second action, when the reference has a URL. */
  const externalHref = (row: ActivityRow): string | null => {
    const ref = row.refs.find((r) => r.kind === "pr" || r.kind === "gh-issue");
    if (ref === undefined) return null;
    const hash = ref.ref.lastIndexOf("#");
    const number = Number(ref.ref.slice(hash + 1));
    const fullName = ref.ref.slice(0, hash);
    if (!Number.isFinite(number) || !fullName.includes("/")) return null;
    return ref.kind === "pr" ? pullUrl(fullName, number) : githubIssueUrl(fullName, number);
  };
  /** Double click leaves the app, exactly as it does on the PR and GitHub-issue lists. */
  const openRow = (row: ActivityRow) => {
    const ref = row.refs.find((r) => r.kind === "pr" || r.kind === "gh-issue" || r.kind === "issue");
    if (ref === undefined) return;
    if (ref.kind === "issue") {
      void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${ref.ref}` } as never);
      return;
    }
    const hash = ref.ref.lastIndexOf("#");
    const number = Number(ref.ref.slice(hash + 1));
    if (!Number.isFinite(number)) return;
    const fullName = ref.ref.slice(0, hash);
    if (!fullName.includes("/")) return;
    const href = ref.kind === "pr" ? pullUrl(fullName, number) : githubIssueUrl(fullName, number);
    window.open(href, "_blank", "noreferrer");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SurfaceToolbar>
        <ToolbarTabs label="Activity source" tabs={tabs} value={active ?? "all"} onChange={(id) => setActive(id === "all" ? null : (id as ActivitySource))} />
        <ListFilter value={query} onChange={setQuery} count={rows.length} total={merged.length} />
        <ToolbarButton icon="live" className="ml-auto" onClick={() => refetch()}>
          Refresh
        </ToolbarButton>
      </SurfaceToolbar>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
        {olderFailures.map((s) => (
          <div key={`older-${s.source}`} className="px-3 py-2">
            <ErrorState title={`older ${s.source} activity could not be loaded`} error={s.olderError} />
          </div>
        ))}
        {failed.map((s) => (
          <div key={s.source} className="px-3 py-2">
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
            <EmptyState icon="activity" title={active === null ? `No recorded activity for ${repo.fullName}` : `No ${SOURCE_LABEL[active].toLowerCase()} activity for ${repo.fullName}`} />
          )
        ) : (
          <ol aria-label="Activity feed" className="flex flex-col">
            {rows.map((row) => (
              <FeedRow
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                onInspect={row.refs.some((r) => OPENABLE.has(r.kind)) ? () => inspectRow(row) : undefined}
                onOpen={row.refs.some((r) => OPENABLE.has(r.kind)) ? () => openRow(row) : undefined}
                href={externalHref(row)}
              />
            ))}
            {olderSources.map((s) => (
              <li key={`older-${s.source}`} className="h-row">
                <ListRow
                  testId="activity-older"
                  leading={<Icon name="back" size="xs" className="shrink-0 text-ink-faint" />}
                  title={<span className="text-xs text-ink-muted">Load older {SOURCE_LABEL[s.source].toLowerCase()} activity</span>}
                  onActivate={() => void loadOlder(s.source as Exclude<ActivitySource, "jira">)}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
