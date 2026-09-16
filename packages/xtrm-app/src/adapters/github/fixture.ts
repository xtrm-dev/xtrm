import type { GithubAdapter, Repo, RepoEvent } from "../types.ts";

// Development fixture. Shapes follow the Console v1 GitHub DTOs; content is illustrative.

const repos: Repo[] = [
  ["xtrm-dev", "xtrm"],
  ["xtrm-dev", "core"],
  ["xtrm-dev", "specialists"],
  ["Jaggerxtrm", "console"],
  ["mercuryintelligence", "program"],
].map(([owner, name]) => ({ fullName: `${owner}/${name}`, displayName: name!, owner: owner!, name: name!, lastPolledAt: null }));

const now = Date.parse("2026-09-16T17:00:00Z");
const ago = (m: number) => new Date(now - m * 60_000).toISOString();

const seed: Array<Omit<RepoEvent, "id" | "repo" | "createdAt">> = [
  { kind: "pull_request", rawType: "PullRequestEvent", branch: null, actor: "Jaggerxtrm", action: "opened", title: "docs(xtrm-app): canonical Console v2 baseline", body: null, url: "https://github.com/xtrm-dev/xtrm/pull/206", additions: 3578, deletions: 13, changedFiles: 15, commitCount: null },
  { kind: "push", rawType: "PushEvent", branch: "main", actor: "Jaggerxtrm", action: null, title: "docs(runtime): define first-party XTRM agent runtime", body: null, url: null, additions: 1250, deletions: 0, changedFiles: 11, commitCount: 1 },
  { kind: "create", rawType: "CreateEvent", branch: "xt/rq8w", actor: "Jaggerxtrm", action: null, title: "Created branch: xt/rq8w", body: null, url: null, additions: null, deletions: null, changedFiles: null, commitCount: null },
  { kind: "pull_request", rawType: "PullRequestEvent", branch: null, actor: "Jaggerxtrm", action: "merged", title: "feat(XTRM-94): Substrate Documentation vNext", body: null, url: "https://github.com/xtrm-dev/xtrm/pull/201", additions: 902, deletions: 188, changedFiles: 23, commitCount: null },
  { kind: "issue_comment", rawType: "IssueCommentEvent", branch: null, actor: "Jaggerxtrm", action: "created", title: "fix(agentsession-sre): silence virtual-bead spam", body: null, url: "https://github.com/xtrm-dev/xtrm/pull/85", additions: null, deletions: null, changedFiles: null, commitCount: null },
  { kind: "delete", rawType: "DeleteEvent", branch: null, actor: "Jaggerxtrm", action: null, title: null, body: null, url: null, additions: null, deletions: null, changedFiles: null, commitCount: null },
];

export const fixtureEvents = (repo: string): RepoEvent[] =>
  Array.from({ length: 90 }, (_, i) => ({ ...seed[i % seed.length]!, id: `fx-${repo}-${i}`, repo, createdAt: ago(i * 37 + 4) }));

export const fixtureGithub: GithubAdapter = {
  source: "fixture",
  async listRepos() {
    return repos;
  },
  async repoStats() {
    return repos.map((r, i) => ({ fullName: r.fullName, pushes: 12 - i * 2, prEvents24h: 5 - i, issueEvents24h: i, lastEventAt: ago(i * 90) }));
  },
  async events(repo, limit = 200) {
    return fixtureEvents(repo).slice(0, limit);
  },
};
