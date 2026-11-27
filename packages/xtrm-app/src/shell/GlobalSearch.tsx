import { useMemo } from "react";
import { REPO_SECTIONS, destinationHref, repoHref } from "../app/destinations.ts";
import { projectForRepo, useIssues, useIssuesForProjects, useProjects, usePulls, useRepos } from "../app/queries.ts";
import { issueStatus } from "../issues/issue-table.ts";
import { CommandMenu, type CommandEntry, type CommandGroupData } from "../ui/command-menu.tsx";
import { cx } from "../ui/primitives.tsx";
import { useGo } from "./ContextSidebar.tsx";
import { useShell } from "./context.tsx";
import { issueKeyFromQuery, rankSearch } from "./search-rank.ts";

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
  // Pull requests are repository-scoped, like the repository scope of the palette.
  // Read only while the palette is open: the shell mounts this on every route (XTRM-1090 review).
  const pulls = usePulls(repo.fullName, "all", false, palette.open);

  const groups = useMemo<CommandGroupData[]>(() => {
    if (commandMode) {
      const d = layout.inspector.state;
      const commands: CommandEntry[] = [
        { id: "sidebar", label: layout.sidebar.open ? "Collapse sidebar" : "Open sidebar", hint: "Ctrl B", icon: "sidebar", onSelect: () => dispatch({ type: "sidebar/toggle" }) },
        { id: "inspector", label: d === "CLOSED" ? "Open inspector" : "Close inspector", hint: "Ctrl I", icon: "inspector", onSelect: () => dispatch({ type: d === "CLOSED" ? "drawer/open" : "drawer/close" }) },
        ...(d === "CONTEXTUAL" ? [{ id: "pin", label: "Pin drawer", icon: "pin" as const, onSelect: () => dispatch({ type: "drawer/pin" }) }] : []),
        ...(d === "PINNED" ? [{ id: "unpin", label: "Unpin drawer", icon: "unpin" as const, onSelect: () => dispatch({ type: "drawer/unpin" }) }] : []),
        ...(d === "CONTEXTUAL" || d === "PINNED" ? [{ id: "max", label: "Maximize drawer", hint: "Ctrl Shift Enter", icon: "maximize" as const, onSelect: () => dispatch({ type: "drawer/maximize" }) }] : []),
        ...(d === "MAXIMIZED" ? [{ id: "restore", label: "Restore drawer", hint: "Ctrl Shift Enter", icon: "restore" as const, onSelect: () => dispatch({ type: "drawer/restore" }) }] : []),
        { id: "theme", label: `Switch to ${shell.theme === "dark" ? "light" : "dark"} theme`, icon: shell.theme === "dark" ? "sun" : "moon", onSelect: shell.toggleTheme },
      ];
      const navigation: CommandEntry[] = [
        ...REPO_SECTIONS.flatMap((s) =>
          s.items.flatMap((i) => {
            const href = destinationHref(repo, i);
            return href ? [{ id: `go-${i.id}`, label: `Go to ${i.label}`, hint: `${repo.name} · ${s.label}`, icon: i.icon, onSelect: () => go(href) }] : [];
          }),
        ),
        { id: "go-repositories", label: "Go to All repositories", icon: "repositories" as const, onSelect: () => go("/repositories") },
      ];
      return [
        { heading: "Commands", entries: commands },
        { heading: "Navigation", entries: navigation },
      ];
    }

    // Filter and rank here, then cap (XTRM-713): capping first hid every issue past the first 2000 rows.
    const query = palette.query;
    const limit = query.trim() ? MAX_PER_GROUP : 6;
    const rank = (entries: CommandEntry[]) => rankSearch(entries.map((e) => ({ ...e, keys: e.keywords })), query, limit);

    const issueSource = workspace ? allIssues.flatMap((q) => q.data ?? []) : repoIssues.data ?? [];
    const matched = rankSearch(issueSource.map((i) => ({ issue: i, label: i.title, keys: [i.ref, i.locator] })), query, limit).map((m) => m.issue);
    const issues: CommandEntry[] = matched.map((i) => ({
      id: i.id,
      label: i.title,
      // issueStatus is the list's status authority: a claimed issue reads
      // "In progress", never its raw lifecycle ("open"), in both places. The hint
      // keeps the locator only, so a child issue cannot spend its width on an
      // alias; the ref stays searchable through `keywords`.
      hint: `${i.locator ?? i.ref} · ${issueStatus(i).label}`,
      keywords: [i.ref, i.locator],
      icon: "issues",
      onSelect: () => shell.inspect({ kind: "issue", ref: i.ref }),
    }));
    // Pull requests rank on the same rules as issues: the number is the key, so
    // "#212" and "212" both win, and the head branch is a searchable alias.
    const pullSource = (pulls.data ?? []).map((p) => ({ pull: p, label: p.title, keys: [`#${p.number}`, String(p.number), ...(p.headBranch === null ? [] : [p.headBranch])] }));
    const pullRequests: CommandEntry[] = rankSearch(pullSource, query, limit).map(({ pull: p }) => ({
      id: `pr-${p.number}`,
      label: p.title,
      hint: `#${p.number} · ${p.state}`,
      keywords: [`#${p.number}`, String(p.number), ...(p.headBranch === null ? [] : [p.headBranch])],
      icon: "pull",
      onSelect: () => shell.inspect({ kind: "pr", ref: `${repo.fullName}#${p.number}` }),
    }));
    // The adapter page is capped, so an older pull request is absent from
    // `pulls.data`; an exact number still resolves, exactly like an issue key.
    const typedNumber = /^#?(\d+)$/.exec(query.trim())?.[1];
    if (typedNumber !== undefined && !(pulls.data ?? []).some((p) => String(p.number) === typedNumber)) {
      pullRequests.unshift({
        id: `open-pr-${typedNumber}`,
        label: `Open pull request #${typedNumber}`,
        hint: "pull request",
        keywords: [`#${typedNumber}`, typedNumber],
        icon: "pull",
        onSelect: () => shell.inspect({ kind: "pr", ref: `${repo.fullName}#${typedNumber}` }),
      });
    }
    const repositories: CommandEntry[] = (repos.data ?? [])
      .filter((r) => workspace || r.fullName === repo.fullName || r.owner === repo.owner)
      .map((r) => ({ id: r.fullName, label: r.fullName, icon: "repositories", onSelect: () => go(repoHref(r, "/work/issues")) }));
    const destinations: CommandEntry[] = REPO_SECTIONS.flatMap((s) =>
      s.items.filter((i) => !i.deferred).flatMap((i) => {
        const href = destinationHref(repo, i);
        return href ? [{ id: i.id, label: i.label, hint: repo.name, icon: i.icon, onSelect: () => go(href) }] : [];
      }),
    );

    // A typed key opens that issue from any project, even when its board is not loaded in this scope.
    const key = issueKeyFromQuery(query);
    if (key && !matched.some((i) => i.ref.toUpperCase() === key || i.locator.toUpperCase() === key)) {
      issues.unshift({ id: `open-${key}`, label: `Open ${key}`, hint: "issue key", keywords: [key], icon: "issues", onSelect: () => shell.inspect({ kind: "issue", ref: key }) });
    }

    return [
      { heading: "Go to", entries: rank(destinations) },
      { heading: "Issues", entries: issues },
      // Pull requests load for the current repository only, in either scope.
      { heading: workspace ? `Pull requests · ${repo.name}` : "Pull requests", entries: pullRequests },
      { heading: "Repositories", entries: rank(repositories) },
    ];
  }, [commandMode, workspace, layout, repo, repoIssues.data, allIssues, pulls.data, repos.data, palette.query, shell, dispatch, go]);

  const scopeToggle = !commandMode && (
    <div role="radiogroup" aria-label="Search scope" className="flex shrink-0 items-center rounded-md bg-control p-0.5 text-xs">
      {(["repository", "workspace"] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          role="radio"
          aria-checked={palette.scope === scope}
          onClick={() => setPalette({ scope })}
          className={cx(
            "max-w-24 truncate rounded px-2 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-accent/40",
            palette.scope === scope
              ? "bg-surface text-ink shadow-[0_0_0_1px_var(--x-border-muted)]"
              : "text-ink-faint hover:text-ink-muted",
          )}
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
      placeholder={commandMode ? "Run a command…" : workspace ? "Search issues and repositories across the workspace" : `Search ${repo.name}`}
      groups={groups}
      shouldFilter={commandMode}
      toolbar={scopeToggle}
      loading={searching && (repoIssues.isFetching || allIssues.some((q) => q.isFetching) || pulls.isFetching)}
    />
  );
}
