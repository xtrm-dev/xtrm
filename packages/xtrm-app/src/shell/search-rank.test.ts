import { describe, expect, it } from "vitest";
import { issueKeyFromQuery, rankSearch } from "./search-rank.ts";

const issue = (ref: string, label: string) => ({ label, keys: [ref] });

describe("rankSearch", () => {
  it("finds a match beyond any cap applied to the source", () => {
    const board = Array.from({ length: 15_000 }, (_, n) => issue(`CORE-${n}`, `core task ${n}`));
    board.push(issue("MMD-3752", "Board helper wed04-board-coord"));
    expect(rankSearch(board, "MMD-3752", 40).map((i) => i.keys[0])).toEqual(["MMD-3752"]);
  });

  it("ranks the exact key above issues that mention it", () => {
    const items = [issue("XTRM-700", "Activation authority (XTRM-690 security pass)"), issue("XTRM-690", "sb serve --stdio")];
    expect(rankSearch(items, "xtrm-690", 10).map((i) => i.keys[0])).toEqual(["XTRM-690", "XTRM-700"]);
  });

  it("ranks a key prefix and a label prefix above a plain match", () => {
    const items = [issue("A-1", "preserve the serve path"), issue("A-2", "serve over ssh"), issue("SERVE-1", "other")];
    expect(rankSearch(items, "serve", 10).map((i) => i.keys[0])).toEqual(["SERVE-1", "A-2", "A-1"]);
  });

  it("requires every token and ignores text outside label and keys", () => {
    const items = [{ label: "console dark palette", keys: ["X-1"], hint: "open" }, { label: "console light", keys: ["X-2"] }];
    expect(rankSearch(items, "console dark", 10)).toHaveLength(1);
    expect(rankSearch(items, "open", 10)).toHaveLength(0);
  });

  it("returns the first items unranked for an empty query", () => {
    expect(rankSearch([issue("A-1", "a"), issue("A-2", "b")], "  ", 1)).toHaveLength(1);
  });
});

describe("issueKeyFromQuery", () => {
  it("accepts keys from any project, case-insensitive, with child segments", () => {
    expect(issueKeyFromQuery(" mmd-3752 ")).toBe("MMD-3752");
    expect(issueKeyFromQuery("XTRM-424.5.1")).toBe("XTRM-424.5.1");
  });

  it("rejects free text", () => {
    expect(issueKeyFromQuery("serve")).toBeNull();
    expect(issueKeyFromQuery("MMD 3752")).toBeNull();
  });
});
