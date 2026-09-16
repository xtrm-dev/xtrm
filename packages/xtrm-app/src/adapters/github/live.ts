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

async function tryData<T>(path: string): Promise<T | null> {
  try {
    return await getData<T>(path);
  } catch {
    return null;
  }
}

// --- pull requests ----------------------------------------------------------
// Reads go through the Console v1 backend (XTRM-395 step 1: no auth changes,
// no direct api.github.com calls from xtrm-app). List/detail are served from
// the backend poller cache; checks/mergeability/files are passthrough
// endpoints with the existing TTL shape (`route-runtime.ts`):
//   GET /api/github/repos/:owner/:repo/pulls?state=all
//   GET /api/github/repos/:owner/:repo/pulls/:n
//   GET /api/github/repos/:owner/:repo/pulls/:n/checks
//   GET /api/github/repos/:owner/:repo/pulls/:n/files
// When the passthrough PR lands without the newer endpoints, detail degrades
// to checks=none / empty files rather than failing the drawer.

interface WirePull {
  number: number;
  title: string;
  user?: { login?: string } | null;
  author?: string | null;
  head?: { ref?: string } | null;
  head_branch?: string | null;
  base?: { ref?: string } | null;
  base_branch?: string | null;
  state?: string | null;
  merged_at?: string | null;
  draft?: boolean | null;
  additions?: number | null;
  deletions?: number | null;
  changed_files?: number | null;
  comments?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  url?: string | null;
  body?: string | null;
  checks?: string | null;
  check_state?: string | null;
  review?: string | null;
  review_state?: string | null;
}

interface WirePullDetail extends WirePull {
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  commits?: number | null;
  reviews?: Array<{ id?: string | number; author?: string; user?: { login?: string }; state?: string; submitted_at?: string | null }> | null;
  files?: Array<{ filename?: string; additions?: number; deletions?: number; status?: string }> | null;
}

interface WireChecks {
  state?: string | null;
  total?: number | null;
}

interface WireFiles {
  files?: WirePullDetail["files"];
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
      return "commented";
    case "pending":
    case "review_required":
      return "pending";
    default:
      return "none";
  }
}

function asPullState(raw: WirePull): PullState {
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

export function mapPull(repo: string, raw: WirePull): PullRequestSummary {
  const [owner = "", name = repo] = repo.includes("/") ? repo.split("/") : ["", repo];
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author ?? raw.user?.login ?? "—",
    headBranch: raw.head?.ref ?? raw.head_branch ?? "—",
    baseBranch: raw.base?.ref ?? raw.base_branch ?? "main",
    state: asPullState(raw),
    draft: raw.draft ?? false,
    checks: asCheckState(raw.checks ?? raw.check_state),
    review: asReviewState(raw.review ?? raw.review_state),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    comments: raw.comments ?? 0,
    updatedAt: raw.updated_at ?? new Date().toISOString(),
    createdAt: raw.created_at ?? raw.updated_at ?? new Date().toISOString(),
    url: raw.html_url ?? raw.url ?? `https://github.com/${owner}/${name}/pull/${raw.number}`,
    body: raw.body ?? null,
  };
}

export function mapPullDetail(repo: string, raw: WirePullDetail, checks: WireChecks | null, files: WireFiles | WirePullDetail["files"] | null): PullRequestDetail {
  const base = mapPull(repo, raw);
  const fileRows = Array.isArray(files) ? files : (files as WireFiles | null)?.files ?? raw.files ?? [];
  return {
    ...base,
    mergeable: raw.mergeable ?? null,
    mergeableState: raw.mergeable_state ?? null,
    commits: raw.commits ?? 0,
    reviews: (raw.reviews ?? []).map((r, i) => ({
      id: String(r.id ?? `${base.number}-${i}`),
      author: r.author ?? r.user?.login ?? "—",
      state: asReviewState(r.state),
      submittedAt: r.submitted_at ?? null,
    })),
    files: (fileRows ?? []).map((f) => ({
      filename: f?.filename ?? "—",
      additions: f?.additions ?? 0,
      deletions: f?.deletions ?? 0,
      status: f?.status ?? "modified",
    })),
    checks: asCheckState((checks as WireChecks | null)?.state ?? (raw as WirePull).checks ?? (raw as WirePull).check_state),
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
    const q = new URLSearchParams({ state });
    return (await getData<WirePull[]>(`/repos/${repo}/pulls?${q}`)).map((p) => mapPull(repo, p));
  },
  async getPull(repo, number: number) {
    const [detail, checks, files] = await Promise.all([
      getData<WirePullDetail>(`/repos/${repo}/pulls/${number}`),
      tryData<WireChecks>(`/repos/${repo}/pulls/${number}/checks`),
      tryData<WireFiles>(`/repos/${repo}/pulls/${number}/files`),
    ]);
    return mapPullDetail(repo, detail, checks, files);
  },
};
