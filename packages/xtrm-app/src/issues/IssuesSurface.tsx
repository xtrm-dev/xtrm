import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { useAdapters, type IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, Row, SourceBadge, SurfaceToolbar, TOOLBAR_CONTROL, TOOLBAR_REST, cx, relativeTime } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";
import { useCanWrite } from "./actions.ts";
import { IssueBoard } from "./IssueBoard.tsx";
import { buildTree, defaultDesc, issueStatus, keyColumnRem, rollupActivity, type Sort, type SortKey, type StatusTone, type TreeRow } from "./issue-table.ts";
import { TERMINAL, IssueKey, PriorityGlyph, kindIcon } from "./meta.tsx";
import { NewIssueDialog } from "./NewIssueDialog.tsx";
import { ReferenceChip } from "../refs/references.tsx";

type View = "open" | "progress" | "ready" | "blocked" | "deferred" | "done" | "all";

const VIEWS: Array<[View, string, (i: IssueSummary) => boolean]> = [
  ["open", "Open", (i) => i.lifecycle === "open"],
  ["progress", "In progress", (i) => i.readiness === "claimed"],
  ["ready", "Ready", (i) => i.readiness === "ready"],
  ["blocked", "Blocked", (i) => i.lifecycle === "open" && i.blockedBy.length > 0],
  ["deferred", "Deferred", (i) => i.lifecycle === "deferred"],
  ["done", "Done", (i) => TERMINAL.has(i.lifecycle)],
  ["all", "All", () => true],
];

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

/** Summary takes the spare width; the key column is sized from the data, see `keyColumnRem`. */
const COLUMNS: Array<{ key: SortKey; label: string; width: string; align?: "right" }> = [
  { key: "title", label: "Title", width: "minmax(0,1fr)" },
  { key: "children", label: "Children", width: "5rem", align: "right" },
  { key: "events", label: "Events", width: "4.5rem", align: "right" },
  { key: "pointers", label: "Pointers", width: "5.25rem", align: "right" },
  { key: "pr", label: "PR", width: "5rem", align: "right" },
  { key: "created", label: "Created", width: "5rem", align: "right" },
  { key: "updated", label: "Updated", width: "5.5rem", align: "right" },
];
const GRID = { gridTemplateColumns: COLUMNS.map((c) => c.width).join(" ") };
const CELL_EDGE = "flex h-full min-w-0 items-center";
const CELL = `${CELL_EDGE} px-2`;

function filterTrigger(value: string | null, label: string) {
  return (
    <button type="button" className={cx(TOOLBAR_CONTROL, TOOLBAR_REST, value !== null && "bg-hover text-ink")}>
      {value ?? label} <Icon name="chevronDown" size="xs" className="text-ink-faint" />
    </button>
  );
}

