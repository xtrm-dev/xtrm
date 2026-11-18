import type {
  CheckState,
  GithubAdapter,
  PullDetailSection,
  GithubIssueSummary,
  Release,
  RepoDocument,
  RepoReportSummary,
  PullListState,
  PullRequestDetail,
  PullRequestSummary,
  PullState,
  Repo,
  RepoEvent,
  RepoEventKind,
  RepoStats,
  ReviewState,
} from "../types.ts";

// Console v1 backend DTOs (`Jaggerxtrm/console` routes/github.ts @ 4b0d9f5).
// The backend keeps owning fetch/cache/polling; this adapter only maps.

interface WireRepo {
  full_name: string;
  display_name: string;
  tracked: number;
  last_polled_at: string | null;
}
interface WireStats {
  full_name: string;
  pushes: number;
  prs_open: number;
  issues_open: number;
  last_event_at: string | null;
}
interface WireEvent {
  id: string;
  type: string;
  repo: string;
  branch: string | null;
  actor: string;
  action: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  commit_count: number | null;
  created_at: string;
}

const KIND: Record<string, RepoEventKind> = {
  PushEvent: "push",
  PullRequestEvent: "pull_request",
  PullRequestReviewEvent: "pull_request",
  PullRequestReviewCommentEvent: "pull_request",
  IssueCommentEvent: "issue_comment",
  IssuesEvent: "issue",
  ReleaseEvent: "release",
  CreateEvent: "create",
  DeleteEvent: "delete",
};

export function mapRepo(r: WireRepo): Repo {
  const [owner = "", name = r.full_name] = r.full_name.split("/");
  return { fullName: r.full_name, displayName: r.display_name || name, owner, name, lastPolledAt: r.last_polled_at };
}

export function mapStats(s: WireStats): RepoStats {
  return { fullName: s.full_name, pushes: s.pushes, prEvents24h: s.prs_open, issueEvents24h: s.issues_open, lastEventAt: s.last_event_at };
}

export function mapEvent(e: WireEvent): RepoEvent {
  return {
    id: e.id,
    kind: KIND[e.type] ?? "other",
    rawType: e.type,
    repo: e.repo,
    branch: e.branch,
    actor: e.actor,
    action: e.action,
    title: e.title,
    body: e.body,
    url: e.url,
    additions: e.additions,
    deletions: e.deletions,
    changedFiles: e.changed_files,
    commitCount: e.commit_count,
    createdAt: e.created_at,
  };
}

async function getData<T>(path: string): Promise<T> {
  const res = await fetch(`/api/github${path}`);
  if (!res.ok) throw new Error(`GitHub backend ${path} returned ${res.status}`);
  return ((await res.json()) as { data: T }).data;
}

// --- pull requests ----------------------------------------------------------
// Reads go through the Console v1 backend (XTRM-395 step 1: no auth changes,
// no direct api.github.com calls from xtrm-app). Exact backend paths
// (`Jaggerxtrm/console` apps/console/src/server/routes/github.ts):
//   GET /api/github/prs?repo=owner/repo&state=open|closed|merged&limit&offset
//       -> { data: Pr[], limit, offset } (poller cache; `state` is an exact
//       column match, so `all` is expressed by omitting the param)
//   GET /api/github/prs/:owner/:repo/:number -> Pr row (unwrapped)
//   GET /api/github/prs/:owner/:repo/:number/detail -> PrDetailPayload
//       { pr, comments, reviews, review_comments, commits, files, timeline,
//       errors } (TTL cached: 60s open / 10min closed; route-runtime.ts)
//   GET /api/github/prs/:owner/:repo/:number/checks
//       -> { state, checks, head_sha, mergeable, mergeable_state }
//       (separate backend issue; 404 until it lands — detail degrades to
//       checks none / mergeable null rather than failing the drawer)
// Row shape: packages/core/src/github/store.ts GithubPr (snake_case). List
// rows carry no branch refs, no review aggregate, and null diff counters until
// the backend persists them (XTRM-857), so every unknown maps to null and the
// UI renders unknown, never 0. The detail payload merges mapLivePr's flat
// head_ref/base_ref/draft into `pr`, which is the only branch source today.

