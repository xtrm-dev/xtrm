// Typed adapter contracts (shell architecture §9.3).
// UI components depend on these view models only, never on a source.

export type DataSource = "live" | "fixture";

// --- github ---------------------------------------------------------------

export interface Repo {
  fullName: string;
  displayName: string;
  owner: string;
  name: string;
  lastPolledAt: string | null;
}

export interface RepoStats {
  fullName: string;
  pushes: number;
  /** Console v1 reports 24h event counts under `prs_open`; not an open total (defect R7). */
  prEvents24h: number;
  issueEvents24h: number;
  lastEventAt: string | null;
}

export type RepoEventKind = "push" | "pull_request" | "issue_comment" | "issue" | "release" | "create" | "delete" | "other";

export interface RepoEvent {
  id: string;
  kind: RepoEventKind;
  rawType: string;
  repo: string;
  branch: string | null;
  actor: string;
  action: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commitCount: number | null;
  createdAt: string;
}

export interface GithubAdapter {
  readonly source: DataSource;
  listRepos(): Promise<Repo[]>;
  repoStats(): Promise<RepoStats[]>;
  events(repo: string, limit?: number): Promise<RepoEvent[]>;
}

// --- substrate ------------------------------------------------------------

export interface SubstrateProject {
  id: string;
  prefix: string;
  name: string;
  /** Local checkout roots bound to this project. */
  gitRoots: string[];
}

export type Readiness = "ready" | "not_ready" | "unknown";

export interface IssueSummary {
  id: string;
  ref: string;
  title: string;
  kind: string;
  lifecycle: string;
  revision: number;
  /**
   * `ready` comes from the dispatchable set; anything else is `unknown` in lists
   * because per-issue readiness is N+1 today (shell architecture §9.3 blocker).
   */
  readiness: Readiness;
}

export interface ContractItem {
  text: string;
}

export interface IssueDetail extends IssueSummary {
  readinessState: string;
  dispatchable: boolean;
  reasons: string[];
  contract: {
    problem: string;
    success: string;
    scope: string[];
    nonGoals: string[];
    constraints: string[];
    validation: string[];
    output: string[];
  };
  claim: { holder: string; expiresAt: number | null } | null;
  closure: { closed: boolean; closedAt: number | null; reason: string | null };
  provenance: { eventCount: number; lastEventType: string | null; lastEventAt: number | null };
}

export interface SubstrateAdapter {
  readonly source: DataSource;
  listProjects(): Promise<SubstrateProject[]>;
  listIssues(projectId: string): Promise<IssueSummary[]>;
  getIssue(ref: string): Promise<IssueDetail>;
}

// --- program --------------------------------------------------------------

export type ProgramItemKind = "workstream" | "assignment" | "decision";

export interface ProgramItem {
  id: string;
  kind: ProgramItemKind;
  title: string;
  status: string;
  path: string;
  updatedAt: string | null;
  jiraRefs: string[];
  /**
   * Typed references to executable work. Program never carries the referenced
   * issue's state; the drawer resolves it through the substrate adapter.
   */
  issueRefs: string[];
}

export interface ProgramView {
  source: { repository: string; branch: string; shortSha: string | null; generatedAt: string };
  freshness: "fresh" | "stale" | "degraded";
  healthMessage: string | null;
  now: { title: string; evidenceCutoff: string | null } | null;
  items: ProgramItem[];
  activity: Array<{ sha: string; date: string; subject: string; url: string }>;
}

export interface ProgramAdapter {
  readonly source: DataSource;
  snapshot(): Promise<ProgramView>;
}

export interface Adapters {
  github: GithubAdapter;
  substrate: SubstrateAdapter;
  program: ProgramAdapter;
}
