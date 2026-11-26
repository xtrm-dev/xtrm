import { describe, expect, it } from "vitest";
import { pushRow, pushRows } from "./push.ts";
import type { RepoEvent } from "../adapters/types.ts";

const push = (over: Partial<RepoEvent> = {}): RepoEvent => ({
  id: "evt-1",
  kind: "push",
  rawType: "PushEvent",
  repo: "o/r",
  branch: "main",
  actor: "w2w9",
  action: null,
  title: "fix(activity): show pushes",
  body: null,
  url: "https://github.com/o/r/commit/abc1234",
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  commitCount: 1,
  createdAt: "2026-11-26T10:00:00Z",
  ...over,
});

describe("push activity rows (XTRM-757 revision)", () => {
  it("maps a push to a github-sourced row with a stable id and no commit duplication", () => {
    const row = pushRow(push())!;
    expect(row.id).toBe("github:push:evt-1");
    expect(row.source).toBe("github");
    expect(row.kind).toBe("push");
    expect(row.verb).toBe("pushed");
    expect(row.object).toBe("fix(activity): show pushes");
    expect(row.refs).toEqual([{ kind: "branch", ref: "main" }]);
    expect(row.meta).toEqual([
      ["commits", "1"],
      ["files", "2"],
      ["changes", "+12 −3"],
      ["commit", "https://github.com/o/r/commit/abc1234"],
    ]);
  });

  it("reads a multi-commit push as one push naming the branch, never as a commit", () => {
    const row = pushRow(push({ commitCount: 3, title: "third commit subject" }))!;
    expect(row.verb).toBe("pushed 3 commits to");
    expect(row.object).toBe("main");
    // The branch is in the sentence; a second branch chip would repeat it.
    expect(row.refs).toEqual([]);
    expect(row.meta).toContainEqual(["commits", "3"]);
  });

  it("names only the count when a multi-commit push has no branch", () => {
    const row = pushRow(push({ commitCount: 2, branch: null, title: "subject" }))!;
    expect(row.verb).toBe("pushed 2 commits");
    expect(row.object).toBe("a branch");
  });

  it("never invents a time or a subject", () => {
    expect(pushRow(push({ createdAt: "not a date" }))).toBeNull();
    const bare = pushRow(push({ title: null, branch: null, url: null, additions: null, deletions: null, changedFiles: null, commitCount: null }))!;
    expect(bare.object).toBe("a push");
    expect(bare.refs).toEqual([]);
    expect(bare.meta).toEqual([]);
  });

  it("keeps only push events and skips the rest", () => {
    const rows = pushRows([push({ id: "a" }), push({ id: "b", kind: "create", rawType: "CreateEvent" }), push({ id: "c", createdAt: "nope" })]);
    expect(rows.map((r) => r.id)).toEqual(["github:push:a"]);
  });
});
