// The source loaders (XTRM-757). Each one returns a page of rows or an
// error, never a partial array: the surface renders a failed source as its own
// inline state instead of silently dropping its rows.

import type { GithubAdapter, GithubIssueSummary, PullRequestSummary, SubstrateAdapter } from "../adapters/types.ts";
import { journalFeedRows } from "./substrate.ts";
import { githubIssueRow, pullConversationRows, pullRow } from "./github.ts";
import { pushRows } from "./push.ts";
import type { ActivityPage, ActivityRow, ActivitySource } from "./types.ts";

/** One page size for every source: the console never loads a whole history. */
export const ACTIVITY_PAGE = 50;
/** Pull requests whose reviews and comments are read; bounded so the feed costs O(1) calls. */
export const REVIEWED_PRS = 8;
/** Push events read per load. The events endpoint is the only source of pushes. */
export const ACTIVITY_EVENTS = 200;

export interface FeedContext {
  repo: string;
  projectId: string | null;
  github: GithubAdapter;
  substrate: SubstrateAdapter;
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
  // Journal entries only. A status row would have to stamp the board's
  // `updatedAt`, which is not a transition time, so it would read as a
  // transition Substrate never recorded; the project-wide event read that would
  // make it honest is a separate Issue.
  const feed = await ctx.substrate.journalFeed(ctx.projectId, { limit: ACTIVITY_PAGE, cursor });
  const rows = journalFeedRows({ projectId: ctx.projectId, entries: feed.entries, nextCursor: feed.nextCursor });
  return { source: "substrate", rows, cursor: feed.nextCursor };
}

/**
 * GitHub: pull requests, issues and pushes, then reviews and comments for the
 * newest few PRs. Pushes belong to this source, not to a source of their own:
 * they are GitHub events, and one failed GitHub read is one failed source.
 */
export async function loadGithub(ctx: FeedContext): Promise<ActivityPage> {
  const [pulls, issues, events] = await Promise.all([
    ctx.github.listPulls(ctx.repo, "all"),
    ctx.github.listIssues(ctx.repo),
    ctx.github.events(ctx.repo, ACTIVITY_EVENTS),
  ]);
  const rows: ActivityRow[] = [
    ...pulls.slice(0, ACTIVITY_PAGE).map((pr) => pullRow(pr, ctx.repo)).filter((r): r is ActivityRow => r !== null),
    ...issues.slice(0, ACTIVITY_PAGE).map((issue) => githubIssueRow(issue, ctx.repo)).filter((r): r is ActivityRow => r !== null),
    ...pushRows(events).slice(0, ACTIVITY_PAGE),
  ];
  const recent = [...pulls].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, REVIEWED_PRS);
  for (const pr of recent) {
    const detail = await ctx.github.getPull(ctx.repo, pr.number);
    rows.push(...pullConversationRows(detail, ctx.repo));
  }
  return { source: "github", rows, cursor: null };
}

export type SourceLoader = (ctx: FeedContext, cursor: string | null) => Promise<ActivityPage>;

/**
 * Every source the feed offers today, with its loader. `git` is retired: local
 * commits are no longer a source, and `LIVE_ACTIVITY_SOURCES` names what runs.
 */
export const SOURCE_LOADERS: Partial<Record<Exclude<ActivitySource, "jira">, SourceLoader>> = {
  substrate: loadSubstrate,
  github: (ctx) => loadGithub(ctx),
};

/** Run one source, converting a failure into its own error state. */
export async function loadSourceState(
  source: Exclude<ActivitySource, "jira">,
  ctx: FeedContext,
  cursor: string | null = null,
): Promise<{ source: ActivitySource; rows: ActivityRow[]; cursor: string | null; error: string | null; pending: boolean }> {
  try {
    const loader = SOURCE_LOADERS[source];
    if (loader === undefined) throw new Error(`activity source ${source} is retired`);
    const page = await loader(ctx, cursor);
    return { source, rows: page.rows, cursor: page.cursor, error: null, pending: false };
  } catch (err) {
    return { source, rows: [], cursor: null, error: err instanceof Error ? err.message : String(err), pending: false };
  }
}
