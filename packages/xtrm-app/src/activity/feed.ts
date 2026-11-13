// The three source loaders (XTRM-757). Each one returns a page of rows or an
// error, never a partial array: the surface renders a failed source as its own
// inline state instead of silently dropping its rows.

import type { GithubAdapter, GithubIssueSummary, GitActivityAdapter, PullRequestSummary, SubstrateAdapter } from "../adapters/types.ts";
import { journalFeedRows, statusRow, type JournalFeedWire } from "./substrate.ts";
import { githubIssueRow, pullConversationRows, pullRow } from "./github.ts";
import { commitRows, type GitCommitWire } from "./git.ts";
import type { ActivityPage, ActivityRow, ActivitySource } from "./types.ts";

/** One page size for every source: the console never loads a whole history. */
export const ACTIVITY_PAGE = 50;
/** Pull requests whose reviews and comments are read; bounded so the feed costs O(1) calls. */
export const REVIEWED_PRS = 8;

export interface FeedContext {
  repo: string;
  projectId: string | null;
  github: GithubAdapter;
  substrate: SubstrateAdapter;
  gitActivity: GitActivityAdapter;
  /** Bridge base path, so tests can point at a stub. */
  bridge?: string;
  fetchImpl?: typeof fetch;
}

async function bridgeJson<T>(path: string, fetchImpl: typeof fetch, bridge: string): Promise<T> {
  const res = await fetchImpl(`${bridge}${path}`);
  const body = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (body.ok === false) throw new Error(body.error ?? `bridge refused ${path}`);
  return body;
}

/** Substrate: the project-wide journal feed plus one status row per issue. */
export async function loadSubstrate(ctx: FeedContext, cursor: string | null): Promise<ActivityPage> {
  if (ctx.projectId === null) return { source: "substrate", rows: [], cursor: null, error: "no Substrate project is mapped to this repository" };
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const bridge = ctx.bridge ?? "/xtrm-api/substrate";
  const query = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
  const feed = await bridgeJson<{ data: { entries: JournalFeedWire["entries"]; nextCursor: string | null } }>(
    `/journal-feed?project=${encodeURIComponent(ctx.projectId)}&limit=${ACTIVITY_PAGE}${query}`,
    fetchImpl,
    bridge,
  );
  const rows = journalFeedRows({ projectId: ctx.projectId, entries: feed.data.entries, nextCursor: feed.data.nextCursor });
  // Status rows come from the issue rows the console already reads; they state
  // the recorded state, not a claimed transition.
  const issues = await ctx.substrate.listIssues(ctx.projectId);
  const statuses: ActivityRow[] = issues.map((issue) =>
    statusRow({ ref: issue.ref, title: issue.title, lifecycle: issue.lifecycle, updatedAt: issue.updatedAt }),
  );
  const merged = [...rows, ...statuses];
  return { source: "substrate", rows: merged, cursor: feed.data.nextCursor };
}

/** GitHub: pull requests, issues, then reviews and comments for the newest few PRs. */
export async function loadGithub(ctx: FeedContext): Promise<ActivityPage> {
  const pulls: PullRequestSummary[] = await ctx.github.listPulls(ctx.repo, "all");
  const issues: GithubIssueSummary[] = await ctx.github.listIssues(ctx.repo);
  const rows: ActivityRow[] = [
    ...pulls.slice(0, ACTIVITY_PAGE).map((pr) => pullRow(pr, ctx.repo)),
    ...issues.slice(0, ACTIVITY_PAGE).map((issue) => githubIssueRow(issue, ctx.repo)),
  ];
  const recent = [...pulls].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, REVIEWED_PRS);
  for (const pr of recent) {
    const detail = await ctx.github.getPull(ctx.repo, pr.number);
    rows.push(...pullConversationRows(detail, ctx.repo));
  }
  return { source: "github", rows, cursor: null };
}

/** Git: the local log of the repository on disk, through the adapter. */
export async function loadGit(ctx: FeedContext): Promise<ActivityPage> {
  const commits: GitCommitWire[] = await ctx.gitActivity.commits(ctx.repo, ACTIVITY_PAGE);
  return { source: "git", rows: commitRows(commits), cursor: null };
}

export type SourceLoader = (ctx: FeedContext, cursor: string | null) => Promise<ActivityPage>;

/** Every source the feed offers today, with its loader. */
export const SOURCE_LOADERS: Record<Exclude<ActivitySource, "jira">, SourceLoader> = {
  substrate: loadSubstrate,
  github: (ctx) => loadGithub(ctx),
  git: (ctx) => loadGit(ctx),
};

/** Run one source, converting a failure into its own error state. */
export async function loadSourceState(
  source: Exclude<ActivitySource, "jira">,
  ctx: FeedContext,
  cursor: string | null = null,
): Promise<{ source: ActivitySource; rows: ActivityRow[]; cursor: string | null; error: string | null; pending: boolean }> {
  try {
    const page = await SOURCE_LOADERS[source](ctx, cursor);
    return { source, rows: page.rows, cursor: page.cursor, error: null, pending: false };
  } catch (err) {
    return { source, rows: [], cursor: null, error: err instanceof Error ? err.message : String(err), pending: false };
  }
}
