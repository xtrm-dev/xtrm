// Typed adapter contracts (shell architecture §9.3).
// UI components depend on these view models only, never on a source.
import type { AgentHostConnectionAdapter } from "./agent/host-connection.ts";
import type { AgentAdapter } from "./agent/types.ts";

import type { ResearchAdapter } from "./research/types.ts";

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

export type GithubIssueState = "open" | "closed";

export interface GithubIssueSummary {
  number: number;
  title: string;
  /** Issue body; the list rows carry it too (the backend row is one table). */
  body: string | null;
  state: GithubIssueState;
  author: string;
  labels: string[];
  comments: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface Release {
  id: string;
  tag: string;
  /** Release title; falls back to the tag when GitHub carries none. */
  name: string;
  notes: string | null;
  author: string | null;
  publishedAt: string | null;
  url: string;
}

/** README / CHANGELOG / a report file, as served by the Console v1 backend. */
export interface RepoDocument {
  path: string;
  content: string | null;
  sha: string | null;
  lastModified: string | null;
}

export interface RepoReportSummary {
  name: string;
  path: string;
  sha: string;
  size: number;
}

export interface GithubAdapter {
  readonly source: DataSource;
  listRepos(): Promise<Repo[]>;
  repoStats(): Promise<RepoStats[]>;
  events(repo: string, limit?: number): Promise<RepoEvent[]>;
  listPulls(repo: string, state?: PullListState): Promise<PullRequestSummary[]>;
  getPull(repo: string, number: number): Promise<PullRequestDetail>;
  listIssues(repo: string): Promise<GithubIssueSummary[]>;
  getIssue(repo: string, number: number): Promise<GithubIssueSummary>;
  listReleases(repo: string): Promise<Release[]>;
  /** `README.md` and `CHANGELOG.md` only; the backend rejects any other path. */
  getDocument(repo: string, path: string): Promise<RepoDocument>;
  listReports(repo: string): Promise<RepoReportSummary[]>;
  getReport(repo: string, filename: string): Promise<RepoDocument>;
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

export type Readiness = "terminal" | "deferred" | "draft" | "blocked" | "claimed" | "ready" | "not_ready";
export type Lifecycle = "open" | "deferred" | "done" | "cancelled" | "archived";
export type Scrutiny = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type EdgeKind = "parent_child" | "blocks" | "relates_to" | "discovered_from" | "supersedes" | "duplicates";

export interface PullLink {
  id: number;
  repository: string;
  number: number;
  relation: "created_from" | "mentioned";
  sources: string[];
  alsoMentioned: boolean;
  url: string | null;
  actor: string | null;
  createdAt: number;
  commits: Array<{ sha: string; landedSha: string | null }>;
  /** Live PR state from the pull_requests store; null => "state unknown". */
  state: string | null;
  /** 'assumed' when only the opener wrote the row, 'observed' after a reconciler read. */
  stateSource: string | null;
  /** PR title from the pull_requests store; null when unknown. */
  title: string | null;
  /** Merge timestamp (epoch ms) when merged; null otherwise. */
  mergedAt: number | null;
}

export interface LinkEvent {
  eventId: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

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
  /** Latest of `updatedAt` and the newest journal entry; journal writes do not move `updatedAt`. */
  lastActivityAt: number | null;
  /** Journal entries on this issue. */
  eventCount: number;
  /** Evidence refs carried by those journal entries. */
  pointerCount: number;
  /** Strongest live PR link, from Substrate; state from the 728 cache. */
  primaryPr: { repository: string; number: number; relation: string; url: string | null; state: string | null } | null;
  /** Latest attestation against the current revision; null when the source does not expose it. */
  attestation: "none" | "current" | "stale" | "rejected" | null;
  /** False when the work contract fails structural validation; null when unknown. */
  contractComplete: boolean | null;
  /** Attested for this revision and allowed by the scrutiny policy. */
  dispatchable: boolean | null;
  parentRef: string | null;
  parentLocator: string | null;
  childCount: number;
  childrenDone: number;
  /** Open issues that block this one. */
  blockedBy: string[];
  /**
   * Real derived readiness from the board projection (PRD §13):
   * `terminal|deferred|draft|blocked|claimed|ready`. Detail rows report
   * `ready` when dispatchable and `not_ready` otherwise.
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

/** Stored execution identity, verbatim (tmux `$N`, UUID, `specialist::name`). Never guessed. */
export interface JournalIdentity {
  participantId: string | null;
  sessionId: string | null;
  activationId: string | null;
  runId: string | null;
}

/**
 * Which journal read the backend actually served: paged, one legacy ascending
 * read, or `unknown` when the paging probe could not decide. `unknown` is not a
 * downgrade — the request was served as asked — but it is also not proof, so the
 * reader must not treat it as either.
 */
export type JournalPaging = "cursor" | "legacy" | "unknown";

export interface JournalEntry {
  id: string;
  sequence: number;
  kind: string;
  revision: number;
  createdAt: number;
  /** Semantic summary, else the result summary; empty when the entry has neither. */
  summary: string;
  /** ADR-009: the row failed read validation; render this marker, not `summary`. */
  unreadable?: string | null;
  identity: JournalIdentity;
  /** Semantic checkpoint fields other than the summary (completed, next, keyDecisions, …). */
  semantic: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  mechanical: Record<string, unknown> | null;
  executionContext: Record<string, unknown> | null;
}

export interface Attestation {
  outcome: string;
  policy: string;
  attestedBy: string;
  createdAt: number;
  revision: number | null;
  contractHash: string | null;
  evidenceRefs: string[];
  blockingGaps: string[];
}

export interface ClaimRecord {
  holder: string;
  activationId: string | null;
  acquiredAt: number | null;
  expiresAt: number | null;
  releasedAt: number | null;
  generation: number | null;
  revision: number | null;
}

export interface BindingRecord {
  id: string;
  participantId: string | null;
  activationId: string | null;
  attemptId: string | null;
  sessionId: string | null;
  workspace: string | null;
  baseCommit: string | null;
  revision: number | null;
  createdAt: number | null;
}

export interface ArtifactRecord {
  kind: string;
  value: string;
  provider: string | null;
  superseded: boolean;
}

export interface ReceiptRecord {
  id: string;
  bindingId: string | null;
  revision: number | null;
  commitSha: string | null;
  /** Settling journal checkpoint (XTRM-416); null when not linked. */
  checkpointId: string | null;
  /** Journal sequence of the checkpoint when it resolves; null when unknown. */
  checkpointSequence: number | null;
  validationRefs: ArtifactRecord[];
  artifacts: ArtifactRecord[];
  createdAt: number | null;
  finalizedAt: number | null;
}

export interface CheckpointRecord {
  entryId: string;
  sequence: number;
  kind: string;
  revision: number | null;
  summary: string | null;
}

export interface ExternalBindingRecord {
  provider: string;
  scope: string;
  remoteId: string;
  url: string | null;
}

export interface ProvenanceSummary {
  attestation: Attestation | null;
  claims: ClaimRecord[];
  bindings: BindingRecord[];
  receipts: ReceiptRecord[];
  checkpoints: CheckpointRecord[];
  commits: string[];
  prs: string[];
  externalBindings: ExternalBindingRecord[];
}

export interface Closure {
  closed: boolean;
  closedAt: number | null;
  reason: string | null;
  closureId: string | null;
  outcome: string | null;
  actor: string | null;
  session: string | null;
  /** Contract revision the closure was made against; null when not recorded. */
  revision: number | null;
  contractHash: string | null;
}

export interface IssueDetail extends IssueSummary {
  projectId: string | null;
  readinessState: string;
  dispatchable: boolean;
  reasons: string[];
  contract: Contract;
  claim: { holder: string; expiresAt: number | null } | null;
  closure: Closure;
  parent: IssueLink | null;
  children: IssueLink[];
  blockers: IssueLink[];
  release: { childrenDone: number; childrenTotal: number } | null;
  journal: JournalEntry[];
  /** Set when the journal read itself failed, so the tab can say so instead of looking empty. */
  journalError?: string | null;
  /** `legacy` means the loaded entries are an ascending read that cannot page further. */
  journalPaging?: JournalPaging | null;
  /** Entries Substrate holds; greater than `journal.length` when the read was capped. */
  journalTotal: number;
  provenance: ProvenanceSummary;
  pullRequests: PullLink[];
  linkEvents: LinkEvent[];
  linkGate: { mode: string; manual: { verdict: string; codes: string[] } };
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

/** How the Substrate source reaches the board; `null` when the source cannot say (fixtures). */
export interface BoardConnection {
  /** `local` when the CLI reads its own database; `ssh` when it forwards to the server. */
  mode: string;
  host?: string;
  latencyMs?: number | null;
  serverVersion?: string;
  ok: boolean;
  error?: string;
}

/** One project-wide journal row as the feed returns it (XTRM-764 / XTRM-757). */
export interface JournalFeedEntryWire {
  id: string;
  kind: string;
  issueRef: string;
  issueId: string;
  sequence: number;
  issueRevision: number;
  createdAt: number;
  participantId?: string | null;
  semantic?: { summary?: string } | null;
  result?: { summary?: string } | null;
  /** ADR-009 read marker; null/absent on a clean row. */
  unreadable?: string | null;
}

export interface SubstrateAdapter {
  readonly source: DataSource;
  /** Whether mutations are enabled for this source. */
  canWrite(): Promise<boolean>;
  /** Where the board lives. Optional: fixtures have no transport to report. */
  connection?(): Promise<BoardConnection | null>;
  listProjects(): Promise<SubstrateProject[]>;
  listIssues(projectId: string): Promise<IssueSummary[]>;
  /**
   * `withBoard: false` skips the project board walk and returns board-derived fields neutral;
   * the caller fills them from a cached board (the live adapter's `applyBoard`).
   */
  getIssue(ref: string, projectId?: string, opts?: { withBoard?: boolean }): Promise<IssueDetail>;
  /**
   * Paged journal read of full bodies. `tail` is the newest window; `before` is
   * the backwards cursor for older pages. A journal bigger than one page is
   * only fully reachable through this call.
   */
  readJournal(ref: string, opts?: { tail?: number; before?: number; limit?: number }): Promise<JournalEntry[]>;
  /**
   * Project-wide journal page for the Activity feed (XTRM-757): newest first,
   * every kind, one page per call. Live reads the bridge's /journal-feed; a
   * fixture answers from canned entries so a fixture console is not a broken
   * source.
   */
  journalFeed(
    projectId: string,
    opts?: { limit?: number; cursor?: string | null },
  ): Promise<{ entries: JournalFeedEntryWire[]; nextCursor: string | null }>;
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

/**
 * The git source of the Activity feed (XTRM-757): the LOCAL log of the
 * repository on disk, read by the bridge. GitHub never supplies commits, so
 * this is the only producer of a commit row.
 */
export interface GitActivityAdapter {
  readonly source: DataSource;
  commits(repo: string, limit?: number): Promise<Array<{ sha: string; author: string; subject: string; at: number }>>;
}

export interface Adapters {
  agent: AgentAdapter;
  gitActivity: GitActivityAdapter;
  agentHost: AgentHostConnectionAdapter;
  github: GithubAdapter;
  githubAuth: GithubAuthAdapter;
  substrate: SubstrateAdapter;
  program: ProgramAdapter;
  research: ResearchAdapter;
}
