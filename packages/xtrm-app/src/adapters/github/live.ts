import type {
  CheckState,
  GithubAdapter,
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
// Row shape: packages/core/src/github/store.ts GithubPr (snake_case). Rows
// carry no branches, draft flag, or check/review state; those map to neutral
// fallbacks below instead of guessed fields.

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
  // absent today (verified against the live /prs response).
  head?: { ref?: string } | null;
  head_branch?: string | null;
  base?: { ref?: string } | null;
  base_branch?: string | null;
}

/** Detail payload sections used here (route-runtime.ts PrDetailPayload). */
interface WireDetail {
  pr: WirePr;
  reviews: Array<{ id: number; author: string; state: string; submitted_at: string | null }>;
  commits: Array<{ sha: string }>;
  files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
}

interface WireChecks {
  state: string | null;
  checks?: Array<{ name?: string }> | null;
  head_sha?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
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

function asCheckState(raw: string | null | undefined): CheckState {
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
    default:
      return "none";
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

export function mapPull(repo: string, raw: WirePr): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author ?? "—",
    // Rows carry no branch refs; tolerated fields map if the backend adds them.
    headBranch: raw.head?.ref ?? raw.head_branch ?? "—",
    baseBranch: raw.base?.ref ?? raw.base_branch ?? "—",
    state: asPullState(raw),
    draft: false,
    // List rows carry no check/review state; the drawer resolves both.
    checks: "none",
    review: "none",
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    comments: raw.comment_count ?? 0,
    updatedAt: raw.updated_at ?? raw.created_at,
    createdAt: raw.created_at,
    url: raw.url ?? `https://github.com/${repo}/pull/${raw.number}`,
    body: raw.body,
  };
}

/** Latest review decides the drawer summary; empty review lists stay `none`. */
function summarizeReviews(reviews: WireDetail["reviews"]): { review: ReviewState; rows: PullRequestDetail["reviews"] } {
  const rows = reviews.map((r) => ({ id: String(r.id), author: r.author ?? "—", state: asReviewState(r.state), submittedAt: r.submitted_at }));
  const last = rows.filter((r) => r.state !== "none").at(-1);
  return { review: last?.state ?? "none", rows };
}

export function mapPullDetail(repo: string, row: WirePr, detail: WireDetail, checks: WireChecks | null): PullRequestDetail {
  const base = mapPull(repo, row);
  const files = (detail.files ?? []).map((f) => ({
    filename: f.filename ?? "—",
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    status: f.status ?? "modified",
  }));
  const { review, rows } = summarizeReviews(detail.reviews ?? []);
  return {
    ...base,
    // Row counters are null until enriched; fall back to the file summary.
    additions: row.additions ?? files.reduce((n, f) => n + f.additions, 0),
    deletions: row.deletions ?? files.reduce((n, f) => n + f.deletions, 0),
    changedFiles: row.changed_files ?? files.length,
    comments: row.comment_count ?? base.comments,
    review,
    reviews: rows,
    files,
    commits: detail.commits?.length ?? 0,
    mergeable: checks?.mergeable ?? null,
    mergeableState: checks?.mergeable_state ?? null,
    checks: asCheckState(checks?.state),
  };
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
};
