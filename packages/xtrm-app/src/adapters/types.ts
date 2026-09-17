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

export type PullState = "open" | "merged" | "closed";
export type PullListState = "open" | "closed" | "all";
export type CheckState = "passing" | "failing" | "pending" | "none";
export type ReviewState = "approved" | "changes_requested" | "commented" | "pending" | "none";

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  headBranch: string;
  baseBranch: string;
  state: PullState;
  draft: boolean;
  checks: CheckState;
  review: ReviewState;
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: number;
  updatedAt: string;
  createdAt: string;
  url: string;
  body: string | null;
}

export interface PullRequestReview {
  id: string;
  author: string;
  state: ReviewState;
  submittedAt: string | null;
  /** Review summary body; null/empty when the review carries no text. */
  body: string | null;
  url: string | null;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  url: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface PullRequestReviewComment {
  id: string;
  author: string;
  body: string;
  path: string;
  /** Current line; null for outdated comments that only carry `original_line`. */
  line: number | null;
  originalLine: number | null;
  /** GitHub `in_reply_to_id`; null for thread roots and backends that omit it. */
  inReplyToId: string | null;
  diffHunk: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface PullFileSummary {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface PullRequestDetail extends PullRequestSummary {
  mergeable: boolean | null;
  mergeableState: string | null;
  commits: number;
  reviews: PullRequestReview[];
  /** Issue/PR conversation comments (chronological). Count stays on `comments`. */
  conversationComments: PullRequestComment[];
  /** Code-anchored review comments; grouped into threads by the UI. */
  reviewComments: PullRequestReviewComment[];
  files: PullFileSummary[];
}

export interface GithubAdapter {
  readonly source: DataSource;
  listRepos(): Promise<Repo[]>;
  repoStats(): Promise<RepoStats[]>;
  events(repo: string, limit?: number): Promise<RepoEvent[]>;
  listPulls(repo: string, state?: PullListState): Promise<PullRequestSummary[]>;
  getPull(repo: string, number: number): Promise<PullRequestDetail>;
}

// --- github auth (XTRM-400; backend XTRM-404) ----------------------------------
// Wire shapes are exactly the XTRM-404 SUCCESS contract (snake_case preserved).
// The browser never receives or stores tokens; every read resolves to one of
// the six served states plus per-repository installation capability.

export type GithubAuthState = "not_configured" | "signed_out" | "pending" | "signed_in" | "expired" | "error";
export type GithubAuthSource = "user" | "shared" | "none";
/** Where the backend keeps the user token (XTRM-404 CONSTRAINTS); optional until the backend serves it. */
export type GithubTokenStore = "keychain" | "file";

export interface GithubAuthUser {
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface GithubDeviceChallenge {
  user_code: string;
  verification_uri: string;
  expires_at: string;
  /** Backend poll interval in seconds (GitHub requires >= 5). */
  interval: number;
}

export interface GithubAuthError {
  code: string;
  message: string;
}

export interface GithubAuthStatus {
  state: GithubAuthState;
  auth_source: GithubAuthSource;
  user?: GithubAuthUser;
  device?: GithubDeviceChallenge;
  store?: GithubTokenStore;
  error?: GithubAuthError;
}

export interface GithubInstallation {
  id: number;
  account: { login: string; avatar_url: string | null; html_url?: string | null };
  repository_selection: string;
  permissions: Record<string, string>;
  html_url: string;
}

export interface GithubInstallations {
  installations: GithubInstallation[];
  install_url: string;
}

export interface GithubCapabilities {
  auth_source: GithubAuthSource;
  installed: boolean;
  permissions: Record<string, string>;
  can: {
    read_pulls: boolean;
    read_checks: boolean;
    read_contents: boolean;
    read_issues: boolean;
    read_actions: boolean;
  };
}

export interface GithubAuthAdapter {
  readonly source: DataSource;
  status(): Promise<GithubAuthStatus>;
  /** Opens a device flow; the UI then polls status() for pending -> signed_in/error. */
  startDevice(): Promise<GithubAuthStatus>;
  cancelDevice(): Promise<GithubAuthStatus>;
  signOut(): Promise<GithubAuthStatus>;
  installations(): Promise<GithubInstallations>;
  capabilities(repo: string): Promise<GithubCapabilities>;
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
  /** Flat human ref (XTRM-58): stable identity for URLs and writes. */
  ref: string;
  /** Hierarchical locator (XTRM-79.1): primary display key, shows epic/parent lineage. */
  locator: string;
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
  parentLocator: string | null;
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
  locator?: string;
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
  githubAuth: GithubAuthAdapter;
  substrate: SubstrateAdapter;
  program: ProgramAdapter;
}
