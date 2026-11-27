import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { AgentSidebar } from "../agent/AgentSidebar.tsx";
import { useAgentStore } from "../agent/workspace.tsx";
import { AGENT_MODE, MODES, PROJECT_SECTIONS, REPO_SECTIONS, RESEARCH_SECTIONS, destinationHref, halfForPath, modeForPath, repoHref, type Half } from "../app/destinations.ts";
import { isInvalidManifestRow } from "../adapters/research/types.ts";
import { projectForRepo, useConnection, useIssues, useProjects, useRepoStats, useRepos, useResearchRuns } from "../app/queries.ts";
import { ExpandPopover } from "../ui/expand-popover.tsx";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Row, StatusDot, Tip, cx, relativeTime } from "../ui/primitives.tsx";
import { NavRailItem, SidebarRow, SidebarSection } from "../ui/sidebar.tsx";
import { useShell } from "./context.tsx";
import { modShortcut } from "./layout.ts";

export function useGo() {
  const navigate = useNavigate();
  return (href: string) => void navigate({ to: href } as never);
}

function RepositorySelector() {
  const { repo } = useShell();
  const go = useGo();
  const repos = useRepos();
  const stats = useRepoStats();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const ordered = useMemo(() => {
    const last = new Map(stats.data?.map((s) => [s.fullName, s.lastEventAt ?? ""]));
    const q = filter.trim().toLowerCase();
    return (repos.data ?? [])
      .filter((r) => !q || r.fullName.toLowerCase().includes(q))
      .sort((a, b) => (last.get(b.fullName) ?? "").localeCompare(last.get(a.fullName) ?? "") || a.fullName.localeCompare(b.fullName));
  }, [repos.data, stats.data, filter]);

  const lastEvent = (fullName: string) => stats.data?.find((s) => s.fullName === fullName)?.lastEventAt ?? null;

  return (
    <ExpandPopover
      side="bottom"
      label={`Repository: ${repo.fullName}`}
      open={open}
      onOpenChange={setOpen}
      triggerClassName="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover data-[popup-open]:bg-hover"
      popupClassName="rounded-b-lg bg-raised shadow-float"
      row={
        <>
          <span className="text-2xs font-medium tracking-wide text-ink-faint uppercase">Repository</span>
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{repo.name}</span>
            <span className="truncate text-xs text-ink-faint">{repo.owner}</span>
            <Icon name="chevronDown" size="xs" className="ml-auto shrink-0 text-ink-faint" />
          </span>
        </>
      }
    >
      <div className="flex h-10 items-center gap-2 border-b border-border-muted px-3">
        <Icon name="search" size="xs" className="text-ink-faint" />
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      {/* The popover's own capped surface is the single scroller, so the list never nests one. */}
      <div className="p-1" role="listbox" aria-label="Repositories">
        {repos.isPending && <div className="px-2 py-2 text-sm text-ink-faint">Loading repositories…</div>}
        {repos.isError && <div className="px-2 py-2 text-sm text-danger">{String(repos.error.message)}</div>}
        {ordered.map((r) => (
          <Row
            key={r.fullName}
            density="sidebar"
            role="option"
            aria-selected={r.fullName === repo.fullName}
            selected={r.fullName === repo.fullName}
            onActivate={() => {
              setOpen(false);
              setFilter("");
              go(repoHref(r, "/work/issues"));
            }}
          >
            <span className="truncate text-ink-muted">
              <span className="text-ink-faint">{r.owner}/</span>
              <span className="text-ink">{r.name}</span>
            </span>
            <span className="ml-auto text-xs text-ink-faint tabular">{relativeTime(lastEvent(r.fullName))}</span>
          </Row>
        ))}
      </div>
      <div className="border-t border-border-muted p-1">
        <Row
          density="sidebar"
          onActivate={() => {
            setOpen(false);
            go("/repositories");
          }}
        >
          <Icon name="repositories" size="xs" className="text-ink-faint" />
          <span className="text-ink-muted">All repositories</span>
        </Row>
      </div>
    </ExpandPopover>
  );
}

