import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdapters, type IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, SourceBadge, SurfaceToolbar, cx, relativeTime } from "../ui/primitives.tsx";
import { RowAction } from "../ui/row-action.tsx";
import { ListFilter, ToolbarButton, ToolbarFilter, ToolbarMultiFilter } from "../ui/toolbar.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";
import { useCanWrite } from "./actions.ts";
import { IssueBoard } from "./IssueBoard.tsx";
import { INDENT_REM, ISSUE_STATUSES, buildTree, defaultDesc, keyNames, matchesIssueStatusSet, rollupActivity, type Sort, type SortKey, type TreeRow } from "./issue-table.ts";
import { KeyChip, ListRow, StatPill } from "../ui/list-row.tsx";
import { TERMINAL, PriorityGlyph, kindIcon } from "./meta.tsx";
import { IssueStatusBadge } from "./IssueStatusBadge.tsx";
import { NewIssueDialog } from "./NewIssueDialog.tsx";
import { ReferenceChip } from "../refs/references.tsx";

// One status control, one vocabulary (2026-11-26 ruling): the Status filter and the row badge both read
// `issueStatusId`/`matchesIssueStatus`, so Substrate's statuses — open, in progress, ready, blocked,
// deferred, done, cancelled, archived, and the closed aggregate — are the only ones the console speaks.