/** Poller-cache PR row (store.ts GithubPr). */
interface WirePr {
  repo: string;
  number: number;
  title: string;
  body: string | null;
  /** 'open' | 'closed' | 'merged' */
  state: string;
  author: string;
  url: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  comment_count: number | null;
  label_names: string | null;
  created_at: string;
  updated_at: string | null;
  merged_at: string | null;
  closed_at: string | null;
  // Tolerated for forward compatibility if the backend ever enriches rows;
  // absent on list rows today (verified against the live /prs response).
  head?: { ref?: string } | null;
  head_branch?: string | null;
  base?: { ref?: string } | null;
  base_branch?: string | null;
  // Flat refs the detail payload adds through mapLivePr (route-runtime.ts).
  head_ref?: string | null;
  head_sha?: string | null;
  base_ref?: string | null;
  base_sha?: string | null;
  draft?: boolean | null;
  /** Review aggregate; the backend serves none in the list today (XTRM-857). */
  review_state?: string | null;
  review_count?: number | null;
  reviews_count?: number | null;
  /** Check aggregate; the list serves none today (XTRM-857). */
  check_state?: string | null;
}

/** Detail payload sections used here (route-runtime.ts PrDetailPayload). */
interface WireComment {
  id: number;
  author: string;
  body: string | null;
  url?: string | null;
  html_url?: string | null;
  created_at: string;
  updated_at?: string | null;
}
interface WireReview {
  id: number;
  author: string;
  state: string;
  body?: string | null;
  url?: string | null;
  html_url?: string | null;
  submitted_at: string | null;
}
interface WireReviewComment {
  id: number;
  author: string;
  body: string | null;
  path: string;
  line?: number | null;
  original_line?: number | null;
  in_reply_to_id?: number | null;
  diff_hunk?: string | null;
  url?: string | null;
  html_url?: string | null;
  created_at: string;
  updated_at?: string | null;
}
interface WireDetail {
  pr: WirePr;
  comments?: WireComment[];
  reviews: WireReview[];
  review_comments?: WireReviewComment[];
  commits: Array<{ sha: string }>;
  files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
  /** Per-section backend failure; a failed section is unknown, never empty. */
  errors?: Record<string, string>;
  /** Backend cache stamp; informational, never rendered as freshness. */
  cached_at?: string | null;
}

interface WireChecks {
  state: string | null;
  checks?: Array<{ name?: string }> | null;
  head_sha?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  /** Optional backend cache stamp (XTRM-404); informational, never rendered as freshness. */
  cached_at?: string | null;
}