function SourceFooter() {
  const adapters = useAdapters();
  const connection = useConnection();
  const [open, setOpen] = useState(false);
  const items = [
    ["Agent host", adapters.agent.source],
    ["GitHub", adapters.github.source],
    ["Substrate", adapters.substrate.source],
    ["Research", adapters.research.source],
  ] as const;
  const live = items.filter(([, source]) => source === "live").length;
  const conn = connection.data ?? null;
  // Only an ssh forward is worth a footer line; a local db is the quiet default.
  const remote = conn?.ok && conn.mode === "ssh" ? conn : null;
  const state = conn == null ? "unverified" : conn.ok ? (remote ? "remote" : "local") : "offline";
  const tone = conn == null ? "neutral" : conn.ok ? "done" : "danger";
  return (
    <div className="mt-auto px-2 pb-2">
      {/* Inset from the panel edges, one compact line: it is a status strip, not a header. */}
      <ExpandPopover
        side="top"
        label="Data sources"
        open={open}
        onOpenChange={setOpen}
        triggerClassName="flex h-7 w-full items-center gap-2 rounded-md bg-strip px-2 text-left text-xs text-strip-ink shadow-strip outline-none hover:bg-strip-open hover:text-strip-ink-strong focus-visible:bg-strip-open data-[popup-open]:bg-strip-open data-[popup-open]:text-strip-ink-strong"
        popupClassName="rounded-t-md bg-strip text-sm text-strip-ink shadow-strip-open"
        bodyClassName="flex flex-col gap-0.5 p-1.5"
        row={({ open }) => (
          <>
            <StatusDot tone={live === items.length ? "done" : "muted"} label={`${live} of ${items.length} live`} />
            <span className="truncate">{live === items.length ? "All sources live" : `${live} of ${items.length} live`}</span>
            {remote?.latencyMs != null && <span className="ml-auto shrink-0 tabular">{remote.latencyMs} ms</span>}
            {/* It opens upward, so the resting chevron points up and flips down when the panel is open. */}
            <Icon name={open ? "chevronDown" : "chevronUp"} size="xs" className={cx("shrink-0", remote?.latencyMs != null ? "ml-1" : "ml-auto")} />
          </>
        )}
      >
        <div className="flex items-baseline gap-2 px-1.5 pt-0.5 pb-1">
          <span className="text-xs text-strip-ink-faint">Data sources</span>
          <span className="ml-auto text-xs tabular text-strip-ink-faint">
            {live}/{items.length} live
          </span>
        </div>
        {conn && (
          <div
            className="flex h-7 items-center gap-2 rounded-md px-1.5 text-strip-ink-strong outline-none focus-visible:bg-strip-open"
            data-testid="board-connection"
            data-popover-row=""
            tabIndex={-1}
            title={remote ? `${remote.host ?? "ssh"} · ${remote.latencyMs ?? "?"} ms` : undefined}
          >
            <StatusDot tone={tone} label={conn.ok ? "board reachable" : "board unreachable"} />
            <span className="truncate">Board</span>
            <span className={cx("ml-auto", conn.ok ? "text-strip-ink-faint" : "text-danger")}>
              {conn.ok ? (remote ? `server · ${remote.latencyMs ?? "–"} ms` : "local db") : "offline"}
            </span>
          </div>
        )}
        {items.map(([label, source]) => (
          <div key={label} className="flex h-7 items-center gap-2 rounded-md px-1.5 text-strip-ink-strong outline-none focus-visible:bg-strip-open" data-popover-row="" tabIndex={-1}>
            <StatusDot tone={source === "live" ? "done" : "muted"} label={source} />
            <span className="truncate">{label}</span>
            <span className="ml-auto text-strip-ink-faint" data-testid="source-state">
              {source}
            </span>
          </div>
        ))}
        <div className="mt-1 border-t border-strip-rule px-1.5 pt-1.5 pb-0.5 text-xs text-strip-ink-faint" data-testid="board-transport">
          {state === "remote" ? "ssh" : state === "local" ? "local db" : state === "offline" ? "unreachable" : "unknown"}
          {remote?.host ? ` · ${remote.host}` : ""}
          {conn?.serverVersion ? ` · sb ${conn.serverVersion}` : ""}
        </div>
      </ExpandPopover>
    </div>
  );
}

/**
 * The Project rail row a pathname belongs to: the longest matching section route, so a child route
 * (the timeline) belongs to its own row and not to Project root. Null when no section matches.
 */
function owningProjectSection(repo: { owner: string; name: string }, pathname: string) {
  let owner: (typeof PROJECT_SECTIONS)[number] | null = null;
  for (const section of PROJECT_SECTIONS) {
    const href = repoHref(repo, section.repoPath);
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (owner == null || section.repoPath.length > owner.repoPath.length) owner = section;
  }
  return owner;
}

/** The Research rail row a pathname names; Research sections are exact routes with nothing nested below. */
function owningResearchSection(pathname: string) {
  return RESEARCH_SECTIONS.find((section) => pathname === section.path) ?? null;
}

/** Project's own rows: its repository-scoped sub-routes (ADR-002 D2), on the rail under the Project row. */
function ProjectRows({ pathname }: { pathname: string }) {
  const { repo } = useShell();
  const go = useGo();
  const owner = owningProjectSection(repo, pathname);
  return PROJECT_SECTIONS.map((section) => {
    const href = repoHref(repo, section.repoPath);
    // One row only: the pathname belongs to the longest matching section.
    const selected = owner?.id === section.id;
    return <NavRailItem key={section.id} label={section.label} selected={selected} deferred={!!section.deferred} onActivate={() => go(href)} />;
  });
}

