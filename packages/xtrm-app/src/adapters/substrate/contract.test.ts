import { describe, expect, it } from "vitest";
import { listItems, parseContract, patchContract, planNormalization } from "./contract.ts";

const imported = parseContract({
  problem: [
    "Imported from Beads.",
    "",
    "## PROBLEM",
    "Console cannot address repositories.",
    "",
    "## ROOT CAUSE",
    "No router.",
    "",
    "## SCOPE (NEW FILES ONLY — greenfield)",
    "- add router",
    "- add URL contract",
    "  with search params",
    "",
    "## NON_GOALS",
    "- rewrite backend",
    "",
    "## VALIDATION (must pass before handoff)",
    "1. deep link restores drawer",
    "2. tests pass",
    "",
    "## OUTPUT",
    "PR with screenshots",
    "",
    "```md",
    "## SCOPE inside a fence is not a section",
    "```",
  ].join("\n"),
  success: "TBD — imported from Beads; pending XTRM planning",
  scope: [],
  nonGoals: [],
  constraints: [],
  validation: [{ check: "TBD — imported from Beads; pending XTRM planning" }],
  output: [{ artifact: "TBD — imported from Beads; pending XTRM planning" }],
  scrutiny: "LOW",
});

describe("contract normalization", () => {
  it("maps embedded sections into typed fields and keeps unknown sections in problem", () => {
    const plan = planNormalization(imported)!;
    expect(plan.patch.scope).toEqual(["add router", "add URL contract\nwith search params"]);
    expect(plan.patch.nonGoals).toEqual(["rewrite backend"]);
    expect(plan.patch.validation).toEqual(["deep link restores drawer", "tests pass"]);
    expect(plan.patch.output).toEqual(["PR with screenshots\n```md\n## SCOPE inside a fence is not a section\n```"]);
    expect(plan.patch.problem).toContain("Console cannot address repositories.");
    expect(plan.patch.problem).toContain("## ROOT CAUSE");
    expect(plan.patch.problem).not.toContain("## NON_GOALS");
    expect(plan.mapped.map((m) => m.field)).toEqual(["scope", "nonGoals", "validation", "output"]);
  });

  it("never overwrites a typed field that already has real content", () => {
    const plan = planNormalization({ ...imported, scope: ["existing scope"] })!;
    expect(plan.patch.scope).toBeUndefined();
    expect(plan.patch.problem).toContain("## SCOPE");
  });

  it("returns null for contracts without embedded sections", () => {
    expect(planNormalization(parseContract({ problem: "plain problem", success: "s" }))).toBeNull();
  });

  it("writes the plan losslessly: unknown keys survive", () => {
    const plan = planNormalization(imported)!;
    const next = patchContract(imported, plan.patch);
    expect(next.scrutiny).toBe("LOW");
    expect(next.validation).toEqual([{ check: "deep link restores drawer" }, { check: "tests pass" }]);
    expect(next.constraints).toEqual([]);
  });
});

describe("contract patching", () => {
  const c = parseContract({ problem: "p", success: "s", scope: ["a"], nonGoals: [], constraints: [], validation: [{ check: "c1", severity: "high" }], output: [], extra: 1 });

  it("keeps untouched entry objects identical, including extra keys", () => {
    const next = patchContract(c, { validation: ["c1", "c2"] });
    expect(next.validation).toEqual([{ check: "c1", severity: "high" }, { check: "c2" }]);
    expect(next.extra).toBe(1);
    expect(next.problem).toBe("p");
  });

  it("drops blank list items", () => {
    expect(patchContract(c, { scope: ["a", " ", "b"] }).scope).toEqual(["a", "b"]);
  });

  it("splits list bodies", () => {
    expect(listItems("- one\n- two")).toEqual(["one", "two"]);
    expect(listItems("single paragraph\nsecond line")).toEqual(["single paragraph\nsecond line"]);
  });
});
