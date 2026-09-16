import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdapters, type IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, Row, SourceBadge, StatusDot, cx, relativeTime } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";
import { useCanWrite } from "./actions.ts";
import { IssueBoard } from "./IssueBoard.tsx";
import { TERMINAL, IssueKey, PriorityGlyph, kindIcon, lifecycleLabel, lifecycleTone } from "./meta.tsx";
import { NewIssueDialog } from "./NewIssueDialog.tsx";

type View = "open" | "ready" | "blocked" | "deferred" | "done" | "all";
type SortKey = "key" | "priority" | "updated" | "status";

const VIEWS: Array<[View, string, (i: IssueSummary) => boolean]> = [
  ["open", "Open", (i) => i.lifecycle === "open"],
  ["ready", "Ready", (i) => i.readiness === "ready"],
  ["blocked", "Blocked", (i) => i.lifecycle === "open" && i.blockedBy.length > 0],
  ["deferred", "Deferred", (i) => i.lifecycle === "deferred"],
  ["done", "Done", (i) => TERMINAL.has(i.lifecycle)],
  ["all", "All", () => true],
];

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

function refOrder(a: string, b: string) {
  const na = a.split(/[-.]/).slice(1).map(Number);
  const nb = b.split(/[-.]/).slice(1).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

const COLUMNS = "grid grid-cols-[1.25rem_11rem_minmax(0,1fr)_7rem_2.5rem_4rem_3.5rem] items-center gap-3";

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
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "updated", desc: true });
  const [creating, setCreating] = useState(false);

  const openPage = (ref: string) => void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${ref}` } as never);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map(([v, , pred]) => [v, (issues.data ?? []).filter(pred).length])) as Record<View, number>, [issues.data]);

  const matching = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (issues.data ?? []).filter((i) => !q || i.title.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q) || i.locator.toLowerCase().includes(q) || (i.parentLocator ?? "").toLowerCase().includes(q));
  }, [issues.data, filter]);

  const visible = useMemo(() => {
    const pred = VIEWS.find(([v]) => v === view)![2];
    const rows = matching.filter(pred);
    const dir = sort.desc ? -1 : 1;
    const cmp: Record<SortKey, (a: IssueSummary, b: IssueSummary) => number> = {
      key: (a, b) => refOrder(a.locator, b.locator),
      priority: (a, b) => (a.priority ?? 9) - (b.priority ?? 9) || refOrder(a.locator, b.locator),
      updated: (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0),
      status: (a, b) => a.lifecycle.localeCompare(b.lifecycle),
    };
    return [...rows].sort((a, b) => dir * cmp[sort.key](a, b));
  }, [matching, view, sort]);

  const header = (key: SortKey | null, label: string, align?: "right") => (
    <button
      type="button"
      disabled={!key}
      onClick={() => key && setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "key" }))}
      className={cx("flex items-center gap-1 truncate text-xs text-ink-faint outline-none enabled:hover:text-ink-muted", align === "right" && "justify-end")}
    >
      {label}
      {key && sort.key === key && <Icon name="chevronDown" size="xs" className={cx("transition-transform", !sort.desc && "rotate-180")} />}
    </button>
  );

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
        items={visible}
        rowHeight={36}
        widthClass="max-w-6xl"
        getKey={(i) => i.id}
        header={
          <div className="sticky top-0 z-10 border-b border-border-muted bg-surface">
          <div className={cx(COLUMNS, "mx-auto h-8 max-w-6xl px-5")}>
            <span />
            {header("key", "Key")}
            <span className="text-xs text-ink-faint">Summary</span>
            {header("status", "Status")}
            {header("priority", "P")}
            <span className="text-right text-xs text-ink-faint">Children</span>
            {header("updated", "Updated", "right")}
          </div>
          </div>
        }
        renderRow={(i) => (
          <IssueRow issue={i} selected={inspected?.kind === "issue" && inspected.ref === i.ref} onInspect={() => inspect({ kind: "issue", ref: i.ref })} onOpen={() => openPage(i.ref)} />
        )}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="XTRM Issues">
      <div className="flex shrink-0 flex-col gap-4 px-8 pt-6 pb-3">
        <div className="mx-auto flex w-full max-w-6xl items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-xl font-semibold text-ink">Issues</h1>
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              Executable work contracts{project && <> · <span className="font-mono text-xs">{project.prefix}</span></>}
              <SourceBadge source={substrate.source} />
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-border-muted px-2.5 focus-within:border-border-strong">
              <Icon name="search" size="xs" className="text-ink-faint" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter issues" aria-label="Filter issues" className="w-40 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint" />
            </div>
            <div role="radiogroup" aria-label="Layout" className="flex h-8 items-center rounded-md border border-border-muted p-0.5">
              {(["list", "board"] as const).map((l) => (
                <IconButton key={l} icon={l} label={l === "list" ? "List" : "Board"} role="radio" aria-checked={layout === l} active={layout === l} onClick={() => setLayout(l)} className="size-6" />
              ))}
            </div>
            <OptionsMenu
              label="Issue list options"
              items={[
                { label: "Refresh", icon: "live", onSelect: () => void issues.refetch() },
                { label: "Copy link", icon: "link", onSelect: () => copy(window.location.href) },
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
        <div role="tablist" aria-label="Issue views" hidden={layout === "board"} className="mx-auto flex w-full max-w-6xl items-center gap-1 border-b border-border-muted pb-2">
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
      </div>
      {body}
      {project && <NewIssueDialog open={creating} onOpenChange={setCreating} projectId={project.id} onCreated={(ref) => inspect({ kind: "issue", ref })} />}
    </section>
  );
}

function IssueRow({ issue, selected, onInspect, onOpen }: { issue: IssueSummary; selected: boolean; onInspect: () => void; onOpen: () => void }) {
  const terminal = TERMINAL.has(issue.lifecycle);
  return (
    <Row selected={selected} onActivate={onInspect} onDoubleClick={onOpen} className="px-3">
      <div className={cx(COLUMNS, "w-full")}>
      <Icon name={kindIcon(issue.kind)} size="xs" className="text-ink-faint" />
      <IssueKey locator={issue.locator} humanRef={issue.ref} className="truncate" />
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx("truncate", terminal ? "text-ink-muted" : "text-ink")}>{issue.title}</span>
        {issue.readiness === "ready" && <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 text-xs text-accent-ink">Ready</span>}
        {issue.blockedBy.length > 0 && !terminal && (
          <span className="shrink-0 text-xs text-ink-faint" title={`Blocked by ${issue.blockedBy.join(", ")}`}>
            blocked
          </span>
        )}
        {issue.parentRef && <span className="hidden shrink-0 font-mono text-xs text-ink-faint xl:inline">↑ {issue.parentLocator ?? issue.parentRef}</span>}
        <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" onClick={(e) => e.stopPropagation()}>
          <IconButton icon="open" label={`Open ${issue.ref}`} onClick={onOpen} />
          <IconButton icon="copy" label={`Copy ${issue.ref}`} onClick={() => copy(issue.ref)} />
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <StatusDot tone={lifecycleTone(issue.lifecycle)} label={lifecycleLabel(issue.lifecycle)} />
        <span className="truncate text-ink-muted">{lifecycleLabel(issue.lifecycle)}</span>
      </span>
      <PriorityGlyph priority={issue.priority} />
      <span className="text-right text-xs text-ink-faint tabular">{issue.childCount ? `${issue.childrenDone}/${issue.childCount}` : ""}</span>
      <span className="text-right text-xs text-ink-faint tabular">{relativeTime(issue.updatedAt)}</span>
      </div>
    </Row>
  );
}
