import { describe, expect, it } from "vitest";
import { activityCounts, filterActivity, mergeActivity, sortActivity } from "./merge.ts";
import type { ActivityRow, ActivitySourceState } from "./types.ts";

const row = (id: string, source: ActivityRow["source"], at: number): ActivityRow => ({
  id,
  source,
  kind: "note",
  actor: null,
  verb: "noted",
  object: id,
  refs: [],
  at,
  meta: [],
  body: null,
});

const state = (source: ActivitySourceState["source"], rows: ActivityRow[], error: string | null = null): ActivitySourceState => ({
  source,
  rows,
  cursor: null,
  error,
  pending: false,
});

describe("activity merge (XTRM-757)", () => {
  it("orders newest first and breaks a timestamp tie by id, deterministically", () => {
    const rows = [row("b", "git", 1000), row("a", "git", 1000), row("c", "github", 2000)];
    expect(sortActivity(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortActivity([...rows].reverse()).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("merges sources without duplicating a row the same source reports twice", () => {
    const merged = mergeActivity([[row("x", "substrate", 10)], [row("x", "substrate", 10), row("y", "git", 20)]]);
    expect(merged.map((r) => r.id)).toEqual(["y", "x"]);
  });

  it("filters by source, and null means everything", () => {
    const rows = [row("a", "git", 1), row("b", "github", 2)];
    expect(filterActivity(rows, "git").map((r) => r.id)).toEqual(["a"]);
    expect(filterActivity(rows, null)).toHaveLength(2);
  });

  it("counts per source, and a FAILED source is excluded rather than counted as zero activity", () => {
    const counts = activityCounts([
      state("substrate", [row("s1", "substrate", 1), row("s2", "substrate", 2)]),
      // The failed source carries rows on purpose: if `activityCounts` counted
      // them, `github` would read 1 and `all` would read 4. Counting an empty
      // failed source would make this assertion true either way.
      state("github", [row("h1", "github", 9)], "github unreachable"),
      state("git", [row("g1", "git", 3)]),
    ]);
    expect(counts.bySource.substrate).toBe(2);
    expect(counts.bySource.git).toBe(1);
    expect(counts.bySource.github).toBe(0);
    expect(counts.all).toBe(3);
  });

  it("reports an empty source as zero, not as an error", () => {
    const counts = activityCounts([state("substrate", []), state("github", []), state("git", [])]);
    expect(counts).toEqual({ all: 0, bySource: { substrate: 0, github: 0, git: 0, jira: 0 } });
  });
});
