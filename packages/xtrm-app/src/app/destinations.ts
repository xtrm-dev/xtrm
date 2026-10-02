import type { IconName } from "../ui/icon.tsx";

// Navigation model (accepted 2026-09-16, PRD §36.2 2026-10-02): the rail's top switch selects a HALF
// (Console or Agent); in the Console half the rail selects a MODE and the contextual sidebar shows only
// that mode's context. The Agent half has one sidebar: sessions. No destination appears in both places.

export type ModeId = "work" | "agent" | "agents" | "program" | "research" | "observability";

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
  { id: "agents", label: "Agents", icon: "agents", path: "/agents", deferred: "Fleet presence arrives with the Agent/Frames tranche (wave H)" },
  { id: "program", label: "Program", icon: "program", path: "/program" },
  { id: "research", label: "Research", icon: "research", path: "/research" },
  { id: "observability", label: "Observability", icon: "observability", path: "/observability", deferred: "Fleet-level analysis (wave G)" },
];

export type Half = "console" | "agent";

export const halfForPath = (pathname: string): Half => (pathname === "/agent" || pathname.startsWith("/agent/") ? "agent" : "console");

/** Agent half mode descriptor: not in the numbered rail list (PRD §36.12 decision 1). */
export const AGENT_MODE: Mode = { id: "agent", label: "Agent", icon: "agent", path: "/agent" };

export function modeForPath(pathname: string): ModeId {
  if (pathname.startsWith("/program")) return "program";
  if (pathname.startsWith("/research")) return "research";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/agent")) return "agent";
  if (pathname.startsWith("/observability")) return "observability";
  return "work";
}

/**
 * Research contextual-sidebar groups (XTRM-433 slice 2). Experiments and Recent Runs are
 * backed by the research adapter's `listRuns()`; Saved Comparisons and Workloads have no
 * adapter-level listing yet and follow the same deferred convention as `REPO_SECTIONS`.
 */
export interface ResearchSection {
  id: string;
  label: string;
  icon: IconName;
  path: string;
  deferred?: string;
}

export const RESEARCH_SECTIONS: ResearchSection[] = [
  { id: "experiments", label: "Experiments", icon: "research", path: "/research/experiments" },
  { id: "runs", label: "Recent Runs", icon: "activity", path: "/research/runs" },
  { id: "comparisons", label: "Saved Comparisons", icon: "link", path: "/research/comparisons", deferred: "Comparison view is a later XTRM-433 slice" },
  { id: "workloads", label: "Workloads", icon: "repositories", path: "/research/workloads", deferred: "Workload browsing is a later XTRM-433 slice" },
];

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
      { id: "github-issues", label: "GitHub Issues", icon: "comment", repoPath: "/code/issues" },
      { id: "releases", label: "Releases", icon: "release", repoPath: "/code/releases" },
      { id: "content", label: "Repository content", icon: "file", repoPath: "/code/content" },
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
