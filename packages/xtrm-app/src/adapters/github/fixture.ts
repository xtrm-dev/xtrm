import type { GithubAdapter, GithubIssueSummary, PullListState, PullRequestDetail, PullRequestSummary, Release, Repo, RepoEvent } from "../types.ts";

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
  conversationComments: PullRequestDetail["conversationComments"];
  reviewComments: PullRequestDetail["reviewComments"];
  files: PullRequestDetail["files"];
}

const pullSeed: Array<Omit<FixturePull, "url" | "createdAt" | "updatedAt"> & { ageMin: number }> = [
  {
    number: 212, title: "feat(XTRM-301): rail keyboard model v2", author: "Jaggerxtrm", headBranch: "xt/o8h2", baseBranch: "main",
    state: "open", draft: false, checks: "passing", review: "approved", additions: 412, deletions: 88, changedFiles: 3, comments: 6,
    body: "Implements XTRM-301. Follow-up to XTRM-300.1.", mergeable: true, mergeableState: "clean", commits: 3,
    reviews: [{ id: "r212-1", author: "reviewer-xtrm", state: "approved", submittedAt: ago(120), body: "Looks good — rail toggle reads well.", url: null }],
    conversationComments: [
      { id: "c212-1", author: "Jaggerxtrm", body: "Heads up: this needs the Mod+I tooltip before merge.", url: null, createdAt: ago(140), updatedAt: null },
      { id: "c212-2", author: "github-actions[bot]", url: "https://github.com/xtrm-dev/xtrm/pull/212#issuecomment-1", createdAt: ago(130), updatedAt: null,
        body: [
          "<!-- pr-lens -->",
          "",
          "<h3>Rail keyboard model review package</h3>",
          "",
          "<p>The change reworks the rail keyboard model. <code>1 file</code> · <code>+412</code> · <code>−88</code> · <code>PR wait p50 441s</code></p>",
          "",
          "<details open>",
          "<summary><b>Rail before and after</b></summary>",
          "",
          '<a href="https://example.invalid/pr-lens-fixture/rail-light-a.svg"><picture>',
          '  <source media="(prefers-color-scheme: dark)" srcset="https://example.invalid/pr-lens-fixture/rail-dark-a.svg">',
          '  <img alt="Rail before and after" src="https://example.invalid/pr-lens-fixture/rail-light-a.svg" width="1318">',
          "</picture></a>",
          "",
          "</details>",
          "",
          "<details>",
          "<summary><b>Focus order</b></summary>",
          "",
          '<a href="https://example.invalid/pr-lens-fixture/focus-light-b.svg"><picture>',
          '  <source media="(prefers-color-scheme: dark)" srcset="https://example.invalid/pr-lens-fixture/focus-dark-b.svg">',
          '  <img alt="Focus order" src="https://example.invalid/pr-lens-fixture/focus-light-b.svg" width="1551">',
          "</picture></a>",
          "",
          "</details>",
          "",
          "---",
          "",
          '<sub>◈ Rendered by <a href="https://github.com/coldteadotai/pr-lens">PR Lens</a> · <script>alert("x")</script></sub>',
        ].join("\n") },
      { id: "c212-3", author: "github-actions[bot]", url: "https://github.com/xtrm-dev/xtrm/pull/212#issuecomment-2", createdAt: ago(125), updatedAt: null,
        body: [
          "<!-- pr-lens -->",
          "",
          "<h3>Rail keyboard model review package (2)</h3>",
          "",
          "<p>Refreshed after the tooltip fix.</p>",
          "",
          "<details open>",
          "<summary><b>Tooltip placement</b></summary>",
          "",
          '<a href="https://example.invalid/pr-lens-fixture/tooltip-light-c.svg"><picture>',
          '  <source media="(prefers-color-scheme: dark)" srcset="https://example.invalid/pr-lens-fixture/tooltip-dark-c.svg">',
          '  <img alt="Tooltip placement" src="https://example.invalid/pr-lens-fixture/tooltip-light-c.svg" width="1318">',
          "</picture></a>",
          "",
          "</details>",
        ].join("\n") },
    ],
    reviewComments: [],
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
    conversationComments: [],
    reviewComments: [],
    files: [{ filename: "packages/agentsession-sre/src/feed.ts", additions: 96, deletions: 12, status: "modified" }],
    ageMin: 180,
  },
  {
    number: 210, title: "docs: canonical Console v2 baseline", author: "Jaggerxtrm", headBranch: "docs/baseline", baseBranch: "main",
    state: "open", draft: true, checks: "none", review: "none", additions: 3578, deletions: 13, changedFiles: 15, comments: 0,
    body: null, mergeable: true, mergeableState: "clean", commits: 2,
    reviews: [],
    conversationComments: [],
    reviewComments: [],
    files: [{ filename: "packages/xtrm-app/docs/console-v2-shell-architecture.md", additions: 900, deletions: 5, status: "modified" }],
    ageMin: 300,
  },
  {
    number: 209, title: "feat(XTRM-302): collapsed sidebar reopen rail", author: "contrib-xtrm", headBranch: "xt/il2a", baseBranch: "main",
    state: "open", draft: false, checks: "failing", review: "changes_requested", additions: 240, deletions: 60, changedFiles: 6, comments: 7,
    body: "Implements XTRM-302. UTF-8 is not a reference.", mergeable: false, mergeableState: "dirty", commits: 4,
    reviews: [{ id: "r209-1", author: "Jaggerxtrm", state: "changes_requested", submittedAt: ago(400), body: "**[test · Console v2]** Review summary to preview review rendering.", url: null }],
    conversationComments: [
      { id: "c209-1", author: "Jaggerxtrm", body: "**[test · Console v2]** Conversation comment to preview PR thread rendering in the XTRM Console drawer. Safe to ignore.", url: null, createdAt: ago(410), updatedAt: null },
    ],
    reviewComments: [
      { id: "rc209-1", author: "Jaggerxtrm", body: "Inline test comment: does the drawer show code-anchored threads?", path: "packages/xtrm-app/docs/README.md", line: 24, originalLine: null, inReplyToId: null, diffHunk: null, url: null, createdAt: ago(405), updatedAt: null },
      { id: "rc209-2", author: "Jaggerxtrm", body: "Reply in the same thread (test).", path: "packages/xtrm-app/docs/README.md", line: 24, originalLine: null, inReplyToId: "rc209-1", diffHunk: null, url: null, createdAt: ago(404), updatedAt: null },
    ],
    files: [{ filename: "packages/xtrm-app/src/shell/AppShell.tsx", additions: 240, deletions: 60, status: "modified" }],
    ageMin: 500,
  },
  {
    number: 208, title: "feat(XTRM-94): Substrate Documentation vNext", author: "Jaggerxtrm", headBranch: "feat/XTRM-94-docs-vnext", baseBranch: "main",
    state: "merged", draft: false, checks: "passing", review: "approved", additions: 902, deletions: 188, changedFiles: 23, comments: 12,
    body: "Closes XTRM-94.", mergeable: null, mergeableState: null, commits: 6,
    reviews: [{ id: "r208-1", author: "reviewer-xtrm", state: "approved", submittedAt: ago(2900), body: null, url: null }],
    conversationComments: [],
    reviewComments: [],
    files: [{ filename: "docs/substrate/README.md", additions: 902, deletions: 188, status: "modified" }],
    ageMin: 2900,
  },
  {
    number: 207, title: "feat(XTRM-300): Console v2 executable shell", author: "Jaggerxtrm", headBranch: "xt/rq8w", baseBranch: "main",
    state: "merged", draft: false, checks: "passing", review: "commented", additions: 1250, deletions: 40, changedFiles: 11, comments: 5,
    body: "Epic XTRM-300 vertical slice.", mergeable: null, mergeableState: null, commits: 5,
    reviews: [{ id: "r207-1", author: "reviewer-xtrm", state: "commented", submittedAt: ago(4300), body: "Nice slice.", url: null }],
    conversationComments: [],
    reviewComments: [],
    files: [{ filename: "packages/xtrm-app/src/surfaces/ActivitySurface.tsx", additions: 300, deletions: 10, status: "modified" }],
    ageMin: 4300,
  },
  {
    number: 206, title: "docs(xtrm-app): canonical Console v2 baseline", author: "Jaggerxtrm", headBranch: "docs/v2-baseline", baseBranch: "main",
    state: "merged", draft: false, checks: "passing", review: "approved", additions: 3578, deletions: 13, changedFiles: 15, comments: 3,
    body: null, mergeable: null, mergeableState: null, commits: 2,
    reviews: [],
    conversationComments: [],
    reviewComments: [],
    files: [],
    ageMin: 5600,
  },
  {
    number: 205, title: "chore: drop dead RightSidebar mount", author: "contrib-xtrm", headBranch: "chore/drop-right-sidebar", baseBranch: "main",
    state: "closed", draft: false, checks: "failing", review: "changes_requested", additions: 12, deletions: 210, changedFiles: 3, comments: 2,
    body: "Superseded by the Inspector Drawer.", mergeable: null, mergeableState: null, commits: 1,
    reviews: [{ id: "r205-1", author: "Jaggerxtrm", state: "changes_requested", submittedAt: ago(8000), body: null, url: null }],
    conversationComments: [],
    reviewComments: [],
    files: [],
    ageMin: 8000,
  },
  {
    number: 204, title: "feat(XTRM-303): root-export readiness types", author: "Jaggerxtrm", headBranch: "feat/XTRM-303-readiness", baseBranch: "main",
    state: "closed", draft: false, checks: "none", review: "none", additions: 44, deletions: 9, changedFiles: 2, comments: 0,
    body: "Withdrawn; landed as part of XTRM-303.", mergeable: null, mergeableState: null, commits: 1,
    reviews: [],
    conversationComments: [],
    reviewComments: [],
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
  return { ...base, mergeable: seedRow.mergeable, mergeableState: seedRow.mergeableState, commits: seedRow.commits, reviews: seedRow.reviews, conversationComments: seedRow.conversationComments, reviewComments: seedRow.reviewComments, files: seedRow.files };
};

const issueSeed: Array<{ number: number; title: string; state: "open" | "closed"; author: string; labels: string[]; comments: number; ageMin: number; body: string | null }> = [
  { number: 41, title: "Drawer keyboard trap when maximized", state: "open", author: "octocat", labels: ["bug", "ui"], comments: 3, ageMin: 90, body: "Steps to reproduce:\n\n1. Maximize the inspector\n2. Press Tab\n\nRelated to XTRM-303." },
  { number: 38, title: "Document the release checklist", state: "open", author: "hubot", labels: ["docs"], comments: 0, ageMin: 1500, body: "The checklist lives only in chat." },
  { number: 30, title: "Flaky release smoke on slow disks", state: "closed", author: "octocat", labels: ["bug"], comments: 7, ageMin: 6000, body: null },
];

const releaseSeed: Array<{ tag: string; name: string; ageMin: number; notes: string | null }> = [
  { tag: "v0.4.0", name: "0.4.0 — inspector motion", ageMin: 240, notes: "### Added\n\n- Synchronized inspector motion (XTRM-301)\n- PR conversation threads\n\n### Fixed\n\n- Description no longer scrolls inside the drawer" },
  { tag: "v0.3.0", name: "0.3.0 — GitHub login", ageMin: 4300, notes: "Device-flow sign in, Settings › GitHub, and per-repository capability checks." },
  { tag: "v0.2.0", name: "", ageMin: 20000, notes: null },
];

export const fixtureIssues = (repo: string): GithubIssueSummary[] => {
  const [owner = "xtrm-dev", name = "xtrm"] = repo.split("/");
  return issueSeed.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    state: i.state,
    author: i.author,
    labels: i.labels,
    comments: i.comments,
    url: `https://github.com/${owner}/${name}/issues/${i.number}`,
    createdAt: ago(i.ageMin + 2000),
    updatedAt: ago(i.ageMin),
    closedAt: i.state === "closed" ? ago(i.ageMin) : null,
  }));
};