/** Single-PR and detail endpoints return their payload unwrapped (no `{ data }`). */
async function getRaw<T>(path: string): Promise<T> {
  const res = await fetch(`/api/github${path}`);
  if (!res.ok) throw new Error(`GitHub backend ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

async function tryRaw<T>(path: string): Promise<T | null> {
  try {
    return await getRaw<T>(path);
  } catch {
    return null;
  }
}

/** A state the backend sent; an absent or unrecognised value is unknown (null). */
function asCheckState(raw: string | null | undefined): CheckState | null {
  switch ((raw ?? "").toLowerCase()) {
    case "success":
    case "passing":
      return "passing";
    case "failure":
    case "failing":
    case "error":
      return "failing";
    case "pending":
    case "in_progress":
    case "queued":
      return "pending";
    case "none":
      return "none";
    default:
      return null;
  }
}

function asReviewState(raw: string | null | undefined): ReviewState {
  switch ((raw ?? "").toLowerCase()) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes_requested";
    case "commented":
    case "dismissed":
      return "commented";
    case "pending":
    case "review_required":
      return "pending";
    default:
      return "none";
  }
}

function asPullState(raw: WirePr): PullState {
  if (raw.merged_at) return "merged";
  switch ((raw.state ?? "open").toLowerCase()) {
    case "closed":
      return "closed";
    case "merged":
      return "merged";
    default:
      return "open";
  }
}

/** A state the backend sent; an absent or unrecognised value is unknown (null). */
function reviewStateOrNull(raw: string | null | undefined): ReviewState | null {
  switch ((raw ?? "").toLowerCase()) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes_requested";
    case "commented":
    case "dismissed":
      return "commented";
    case "pending":
    case "review_required":
      return "pending";
    case "none":
      return "none";
    default:
      return null;
  }
}

export function mapPull(repo: string, raw: WirePr): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author ?? "—",
    // List rows carry no branch refs; the detail payload carries flat ones.
    headBranch: raw.head?.ref ?? raw.head_branch ?? raw.head_ref ?? null,
    baseBranch: raw.base?.ref ?? raw.base_branch ?? raw.base_ref ?? null,
    state: asPullState(raw),
    draft: raw.draft === true,
    // List rows carry no check state, so the list says unknown, not "no checks".
    checks: asCheckState(raw.check_state),
    // ...and no review aggregate, so the list says unknown, not "no reviews".
    review: reviewStateOrNull(raw.review_state),
    reviewCount: raw.review_count ?? raw.reviews_count ?? null,
    additions: raw.additions ?? null,
    deletions: raw.deletions ?? null,
    changedFiles: raw.changed_files ?? null,
    comments: raw.comment_count ?? null,
    updatedAt: raw.updated_at ?? raw.created_at,
    createdAt: raw.created_at,
    url: raw.url ?? `https://github.com/${repo}/pull/${raw.number}`,
    body: raw.body,
  };
}

/** Latest review decides the drawer summary; empty review lists stay `none`. */
function summarizeReviews(reviews: WireDetail["reviews"]): { review: ReviewState; rows: PullRequestDetail["reviews"] } {
  const rows = reviews.map((r) => ({
    id: String(r.id),
    author: r.author ?? "—",
    state: asReviewState(r.state),
    submittedAt: r.submitted_at,
    body: r.body ?? null,
    url: r.url ?? r.html_url ?? null,
  }));
  const last = rows.filter((r) => r.state !== "none").at(-1);
  return { review: last?.state ?? "none", rows };
}

export function mapPullComments(raw: WireDetail["comments"]): PullRequestDetail["conversationComments"] {
  return (raw ?? []).map((c) => ({
    id: String(c.id),
    author: c.author ?? "—",
    body: c.body ?? "",
    url: c.url ?? c.html_url ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at ?? null,
  }));
}

export function mapPullReviewComments(raw: WireDetail["review_comments"]): PullRequestDetail["reviewComments"] {
  return (raw ?? []).map((c) => ({
    id: String(c.id),
    author: c.author ?? "—",
    body: c.body ?? "",
    path: c.path ?? "—",
    line: c.line ?? null,
    originalLine: c.original_line ?? null,
    inReplyToId: c.in_reply_to_id != null ? String(c.in_reply_to_id) : null,
    diffHunk: c.diff_hunk ?? null,
    url: c.url ?? c.html_url ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at ?? null,
  }));
}

/** Sections the backend reports failures for, in the order the drawer checks them. */
const DETAIL_SECTIONS: PullDetailSection[] = ["pr", "comments", "reviews", "review_comments", "commits", "files", "timeline"];

