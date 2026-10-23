// Hierarchy is visible by default: human messages lead with the locator and
// keep the durable ref in parentheses; commands keep the durable ref.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { displayRef } from "../src/domain/issue.ts";
import { evaluateIssue, type IssueSnapshot } from "../src/presentation/advisories.ts";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract } from "./helpers.ts";

describe("locator display and resolution", () => {
  it("displayRef: locator first, one value for a root issue", () => {
    assert.equal(displayRef("XTRM-668.9", "XTRM-677"), "XTRM-668.9 (XTRM-677)");
    assert.equal(displayRef("XTRM-678", "XTRM-678"), "XTRM-678");
    assert.equal(displayRef(undefined, "XTRM-678"), "XTRM-678");
  });

  it("advisory messages carry the label, commands keep the durable ref", () => {
    const snap: IssueSnapshot = {
      ref: "XTRM-677",
      label: "XTRM-668.9 (XTRM-677)",
      lifecycleState: "open",
      readinessState: "ready",
      claim: { holder: "a", activationId: null, acquiredAt: 0, expiresAt: 4 * 60_000 },
      journalSeq: 0,
      lastCheckpointSeq: 0,
      latestKind: null,
      handoffsSinceClaim: 0,
      now: 0,
    };
    const renew = evaluateIssue(snap, { holder: "a", source: "env" }).find((a) => a.code === "claim_renew")!;
    assert.match(renew.message, /^XTRM-668\.9 \(XTRM-677\): claim expires/);
    assert.match(renew.instruction, /sb issue renew XTRM-677 /);
    assert.doesNotMatch(renew.instruction, /\(/);
  });

  it("resolveRef accepts a locator in any case, including a historical one", () => {
    const db = openSubstrate(":memory:");
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_lc", prefix: "LC", name: "lc" });
      const parent = svc.createIssue({ projectId: "prj_lc", title: "parent", kind: "epic", contract: contract(), scrutiny: "LOW", authoredBy: "t" });
      const child = svc.createIssue({ projectId: "prj_lc", title: "child", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "t", parentId: parent.id });
      const locator = svc.currentLocator(child.id);
      assert.match(locator, /^LC-\d+\.1$/);
      assert.equal(svc.resolveRef(locator.toLowerCase()).id, child.id);
      assert.equal(svc.resolveRef(locator).id, child.id);
      assert.equal(svc.resolveRef(child.humanRef.toLowerCase()).id, child.id);
    } finally {
      db.close();
    }
  });
});
