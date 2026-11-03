import { Popover } from "@base-ui/react/popover";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { AgentSidebar } from "../agent/AgentSidebar.tsx";
import { useAgentStore } from "../agent/workspace.tsx";
import { AGENT_MODE, MODES, REPO_SECTIONS, RESEARCH_SECTIONS, halfForPath, modeForPath, modeHref, repoHref, type Half } from "../app/destinations.ts";
import { isInvalidManifestRow } from "../adapters/research/types.ts";
import { projectForRepo, useIssues, useProgram, useProjects, useRepoStats, useRepos, useResearchRuns } from "../app/queries.ts";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Row, StatusDot, Tip, cx, relativeTime } from "../ui/primitives.tsx";
import { SidebarRow, SidebarSection } from "../ui/sidebar.tsx";
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
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Repository: ${repo.fullName}`}
        className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover data-[popup-open]:bg-hover"
      >
        <span className="text-[0.65rem] font-medium tracking-wide text-ink-faint uppercase">Repository</span>
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{repo.name}</span>
          <span className="truncate text-xs text-ink-faint">{repo.owner}</span>
          <Icon name="chevronDown" size="xs" className="ml-auto shrink-0 text-ink-faint" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="flex w-72 flex-col rounded-lg bg-raised shadow-float outline-none">
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
            <div className="thin-scrollbar max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Repositories">
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SourceFooter() {
  const adapters = useAdapters();
  const items = [
    ["Agent host", adapters.agent.source],
    ["GitHub", adapters.github.source],
    ["Substrate", adapters.substrate.source],
    ["Program", adapters.program.source],
    ["Research", adapters.research.source],
  ] as const;
  const live = items.filter(([, source]) => source === "live").length;
  return (
    <details aria-label="Data sources" className="group/src px-2 py-1.5 text-xs text-ink-faint">
      <summary className="flex h-6 cursor-default list-none items-center gap-2 rounded-md px-1 outline-none hover:text-ink-muted [&::-webkit-details-marker]:hidden">
        <StatusDot tone={live === items.length ? "done" : "muted"} label={`${live} of ${items.length} live`} />
        <span>{live === items.length ? "All sources live" : `${live} of ${items.length} sources live`}</span>
        <Icon name="chevronDown" size="xs" className="ml-auto transition-transform group-open/src:rotate-180" />
      </summary>
      <div className="flex flex-col gap-0.5 px-1 pt-1">
        {items.map(([label, source]) => (
          <div key={label} className="flex h-5 items-center gap-2">
            <StatusDot tone={source === "live" ? "done" : "muted"} label={source} />
            <span>{label}</span>
            <span className="ml-auto">{source}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function ProgramRows() {
  const program = useProgram();
  const counts = (kind: string) => program.data?.items.filter((i) => i.kind === kind).length ?? null;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  return (
    <>
      <SidebarRow indent icon="target" label="Workstreams" count={counts("workstream")} onActivate={() => jump("program-workstream")} />
      <SidebarRow indent icon="agents" label="Assignments" count={counts("assignment")} onActivate={() => jump("program-assignment")} />
      <SidebarRow indent icon="done" label="Decisions" count={counts("decision")} onActivate={() => jump("program-decision")} />
      <SidebarRow indent icon="commit" label="Recent changes" onActivate={() => jump("program-activity")} />
    </>
  );
}

/** Experiments and Recent Runs are counted from `listRuns()`; Saved Comparisons and Workloads have no listing source yet and render deferred. */
function ResearchRows({ pathname }: { pathname: string }) {
  const go = useGo();
  const runs = useResearchRuns();
  const experimentCount = runs.data ? new Set(runs.data.filter((r) => !isInvalidManifestRow(r)).map((r) => r.experiment)).size : null;
  const countFor = (id: string) => (id === "experiments" ? experimentCount : id === "runs" ? (runs.data?.length ?? null) : null);
  return RESEARCH_SECTIONS.map((section) => (
    <SidebarRow
      key={section.id}
      indent
      icon={section.icon}
      label={section.label}
      selected={pathname === section.path}
      deferred={!!section.deferred}
      count={countFor(section.id)}
      onActivate={() => go(section.path)}
    />
  ));
}

/** Every Work-half destination in one list: repository rows, then the workspace modes under Work. */
function WorkSidebar({ pathname }: { pathname: string }) {
  const { repo } = useShell();
  const go = useGo();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const openCount = issues.data?.filter((i) => i.lifecycle === "open").length;
  const active = modeForPath(pathname);
  return (
    <>
      <div className="px-2">
        <RepositorySelector />
      </div>
      <div className="thin-scrollbar mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2">
        {REPO_SECTIONS.map((section) => (
          <SidebarSection key={section.label} label={section.label}>
            {section.items.map((item) => {
              const href = repoHref(repo, item.repoPath);
              return (
                <SidebarRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  selected={pathname === href || pathname.startsWith(`${href}/`)}
                  deferred={!!item.deferred}
                  count={item.id === "issues" ? (openCount ?? null) : null}
                  onActivate={() => go(href)}
                />
              );
            })}
            {section.label === "Work" &&
              MODES.filter((m) => m.id !== "work").map((m) => (
                <Fragment key={m.id}>
                  <SidebarRow icon={m.icon} label={m.label} selected={m.id === active} deferred={!!m.deferred} onActivate={() => go(modeHref(m, repo))} />
                  {m.id === active && m.id === "program" && <ProgramRows />}
                  {m.id === active && m.id === "research" && <ResearchRows pathname={pathname} />}
                </Fragment>
              ))}
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
    <div role="radiogroup" aria-label="Workspace" data-testid="half-switch" className="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-pressed p-0.5">
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
                "flex h-6 min-w-0 flex-1 items-center justify-center rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
                on ? "bg-control text-ink shadow-[0_0_0_1px_var(--x-border-muted)]" : "text-ink-faint hover:text-ink-muted",
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
