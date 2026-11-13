import { describe, expect, it } from "vitest";
import { parseGitLog, resolveCheckoutRoot } from "/home/dawid/dev/xtrm/.xtrm/worktrees/xtrm-xt-pi-linksgap/packages/xtrm-app/server/substrate-cli.ts";

describe("git log bridge", () => {
  it("resolves a checkout by remote, and fails closed for an unknown repository", () => {
    const remotes = new Map<string, string | null>([
      ["/a", "git@github.com:xtrm-dev/xtrm.git"],
      ["/b", "https://github.com/xtrm-dev/core"],
      ["/c", null],
    ]);
    expect(resolveCheckoutRoot(["/c", "/a", "/b"], remotes, "xtrm-dev/core")).toBe("/b");
    expect(resolveCheckoutRoot(["/c"], remotes, "xtrm-dev/core")).toBeNull();
  });

  it("parses one record per commit, subject separators intact", () => {
    const stdout = ["abc123\u001fAda\u001f1700000000\u001ffix: a\tb", "", "def456\u001fBob\u001f1700000100\u001fchore: c"].join("\n");
    expect(parseGitLog(stdout)).toEqual([
      { sha: "abc123", author: "Ada", subject: "fix: a\tb", at: 1_700_000_000_000 },
      { sha: "def456", author: "Bob", subject: "chore: c", at: 1_700_000_100_000 },
    ]);
    expect(parseGitLog("garbage\n")).toEqual([]);
  });
});
