import type { GithubAdapter, PullListState, PullRequestDetail, PullRequestSummary, Repo, RepoEvent } from "../types.ts";

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

// --- pull requests ----------------------------------------------------------
// Fixture PRs carry Substrate issue keys in title/branch/body so the linkage
// (PR -> issue chips) is exercisable without live data. Numbers, authors, and
// check/review states vary across the Open / Merged / Closed views.

interface FixturePull extends PullRequestSummary {
  mergeable: boolean | null;
  mergeableState: string | null;
  commits: number;
  reviews: PullRequestDetail["reviews"];
  files: PullRequestDetail["files"];
}

const pullSeed: Array<Omit<FixturePull, "url" | "createdAt" | "updatedAt"> & { ageMin: number }> = [
  {
    number: 212, title: "feat(XTRM-301): rail keyboard model v2", author: "Jaggerxtrm", headBranch: "xt/o8h2", baseBranch: "main",
    state: "open", draft: false, checks: "passing", review: "approved", additions: 412, deletions: 88, changedFiles: 3, comments: 4,
    body: "Implements XTRM-301. Follow-up to XTRM-300.1.", mergeable: true, mergeableState: "clean", commits: 3,
    reviews: [{ id: "r212-1", author: "reviewer-xtrm", state: "approved", submittedAt: ago(120) }],
    files: [
      { filename: "packages/xtrm-app/src/shell/context.tsx", additions: 210, deletions: 40, status: "modified" },
      { filename: "packages/xtrm-app/src/shell/layout.ts", additions: 120, deletions: 30, status: "modified" },
      { filename: "packages/xtrm-app/src/github/PullsSurface.tsx", additions: 82, deletions: 18, status: "added" },
    ],
    ageMin: 45,
  },
  {
    number: 211, title: "fix(XTRM-305): silence virtual-bead spam", author: "Jaggerxtrm", headBranch: "fix/XTRM-305-bead-spam", baseBranch: "main",
    state: "open", draft: false, checks: "pending", review: "pending", additions: 96, deletions: 12, changedFiles: 4, comments: 1,
    body: "Fixes XTRM-305. See also XTRM-94.", mergeable: null, mergeableState: "unknown", commits: 1,
    reviews: [],
    files: [{ filename: "packages/agentsession-sre/src/feed.ts", additions: 96, deletions: 12, status: "modified" }],
    ageMin: 180,
  },
  {
    number: 210, title: "docs: canonical Console v2 baseline", author: "Jaggerxtrm", headBranch: "docs/baseline", baseBranch: "main",
    state: "open", draft: true, checks: "none", review: "none", additions: 3578, deletions: 13, changedFiles: 15, comments: 0,
    body: null, mergeable: true, mergeableState: "clean", commits: 2,
    reviews: [],
    files: [{ filename: "packages/xtrm-app/docs/console-v2-shell-architecture.md", additions: 900, deletions: 5, status: "modified" }],
    ageMin: 300,
  },
  {
    number: 209, title: "feat(XTRM-302): collapsed sidebar reopen rail", author: "contrib-xtrm", headBranch: "xt/il2a", baseBranch: "main",
    state: "open", draft: false, checks: "failing", review: "changes_requested", additions: 240, deletions: 60, changedFiles: 6, comments: 7,
    body: "Implements XTRM-302. UTF-8 is not a reference.", mergeable: false, mergeableState: "dirty", commits: 4,
    reviews: [{ id: "r209-1", author: "Jaggerxtrm", state: "changes_requested", submittedAt: ago(400) }],
    files: [{ filename: "packages/xtrm-app/src/shell/AppShell.tsx", additions: 240, deletions: 60, status: "modified" }],
    ageMin: 500,
  },
  {
    number: 208, title: "feat(XTRM-94): Substrate Documentation vNext", author: "Jaggerxtrm", headBranch: "feat/XTRM-94-docs-vnext", baseBranch: "main",
    state: "merged", draft: false, checks: "passing", review: "approved", additions: 902, deletions: 188, changedFiles: 23, comments: 12,
    body: "Closes XTRM-94.", mergeable: null, mergeableState: null, commits: 6,
    reviews: [{ id: "r208-1", author: "reviewer-xtrm", state: "approved", submittedAt: ago(2900) }],
    files: [{ filename: "docs/substrate/README.md", additions: 902, deletions: 188, status: "modified" }],
    ageMin: 2900,
  },
  {
    number: 207, title: "feat(XTRM-300): Console v2 executable shell", author: "Jaggerxtrm", headBranch: "xt/rq8w", baseBranch: "main",
    state: "merged", draft: false, checks: "passing", review: "commented", additions: 1250, deletions: 40, changedFiles: 11, comments: 5,
    body: "Epic XTRM-300 vertical slice.", mergeable: null, mergeableState: null, commits: 5,
    reviews: [{ id: "r207-1", author: "reviewer-xtrm", state: "commented", submittedAt: ago(4300) }],
    files: [{ filename: "packages/xtrm-app/src/surfaces/ActivitySurface.tsx", additions: 300, deletions: 10, status: "modified" }],
    ageMin: 4300,
  },
  {
    number: 206, title: "docs(xtrm-app): canonical Console v2 baseline", author: "Jaggerxtrm", headBranch: "docs/v2-baseline", baseBranch: "main",
    state: "merged", draft: false, checks: "passing", review: "approved", additions: 3578, deletions: 13, changedFiles: 15, comments: 3,
    body: null, mergeable: null, mergeableState: null, commits: 2,
    reviews: [],
    files: [],
    ageMin: 5600,
  },
  {
    number: 205, title: "chore: drop dead RightSidebar mount", author: "contrib-xtrm", headBranch: "chore/drop-right-sidebar", baseBranch: "main",
    state: "closed", draft: false, checks: "failing", review: "changes_requested", additions: 12, deletions: 210, changedFiles: 3, comments: 2,
    body: "Superseded by the Inspector Drawer.", mergeable: null, mergeableState: null, commits: 1,
    reviews: [{ id: "r205-1", author: "Jaggerxtrm", state: "changes_requested", submittedAt: ago(8000) }],
    files: [],
    ageMin: 8000,
  },
  {
    number: 204, title: "feat(XTRM-303): root-export readiness types", author: "Jaggerxtrm", headBranch: "feat/XTRM-303-readiness", baseBranch: "main",
    state: "closed", draft: false, checks: "none", review: "none", additions: 44, deletions: 9, changedFiles: 2, comments: 0,
    body: "Withdrawn; landed as part of XTRM-303.", mergeable: null, mergeableState: null, commits: 1,
    reviews: [],
    files: [],
    ageMin: 9900,
  },
];

