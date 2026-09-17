import type { IconName } from "../ui/icon.tsx";

// Navigation model (accepted 2026-09-16): the global rail selects a MODE; the contextual sidebar
// shows only that mode's context. No destination appears in both places.

export type ModeId = "work" | "agent" | "agents" | "program" | "observability";

export interface Mode {
  id: ModeId;
  label: string;
  icon: IconName;
  /** Where selecting the mode navigates; `null` means the current repository's default surface. */
  path: string | null;
  deferred?: string;
}

export const MODES: Mode[] = [
  { id: "work", label: "Work", icon: "work", path: null },
  { id: "agent", label: "Agent", icon: "agent", path: "/agent", deferred: "Agent/Frames tranche (wave H)" },
  { id: "agents", label: "Agents", icon: "agents", path: "/agents", deferred: "Fleet presence arrives with the Agent/Frames tranche (wave H)" },
  { id: "program", label: "Program", icon: "program", path: "/program" },
  { id: "observability", label: "Observability", icon: "observability", path: "/observability", deferred: "Fleet-level analysis (wave G)" },
];

export function modeForPath(pathname: string): ModeId {
  if (pathname.startsWith("/program")) return "program";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/agent")) return "agent";
  if (pathname.startsWith("/observability")) return "observability";
  return "work";
}

export interface Destination {
  id: string;
  label: string;
  icon: IconName;
  /** Relative to `/rep/:owner/:repo`. */
  repoPath: string;
  deferred?: string;
}

export interface RepoSection {
  label: "Work" | "Code" | "System";
  items: Destination[];
}

/** Work-mode sidebar: repository context only. */
export const REPO_SECTIONS: RepoSection[] = [
  {
    label: "Work",
    items: [{ id: "issues", label: "Issues", icon: "issues", repoPath: "/work/issues" }],
  },
  {
    label: "Code",
    items: [
      { id: "activity", label: "Activity", icon: "activity", repoPath: "/code/activity" },
      { id: "pulls", label: "Pull requests", icon: "pull", repoPath: "/code/pulls" },
      { id: "github-issues", label: "GitHub Issues", icon: "comment", repoPath: "/code/issues", deferred: "Wave C follow-up; distinct from XTRM Issues" },
      { id: "releases", label: "Releases", icon: "release", repoPath: "/code/releases", deferred: "Wave C follow-up" },
      { id: "content", label: "Repository content", icon: "file", repoPath: "/code/content", deferred: "README / CHANGELOG / reports — wave C follow-up" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "graph", label: "Graph", icon: "graph", repoPath: "/system/graph", deferred: "Graph shell integration (wave G)" },
      { id: "repo-observability", label: "Observability", icon: "observability", repoPath: "/system/observability", deferred: "Observability shell integration (wave G)" },
    ],
  },
];

export const repoHref = (repo: { owner: string; name: string }, repoPath: string) => `/rep/${repo.owner}/${repo.name}${repoPath}`;

export const modeHref = (mode: Mode, repo: { owner: string; name: string }) => mode.path ?? repoHref(repo, "/work/issues");