export const fixtureReleases = (repo: string): Release[] => {
  const [owner = "xtrm-dev", name = "xtrm"] = repo.split("/");
  return releaseSeed.map((r, i) => ({
    id: `rel-${i}`,
    tag: r.tag,
    name: r.name || r.tag,
    notes: r.notes,
    author: "octocat",
    publishedAt: ago(r.ageMin),
    url: `https://github.com/${owner}/${name}/releases/tag/${r.tag}`,
  }));
};

const DOCS: Record<string, string> = {
  "README.md": "# xtrm\n\nAgent-first operating environment.\n\n- Substrate owns executable work (XTRM-301)\n- Console v2 lives in `packages/xtrm-app`\n",
  "CHANGELOG.md": "## [Unreleased]\n\n### Added\n\n- GitHub Issues, Releases and Repository content surfaces (XTRM-397)\n",
};

const REPORTS = [
  { name: "2026-09-17-4890f38.md", path: ".xtrm/reports/2026-09-17-4890f38.md", sha: "a1b2c3d4", size: 4210 },
  { name: "2026-09-16-6a61da2.md", path: ".xtrm/reports/2026-09-16-6a61da2.md", sha: "e5f6a7b8", size: 3180 },
];

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
  async listIssues(repo) {
    return fixtureIssues(repo);
  },
  async getIssue(repo, number: number) {
    const issue = fixtureIssues(repo).find((i) => i.number === number);
    if (!issue) throw new Error(`unknown issue ${repo}#${number}`);
    return issue;
  },
  async listReleases(repo) {
    return fixtureReleases(repo);
  },
  async getDocument(_repo, path: string) {
    return { path, content: DOCS[path] ?? null, sha: DOCS[path] ? "fixture-sha" : null, lastModified: ago(120) };
  },
  async listReports() {
    return REPORTS;
  },
  async getReport(_repo, filename: string) {
    return { path: filename, content: `# Session report ${filename}\n\nClosed XTRM-397 with tests and screenshots.\n`, sha: "fixture-sha", lastModified: ago(60) };
  },
};
