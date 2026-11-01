import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { useAdapters, type IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, Row, SourceBadge, StatusDot, cx, relativeTime } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";
import { useCanWrite } from "./actions.ts";
import { IssueBoard } from "./IssueBoard.tsx";
import { buildTree, defaultDesc, issueStatus, keyColumnRem, rollupActivity, type Sort, type SortKey, type TreeRow } from "./issue-table.ts";
import { TERMINAL, IssueKey, PriorityGlyph, kindIcon } from "./meta.tsx";
import { NewIssueDialog } from "./NewIssueDialog.tsx";
import { ReferenceChip } from "../refs/references.tsx";

type View = "open" | "ready" | "blocked" | "deferred" | "done" | "all";

const VIEWS: Array<[View, string, (i: IssueSummary) => boolean]> = [
  ["open", "Open", (i) => i.lifecycle === "open"],
  ["ready", "Ready", (i) => i.readiness === "ready"],
  ["blocked", "Blocked", (i) => i.lifecycle === "open" && i.blockedBy.length > 0],
  ["deferred", "Deferred", (i) => i.lifecycle === "deferred"],
  ["done", "Done", (i) => TERMINAL.has(i.lifecycle)],
  ["all", "All", () => true],
];

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

/** Summary takes the spare width; the key column is sized from the data, see `keyColumnRem`. */
const COLUMNS: Array<{ key: SortKey; label: string; width: string; align?: "right" }> = [
  { key: "key", label: "Key", width: "var(--key-col)" },
  { key: "title", label: "Summary", width: "minmax(20rem,1fr)" },
  { key: "status", label: "Status", width: "7rem" },
  { key: "priority", label: "Priority", width: "5rem" },
  { key: "children", label: "Children", width: "5.5rem", align: "right" },
  { key: "events", label: "Events", width: "5rem", align: "right" },
  { key: "pointers", label: "Pointers", width: "5.5rem", align: "right" },
  { key: "created", label: "Created", width: "5.5rem", align: "right" },
  { key: "updated", label: "Updated", width: "5.5rem", align: "right" },
];
const GRID = { gridTemplateColumns: COLUMNS.map((c) => c.width).join(" ") };
const CELL = "flex h-full min-w-0 items-center border-r border-border-muted px-3 last:border-r-0";