/** Experiments and Recent Runs are counted from `listRuns()`; Saved Comparisons and Workloads have no listing source yet and render deferred. */
function ResearchRows({ pathname }: { pathname: string }) {
  const go = useGo();
  const runs = useResearchRuns();
  const experimentCount = runs.data ? new Set(runs.data.filter((r) => !isInvalidManifestRow(r)).map((r) => r.experiment)).size : null;
  const countFor = (id: string) => (id === "experiments" ? experimentCount : id === "runs" ? (runs.data?.length ?? null) : null);
  return RESEARCH_SECTIONS.map((section) => (
    <NavRailItem
      key={section.id}
      label={section.label}
      selected={pathname === section.path}
      deferred={!!section.deferred}
      count={countFor(section.id)}
      onActivate={() => go(section.path)}
    />
  ));
}

/** Work-half destinations in three groups; Project carries its own rows, Research reveals its sections. */
function WorkSidebar({ pathname }: { pathname: string }) {
  const { repo } = useShell();
  const go = useGo();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const openCount = issues.data?.filter((i) => i.lifecycle === "open").length;
  const active = modeForPath(pathname);
  const [projectOpen, setProjectOpen] = useState(true);
  return (
    <>
      <div className="px-2">
        <RepositorySelector />
      </div>
      <div className="thin-scrollbar mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2">
        {REPO_SECTIONS.map((section) => (
          <SidebarSection key={section.label} label={section.label}>
            {section.items.map((item) => {
              const href = destinationHref(repo, item);
              const nested = item.id === "project";
              // The rail renders only while its row is open (Project) and the half is active (Research).
              const railOpen = nested ? projectOpen : item.id === "research" && active === "research";
              // While the rail shows, its selected child names the location and the parent does not;
              // collapsed, the parent takes the selection so the location stays visible.
              const childActive = nested ? owningProjectSection(repo, pathname) !== null : item.id === "research" && owningResearchSection(pathname) !== null;
              const atSection = href != null && (pathname === href || pathname.startsWith(`${href}/`));
              return (
                <SidebarRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  selected={atSection && !(railOpen && childActive)}
                  deferred={!!item.deferred}
                  count={item.id === "issues" ? (openCount ?? null) : null}
                  expanded={nested ? projectOpen : undefined}
                  onToggle={nested ? () => setProjectOpen((v) => !v) : undefined}
                  onActivate={href ? () => go(href) : undefined}
                >
                  {nested && projectOpen && <ProjectRows pathname={pathname} />}
                  {item.id === "research" && active === "research" && <ResearchRows pathname={pathname} />}
                </SidebarRow>
              );
            })}
          </SidebarSection>
        ))}
      </div>
    </>
  );
}

const HALVES: Array<{ id: Half; label: string }> = [
  { id: "console", label: "Work" },
  { id: "agent", label: "Agent" },
];

/** Remembers the last route of each half so the switch returns where the operator left off (PRD §36.2). */
export function useHalfNavigation() {
  const store = useAgentStore();
  const location = useRouterState({ select: (s) => s.location });
  const go = useGo();
  const half = halfForPath(location.pathname);
  useEffect(() => {
    store.lastHref[half] = location.href;
  }, [store, half, location.href]);
  const switchTo = (target: Half) => {
    if (target === half) return;
    go(store.lastHref[target] ?? (target === "agent" ? "/agent" : "/"));
  };
  return { half, switchTo };
}

/** Always-visible Work / Agent switch: the two halves of one shell (PRD §36.2). */
function HalfSwitch() {
  const { half, switchTo } = useHalfNavigation();
  return (
    <div role="radiogroup" aria-label="Workspace" data-testid="half-switch" className="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-sm bg-pressed p-0.5">
      {HALVES.map((h) => {
        const on = h.id === half;
        return (
          <Tip key={h.id} label={on ? h.label : `Switch to ${h.label}`} shortcut={modShortcut(".")}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={h.label}
              onClick={() => switchTo(h.id)}
              className={cx(
                "flex h-6 min-w-0 flex-1 items-center justify-center rounded-sm text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
                on ? "bg-control text-ink" : "text-ink-faint hover:text-ink-muted",
              )}
            >
              {h.label}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

export function ContextSidebar() {
  const { dispatch } = useShell();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const id = modeForPath(pathname);
  const mode = id === "agent" ? AGENT_MODE : MODES.find((m) => m.id === id)!;

  return (
    <nav aria-label={`${mode.label} navigation`} data-testid="context-sidebar" className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-2">
        <HalfSwitch />
        <IconButton data-testid="sidebar-collapse-edge" icon="sidebar" label="Collapse sidebar" shortcut={modShortcut("B")} onClick={() => dispatch({ type: "sidebar/toggle" })} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{mode.id === "agent" ? <AgentSidebar /> : <WorkSidebar pathname={pathname} />}</div>
      <SourceFooter />
    </nav>
  );
}
