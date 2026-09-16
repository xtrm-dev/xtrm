import { describe, expect, it } from "vitest";
import { SubstrateReadError, mapIssueDetail, mapIssues, mapProjects, unwrap } from "./live.ts";

const wire = (id: string, extra: object = {}) => ({ id, humanRef: id.toUpperCase(), title: id, kind: "task", lifecycleState: "open", revision: 1, ...extra });

describe("substrate envelope mapping", () => {
  it("rejects failed or foreign envelopes", () => {
    expect(() => unwrap({ schema: "substrate-cli/v1", command: "issue.list", ok: false, error: "boom" })).toThrow("boom");
    expect(() => unwrap({ schema: "other/v9", command: "x", ok: true, data: [] })).toThrow(SubstrateReadError);
  });

  it("marks only dispatchable issues ready and leaves the rest unknown (no N+1)", () => {
    const issues = mapIssues([wire("a"), wire("b")], [wire("b", { readinessState: "ready", dispatchable: true })]);
    expect(issues.map((i) => [i.ref, i.readiness])).toEqual([["A", "unknown"], ["B", "ready"]]);
  });

  it("joins project links", () => {
    const [p] = mapProjects([{ id: "prj_xtrm", prefix: "XTRM", name: "xtrm" }], { links: [{ gitRoot: "/r/xtrm", projectId: "prj_xtrm" }, { gitRoot: "/r/core", projectId: "prj_core" }] });
    expect(p?.gitRoots).toEqual(["/r/xtrm"]);
  });

  it("flattens contract checks and artifacts", () => {
    const d = mapIssueDetail({
      ...wire("x"),
      readinessState: "draft",
      dispatchable: false,
      reasons: ["scope: empty"],
      contract: { problem: "p", validation: [{ check: "c1" }, {}], output: [{ artifact: "a1" }] },
    });
    expect(d.contract.validation).toEqual(["c1"]);
    expect(d.contract.output).toEqual(["a1"]);
    expect(d.readiness).toBe("not_ready");
    expect(d.claim).toBeNull();
  });
});