export const fixturePulls = (repo: string): PullRequestSummary[] => {
  const [owner = "xtrm-dev", name = repo] = repo.includes("/") ? repo.split("/") : ["xtrm-dev", repo];
  return pullSeed.map((p) => ({
    ...p,
    title: p.title,
    url: `https://github.com/${owner}/${name}/pull/${p.number}`,
    createdAt: ago(p.ageMin + 60),
    updatedAt: ago(p.ageMin),
  }));
};

export const fixturePullDetail = (repo: string, number: number): PullRequestDetail | null => {
  const base = fixturePulls(repo).find((p) => p.number === number);
  if (!base) return null;
  const seedRow = pullSeed.find((p) => p.number === number)!;
  return { ...base, mergeable: seedRow.mergeable, mergeableState: seedRow.mergeableState, commits: seedRow.commits, reviews: seedRow.reviews, files: seedRow.files };
};

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
  async listPulls(repo, state: PullListState = "open") {
    const rows = fixturePulls(repo);
    if (state === "all") return rows;
    if (state === "closed") return rows.filter((p) => p.state !== "open");
    return rows.filter((p) => p.state === "open");
  },
  async getPull(repo, number: number) {
    const detail = fixturePullDetail(repo, number);
    if (!detail) throw new Error(`unknown pull ${repo}#${number}`);
    return detail;
  },
};
