// Live PR state (XTRM-728): the observation the reconciler stores and the
// GitHub transport it reads through. Links stay in issue_pull_requests;
// this row only says what the PR is doing now.

export const PULL_REQUEST_STATES = ["open", "merged", "closed"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export interface PullRequestObservation {
  repository: string;
  number: number;
  state: PullRequestState;
  draft: boolean;
  headSha: string | null;
  headRef: string | null;
  baseRef: string | null;
  mergeCommitSha: string | null;
  title: string | null;
  url: string | null;
  body: string | null;
  mergedAt: number | null;
  closedAt: number | null;
  etag: string | null;
  lastModified: string | null;
  updatedAt: string | null;
}

export interface PullRequestCommit {
  sha: string;
  message: string;
}

export interface PullRequestSource {
  list(repository: string, opts: { limit: number }): Array<{ number: number; updatedAt: string | null }>;
  get(
    repository: string,
    number: number,
    cache: { etag: string | null; lastModified: string | null },
  ): PullRequestObservation | "not-modified";
  commits(repository: string, number: number): PullRequestCommit[];
}

/** Issue refs in prose: XTRM-1, CORE-2601, XTRM-725.3. Deduped, in order. */
export function issueRefsIn(text: string | null): string[] {
  if (text === null) return [];
  const found: string[] = [];
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9]*-\d+(?:\.\d+)*\b/g)) {
    if (!found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

export interface GhIncludeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Parse `gh api --include` output: status line, headers, blank line, body. */
export function parseGhInclude(stdout: string): GhIncludeResponse {
  const lines = stdout.split(/\r?\n/);
  const statusLine = lines.shift() ?? "";
  const status = Number(statusLine.split(/\s+/)[1] ?? 0);
  const headers: Record<string, string> = {};
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line === "") {
      index += 1;
      break;
    }
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status, headers, body: lines.slice(index).join("\n") };
}
