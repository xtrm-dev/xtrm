import { describe, expect, it } from "vitest";
import { SubstrateReadError, mapBoard, mapIssueDetail, mapProjects, unwrap, type WireExport, type WireIssue } from "./live.ts";

const wire = (id: string, extra: Partial<WireIssue> = {}): WireIssue => ({ id, humanRef: id.toUpperCase(), title: id, kind: "task", lifecycleState: "open", revision: 1, ...extra });
const meta = (id: string, priority: number) => ({ issue: { id, kind: "task", title: id, lifecycleState: "open", priority, scrutiny: "LOW", currentRevision: 1, createdAt: 1, updatedAt: 2 } });

describe("substrate envelope mapping", () => {
  it("rejects failed or foreign envelopes", () => {
    expect(() => unwrap({ schema: "substrate-cli/v1", command: "issue.list", ok: false, error: "boom" })).toThrow("boom");
    expect(() => unwrap({ schema: "other/v9", command: "x", ok: true, data: [] })).toThrow(SubstrateReadError);
  });

  it("joins project links", () => {
    const [p] = mapProjects([{ id: "prj_xtrm", prefix: "XTRM", name: "xtrm" }], { links: [{ gitRoot: "/r/xtrm", projectId: "prj_xtrm" }, { gitRoot: "/r/core", projectId: "prj_core" }] });
    expect(p?.gitRoots).toEqual(["/r/xtrm"]);
  });

  it("builds Jira rows from list + export + ready without per-issue reads", () => {
    const list = [wire("epic"), wire("a"), wire("b", { lifecycleState: "done" }), wire("c")];
    const exported: WireExport = {
      issues: [meta("epic", 1), meta("a", 0), meta("b", 2), meta("c", 3)],
      edges: [
        { fromIssue: "epic", toIssue: "a", kind: "parent_child", active: true },
        { fromIssue: "epic", toIssue: "b", kind: "parent_child", active: true },
        { fromIssue: "a", toIssue: "c", kind: "blocks", active: true },
        { fromIssue: "b", toIssue: "c", kind: "blocks", active: true },
        { fromIssue: "epic", toIssue: "c", kind: "blocks", active: false },
      ],
    };
    const rows = mapBoard(list, exported, [wire("a", { dispatchable: true })]);
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
    expect(byRef.EPIC).toMatchObject({ childCount: 2, childrenDone: 1, priority: 1 });
    expect(byRef.A).toMatchObject({ parentRef: "EPIC", readiness: "ready", priority: 0 });
    // b is done, so only a still blocks c; inactive edges are ignored
    expect(byRef.C?.blockedBy).toEqual(["A"]);
  });

  it("degrades to list-only rows when export is unavailable", () => {
    const [row] = mapBoard([wire("a")], null, []);
    expect(row).toMatchObject({ priority: null, childCount: 0, readiness: "unknown" });
  });

  it("maps detail with lineage, journal order, and lossless contract", () => {
    const board = mapBoard([wire("epic"), wire("a")], { issues: [meta("epic", 1), meta("a", 2)], edges: [{ fromIssue: "epic", toIssue: "a", kind: "parent_child", active: true }] }, []);
    const d = mapIssueDetail(
      { ...wire("a"), readinessState: "draft", dispatchable: false, reasons: ["scope: empty"], contract: { problem: "p", success: "s", scope: [], nonGoals: [], constraints: [], validation: [{ check: "c1", extra: true }], output: [], scrutiny: "LOW" } },
      {
        projectId: "prj_x",
        board,
        resume: null,
        trace: { commits: [{ sha: "abc123" }], prs: ["#206"] },
        journal: [
          { id: "j1", sequence: 1, kind: "note", issueRevision: 1, createdAt: 1, semantic: { summary: "first" } },
          { id: "j2", sequence: 2, kind: "decision", issueRevision: 1, createdAt: 2, semantic: { summary: "second" } },
        ],
      },
    );
    expect(d.parent?.ref).toBe("EPIC");
    expect(d.priority).toBe(2);
    expect(d.journal.map((j) => j.summary)).toEqual(["second", "first"]);
    expect(d.contract.validation).toEqual([{ text: "c1", raw: { check: "c1", extra: true } }]);
    expect(d.contract.raw.scrutiny).toBe("LOW");
    expect(d.provenance).toMatchObject({ commits: ["abc123"], prs: ["#206"] });
  });
});
