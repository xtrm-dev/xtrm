import { describe, expect, it } from "vitest";
import { commitRow, commitRows } from "./git.ts";

describe("git activity rows (XTRM-757)", () => {
  it("identifies a commit by sha and shows the short sha plus its branches", () => {
    const row = commitRow({ sha: "abcdef1234567890", author: "w2w9", subject: "fix: x", at: 5, refs: ["main"] });
    expect(row.id).toBe("git:abcdef1234567890");
    expect(row.refs).toEqual([
      { kind: "commit", ref: "abcdef1" },
      { kind: "branch", ref: "main" },
    ]);
    expect(row.meta).toContainEqual(["commit", "abcdef1234567890"]);
  });

  it("maps a page and keeps every commit", () => {
    const rows = commitRows([
      { sha: "a".repeat(40), author: "a", subject: "s1", at: 1 },
      { sha: "b".repeat(40), author: "b", subject: "s2", at: 2 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "git")).toBe(true);
  });
});
