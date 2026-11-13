// Git source (XTRM-757): the LOCAL git log of the repository on disk, read by
// the bridge. GitHub supplies no commits, so every commit row has exactly one
// producer and the sha is its identity.

import type { ActivityRow } from "./types.ts";

export interface GitCommitWire {
  sha: string;
  author: string;
  subject: string;
  at: number;
  refs?: string[];
}

export function commitRow(commit: GitCommitWire): ActivityRow {
  return {
    id: `git:${commit.sha}`,
    source: "git",
    kind: "commit",
    actor: commit.author,
    verb: "committed",
    object: commit.subject,
    refs: [
      { kind: "commit", ref: commit.sha.slice(0, 7) },
      ...(commit.refs ?? []).map((ref) => ({ kind: "branch" as const, ref })),
    ],
    at: commit.at,
    meta: [
      ["commit", commit.sha],
      ["author", commit.author],
    ],
    body: null,
  };
}

export function commitRows(commits: readonly GitCommitWire[]): ActivityRow[] {
  return commits.map(commitRow);
}
