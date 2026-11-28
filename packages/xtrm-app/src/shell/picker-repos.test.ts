import { describe, expect, it } from "vitest";
import { RECENT_REPOS, pickerRepos } from "./ContextSidebar.tsx";

const repos = Array.from({ length: 20 }, (_, i) => ({ fullName: `o/r${String(i).padStart(2, "0")}` }));
// r19 is the most recently active, r00 the least.
const stats = repos.map((r, i) => ({ fullName: r.fullName, lastEventAt: `2026-11-${String(i + 1).padStart(2, "0")}` }));

describe("repository picker rows (XTRM-1136)", () => {
  it("lists only the most recently active repositories when unfiltered", () => {
    const rows = pickerRepos(repos, stats, "", "o/r19");
    expect(rows).toHaveLength(RECENT_REPOS);
    expect(rows[0]!.fullName).toBe("o/r19");
  });

  it("keeps the current repository in the list when it is not among the most recent", () => {
    const rows = pickerRepos(repos, stats, "", "o/r00");
    expect(rows).toHaveLength(RECENT_REPOS + 1);
    expect(rows.at(-1)!.fullName).toBe("o/r00");
  });

  it("searches every repository once a filter is typed", () => {
    expect(pickerRepos(repos, stats, "o/", "o/r19")).toHaveLength(20);
    expect(pickerRepos(repos, stats, "r0", "o/r19").map((r) => r.fullName)).toContain("o/r00");
  });
});
