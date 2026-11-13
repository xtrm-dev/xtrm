// GitHub source (XTRM-757): pull requests, issues, reviews and comments only.
// The operator ruling excluded PushEvent, so a commit is never seen twice: the
// git source owns commits.

import type { GithubIssueSummary, PullRequestDetail, PullRequestSummary } from "../adapters/types.ts";
import type { ActivityRow } from "./types.ts";

const PR_VERB = { open: "opened", merged: "merged", closed: "closed" } as const;

export function pullRow(pr: PullRequestSummary, repo: string): ActivityRow {
  const verb = pr.state === "open" ? (pr.draft ? "opened a draft" : "opened") : PR_VERB[pr.state];
  const at = Date.parse(pr.state === "open" ? pr.createdAt : pr.updatedAt);
  return {
    id: `github:${repo}#${pr.number}`,
    source: "github",
    kind: pr.state === "open" ? "pr.opened" : `pr.${pr.state}`,
    actor: pr.author,
    verb,
    object: `${repo}#${pr.number} ${pr.title}`,
    refs: [{ kind: "pr", ref: `${repo}#${pr.number}` }],
    at: Number.isNaN(at) ? Date.now() : at,
    meta: [
      ["state", pr.state],
      ["branch", `${pr.headBranch} → ${pr.baseBranch}`],
      ["review", pr.review],
      ["checks", pr.checks],
    ],
    body: pr.body,
  };
}

export function githubIssueRow(issue: GithubIssueSummary, repo: string): ActivityRow {
  const at = Date.parse(issue.closedAt ?? issue.createdAt);
  return {
    id: `github:issue:${repo}#${issue.number}`,
    source: "github",
    kind: issue.closedAt === null ? "issue.opened" : "issue.closed",
    actor: issue.author,
    verb: issue.closedAt === null ? "opened" : "closed",
    object: `${repo}#${issue.number} ${issue.title}`,
    refs: [{ kind: "pr", ref: `${repo}#${issue.number}` }],
    at: Number.isNaN(at) ? Date.now() : at,
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
    const at = Date.parse(review.submittedAt ?? detail.updatedAt);
    rows.push({
      id: `github:review:${review.id}`,
      source: "github",
      kind: `review.${review.state}`,
      actor: review.author,
      verb: review.state === "approved" ? "approved" : review.state === "changes_requested" ? "requested changes on" : "reviewed",
      object: `${repo}#${detail.number} ${detail.title}`,
      refs: [{ kind: "pr", ref: `${repo}#${detail.number}` }],
      at: Number.isNaN(at) ? Date.now() : at,
      meta: [
        ["review", review.state],
        ["pr", `${repo}#${detail.number}`],
      ],
      body: review.body,
    });
  }
  for (const comment of detail.conversationComments) {
    const at = Date.parse(comment.createdAt);
    rows.push({
      id: `github:comment:${comment.id}`,
      source: "github",
      kind: "issue_comment",
      actor: comment.author,
      verb: "commented on",
      object: `${repo}#${detail.number} ${detail.title}`,
      refs: [{ kind: "pr", ref: `${repo}#${detail.number}` }],
      at: Number.isNaN(at) ? Date.now() : at,
      meta: [
        ["pr", `${repo}#${detail.number}`],
        ["comment", comment.id],
      ],
      body: comment.body,
    });
  }
  return rows;
}
