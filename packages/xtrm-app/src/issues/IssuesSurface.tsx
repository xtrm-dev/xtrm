import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { useAdapters, type IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Badge } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, Row, SourceBadge, SurfaceToolbar, cx, relativeTime } from "../ui/primitives.tsx";
import { RowAction } from "../ui/row-action.tsx";
import { ListFilter, ToolbarButton, ToolbarFilter } from "../ui/toolbar.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";
import { useCanWrite } from "./actions.ts";
import { IssueBoard } from "./IssueBoard.tsx";
import { buildTree, defaultDesc, issueStatus, keyColumnRem, rollupActivity, type Sort, type SortKey, type TreeRow } from "./issue-table.ts";
import { PrStateBadge } from "./pr-state.tsx";
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
  { key: "pr", label: "PR", width: "6.5rem", align: "right" },
  { key: "created", label: "Created", width: "5rem", align: "right" },
  { key: "updated", label: "Updated", width: "5.5rem", align: "right" },
];
const GRID = { gridTemplateColumns: COLUMNS.map((c) => c.width).join(" ") };
const CELL_EDGE = "flex h-full min-w-0 items-center";
const CELL = `${CELL_EDGE} px-2`;

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
          <IssueRow
            row={r}
            keyCol={keyCol}
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
        <ToolbarFilter label="Status" value={statusFilter} options={["open", "claimed", "deferred", "done"].map((s) => ({ label: s }))} onChange={setStatusFilter} />
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
          items={[
            { label: "Updated", onSelect: () => setSort({ key: "updated", desc: true }) },
            { label: "Priority", onSelect: () => setSort({ key: "priority", desc: false }) },
            { label: "Key", onSelect: () => setSort({ key: "key", desc: false }) },
          ]}
        />
        <ListFilter value={filter} onChange={setFilter} placeholder="Filter issues" count={matching.length} total={issues.data?.length} />
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

function IssueRow({ row, keyCol, selected, onToggle, onInspect, onOpen }: { row: TreeRow; keyCol: string; selected: boolean; onToggle: () => void; onInspect: () => void; onOpen: () => void }) {
  const { issue, depth, rollup, hasChildren, collapsed, detached } = row;
  const terminal = TERMINAL.has(issue.lifecycle);
  const status = issueStatus(issue);
  return (
    <Row
      density="table"
      selected={selected}
      onActivate={onInspect}
      onDoubleClick={onOpen}
      className=""
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
    >
      <div className="grid h-full w-full items-center overflow-hidden" style={{ ...GRID, "--key-col": keyCol } as CSSProperties}>
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
              <Icon name="chevronDown" size="text" className={cx("transition-transform", collapsed && "-rotate-90")} />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <span title={issue.kind} className="flex shrink-0">
            <Icon name={kindIcon(issue.kind)} size="text" className="text-ink-faint" />
          </span>
          <PriorityGlyph priority={issue.priority} />
          <span className="shrink-0 overflow-hidden" style={{ width: "var(--key-col)" }} title={issue.locator ?? issue.ref}>
            <IssueKey locator={issue.locator} humanRef={issue.ref} />
          </span>
          <Badge tone={status.tone} size="xs" title={status.hint} className="w-[4.25rem] justify-center">
            {status.label}
          </Badge>
          <span className="min-w-0 truncate">
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
            <RowAction icon="copy" label={`Copy ${issue.ref}`} onAct={() => copy(issue.ref)} doneLabel="Copied" />
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
            <span title={issue.primaryPr.relation} className="flex min-w-0 items-center justify-end gap-1.5">
              <span className="truncate text-xs text-ink-muted tabular">#{issue.primaryPr.number}</span>
              <PrStateBadge state={issue.primaryPr.state} size="xs" />
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
