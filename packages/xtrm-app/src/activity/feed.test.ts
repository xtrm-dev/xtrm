// The loaders: each one turns a source into a page, and a failure into its own
// error state rather than a partial array.

import { describe, expect, it } from "vitest";
import { loadGit, loadGithub, loadSubstrate, loadSourceState } from "./feed.ts";
import type { GithubAdapter, GitActivityAdapter, PullRequestDetail, SubstrateAdapter } from "../adapters/types.ts";

const gitAdapter = (commits: Array<{ sha: string; author: string; subject: string; at: number }>): GitActivityAdapter => ({
  source: "fixture",
  commits: async () => commits,
});

const ctx = (over: Partial<Parameters<typeof loadGit>[0]> = {}) =>
  ({
    repo: "o/r",
    projectId: "prj_x",
    github: {} as GithubAdapter,
    substrate: {} as SubstrateAdapter,
    gitActivity: gitAdapter([{ sha: "c".repeat(40), author: "w", subject: "s", at: 1 }]),
    ...over,
  }) as Parameters<typeof loadGit>[0];

describe("activity loaders (XTRM-757)", () => {
  it("maps the git log through the adapter", async () => {
    const page = await loadGit(ctx());
    expect(page.source).toBe("git");
    expect(page.rows).toHaveLength(1);
  });

  it("reports a failing source as its own error instead of empty rows", async () => {
    const failing: GitActivityAdapter = { source: "fixture", commits: async () => { throw new Error("git unavailable"); } };
    const state = await loadSourceState("git", ctx({ gitActivity: failing }));
    expect(state.error).toBe("git unavailable");
    expect(state.rows).toEqual([]);
    expect(state.source).toBe("git");
  });

  it("refuses the substrate source when no project is mapped, with a readable reason", async () => {
    const page = await loadSubstrate(ctx({ projectId: null }));
    expect(page.rows).toEqual([]);
    expect(page.error).toMatch(/no Substrate project/);
  });

  it("returns one row per github object and skips a row with no readable date", async () => {
    const github = {
      listPulls: async () => [
        { number: 1, title: "t", author: "a", headBranch: "h", baseBranch: "main", state: "open", draft: false, checks: "none", review: "none", reviewCount: 0, additions: 0, deletions: 0, changedFiles: 0, comments: 0, updatedAt: "2026-11-12T00:00:00Z", createdAt: "2026-11-11T00:00:00Z", url: "u", body: null },
        { number: 2, title: "bad", author: "a", headBranch: "h", baseBranch: "main", state: "open", draft: false, checks: "none", review: "none", reviewCount: 0, additions: 0, deletions: 0, changedFiles: 0, comments: 0, updatedAt: "2026-11-12T00:00:00Z", createdAt: "not-a-date", url: "u", body: null },
      ],
      listIssues: async () => [],
      getPull: async () => ({ reviews: [], conversationComments: [] }) as unknown as PullRequestDetail,
    } as unknown as GithubAdapter;
    const page = await loadGithub(ctx({ github }));
    expect(page.rows.map((r) => r.id)).toEqual(["github:o/r#1"]);
  });
});
