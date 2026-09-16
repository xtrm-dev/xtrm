import type { IconName } from "../ui/icon.tsx";

// Single source for rail, sidebar, search, and command navigation (§8).

export interface Destination {
  id: string;
  label: string;
  icon: IconName;
  path: string;
  /** Route exists but renders an explicit deferred placeholder in the first vertical. */
  deferred?: string;
}

export const GLOBAL_DESTINATIONS: Destination[] = [
  { id: "agent", label: "Agent", icon: "agent", path: "/agent", deferred: "Agent/Frames tranche (wave H)" },
  { id: "work", label: "Work", icon: "work", path: "/work", deferred: "Cross-repository work queue; use repository Issues in this vertical" },
  { id: "repositories", label: "Repositories", icon: "repositories", path: "/repositories" },
  { id: "agents", label: "Agents", icon: "agents", path: "/agents", deferred: "Fleet presence arrives with the Agent/Frames tranche (wave H)" },
  { id: "program", label: "Program", icon: "program", path: "/program" },
  { id: "observability", label: "Observability", icon: "observability", path: "/observability", deferred: "Fleet-level analysis (wave G)" },
];

export interface RepoSection {
  label: "Work" | "Code" | "System" | "Governance";
  items: Array<Destination & { repoPath?: string }>;
}

/** Repository-context hierarchy. `repoPath` is relative to `/rep/:owner/:repo`. */
export const REPO_SECTIONS: RepoSection[] = [
  {
    label: "Work",
    items: [
      { id: "issues", label: "XTRM Issues", icon: "issues", path: "", repoPath: "/work/issues" },
      { id: "repo-agent", label: "Agent", icon: "agent", path: "/agent", deferred: "Agent/Frames tranche (wave H)" },
      { id: "repo-agents", label: "Agents", icon: "agents", path: "/agents", deferred: "Agent/Frames tranche (wave H)" },
    ],
  },
  {
    label: "Code",
    items: [
      { id: "activity", label: "Activity", icon: "activity", path: "", repoPath: "/code/activity" },
      { id: "pulls", label: "Pull requests", icon: "pull", path: "", repoPath: "/code/pulls", deferred: "Wave C follow-up; Console v1 keeps serving pull requests" },
      { id: "github-issues", label: "GitHub Issues", icon: "comment", path: "", repoPath: "/code/issues", deferred: "Wave C follow-up; distinct from XTRM Issues" },
      { id: "releases", label: "Releases", icon: "release", path: "", repoPath: "/code/releases", deferred: "Wave C follow-up" },
      { id: "content", label: "Repository content", icon: "file", path: "", repoPath: "/code/content", deferred: "README / CHANGELOG / reports — wave C follow-up" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "graph", label: "Graph", icon: "graph", path: "", repoPath: "/system/graph", deferred: "Graph shell integration (wave G)" },
      { id: "repo-observability", label: "Observability", icon: "observability", path: "", repoPath: "/system/observability", deferred: "Observability shell integration (wave G)" },
    ],
  },
  {
    label: "Governance",
    items: [{ id: "repo-program", label: "Program", icon: "program", path: "", repoPath: "/governance/program" }],
  },
];

export const repoHref = (repo: { owner: string; name: string }, repoPath: string) => `/rep/${repo.owner}/${repo.name}${repoPath}`;

export const hrefFor = (d: Destination & { repoPath?: string }, repo: { owner: string; name: string }) => (d.repoPath ? repoHref(repo, d.repoPath) : d.path);