/** The clipboard write is a write: it resolves `true` only when the text reached the clipboard. */
/** The one-line row has no headers to click, so the Order by menu carries every key a header used to. */
const SORTS: SortKey[] = ["updated", "created", "priority", "title", "key", "children", "events", "pointers", "pr"];
const SORT_LABEL: Record<SortKey, string> = {
  updated: "Updated",
  created: "Created",
  priority: "Priority",
  title: "Title",
  key: "Key",
  children: "Children",
  events: "Events",
  pointers: "Pointers",
  pr: "PR number",
};

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export function IssuesSurface() {
  const { repo, inspect, inspected } = useShell();
  const { substrate } = useAdapters();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "updated", desc: true });
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReadonlySet<string>>(() => new Set(ISSUE_STATUSES.map((s) => s.id)));
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const openPage = (ref: string) => void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${ref}` } as never);

  // The toolbar facets are one population; the local query is the only thing the list filter narrows,
  // so its "n of m" reads against the same set the status, priority and type facets leave.
  const facets = useMemo(
    () =>
      (issues.data ?? []).filter((i) => {
        if (priorityFilter !== null && i.priority !== priorityFilter) return false;
        if (typeFilter !== null && i.kind !== typeFilter) return false;
        if (!matchesIssueStatusSet(i, statusFilter)) return false;
        return true;
      }),
    [issues.data, priorityFilter, typeFilter, statusFilter],
  );
  const query = filter.trim().toLowerCase();
  const matchesQuery = (i: IssueSummary) =>
    !query || [i.title, i.ref, i.locator, i.parentLocator ?? ""].some((v) => v.toLowerCase().includes(query));
  const matching = useMemo(() => (query ? facets.filter(matchesQuery) : facets), [facets, query]);
  const population = facets;

  const rollups = useMemo(() => rollupActivity(issues.data ?? []), [issues.data]);
  const visible = useMemo(() => (query ? population.filter(matchesQuery) : population), [population, query]);
  const tree = useMemo(() => buildTree(visible, rollups, sort, collapsed), [visible, rollups, sort, collapsed]);
  const toggle = (ref: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(ref)) next.add(ref);
      return next;
    });
  let body;
  if (projects.isPending || (project && issues.isPending)) body = <LoadingState label="Loading issues" />;
  else if (projects.isError) body = <ErrorState title="Substrate is unavailable" error={projects.error} />;
  else if (!project)
    body = (
      <EmptyState icon="issues" title={`${repo.fullName} is not bound to a Substrate project`}>
        Run <code className="font-mono text-xs">sb init</code> in a checkout of this repository to bind it.
      </EmptyState>
    );
  else if (issues.isError) body = <ErrorState title="Could not list issues" error={issues.error} />;
  else if (layout === "board")
    body = (
      <IssueBoard
        issues={matching}
        projectId={project.id}
        canWrite={canWrite}
        inspectedRef={inspected?.kind === "issue" ? inspected.ref : null}
        onInspect={(ref) => inspect({ kind: "issue", ref })}
        onOpen={openPage}
      />
    );
  else if (!visible.length)
    body = (
      <EmptyState
        icon={statusFilter.size === 0 ? "issues" : "done"}
        title={statusFilter.size === 0 ? "No status is selected" : filter ? "No issues match this filter" : "Nothing in this view"}
      >
        {statusFilter.size === 0 ? "Open the Status filter and choose at least one state, or use Select all." : null}
      </EmptyState>
    );
  else
    body = (
      <VirtualList
        label="Issues"
        items={tree}
        rowHeight={32}
        flush
        minWidth="20rem"
        getKey={(r) => r.issue.id}
        renderRow={(r) => (
          <IssueRow
            row={r}
            selected={inspected?.kind === "issue" && inspected.ref === r.issue.ref}
            onToggle={() => toggle(r.issue.ref)}
            onInspect={() => inspect({ kind: "issue", ref: r.issue.ref })}
            onOpen={() => openPage(r.issue.ref)}
          />
        )}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="XTRM Issues">
      <SurfaceToolbar>
        <SourceBadge source={substrate.source} />
        {canWrite && project && (
          <ToolbarButton primary icon="plus" onClick={() => setCreating(true)}>
            New issue
          </ToolbarButton>
        )}
        <ToolbarMultiFilter
          label="Status"
          values={statusFilter}
          options={ISSUE_STATUSES.map((s) => ({ value: s.id, label: s.label }))}
          onChange={setStatusFilter}
        />
        <ToolbarFilter
          label="Priority"
          value={priorityFilter === null ? null : `P${priorityFilter}`}
          options={[0, 1, 2, 3, 4].map((p) => ({ label: `P${p}` }))}
          onChange={(v) => setPriorityFilter(v === null ? null : Number(v.slice(1)))}
        />
        <ToolbarFilter label="Type" value={typeFilter} options={["task", "bug", "feature", "epic", "chore", "decision"].map((t) => ({ label: t }))} onChange={setTypeFilter} />
        <OptionsMenu
          label="Order by"
          trigger={<ToolbarButton>Order by</ToolbarButton>}
          items={SORTS.map((key) => ({
            label: SORT_LABEL[key],
            onSelect: () => setSort({ key, desc: defaultDesc(key) }),
          }))}
        />
        <ListFilter value={filter} onChange={setFilter} placeholder="Filter issues" count={visible.length} total={population.length} />
        <div role="radiogroup" aria-label="Layout" className="ml-auto flex h-7 items-center rounded-sm p-0.5">
          {(["list", "board"] as const).map((l) => (
            <IconButton key={l} icon={l} label={l === "list" ? "List" : "Board"} role="radio" aria-checked={layout === l} active={layout === l} iconSize="xs" onClick={() => setLayout(l)} className="size-6" />
          ))}
        </div>
        <OptionsMenu
          label="Issue list options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void issues.refetch() },
            { label: "Copy link", icon: "link", onSelect: () => copy(window.location.href) },
            { label: "Expand all", icon: "maximize", onSelect: () => setCollapsed(new Set()) },
            { label: "Collapse all", icon: "restore", onSelect: () => setCollapsed(new Set(tree.filter((r) => r.hasChildren).map((r) => r.issue.ref))) },
          ]}
        />
      </SurfaceToolbar>
      {body}
      {project && <NewIssueDialog open={creating} onOpenChange={setCreating} projectId={project.id} onCreated={(ref) => inspect({ kind: "issue", ref })} />}
    </section>
  );
}

function IssueRow({
  row,
  selected,
  onToggle,
  onInspect,
  onOpen,
}: {
  row: TreeRow;
  selected: boolean;
  onToggle: () => void;
  onInspect: () => void;
  onOpen: () => void;
}) {
  const { issue, depth, rollup, hasChildren, collapsed, detached } = row;
  const terminal = TERMINAL.has(issue.lifecycle);
  return (
    // One line, no columns (2026-11-24 ruling): the key is a tinted chip, the status is a solid chip,
    // and the three rollups are pills at the right edge. Nothing is dropped by a measured width; the
    // cluster sheds widest-first on a narrow surface.
    <ListRow
      scale="sm"
      selected={selected}
      onActivate={onInspect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (!hasChildren) return;
        if (e.key === "ArrowRight" && collapsed) {
          e.preventDefault();
          onToggle();
        }
        if (e.key === "ArrowLeft" && !collapsed) {
          e.preventDefault();
          onToggle();
        }
      }}
      indentRem={depth * INDENT_REM}
      leading={
        <>
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${issue.ref}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded-full text-ink-faint outline-none hover:bg-pressed hover:text-ink focus-visible:bg-pressed"
            >
              <Icon name="chevronDown" size="text" className={cx("transition-transform", collapsed && "-rotate-90")} />
            </button>
          ) : (
            <span className="-ml-1 w-5 shrink-0" />
          )}
          <span title={issue.kind} className="flex shrink-0">
            <Icon name={kindIcon(issue.kind)} size="text" className="text-ink-faint" />
          </span>
          <PriorityGlyph priority={issue.priority} />
          <span data-key-cell="" className="flex min-w-0">
            <KeyChip title={keyNames(issue)}>{issue.locator || issue.ref}</KeyChip>
          </span>
          {/* One chip for the list and the drawer: label, tone and fill live in IssueStatusBadge. */}
          <IssueStatusBadge issue={issue} size="xs" />
        </>
      }
      title={
        <>
          <span title={issue.title} className={cx(terminal ? "text-ink-muted" : issue.kind === "epic" ? "font-medium text-ink" : "text-ink")}>
            {issue.title}
          </span>
          {detached && issue.parentRef && (
            <span className="ml-1.5 shrink-0 text-xs text-ink-faint">
              ↑<ReferenceChip reference={{ kind: "issue", ref: issue.parentRef }} fallback={issue.parentLocator ?? issue.parentRef} />
            </span>
          )}
        </>
      }
      trailing={
        <>
          {issue.childCount > 0 && (
            <StatPill icon="work" tone="accent" value={`${issue.childrenDone}/${issue.childCount}`} title={`${issue.childrenDone} of ${issue.childCount} children done`} />
          )}
          <span className="hidden items-center xl:inline-flex">
            <StatPill icon="activity" value={rollup.events || 0} title={`${issue.eventCount} on this issue, ${rollup.events} with children`} />
          </span>
          <span className="hidden items-center 2xl:inline-flex">
            <StatPill icon="external" value={rollup.pointers || 0} title={`${issue.pointerCount} on this issue, ${rollup.pointers} with children`} />
          </span>
          {issue.primaryPr && (
            // The PR number is an address, not a second state: the status chip already carries the
            // colour, so the reference is a neutral key chip with the state in its tooltip.
            <KeyChip
              label={`Pull request #${issue.primaryPr.number}`}
              title={`#${issue.primaryPr.number} · ${issue.primaryPr.relation}`}
              className="min-w-0"
            >
              #{issue.primaryPr.number}
            </KeyChip>
          )}
          <span className="tabular" title={`Created ${relativeTime(issue.createdAt)} · Updated ${relativeTime(rollup.activityAt)}`}>
            {relativeTime(rollup.activityAt)}
          </span>
        </>
      }
      actions={<RowAction icon="copy" label={`Copy ${issue.ref}`} onAct={() => copy(issue.ref)} doneLabel="Copied" failLabel="Copy failed" />}
    />
  );
}
