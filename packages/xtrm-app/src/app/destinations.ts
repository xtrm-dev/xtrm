import type { IconName } from "../ui/icon.tsx";

// Navigation model: the sidebar's top switch selects a HALF (Work or Agent). The Work half lists every
// destination in one sidebar: repository rows plus the workspace MODES, and the active mode's own
// sub-rows nest under it. The Agent half has one sidebar: sessions.

export type ModeId = "work" | "agent" | "agents" | "research" | "observability";

export interface Mode {
  id: ModeId;
  label: string;
  icon: IconName;
  /** Where selecting the mode navigates; `null` means the current repository's default surface. */
  path: string | null;
  /** Repository-relative route, resolved against the selected repository by `modeHref`. */
  repoPath?: string;
  deferred?: string;
}

// Project is not a mode: it is a repository-scoped section (ADR-002 D1/D2), listed in REPO_SECTIONS.
export const MODES: Mode[] = [
  { id: "work", label: "Work", icon: "work", path: null, repoPath: "/work/issues" },
  { id: "agents", label: "Agents", icon: "agents", path: "/agents", deferred: "Fleet presence arrives with the Agent/Frames tranche (wave H)" },
  { id: "research", label: "Research", icon: "research", path: "/research" },
  { id: "observability", label: "Observability", icon: "observability", path: "/observability", deferred: "Fleet-level analysis (wave G)" },
];

export type Half = "console" | "agent";

export const halfForPath = (pathname: string): Half => (pathname === "/agent" || pathname.startsWith("/agent/") ? "agent" : "console");

/** Agent half mode descriptor: not in the numbered rail list (PRD §36.12 decision 1). */
export const AGENT_MODE: Mode = { id: "agent", label: "Agent", icon: "agent", path: "/agent" };

export function modeForPath(pathname: string): ModeId {
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

/**
 * Project sub-sections (ADR-002 D2): every route lives under `/rep/:owner/:repo/project`.
 * `repoPath` includes the `/project` root so the list is directly usable with `repoHref`.
 * Overview is first; each section is a stub behind its own issue until that issue lands.
 */
export interface ProjectSection {
  id: string;
  label: string;
  icon: IconName;
  repoPath: string;
  deferred?: string;
}

export const PROJECT_ROOT = "/project";

export const PROJECT_SECTIONS: ProjectSection[] = [
  { id: "overview", label: "Overview", icon: "program", repoPath: PROJECT_ROOT },
  { id: "timeline", label: "Timeline", icon: "activity", repoPath: "/project/timeline" },
  { id: "questions", label: "Questions", icon: "comment", repoPath: "/project/questions", deferred: "Project Questions arrive read-only with XTRM-817–XTRM-820; answering is deferred to XTRM-821" },
  { id: "workers", label: "Workers", icon: "specialists", repoPath: "/project/workers" },
  { id: "followups", label: "Follow-ups", icon: "issues", repoPath: "/project/followups" },
  { id: "jira", label: "Jira", icon: "link", repoPath: "/project/jira" },
  { id: "settings", label: "Integration", icon: "settings", repoPath: "/project/settings", deferred: "Binding configuration and drift detail arrive with a later Project surface" },
];

export interface Destination {
  id: string;
  label: string;
  icon: IconName;
  /** Relative to `/rep/:owner/:repo`; absent when the destination is not repository-scoped. */
  repoPath?: string;
  /** Absolute route for mode-level or global surfaces. */
  path?: string;
  deferred?: string;
}

export interface RepoSection {
  label: "Workspace" | "GitHub" | "System";
  items: Destination[];
}

/** Work-half sidebar: the operator's groups, in their approved order. */
export const REPO_SECTIONS: RepoSection[] = [
  {
    label: "Workspace",
    items: [
      { id: "activity", label: "Activity", icon: "activity", repoPath: "/code/activity" },
      { id: "issues", label: "Issues", icon: "issues", repoPath: "/work/issues" },
      { id: "project", label: "Project", icon: "program", repoPath: PROJECT_ROOT },
      { id: "agents", label: "Agents", icon: "agents", path: "/agents", deferred: "Fleet presence arrives with the Agent/Frames tranche (wave H)" },
      { id: "observability", label: "Observability", icon: "observability", path: "/observability", deferred: "Fleet-level analysis (wave G)" },
      { id: "research", label: "Research", icon: "research", path: "/research" },
    ],
  },
  {
    label: "GitHub",
    items: [
      { id: "pulls", label: "Pull requests", icon: "pull", repoPath: "/code/pulls" },
      { id: "github-issues", label: "GitHub Issues", icon: "comment", repoPath: "/code/issues" },
      { id: "releases", label: "Releases", icon: "release", repoPath: "/code/releases" },
      { id: "content", label: "Repository content", icon: "content", repoPath: "/code/content" },
      { id: "ci", label: "CI/CD", icon: "ci", repoPath: "/code/ci", deferred: "Pipeline surfaces arrive with the CI tranche" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "specialists", label: "Specialists", icon: "specialists", path: "/specialists", deferred: "Specialist fleet surfaces are not built yet" },
      { id: "skills", label: "Skills", icon: "skills", path: "/skills", deferred: "Skill catalogue surfaces are not built yet" },
    ],
  },
];

export const repoHref = (repo: { owner: string; name: string }, repoPath: string) => `/rep/${repo.owner}/${repo.name}${repoPath}`;

export const modeHref = (mode: Mode, repo: { owner: string; name: string }) =>
  mode.path ?? (mode.repoPath ? repoHref(repo, mode.repoPath) : repoHref(repo, "/work/issues"));

/** Absolute route for a destination: repository-scoped first, then mode-level, else none. */
export const destinationHref = (repo: { owner: string; name: string }, item: Destination): string | null =>
  item.repoPath ? repoHref(repo, item.repoPath) : (item.path ?? null);
