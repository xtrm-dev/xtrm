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
export type Lifecycle = "open" | "deferred" | "done" | "cancelled" | "archived";
export type Scrutiny = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type EdgeKind = "parent_child" | "blocks" | "relates_to" | "discovered_from" | "supersedes" | "duplicates";

export interface IssueSummary {
  id: string;
  ref: string;
  title: string;
  kind: string;
  lifecycle: string;
  revision: number;
  /** 0 (highest) … 4 (lowest); null when the source does not expose it. */
  priority: number | null;
  scrutiny: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  parentRef: string | null;
  childCount: number;
  childrenDone: number;
  /** Open issues that block this one. */
  blockedBy: string[];
  /**
   * `ready` comes from the dispatchable set; anything else is `unknown` in lists
   * because per-issue readiness is N+1 today (XTRM-393).
   */
  readiness: Readiness;
}

/** A contract list entry. `raw` keeps unknown keys (e.g. extra fields on a validation check) for lossless writes. */
export interface ContractEntry {
  text: string;
  raw: Record<string, unknown> | null;
}

export interface Contract {
  problem: string;
  success: string;
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  validation: ContractEntry[];
  output: ContractEntry[];
  references: string[];
  /** The contract exactly as read; writes patch known fields onto it so unknown keys survive. */
  raw: Record<string, unknown>;
}

export interface IssueLink {
  id: string;
  ref: string;
  title: string;
  lifecycle: string;
  kind?: string;
}

export interface JournalEntry {
  id: string;
  sequence: number;
  kind: string;
  revision: number;
  createdAt: number;
  summary: string;
}

export interface ProvenanceSummary {
  attestation: { outcome: string; policy: string; attestedBy: string; createdAt: number } | null;
  claims: number;
  bindings: number;
  receipts: number;
  commits: string[];
  prs: string[];
}

export interface IssueDetail extends IssueSummary {
  projectId: string | null;
  readinessState: string;
  dispatchable: boolean;
  reasons: string[];
  contract: Contract;
  claim: { holder: string; expiresAt: number | null } | null;
  closure: { closed: boolean; closedAt: number | null; reason: string | null };
  parent: IssueLink | null;
  children: IssueLink[];
  blockers: IssueLink[];
  release: { childrenDone: number; childrenTotal: number } | null;
  journal: JournalEntry[];
  provenance: ProvenanceSummary;
}

export interface IssueEdit {
  title?: string;
  priority?: number;
  scrutiny?: Scrutiny;
  contract?: Record<string, unknown>;
}

export interface IssueCreate {
  title: string;
  kind: string;
  priority: number;
  scrutiny: Scrutiny;
  parent?: string;
  contract: Record<string, unknown>;
}

export interface SubstrateAdapter {
  readonly source: DataSource;
  /** Whether mutations are enabled for this source. */
  canWrite(): Promise<boolean>;
  listProjects(): Promise<SubstrateProject[]>;
  listIssues(projectId: string): Promise<IssueSummary[]>;
  getIssue(ref: string, projectId?: string): Promise<IssueDetail>;
  editIssue(projectId: string, ref: string, expectedRevision: number, edit: IssueEdit): Promise<void>;
  setLifecycle(projectId: string, ref: string, state: Lifecycle): Promise<void>;
  addNote(projectId: string, ref: string, text: string, kind: string): Promise<void>;
  createIssue(projectId: string, input: IssueCreate): Promise<string>;
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
