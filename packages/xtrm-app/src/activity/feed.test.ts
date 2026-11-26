// The loaders: each one turns a source into a page, and a failure into its own
// error state rather than a partial array.

import { describe, expect, it } from "vitest";
import { loadGithub, loadSourceState, loadSubstrate } from "./feed.ts";
import type { GithubAdapter, PullRequestDetail, RepoEvent, SubstrateAdapter } from "../adapters/types.ts";

const ctx = (over: Partial<Parameters<typeof loadGithub>[0]> = {}) =>
  ({
    repo: "o/r",
    projectId: "prj_x",
    github: { events: async () => [] } as unknown as GithubAdapter,
    substrate: {} as SubstrateAdapter,
    ...over,
  }) as Parameters<typeof loadGithub>[0];

const event = (over: Partial<RepoEvent> = {}): RepoEvent => ({
  id: "evt-1",
  kind: "push",
  rawType: "PushEvent",
  repo: "o/r",
  branch: "main",
  actor: "w",
  action: null,
  title: "fix: pushed",
  body: null,
  url: null,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  commitCount: 1,
  createdAt: "2026-11-12T00:00:00Z",
  ...over,
});

describe("activity loaders (XTRM-757)", () => {
  it("carries GitHub push events into the github page and drops other event kinds", async () => {
    const github = {
      listPulls: async () => [],
      listIssues: async () => [],
      events: async () => [event(), event({ id: "evt-2", kind: "create", rawType: "CreateEvent" })],
    } as unknown as GithubAdapter;
    const page = await loadGithub(ctx({ github }));
    expect(page.source).toBe("github");
    expect(page.rows.map((r) => r.id)).toEqual(["github:push:evt-1"]);
  });

  it("reports a failing source as its own error instead of empty rows", async () => {
    const failing = {
      listPulls: async () => [],
      listIssues: async () => [],
      events: async () => { throw new Error("github unavailable"); },
    } as unknown as GithubAdapter;
    const state = await loadSourceState("github", ctx({ github: failing }));
    expect(state.error).toBe("github unavailable");
    expect(state.rows).toEqual([]);
    expect(state.source).toBe("github");
  });

  it("refuses a source with no loader instead of returning an empty page", async () => {
    // `git` was deleted from the union; the guard stays for any future gap.
    const state = await loadSourceState("git" as unknown as Parameters<typeof loadSourceState>[0], ctx());
    expect(state.error).toMatch(/retired/);
    expect(state.rows).toEqual([]);
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
      events: async () => [],
      getPull: async () => ({ reviews: [], conversationComments: [] }) as unknown as PullRequestDetail,
    } as unknown as GithubAdapter;
    const page = await loadGithub(ctx({ github }));
    expect(page.rows.map((r) => r.id)).toEqual(["github:o/r#1"]);
  });
});
