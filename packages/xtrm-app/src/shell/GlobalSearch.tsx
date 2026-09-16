import { useMemo } from "react";
import { GLOBAL_DESTINATIONS, REPO_SECTIONS, hrefFor, repoHref } from "../app/destinations.ts";
import { projectForRepo, useIssues, useIssuesForProjects, useProgram, useProjects, useRepos } from "../app/queries.ts";
import { CommandMenu, type CommandEntry, type CommandGroupData } from "../ui/command-menu.tsx";
import { cx } from "../ui/primitives.tsx";
import { useGo } from "./ContextSidebar.tsx";
import { useShell } from "./context.tsx";

const MAX_PER_GROUP = 40;

/** One search system, two modes (§4.4). Results come from the typed adapters only. */
export function GlobalSearch() {
  const shell = useShell();
  const { palette, setPalette, repo, layout, dispatch } = shell;
  const go = useGo();
  const commandMode = palette.query.startsWith(">");
  const workspace = palette.scope === "workspace";
  const searching = palette.open && !commandMode;

  const repos = useRepos();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const repoIssues = useIssues(project?.id);
  const allIssues = useIssuesForProjects(projects.data?.map((p) => p.id) ?? [], searching && workspace);
  const program = useProgram();

  const groups = useMemo<CommandGroupData[]>(() => {
    if (commandMode) {
      const d = layout.inspector.state;
      const commands: CommandEntry[] = [
        { id: "sidebar", label: layout.sidebar.open ? "Collapse sidebar" : "Open sidebar", hint: "Ctrl B", icon: "sidebar", onSelect: () => dispatch({ type: "sidebar/toggle" }) },
        { id: "inspector", label: d === "CLOSED" ? "Open inspector" : "Close inspector", hint: "Ctrl I", icon: "inspector", onSelect: () => dispatch({ type: d === "CLOSED" ? "drawer/open" : "drawer/close" }) },
        ...(d === "CONTEXTUAL" ? [{ id: "pin", label: "Pin drawer", icon: "pin" as const, onSelect: () => dispatch({ type: "drawer/pin" }) }] : []),
        ...(d === "PINNED" ? [{ id: "unpin", label: "Unpin drawer", icon: "unpin" as const, onSelect: () => dispatch({ type: "drawer/unpin" }) }] : []),
        ...(d === "CONTEXTUAL" || d === "PINNED" ? [{ id: "max", label: "Maximize drawer", icon: "maximize" as const, onSelect: () => dispatch({ type: "drawer/maximize" }) }] : []),
        ...(d === "MAXIMIZED" ? [{ id: "restore", label: "Restore drawer", icon: "restore" as const, onSelect: () => dispatch({ type: "drawer/restore" }) }] : []),
        { id: "theme", label: `Switch to ${shell.theme === "dark" ? "light" : "dark"} theme`, icon: shell.theme === "dark" ? "sun" : "moon", onSelect: shell.toggleTheme },
      ];
      const navigation: CommandEntry[] = [
        ...GLOBAL_DESTINATIONS.map((d) => ({ id: `go-${d.id}`, label: `Go to ${d.label}`, icon: d.icon, hint: d.deferred ? "deferred" : undefined, onSelect: () => go(d.path) })),
        ...REPO_SECTIONS.flatMap((s) =>
          s.items.filter((i) => i.repoPath).map((i) => ({ id: `go-${i.id}`, label: `Go to ${i.label}`, hint: `${repo.name} · ${s.label}`, icon: i.icon, onSelect: () => go(hrefFor(i, repo)) })),
        ),
      ];
      return [
        { heading: "Commands", entries: commands },
        { heading: "Navigation", entries: navigation },
      ];
    }

    const issueSource = workspace ? allIssues.flatMap((q) => q.data ?? []) : repoIssues.data ?? [];
    const issues: CommandEntry[] = issueSource.slice(0, 2000).map((i) => ({
      id: i.id,
      label: i.title,
      hint: `${i.ref} · ${i.lifecycle.replace(/_/g, " ")}`,
      keywords: [i.ref],
      icon: "issues",
      onSelect: () => shell.inspect({ kind: "issue", ref: i.ref }),
    }));
    const programItems: CommandEntry[] = (program.data?.items ?? []).map((p) => ({
      id: p.id,
      label: p.title,
      hint: `${p.id} · ${p.kind}`,
      keywords: [p.id],
      icon: "program",
      onSelect: () => shell.inspect({ kind: "program", ref: p.id }),
    }));
    const repositories: CommandEntry[] = (repos.data ?? [])
      .filter((r) => workspace || r.fullName === repo.fullName || r.owner === repo.owner)
      .map((r) => ({ id: r.fullName, label: r.fullName, icon: "repositories", onSelect: () => go(repoHref(r, "/work/issues")) }));
    const destinations: CommandEntry[] = [
      ...REPO_SECTIONS.flatMap((s) => s.items.filter((i) => i.repoPath && !i.deferred).map((i) => ({ id: i.id, label: i.label, hint: repo.name, icon: i.icon, onSelect: () => go(hrefFor(i, repo)) }))),
      ...GLOBAL_DESTINATIONS.filter((d) => !d.deferred).map((d) => ({ id: d.id, label: d.label, icon: d.icon, onSelect: () => go(d.path) })),
    ];

    const cap = (entries: CommandEntry[]) => (palette.query ? entries : entries.slice(0, 6));
    return [
      { heading: "Go to", entries: cap(destinations) },
      { heading: "Issues", entries: cap(issues) },
      { heading: "Program", entries: cap(programItems) },
      { heading: "Repositories", entries: cap(repositories).slice(0, MAX_PER_GROUP * 5) },
    ];
  }, [commandMode, workspace, layout, repo, repoIssues.data, allIssues, program.data, repos.data, palette.query, shell, dispatch, go]);

  const scopeToggle = !commandMode && (
    <div role="radiogroup" aria-label="Search scope" className="flex shrink-0 items-center rounded-md border border-border-muted p-0.5 text-xs">
      {(["repository", "workspace"] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          role="radio"
          aria-checked={palette.scope === scope}
          onClick={() => setPalette({ scope })}
          className={cx("rounded-sm px-2 py-0.5 outline-none", palette.scope === scope ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
        >
          {scope === "repository" ? repo.name : "Workspace"}
        </button>
      ))}
    </div>
  );

  return (
    <CommandMenu
      open={palette.open}
      onOpenChange={(open) => setPalette(open ? { open } : { open, query: "" })}
      query={palette.query}
      onQueryChange={(query) => setPalette({ query })}
      placeholder={commandMode ? "Run a command…" : workspace ? "Search issues, Program, and repositories across the workspace" : `Search ${repo.name}`}
      groups={groups}
      toolbar={scopeToggle}
      loading={searching && (repoIssues.isFetching || allIssues.some((q) => q.isFetching))}
    />
  );
}