export function mapPullDetail(repo: string, row: WirePr, detail: WireDetail, checks: WireChecks | null): PullRequestDetail {
  // The detail payload merges mapLivePr into `pr`, so the flat branch refs and
  // the draft flag exist only there. Merge it over the plain row, but let a
  // known row value survive a null: null means unknown, never "erase".
  const merged: WirePr = {
    ...row,
    ...detail.pr,
    additions: detail.pr.additions ?? row.additions,
    deletions: detail.pr.deletions ?? row.deletions,
    changed_files: detail.pr.changed_files ?? row.changed_files,
    comment_count: detail.pr.comment_count ?? row.comment_count,
    head_ref: detail.pr.head_ref ?? row.head_ref,
    base_ref: detail.pr.base_ref ?? row.base_ref,
    head_branch: detail.pr.head_branch ?? row.head_branch,
    base_branch: detail.pr.base_branch ?? row.base_branch,
    // A detail copy that omits these must not blank the row's known values (F3).
    draft: detail.pr.draft ?? row.draft,
    body: detail.pr.body ?? row.body,
    author: detail.pr.author ?? row.author,
    url: detail.pr.url ?? row.url,
  };
  const base = mapPull(repo, merged);
  // The backend names every failed section in `errors`; a failed section is
  // unknown (null), never an empty list that would read as zero (XTRM-857).
  const errors = detail.errors ?? {};
  const unavailableSections = DETAIL_SECTIONS.filter((section) => errors[section] !== undefined);
  const filesKnown = errors.files === undefined && Array.isArray(detail.files);
  const reviewsKnown = errors.reviews === undefined && Array.isArray(detail.reviews);
  const commentsKnown = errors.comments === undefined && Array.isArray(detail.comments);
  const files = (detail.files ?? []).map((f) => ({
    filename: f.filename ?? "—",
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    status: f.status ?? "modified",
  }));
  const { review, rows } = reviewsKnown ? summarizeReviews(detail.reviews!) : { review: null, rows: [] };
  return {
    ...base,
    // Row counters are null until the backend persists them; the file summary
    // is the fallback only while the files section is present.
    additions: merged.additions ?? (filesKnown ? files.reduce((n, f) => n + f.additions, 0) : null),
    deletions: merged.deletions ?? (filesKnown ? files.reduce((n, f) => n + f.deletions, 0) : null),
    changedFiles: merged.changed_files ?? (filesKnown ? files.length : null),
    comments: merged.comment_count ?? (commentsKnown ? (detail.comments?.length ?? 0) : null),
    review,
    reviewCount: reviewsKnown ? rows.length : base.reviewCount,
    reviews: rows,
    conversationComments: mapPullComments(detail.comments),
    reviewComments: mapPullReviewComments(detail.review_comments),
    files,
    commits: detail.commits?.length ?? 0,
    mergeable: checks?.mergeable ?? null,
    mergeableState: checks?.mergeable_state ?? null,
    checks: asCheckState(checks?.state),
    unavailableSections,
  };
}


// --- issues, releases, repository content -----------------------------------
// Backend paths (`Jaggerxtrm/console` routes/github.ts):
//   GET /api/github/issues?repo=&state=&limit&offset -> { data: GithubIssue[] }
//       (`state` is an exact column match, so both states come from one unfiltered read)
//   GET /api/github/issues/:owner/:repo/:number       -> GithubIssue row (unwrapped)
//   GET /api/github/releases?repo=&limit&offset       -> { releases: GithubRelease[] }
//   GET /api/github/repo/:owner/:name/markdown?path=  -> { content, sha, last_modified }
//       (README.md and CHANGELOG.md only; anything else is a 400)
//   GET /api/github/repo/:owner/:name/reports         -> { data: GithubReportSummary[] }
//   GET /api/github/repo/:owner/:name/reports/:file   -> { content, sha, last_modified }

/** Poller-cache issue row (store.ts GithubIssue). `label_names` is a JSON array string. */
interface WireIssue {
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  author: string;
  url: string;
  comment_count: number | null;
  label_names: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface WireRelease {
  id: number | string;
  repo_full_name: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  author_login: string | null;
  published_at: string | null;
  html_url: string | null;
}

interface WireFile {
  content: string | null;
  sha: string | null;
  last_modified: string | null;
}

interface WireReport {
  name: string;
  path: string;
  sha: string;
  size: number;
}

/** Labels arrive as a JSON array string; a malformed value degrades to no labels, never to a crash. */
export function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}

