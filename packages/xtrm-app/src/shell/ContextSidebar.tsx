import { Popover } from "@base-ui/react/popover";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { MODES, REPO_SECTIONS, modeForPath, repoHref } from "../app/destinations.ts";
import { projectForRepo, useIssues, useProgram, useProjects, useRepoStats, useRepos } from "../app/queries.ts";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Row, StatusDot, relativeTime } from "../ui/primitives.tsx";
import { SidebarRow, SidebarSection } from "../ui/sidebar.tsx";
import { useShell } from "./context.tsx";

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
    ["GitHub", adapters.github.source],
    ["Substrate", adapters.substrate.source],
    ["Program", adapters.program.source],
  ] as const;
  return (
    <div className="flex flex-col gap-0.5 px-2 py-2 text-xs text-ink-faint" aria-label="Data sources">
      {items.map(([label, source]) => (
        <div key={label} className="flex h-5 items-center gap-2">
          <StatusDot tone={source === "live" ? "done" : "muted"} label={source} />
          <span>{label}</span>
          <span className="ml-auto">{source}</span>
        </div>
      ))}
    </div>
  );
}

function WorkSidebar({ pathname }: { pathname: string }) {
  const { repo } = useShell();
  const go = useGo();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const openCount = issues.data?.filter((i) => i.lifecycle === "open").length;
  return (
    <>
      <div className="px-1">
        <RepositorySelector />
      </div>
      <div className="thin-scrollbar mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
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
          </SidebarSection>
        ))}
      </div>
    </>
  );
}

function ProgramSidebar() {
  const program = useProgram();
  const counts = (kind: string) => program.data?.items.filter((i) => i.kind === kind).length ?? null;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-1">
      <div className="px-2 py-1.5">
        <span className="text-[0.65rem] font-medium tracking-wide text-ink-faint uppercase">Program</span>
        <p className="truncate text-sm font-medium text-ink">{program.data?.source.repository ?? "Governance"}</p>
      </div>
      <SidebarSection label="Sections">
        <SidebarRow icon="target" label="Workstreams" count={counts("workstream")} onActivate={() => jump("program-workstream")} />
        <SidebarRow icon="agents" label="Assignments" count={counts("assignment")} onActivate={() => jump("program-assignment")} />
        <SidebarRow icon="done" label="Decisions" count={counts("decision")} onActivate={() => jump("program-decision")} />
        <SidebarRow icon="commit" label="Recent changes" onActivate={() => jump("program-activity")} />
      </SidebarSection>
    </div>
  );
}

function DeferredSidebar({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-1.5">
      <span className="text-[0.65rem] font-medium tracking-wide text-ink-faint uppercase">{label}</span>
      <p className="text-xs text-ink-faint">{reason}</p>
    </div>
  );
}

export function ContextSidebar() {
  const { dispatch } = useShell();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mode = MODES.find((m) => m.id === modeForPath(pathname))!;

  return (
    <nav aria-label={`${mode.label} navigation`} data-testid="context-sidebar" className="flex h-full min-w-0 flex-col py-1.5">
      <div className="flex min-h-0 flex-1 flex-col">
        {mode.id === "work" ? <WorkSidebar pathname={pathname} /> : mode.id === "program" ? <ProgramSidebar /> : <DeferredSidebar label={mode.label} reason={mode.deferred ?? ""} />}
      </div>
      <div className="mt-1 flex items-center border-t border-border-muted px-1 pt-1">
        <div className="min-w-0 flex-1">
          <SourceFooter />
        </div>
        <IconButton icon="sidebar" label="Collapse sidebar" shortcut="Ctrl B" onClick={() => dispatch({ type: "sidebar/toggle" })} className="self-start" />
      </div>
    </nav>
  );
}