export function IssuesSurface() {
  const { repo, inspect, inspected } = useShell();
  const { substrate } = useAdapters();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const [view, setView] = useState<View>("all");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "updated", desc: true });
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const openPage = (ref: string) => void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${ref}` } as never);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map(([v, , pred]) => [v, (issues.data ?? []).filter(pred).length])) as Record<View, number>, [issues.data]);

  const matching = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (issues.data ?? []).filter((i) => {
      if (q && !i.title.toLowerCase().includes(q) && !i.ref.toLowerCase().includes(q) && !i.locator.toLowerCase().includes(q) && !(i.parentLocator ?? "").toLowerCase().includes(q)) return false;
      if (priorityFilter !== null && i.priority !== priorityFilter) return false;
      if (typeFilter !== null && i.kind !== typeFilter) return false;
      if (statusFilter !== null && i.lifecycle !== statusFilter) return false;
      return true;
    });
  }, [issues.data, filter, priorityFilter, typeFilter, statusFilter]);

  const rollups = useMemo(() => rollupActivity(issues.data ?? []), [issues.data]);
  const visible = useMemo(() => matching.filter(VIEWS.find(([v]) => v === view)![2]), [matching, view]);
  const tree = useMemo(() => buildTree(visible, rollups, sort, collapsed), [visible, rollups, sort, collapsed]);
  const toggle = (ref: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(ref)) next.add(ref);
      return next;
    });
  const keyCol = `${keyColumnRem(visible)}rem`;
  const tableVars = { "--key-col": keyCol } as CSSProperties;

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
  else if (!visible.length) body = <EmptyState icon="done" title={filter ? "No issues match this filter" : "Nothing in this view"} />;
  else
    body = (
      <VirtualList
        label="Issues"
        items={tree}
        rowHeight={32}
        flush
        minWidth="20rem"
        getKey={(r) => r.issue.id}
        header={
          <div role="row" data-testid="issues-table-head" className="grid h-8 shrink-0 border-b border-border-subtle" style={{ ...tableVars, ...GRID }}>
            {COLUMNS.map((c) => (
              <div key={c.key} role="columnheader" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"} className={CELL_EDGE}>
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : defaultDesc(c.key) }))}
                  className={cx("flex h-full w-full items-center gap-1 overflow-hidden px-2 text-[11px] font-normal outline-none hover:text-ink focus-visible:bg-hover", sort.key === c.key ? "text-ink" : "text-ink-faint", c.align === "right" && "justify-end")}
                >
                  <span className={cx("flex w-3.5 shrink-0", c.align === "right" && "order-first")}>
                    {sort.key === c.key && <Icon name="chevronDown" size="xs" className={cx("transition-transform", !sort.desc && "rotate-180")} />}
                  </span>
                  {c.label}
                </button>
              </div>
            ))}
          </div>
        }
        renderRow={(r) => (
          <IssueRow row={r} selected={inspected?.kind === "issue" && inspected.ref === r.issue.ref} onToggle={() => toggle(r.issue.ref)} onInspect={() => inspect({ kind: "issue", ref: r.issue.ref })} onOpen={() => openPage(r.issue.ref)} />
        )}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="XTRM Issues">
      <SurfaceToolbar>
        <SourceBadge source={substrate.source} />
        {canWrite && project && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
          >
            <Icon name="plus" size="xs" /> New issue
          </button>
        )}
        <OptionsMenu
          label={statusFilter === null ? "Status" : statusFilter}
          trigger={filterTrigger(statusFilter, "Status")}
          items={[
            { label: "All statuses", onSelect: () => setStatusFilter(null) },
            { label: "open", onSelect: () => setStatusFilter("open") },
            { label: "claimed", onSelect: () => setStatusFilter("claimed") },
            { label: "deferred", onSelect: () => setStatusFilter("deferred") },
            { label: "done", onSelect: () => setStatusFilter("done") },
          ]}
        />
        <OptionsMenu
          label={priorityFilter === null ? "Priority" : `P${priorityFilter}`}
          trigger={filterTrigger(priorityFilter === null ? null : `P${priorityFilter}`, "Priority")}
          items={[
            { label: "All priorities", onSelect: () => setPriorityFilter(null) },
            ...[0, 1, 2, 3, 4].map((p) => ({ label: `P${p}`, onSelect: () => setPriorityFilter(p) })),
          ]}
        />
        <OptionsMenu
          label={typeFilter === null ? "Type" : typeFilter}
          trigger={filterTrigger(typeFilter, "Type")}
          items={[
            { label: "All types", onSelect: () => setTypeFilter(null) },
            ...["task", "bug", "feature", "epic", "chore", "decision"].map((t) => ({ label: t, onSelect: () => setTypeFilter(t) })),
          ]}
        />
        <OptionsMenu
          label="Order by"
          trigger={filterTrigger(null, "Order by")}
          items={[
            { label: "Updated", icon: "chevronDown", onSelect: () => setSort({ key: "updated", desc: true }) },
            { label: "Priority", icon: "chevronDown", onSelect: () => setSort({ key: "priority", desc: false }) },
            { label: "Key", icon: "chevronDown", onSelect: () => setSort({ key: "key", desc: false }) },
          ]}
        />
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-pressed px-1.5 text-ink-faint transition-colors focus-within:bg-hover">
          <Icon name="search" size="xs" className="text-ink-faint" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" aria-label="Search issues" className="w-36 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint" />
        </div>
        <div role="radiogroup" aria-label="Layout" className="ml-auto flex h-7 items-center rounded-sm p-0.5">
          {(["list", "board"] as const).map((l) => (
            <IconButton key={l} icon={l} label={l === "list" ? "List" : "Board"} role="radio" aria-checked={layout === l} active={layout === l} onClick={() => setLayout(l)} className="size-6" />
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

const NUMBER = "text-xs text-ink-muted tabular";

const STATUS_CHIP: Record<StatusTone, string> = {
  accent: "bg-accent-soft text-accent-ink",
  active: "bg-accent-soft text-ink",
  danger: "bg-danger/12 text-danger",
  neutral: "bg-pressed text-ink-muted",
  muted: "bg-hover text-ink-faint",
};

function IssueRow({ row, selected, onToggle, onInspect, onOpen }: { row: TreeRow; selected: boolean; onToggle: () => void; onInspect: () => void; onOpen: () => void }) {
  const { issue, depth, rollup, hasChildren, collapsed, detached } = row;
  const terminal = TERMINAL.has(issue.lifecycle);
  const status = issueStatus(issue);
  return (
    <Row density="table" selected={selected} onActivate={onInspect} onDoubleClick={onOpen} className="">
      <div className="grid h-full w-full items-center overflow-hidden" style={GRID}>
        <div className={cx(CELL, "relative gap-1.5")} style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${issue.ref}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint outline-none hover:bg-pressed hover:text-ink focus-visible:bg-pressed"
            >
              <Icon name="chevronDown" size="xs" className={cx("transition-transform", collapsed && "-rotate-90")} />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <span title={issue.kind} className="flex shrink-0">
            <Icon name={kindIcon(issue.kind)} size="xs" className="text-ink-faint" />
          </span>
          <PriorityGlyph priority={issue.priority} />
          <span title={status.hint} className={cx("shrink-0 rounded px-1.5 py-0.5 text-center text-[0.68rem] leading-4", STATUS_CHIP[status.tone])}>
            {status.label}
          </span>
          <span className="min-w-0 truncate">
            <span className="mr-2 shrink-0 text-xs text-ink-faint">{issue.locator}</span>
            {issue.locator !== issue.ref && <span className="mr-1.5 shrink-0 text-xs text-ink-faint opacity-60">/ {issue.ref}</span>}
            <span title={issue.title} className={cx(terminal ? "text-ink-muted" : issue.kind === "epic" ? "font-medium text-ink" : "text-ink")}>
              {issue.title}
            </span>
            {detached && issue.parentRef && (
              <span className="ml-1.5 shrink-0 text-xs text-ink-faint">
                ↑<ReferenceChip reference={{ kind: "issue", ref: issue.parentRef }} fallback={issue.parentLocator ?? issue.parentRef} />
              </span>
            )}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center bg-surface pl-1 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100" onClick={(e) => e.stopPropagation()}>
            <IconButton icon="open" label={`Open ${issue.ref}`} onClick={onOpen} className="size-5" />
            <IconButton icon="copy" label={`Copy ${issue.ref}`} onClick={() => copy(issue.ref)} className="size-5" />
          </span>
        </div>
        <div className={cx(CELL, "justify-end")}>
          {issue.childCount > 0 ? `${issue.childrenDone}/${issue.childCount}` : ""}
        </div>
        <div className={cx(CELL, "justify-end text-xs text-ink-muted tabular")} title={`${issue.eventCount} on this issue, ${rollup.events} with children`}>
          {rollup.events || ""}
        </div>
        <div className={cx(CELL, "justify-end text-xs text-ink-muted tabular")} title={`${issue.pointerCount} on this issue, ${rollup.pointers} with children`}>
          {rollup.pointers || ""}
        </div>
        <div className={cx(CELL, "justify-end")}>
          {issue.primaryPr && (
            <span title={`${issue.primaryPr.relation} ${issue.primaryPr.state ?? "state unknown"}`} className="truncate text-xs text-ink-muted tabular">
              #{issue.primaryPr.number}
            </span>
          )}
        </div>
        <div className={cx(CELL, "justify-end text-xs text-ink-muted tabular")}>
          {relativeTime(issue.createdAt)}
        </div>
        <div className={cx(CELL, "justify-end text-xs text-ink-muted tabular")} title={`Created ${relativeTime(issue.createdAt)} · Updated ${relativeTime(rollup.activityAt)}`}>
          {relativeTime(rollup.activityAt)}
        </div>
      </div>
    </Row>
  );
}
