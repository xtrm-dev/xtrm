import { Popover } from "@base-ui/react/popover";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { REPO_SECTIONS, hrefFor, repoHref } from "../app/destinations.ts";
import { projectForRepo, useIssues, useProjects, useRepoStats, useRepos } from "../app/queries.ts";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Kbd, Row, StatusDot, cx, relativeTime } from "../ui/primitives.tsx";
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
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-hover focus-visible:bg-hover data-[popup-open]:bg-hover"
      >
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-control text-[0.65rem] font-semibold text-ink-muted uppercase">{repo.name.slice(0, 1)}</span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-ink">{repo.name}</span>
          <span className="truncate text-xs text-ink-faint">{repo.owner}</span>
        </span>
        <Icon name="chevronDown" size="xs" className="ml-auto text-ink-faint" />
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

export function ContextSidebar() {
  const { repo, dispatch, openPalette } = useShell();
  const go = useGo();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const issues = useIssues(project?.id);
  const openCount = issues.data?.filter((i) => !["done", "cancelled", "archived"].includes(i.lifecycle)).length;

  return (
    <nav aria-label="Repository navigation" data-testid="context-sidebar" className="flex h-full min-w-0 flex-col py-1.5 pl-1">
      <div className="flex items-center gap-1 pr-1">
        <div className="min-w-0 flex-1">
          <RepositorySelector />
        </div>
        <IconButton icon="sidebar" label="Collapse sidebar" shortcut="Ctrl B" onClick={() => dispatch({ type: "sidebar/toggle" })} />
      </div>

      <button
        type="button"
        onClick={() => openPalette("search")}
        className="mx-1 mt-2 mb-3 flex h-8 items-center gap-2 rounded-md border border-border-muted bg-surface/60 px-2.5 text-left text-sm text-ink-faint outline-none hover:border-border hover:text-ink-muted focus-visible:border-border-strong"
      >
        <Icon name="search" size="xs" />
        <span className="flex-1 truncate">Search {repo.name} and workspace</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {REPO_SECTIONS.map((section) => (
          <SidebarSection key={section.label} label={section.label}>
            {section.items.map((item) => {
              const href = hrefFor(item, repo);
              const selected = pathname === href;
              return (
                <SidebarRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  selected={selected}
                  deferred={!!item.deferred}
                  count={item.id === "issues" ? openCount ?? null : null}
                  onActivate={() => go(href)}
                />
              );
            })}
          </SidebarSection>
        ))}
      </div>

      <div className={cx("border-t border-border-muted pt-1")}>
        <SourceFooter />
      </div>
    </nav>
  );
}

/** Collapsed contextual sidebar: reserved 44px rounded rail with one reopen affordance (B1, §4.2). */
export function SidebarReopenRail() {
  const { dispatch } = useShell();
  return (
    <div data-testid="sidebar-reopen-rail" className="my-1.5 mr-1 flex w-11 shrink-0 flex-col items-center rounded-lg border border-border-muted py-1.5">
      <IconButton icon="sidebar" label="Open sidebar" shortcut="Ctrl B" tooltipSide="right" onClick={() => dispatch({ type: "sidebar/toggle" })} />
    </div>
  );
}
