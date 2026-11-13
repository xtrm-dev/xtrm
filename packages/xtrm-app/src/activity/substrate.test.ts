import { describe, expect, it } from "vitest";
import { journalFeedRows, journalRow, journalVerb, statusRow } from "./substrate.ts";
// The closed set the bridge enforces (substrate packages/substrate/src/domain/journal.ts).
// Copied rather than imported: the console does not depend on the substrate
// source tree, and an unknown kind still renders neutrally (next case).
const JOURNAL_KINDS = ["note", "finding", "decision", "blocker", "milestone", "handoff", "result", "checkpoint", "compaction", "cancel"] as const;

const wire = (kind: string, extra: Record<string, unknown> = {}) => ({
  id: `jrn_${kind}`,
  issueRef: "XTRM-1",
  issueId: "iss_1",
  sequence: 3,
  kind,
  issueRevision: 2,
  createdAt: 1_700_000_000_000,
  participantId: "w2w9",
  semantic: { summary: `a ${kind} happened` },
  ...extra,
});

describe("substrate activity rows (XTRM-757)", () => {
  it("maps every journal kind the domain defines, and never drops one", () => {
    const rows = journalFeedRows({ projectId: "prj", nextCursor: null, entries: JOURNAL_KINDS.map((k) => wire(k)) });
    expect(rows).toHaveLength(JOURNAL_KINDS.length);
    expect(rows.map((r) => r.kind)).toEqual(JOURNAL_KINDS.map((k) => `journal.${k}`));
    for (const row of rows) expect(row.object).toContain("XTRM-1");
  });

  it("renders an unknown kind as a neutral row instead of dropping it", () => {
    const row = journalRow(wire("something_new") as never);
    expect(row.kind).toBe("journal.something_new");
    expect(row.verb).toBe("recorded");
    expect(journalVerb("note")).toBe("noted");
  });

  it("carries the issue ref, the summary and the expansion meta", () => {
    const row = journalRow(wire("finding") as never);
    expect(row.source).toBe("substrate");
    expect(row.actor).toBe("w2w9");
    expect(row.refs).toEqual([{ kind: "issue", ref: "XTRM-1" }]);
    expect(row.object).toContain("a finding happened");
    expect(row.meta).toContainEqual(["entry", "jrn_finding"]);
    expect(row.meta).toContainEqual(["rev", "2"]);
  });

  it("states the recorded issue state without claiming a transition", () => {
    const row = statusRow({ ref: "XTRM-9", title: "t", lifecycle: "done", updatedAt: 5 });
    expect(row.kind).toBe("issue.status");
    expect(row.verb).toBe("is");
    expect(row.object).toContain("done");
    expect(row.at).toBe(5);
  });
});

describe("fixture feed (XTRM-757)", () => {
  it("renders every journal kind of a fixture page without dropping one", async () => {
    const { journalFeedRows } = await import("./substrate.ts");
    const kinds = JOURNAL_KINDS;
    const rows = journalFeedRows({
      projectId: "prj",
      nextCursor: null,
      entries: kinds.map((kind, i) => ({
        id: `jrn_${i}`,
        issueRef: `XTRM-${i + 1}`,
        issueId: `iss_${i}`,
        sequence: i + 1,
        kind,
        issueRevision: 1,
        createdAt: 1_700_000_000_000 + i,
      })),
    });
    // one row per kind, each with a verb and an object: nothing dropped, nothing blank
    expect(rows).toHaveLength(kinds.length);
    for (const row of rows) {
      expect(row.verb.length).toBeGreaterThan(0);
      expect(row.object.length).toBeGreaterThan(0);
      expect(row.refs).toHaveLength(1);
    }
  });
});