export function mapIssue(row: WireIssue): GithubIssueSummary {
  return {
    number: row.number,
    title: row.title,
    body: row.body,
    state: row.state === "closed" ? "closed" : "open",
    author: row.author,
    labels: parseLabels(row.label_names),
    comments: row.comment_count ?? 0,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

export function mapRelease(row: WireRelease): Release {
  return {
    id: String(row.id),
    tag: row.tag_name,
    name: row.name?.trim() || row.tag_name,
    notes: row.body,
    author: row.author_login,
    publishedAt: row.published_at,
    url: row.html_url ?? `https://github.com/${row.repo_full_name}/releases/tag/${row.tag_name}`,
  };
}

export function mapDocument(path: string, file: WireFile): RepoDocument {
  return { path, content: file.content, sha: file.sha, lastModified: file.last_modified };
}

export const liveGithub: GithubAdapter = {
  source: "live",
  async listRepos() {
    return (await getData<WireRepo[]>("/repos")).filter((r) => r.tracked).map(mapRepo);
  },
  async repoStats() {
    return (await getData<WireStats[]>("/repos/stats")).map(mapStats);
  },
  async events(repo, limit = 200) {
    const q = new URLSearchParams({ repos: repo, limit: String(limit) });
    return (await getData<WireEvent[]>(`/events?${q}`)).map(mapEvent);
  },
  async listPulls(repo, state: PullListState = "open") {
    const params = (s?: string) => {
      const q = new URLSearchParams({ repo, limit: "100" });
      if (s) q.set("state", s);
      return q;
    };
    if (state === "all") {
      // `state` is an exact column match (`all` would match nothing).
      return (await getData<WirePr[]>(`/prs?${params()}`)).map((p) => mapPull(repo, p));
    }
    if (state === "closed") {
      // Unlike the GitHub API, backend `closed` excludes `merged`.
      const [closed, merged] = await Promise.all([getData<WirePr[]>(`/prs?${params("closed")}`), getData<WirePr[]>(`/prs?${params("merged")}`)]);
      return [...closed, ...merged].map((p) => mapPull(repo, p)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return (await getData<WirePr[]>(`/prs?${params(state)}`)).map((p) => mapPull(repo, p));
  },
  async getPull(repo, number: number) {
    const [owner, name] = repo.split("/");
    const [row, detail, checksRaw] = await Promise.all([
      getRaw<WirePr>(`/prs/${owner}/${name}/${number}`),
      getRaw<WireDetail>(`/prs/${owner}/${name}/${number}/detail`),
      tryRaw<WireChecks | { data: WireChecks }>(`/prs/${owner}/${name}/${number}/checks`),
    ]);
    const checks =
      checksRaw && typeof checksRaw === "object" && ("state" in checksRaw || "mergeable" in checksRaw)
        ? (checksRaw as WireChecks)
        : ((checksRaw as { data?: WireChecks } | null)?.data ?? null);
    return mapPullDetail(repo, row, detail, checks);
  },
  async listIssues(repo) {
    const q = new URLSearchParams({ repo, limit: "200" });
    return (await getData<WireIssue[]>(`/issues?${q}`)).map(mapIssue).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getIssue(repo, number: number) {
    const [owner, name] = repo.split("/");
    return mapIssue(await getRaw<WireIssue>(`/issues/${owner}/${name}/${number}`));
  },
  async listReleases(repo) {
    const q = new URLSearchParams({ repo, limit: "100" });
    const { releases } = await getRaw<{ releases: WireRelease[] }>(`/releases?${q}`);
    return releases.map(mapRelease).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  },
  async getDocument(repo, path: string) {
    const [owner, name] = repo.split("/");
    const q = new URLSearchParams({ path });
    return mapDocument(path, await getRaw<WireFile>(`/repo/${owner}/${name}/markdown?${q}`));
  },
  async listReports(repo) {
    const [owner, name] = repo.split("/");
    return await getData<WireReport[]>(`/repo/${owner}/${name}/reports`);
  },
  async getReport(repo, filename: string) {
    const [owner, name] = repo.split("/");
    return mapDocument(filename, await getRaw<WireFile>(`/repo/${owner}/${name}/reports/${encodeURIComponent(filename)}`));
  },
};
