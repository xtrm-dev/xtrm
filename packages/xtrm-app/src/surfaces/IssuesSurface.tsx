import { useMemo, useState } from "react";
import { useAdapters, type IssueSummary } from "../adapters/index.tsx";
import { projectForRepo, useIssues, useProjects } from "../app/queries.ts";
import { lifecycleTone } from "../shell/Inspector.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, Row, SourceBadge, StatusDot, SurfaceHeader, cx } from "../ui/primitives.tsx";
import { VirtualList } from "../ui/virtual-list.tsx";

const TERMINAL = new Set(["done", "cancelled", "archived"]);
type View = "open" | "ready" | "all";

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

export function IssuesSurface() {
  const { repo, inspect, inspected } = useShell();
  const { substrate } = useAdapters();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const [view, setView] = useState<View>("open");
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (issues.data ?? []).filter((i) => {
      if (view === "open" && TERMINAL.has(i.lifecycle)) return false;
      if (view === "ready" && i.readiness !== "ready") return false;
      return !q || i.title.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q);
    });
  }, [issues.data, view, filter]);

  const counts = useMemo(() => {
    const all = issues.data ?? [];
    return { open: all.filter((i) => !TERMINAL.has(i.lifecycle)).length, ready: all.filter((i) => i.readiness === "ready").length, all: all.length };
  }, [issues.data]);

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
  else if (!visible.length) body = <EmptyState icon="done" title={filter ? "No issues match this filter" : "Nothing here"} />;
  else
    body = (
      <VirtualList
        label="Issues"
        items={visible}
        rowHeight={36}
        getKey={(i) => i.id}
        renderRow={(i) => <IssueRow issue={i} selected={inspected?.kind === "issue" && inspected.ref === i.ref} onOpen={() => inspect({ kind: "issue", ref: i.ref })} />}
      />
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="XTRM Issues">
      <SurfaceHeader
        title="Issues"
        meta={
          <>
            {project && <span className="font-mono text-xs">{project.prefix}</span>}
            <SourceBadge source={substrate.source} />
          </>
        }
      >
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-border-muted px-2 focus-within:border-border-strong">
          <Icon name="search" size="xs" className="text-ink-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter issues"
            className="w-32 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <div role="radiogroup" aria-label="Issue view" className="ml-1 flex items-center gap-0.5">
          {(["open", "ready", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={cx("flex h-7 items-center gap-1.5 rounded-md px-2 text-sm outline-none focus-visible:bg-hover", view === v ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
            >
              {v === "open" ? "Open" : v === "ready" ? "Ready" : "All"}
              <span className="text-xs text-ink-faint tabular">{counts[v]}</span>
            </button>
          ))}
        </div>
        <OptionsMenu
          label="Issue list options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void issues.refetch() },
            { label: "Copy link", icon: "link", onSelect: () => copy(window.location.href) },
          ]}
        />
      </SurfaceHeader>
      {body}
    </section>
  );
}

function IssueRow({ issue, selected, onOpen }: { issue: IssueSummary; selected: boolean; onOpen: () => void }) {
  return (
    <Row
      selected={selected}
      onActivate={onOpen}
      actions={<IconButton icon="copy" label={`Copy ${issue.ref}`} onClick={() => copy(issue.ref)} />}
    >
      <StatusDot tone={lifecycleTone(issue.lifecycle)} label={issue.lifecycle.replace(/_/g, " ")} />
      <span className="w-20 shrink-0 truncate font-mono text-xs text-ink-faint">{issue.ref}</span>
      <span className={cx("min-w-0 flex-1 truncate", TERMINAL.has(issue.lifecycle) ? "text-ink-muted" : "text-ink")}>{issue.title}</span>
      {issue.readiness === "ready" && <span className="shrink-0 text-xs text-accent-ink">Ready</span>}
      <span className="w-14 shrink-0 text-right text-xs text-ink-faint group-hover/row:hidden group-focus-within/row:hidden">{issue.kind}</span>
    </Row>
  );
}