export function IssuesSurface() {
  const { repo, inspect, inspected } = useShell();
  const { substrate } = useAdapters();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const [view, setView] = useState<View>("open");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "updated", desc: true });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const openPage = (ref: string) => void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${ref}` } as never);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map(([v, , pred]) => [v, (issues.data ?? []).filter(pred).length])) as Record<View, number>, [issues.data]);

  const matching = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (issues.data ?? []).filter((i) => !q || i.title.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q) || i.locator.toLowerCase().includes(q) || (i.parentLocator ?? "").toLowerCase().includes(q));
  }, [issues.data, filter]);

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
        rowHeight={40}
        flush
        minWidth={`calc(${keyCol} + 60rem)`}
        getKey={(r) => r.issue.id}
        header={
          <div role="row" className="sticky top-0 z-10 grid h-9 border-b border-border bg-surface" style={{ ...tableVars, ...GRID }}>
            {COLUMNS.map((c) => (
              <div key={c.key} role="columnheader" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"} className={cx(CELL, "p-0")}>
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : defaultDesc(c.key) }))}
                  className={cx("flex h-full w-full items-center gap-1 px-3 text-xs font-medium outline-none hover:text-ink focus-visible:bg-hover", sort.key === c.key ? "text-ink" : "text-ink-faint", c.align === "right" && "justify-end")}
                >
                  {c.label}
                  {sort.key === c.key && <Icon name="chevronDown" size="xs" className={cx("shrink-0 transition-transform", !sort.desc && "rotate-180")} />}
                </button>
              </div>
            ))}
          </div>
        }
        renderRow={(r) => (
          <IssueRow row={r} vars={tableVars} selected={inspected?.kind === "issue" && inspected.ref === r.issue.ref} onToggle={() => toggle(r.issue.ref)} onInspect={() => inspect({ kind: "issue", ref: r.issue.ref })} onOpen={() => openPage(r.issue.ref)} />
        )}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="XTRM Issues">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-muted px-4 py-2">
        <h1 className="text-base font-medium text-ink">Issues</h1>
        {project && <span className="font-mono text-xs text-ink-faint">{project.prefix}</span>}
        <SourceBadge source={substrate.source} />
        <div role="tablist" aria-label="Issue views" hidden={layout === "board"} className="flex items-center gap-0.5">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cx("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm outline-none focus-visible:bg-hover", view === v ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
            >
              {label}
              <span className="text-xs text-ink-faint tabular">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-8 items-center gap-1.5 rounded-md bg-hover px-2.5 focus-within:bg-pressed">
            <Icon name="search" size="xs" className="text-ink-faint" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter issues" aria-label="Filter issues" className="w-40 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint" />
          </div>
          <div role="radiogroup" aria-label="Layout" className="flex h-8 items-center rounded-md bg-hover p-0.5">
            {(["list", "board"] as const).map((l) => (
              <IconButton key={l} icon={l} label={l === "list" ? "List" : "Board"} role="radio" aria-checked={layout === l} active={layout === l} onClick={() => setLayout(l)} className="size-7" />
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
          {canWrite && project && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent-soft px-3 text-sm font-medium text-accent-ink outline-none hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Icon name="plus" size="xs" /> New issue
            </button>
          )}
        </div>
      </div>
      {body}
      {project && <NewIssueDialog open={creating} onOpenChange={setCreating} projectId={project.id} onCreated={(ref) => inspect({ kind: "issue", ref })} />}
    </section>
  );
}

const NUMBER = "text-xs text-ink-muted tabular";

function IssueRow({ row, vars, selected, onToggle, onInspect, onOpen }: { row: TreeRow; vars: CSSProperties; selected: boolean; onToggle: () => void; onInspect: () => void; onOpen: () => void }) {
  const { issue, depth, rollup, hasChildren, collapsed, detached } = row;
  const terminal = TERMINAL.has(issue.lifecycle);
  const status = issueStatus(issue);
  const own = rollup.events !== issue.eventCount || rollup.pointers !== issue.pointerCount;
  return (
    <Row density="table" selected={selected} onActivate={onInspect} onDoubleClick={onOpen} className="border-b border-border-muted">
      <div className="grid h-full w-full" style={{ ...vars, ...GRID }}>
        <div className={CELL}>
          <IssueKey locator={issue.locator} humanRef={issue.ref} />
        </div>
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
          <span title={issue.title} className={cx("min-w-0 truncate", terminal ? "text-ink-muted" : issue.kind === "epic" ? "font-medium text-ink" : "text-ink")}>
            {issue.title}
          </span>
          {detached && issue.parentRef && (
            <span className="flex shrink-0 items-center text-xs text-ink-faint">
              ↑<ReferenceChip reference={{ kind: "issue", ref: issue.parentRef }} fallback={issue.parentLocator ?? issue.parentRef} />
            </span>
          )}
          <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center bg-surface pl-1 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100" onClick={(e) => e.stopPropagation()}>
            <IconButton icon="open" label={`Open ${issue.ref}`} onClick={onOpen} />
            <IconButton icon="copy" label={`Copy ${issue.ref}`} onClick={() => copy(issue.ref)} />
          </span>
        </div>
        <div className={cx(CELL, "gap-1.5")} title={issue.blockedBy.length ? `Blocked by ${issue.blockedBy.join(", ")}` : undefined}>
          <StatusDot tone={status.tone} label={status.label} />
          <span className="truncate text-ink-muted">{status.label}</span>
        </div>
        <div className={cx(CELL, "gap-1.5 text-xs text-ink-muted")}>
          <PriorityGlyph priority={issue.priority} />
          {issue.priority !== null && <span>P{issue.priority}</span>}
        </div>
        <div className={cx(CELL, NUMBER, "justify-end")}>{issue.childCount ? `${issue.childrenDone}/${issue.childCount}` : ""}</div>
        <div className={cx(CELL, NUMBER, "justify-end")} title={own ? `${issue.eventCount} on this issue, ${rollup.events} with its children` : undefined}>
          {rollup.events || ""}
        </div>
        <div className={cx(CELL, NUMBER, "justify-end")} title={own ? `${issue.pointerCount} on this issue, ${rollup.pointers} with its children` : undefined}>
          {rollup.pointers || ""}
        </div>
        <div className={cx(CELL, NUMBER, "justify-end")}>{relativeTime(issue.createdAt)}</div>
        <div className={cx(CELL, NUMBER, "justify-end")}>{relativeTime(rollup.activityAt)}</div>
      </div>
    </Row>
  );
}
