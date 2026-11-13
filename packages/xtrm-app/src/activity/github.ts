// GitHub source (XTRM-757): pull requests, issues, reviews and comments only.
// The operator ruling excluded PushEvent, so a commit is never seen twice: the
// git source owns commits.

import type { GithubIssueSummary, PullRequestDetail, PullRequestSummary } from "../adapters/types.ts";
import type { ActivityRow } from "./types.ts";

const PR_VERB = { open: "opened", merged: "merged", closed: "closed" } as const;

/** A row needs a real timestamp: an unparsable date means no row, never "now". */
function parseAt(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function pullRow(pr: PullRequestSummary, repo: string): ActivityRow | null {
  const verb = pr.state === "open" ? (pr.draft ? "opened a draft" : "opened") : PR_VERB[pr.state];
  const at = parseAt(pr.state === "open" ? pr.createdAt : pr.updatedAt);
  if (at === null) return null;
  return {
    id: `github:${repo}#${pr.number}`,
    source: "github",
    kind: pr.state === "open" ? "pr.opened" : `pr.${pr.state}`,
    actor: pr.author,
    verb,
    object: `${repo}#${pr.number} ${pr.title}`,
    refs: [{ kind: "pr", ref: `${repo}#${pr.number}` }],
    at,
    meta: [
      ["state", pr.state],
      // A merged/closed PR is dated by its last update, not by a merge time the
      // summary does not carry: say which clock the row uses.
      ...(pr.state === "open" ? [] : [["dated by", "last update"] as [string, string]]),
      ["branch", `${pr.headBranch} → ${pr.baseBranch}`],
      ["review", pr.review],
      ["checks", pr.checks],
    ],
    body: pr.body,
  };
}

export function githubIssueRow(issue: GithubIssueSummary, repo: string): ActivityRow | null {
  const at = parseAt(issue.closedAt ?? issue.createdAt);
  if (at === null) return null;
  return {
    id: `github:issue:${repo}#${issue.number}`,
    source: "github",
    kind: issue.closedAt === null ? "issue.opened" : "issue.closed",
    actor: issue.author,
    verb: issue.closedAt === null ? "opened" : "closed",
    object: `${repo}#${issue.number} ${issue.title}`,
    // A GitHub issue is not a Substrate issue and not a pull request: it has its
    // own reference kind so the chip opens the GitHub issue, not the PR.
    refs: [{ kind: "gh-issue", ref: `${repo}#${issue.number}` }],
    at,
    meta: [
      ["state", issue.closedAt === null ? "open" : "closed"],
      ["labels", issue.labels.join(", ") || "none"],
    ],
    body: issue.body,
  };
}

/** Reviews and conversation comments of one pull request. */
export function pullConversationRows(detail: PullRequestDetail, repo: string): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const review of detail.reviews) {
    const at = parseAt(review.submittedAt ?? detail.updatedAt);
    if (at === null) continue;
    rows.push({
      id: `github:review:${review.id}`,
      source: "github",
      kind: `review.${review.state}`,
      actor: review.author,
      verb: review.state === "approved" ? "approved" : review.state === "changes_requested" ? "requested changes on" : "reviewed",
      object: `${repo}#${detail.number} ${detail.title}`,
      refs: [{ kind: "pr", ref: `${repo}#${detail.number}` }],
      at,
      meta: [
        ["review", review.state],
        ...(review.submittedAt === null ? [["dated by", "pr last update"] as [string, string]] : []),
        ["pr", `${repo}#${detail.number}`],
      ],
      body: review.body,
    });
  }
  for (const comment of detail.conversationComments) {
    const at = parseAt(comment.createdAt);
    if (at === null) continue;
    rows.push({
      id: `github:comment:${comment.id}`,
      source: "github",
      kind: "issue_comment",
      actor: comment.author,
      verb: "commented on",
      object: `${repo}#${detail.number} ${detail.title}`,
      refs: [{ kind: "pr", ref: `${repo}#${detail.number}` }],
      at,
      meta: [
        ["pr", `${repo}#${detail.number}`],
        ["comment", comment.id],
      ],
      body: comment.body,
    });
  }
  return rows;
}
