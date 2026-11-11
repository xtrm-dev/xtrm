import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract, tempDir } from "./helpers.ts";

// G47: export/import preserves revisions + graph equivalence.
describe("export/import graph equivalence (G47)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("round-trips issues, revisions, edges, aliases, locator history", () => {
    const dirA = tempDir("sub-a-");
    const dirB = tempDir("sub-b-");
    dirs.push(dirA, dirB);
    const dbA = openSubstrate(join(dirA, "s.db"));
    const a = new IssueService(dbA);
    a.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });

    const epic = a.createIssue({ projectId: "prj_xtrm", title: "epic", kind: "epic", contract: contract() });
    const kid = a.createIssue({
      projectId: "prj_xtrm",
      title: "kid",
      kind: "task",
      contract: contract(),
      parentId: epic.id,
      aliases: [{ alias: "xtrm-q99", kind: "beads" }],
    });
    a.updateContract(kid.id, contract({ problem: "P2" }), "op");
    const other = a.createIssue({ projectId: "prj_xtrm", title: "other", kind: "task", contract: contract() });
    a.addEdge(other.id, kid.id, "blocks");
    const moved = a.setParent(kid.id, other.id);
    const snapshot = a.exportProject("prj_xtrm");
    const expectedHashes = a.listRevisions(kid.id).map((r) => r.contractHash);
    const expectedEdges = a.listActiveEdges().map((e) => [e.fromIssue, e.toIssue, e.kind, e.active]);
    const expectedHumanRef = a.getIssue(kid.id).humanRef;
    dbA.close();

    const dbB = openSubstrate(join(dirB, "s.db"));
    try {
      const b = new IssueService(dbB);
      b.importProject(snapshot as Record<string, unknown>);

      assert.equal(b.listRevisions(kid.id).length, 2);
      assert.deepEqual(
        b.listRevisions(kid.id).map((r) => r.contractHash),
        expectedHashes,
      );
      assert.equal(b.getIssue(kid.id).locator, moved.locator);
      assert.equal(b.getIssue(kid.id).humanRef, expectedHumanRef);
      assert.equal(b.resolveRef("xtrm-q99").id, kid.id);
      assert.deepEqual(
        b.listActiveEdges().map((e) => [e.fromIssue, e.toIssue, e.kind, e.active]),
        expectedEdges,
      );
      // Counters resume past imported values: no number or slot reuse.
      const fresh = b.createIssue({ projectId: "prj_xtrm", title: "fresh", kind: "task", contract: contract() });
      assert.ok(![epic.humanRef, other.humanRef].includes(fresh.humanRef));
      const sib = b.createIssue({ projectId: "prj_xtrm", title: "sib", kind: "task", contract: contract(), parentId: other.id });
      assert.notEqual(sib.locator, moved.locator);
    } finally {
      dbB.close();
    }
  });
});
