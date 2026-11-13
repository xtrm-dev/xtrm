import { describe, expect, it } from "vitest";
import { githubIssueRow, pullConversationRows, pullRow } from "./github.ts";
import type { GithubIssueSummary, PullRequestDetail, PullRequestSummary } from "../adapters/types.ts";

const pr = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 7,
  title: "fix: a thing",
  author: "w2w9",
  headBranch: "fix/x",
  baseBranch: "main",
  state: "open",
  draft: false,
  checks: "passing",
  review: "approved",
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  comments: 0,
  updatedAt: "2026-11-12T10:00:00Z",
  createdAt: "2026-11-11T10:00:00Z",
  url: "https://github.com/o/r/pull/7",
  body: null,
  ...over,
});

describe("github activity rows (XTRM-757)", () => {
  it("dates an open PR by its creation and a merged one by its last update, saying which", () => {
    expect(pullRow(pr(), "o/r")!.at).toBe(Date.parse("2026-11-11T10:00:00Z"));
    const merged = pullRow(pr({ state: "merged" }), "o/r")!;
    expect(merged.kind).toBe("pr.merged");
    expect(merged.meta).toContainEqual(["dated by", "last update"]);
  });

  it("never invents a time: an unreadable date yields no row", () => {
    expect(pullRow(pr({ createdAt: "not a date" }), "o/r")).toBeNull();
    expect(githubIssueRow({ ...issue(), createdAt: "nope", closedAt: null }, "o/r")).toBeNull();
  });

  it("gives a GitHub issue its own reference kind, not the PR kind", () => {
    const row = githubIssueRow(issue(), "o/r")!;
    expect(row.refs).toEqual([{ kind: "gh-issue", ref: "o/r#9" }]);
    expect(row.kind).toBe("issue.closed");
  });

  it("maps reviews and comments, and skips an entry with no usable time", () => {
    const detail = {
      ...pr(),
      mergeable: null,
      mergeableState: null,
      commits: 1,
      files: [],
      reviews: [
        { id: "r1", author: "rev", state: "approved", submittedAt: "2026-11-12T11:00:00Z", body: "ok", url: null },
        { id: "r2", author: "rev", state: "commented", submittedAt: null, body: null, url: null },
      ],
      conversationComments: [{ id: "c1", author: "w2w9", body: "hi", url: null, createdAt: "2026-11-12T12:00:00Z", updatedAt: null }],
      reviewComments: [],
    } as unknown as PullRequestDetail;
    const rows = pullConversationRows(detail, "o/r");
    expect(rows.map((r) => r.kind)).toEqual(["review.approved", "review.commented", "issue_comment"]);
    // The review with no submittedAt falls back to the PR update time, never "now".
    expect(rows[1]!.at).toBe(Date.parse(detail.updatedAt));
  });
});

function issue(over: Partial<GithubIssueSummary> = {}): GithubIssueSummary {
  return {
    number: 9,
    title: "an issue",
    body: null,
    state: "closed",
    author: "w2w9",
    labels: [],
    comments: 0,
    url: "https://github.com/o/r/issues/9",
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-11T10:00:00Z",
    closedAt: "2026-11-11T10:00:00Z",
    ...over,
  };
}
