import type { GithubAdapter, Repo, RepoEvent, RepoEventKind, RepoStats } from "../types.ts";

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
};
