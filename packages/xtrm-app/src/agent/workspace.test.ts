import { describe, expect, it } from "vitest";
import { activeMention, parseRefTokens } from "./workspace.tsx";

describe("composer reference tokens", () => {
  it("parses every kind and strips trailing punctuation", () => {
    expect(parseRefTokens("see @issue:XTRM-310, @pr:xtrm-dev/xtrm#212. and @gh-issue:xtrm-dev/xtrm#41)")).toEqual([
      { kind: "issue", ref: "XTRM-310" },
      { kind: "pr", ref: "xtrm-dev/xtrm#212" },
      { kind: "gh-issue", ref: "xtrm-dev/xtrm#41" },
    ]);
    expect(parseRefTokens("@file:src/a.ts @commit:c874ca2 @session:pi-main")).toHaveLength(3);
  });

  it("ignores e-mail addresses and unknown kinds", () => {
    expect(parseRefTokens("mail dawid@example.com about @branch:main")).toEqual([]);
  });

  it("finds the mention at the caret, with an optional kind prefix", () => {
    expect(activeMention("fix @xt", 7)).toEqual({ start: 4, query: "xt", kind: null });
    expect(activeMention("fix @pr:21", 10)).toEqual({ start: 4, query: "21", kind: "pr" });
    expect(activeMention("a@b", 3)).toBeNull();
    expect(activeMention("done @x now", 11)).toBeNull();
  });
});
