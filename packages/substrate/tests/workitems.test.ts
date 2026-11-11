import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { SubstrateIssueStore } from "../src/workitems/substrate-store.ts";
import { BeadsWorkItemStore } from "../src/workitems/beads-store.ts";
import { checkDispatch, dispatchToSpecialist, scopeExpansion } from "../src/workitems/dispatch-gate.ts";
import type { WorkItemStore } from "../src/workitems/store.ts";
import { contract } from "./helpers.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-wi-"));
  const db = openSubstrate(join(dir, "state.db"));
  const issues = new IssueService(db);
  issues.createProject({ id: "prj_wi", prefix: "WI", name: "w" });
  const journal = new JournalService(db, issues);
  const provenance = new ProvenanceService(db, issues, journal);
  return { dir, db, issues, journal, provenance, store: new SubstrateIssueStore(issues, journal) };
}

function readyIssue(s: ReturnType<typeof setup>, title = "WI work"): string {
  const issue = s.issues.createIssue({ projectId: "prj_wi", title, kind: "task", contract: contract(), scrutiny: "MEDIUM", authoredBy: "human:op" });
  s.issues.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "human:reviewer" });
  return issue.id;
}

describe("seam: full method circuit on the Substrate backend", () => {
  it("get/search/ready/validate/resolveContext/claim/renew/release/update/edge/journal/checkpoint/close/changesSince", async () => {
    const s = setup();
    try {
      const id = readyIssue(s);
      const w: WorkItemStore = s.store;
      assert.equal(w.backend, "substrate");
      assert.equal(w.get("WI-1").readinessState, "ready");
      assert.equal(w.search("prj_wi", "wi work").length, 1);
      assert.equal(w.ready("prj_wi").length, 1);
      assert.equal(w.validate(id).dispatchable, true);
      assert.ok(w.resolveContext(id).hash.length > 0);
      // Actor strings pass through verbatim (trust-class preservation).
      const claim = w.claim(id, "human:worker", { activationId: "act-1" });
      assert.equal(claim.holder, "human:worker");
      assert.equal(w.ready("prj_wi").length, 0);
      const renewed = w.renew(id, "human:worker", { activationId: "act-1" });
      assert.equal(renewed.generation, claim.generation);
      const other = s.issues.createIssue({ projectId: "prj_wi", title: "Other", kind: "task", contract: contract(), scrutiny: "LOW" });
      const edge = w.addEdge(id, other.id, "blocks");
      assert.equal(edge.kind, "blocks");
      assert.ok(edge.edgeId);
      const j = w.addJournal(id, "finding", { participantId: "human:worker", semantic: { summary: "found the loader stalls on large partitions" } });
      assert.equal(j.kind, "finding");
      const cp = await w.checkpoint(id, { headCommit: "a".repeat(40) });
      assert.ok(cp.entryId);
      const batch = w.changesSince(id, 0);
      assert.ok(batch.events.length > 0);
      assert.equal(batch.nextCursor, batch.events[batch.events.length - 1]!.id);
      assert.equal(w.release(id, "human:worker", { activationId: "act-1" }), true);
      const updated = w.update(id, { ...contract(), problem: "v2" }, { authoredBy: "human:op" });
      assert.equal(updated.revisionCreated, true);
      const closed = w.close(id);
      assert.equal(closed.issue.lifecycleState, "done");
    } finally {
      s.db.close();
    }
  });

  it("claimReady attests and claims atomically; parent routes through setParent", () => {
    const s = setup();
    try {
      const w = s.store;
      const parent = s.issues.createIssue({ projectId: "prj_wi", title: "P", kind: "epic", contract: contract(), scrutiny: "LOW" });
      const child = s.issues.createIssue({ projectId: "prj_wi", title: "C", kind: "task", contract: contract(), scrutiny: "LOW" });
      const { claim, attestedRevision } = w.claimReady(child.id, "human:worker", { outcome: "ready", policy: "default", attestedBy: "human:reviewer" });
      assert.equal(attestedRevision, 1);
      assert.equal(claim.holder, "human:worker");
      const r = w.addEdge(parent.id, child.id, "parent_child");
      assert.equal(r.edgeId, null);
      assert.equal(s.issues.getParent(child.id)?.id, parent.id);
    } finally {
      s.db.close();
    }
  });
});

describe("gate: ambiguous work refused, scope never expands, binding recorded", () => {
  it("draft issue refused even with a rich requestedScope (no prompt smuggling)", () => {
    const s = setup();
    try {
      const draft = s.issues.createIssue({ projectId: "prj_wi", title: "Draft", kind: "task", contract: contract(), scrutiny: "LOW" });
      assert.throws(
        () => checkDispatch(s.issues, { ref: draft.id, specialist: "executor", holder: "h", workspace: "/tmp/w", requestedScope: ["a", "b", "c"] }),
        /is draft/,
      );
    } finally {
      s.db.close();
    }
  });

  it("stale attestation refuses: edit after attest invalidates the gate", () => {
    const s = setup();
    try {
      const id = readyIssue(s);
      const w: WorkItemStore = s.store;
      w.update(id, { ...contract(), problem: "changed" });
      assert.throws(
        () => checkDispatch(s.issues, { ref: id, specialist: "executor", holder: "h", workspace: "/tmp/w" }),
        /is draft/,
      );
    } finally {
      s.db.close();
    }
  });

  it("narrow allowed, expand rejected; dispatch binds the live revision", () => {
    const s = setup();
    try {
      const id = readyIssue(s);
      const w: WorkItemStore = s.store;
      assert.deepEqual(scopeExpansion(s.issues, id, ["a"]), []);
      assert.deepEqual(scopeExpansion(s.issues, id, ["a", "zzz"]), ["zzz"]);
      assert.throws(
        () => checkDispatch(s.issues, { ref: id, specialist: "executor", holder: "h", workspace: "/tmp/w", requestedScope: ["zzz"] }),
        /scope expansion/,
      );
      const ok = checkDispatch(s.issues, { ref: id, specialist: "executor", holder: "h", workspace: "/tmp/w", requestedScope: ["a"] });
      assert.equal(ok.revision, 1);
      const { binding } = dispatchToSpecialist(s.issues, s.provenance, { ref: id, specialist: "executor", holder: "h", workspace: "/tmp/w" });
      assert.equal(binding.issueRevision, 1);
      assert.equal(binding.issueId, id);
      // A later edit binds anew; the old binding still names revision 1.
      w.update(id, { ...contract(), problem: "v3" });
      s.issues.attestReadiness(id, { outcome: "ready", policy: "default", attestedBy: "human:reviewer" });
      const second = dispatchToSpecialist(s.issues, s.provenance, { ref: id, specialist: "executor", holder: "h", workspace: "/tmp/w" });
      assert.equal(second.binding.issueRevision, 2);
    } finally {
      s.db.close();
    }
  });

  it("claim-then-dispatch pipeline: claimed issues dispatch, binding pins the claim", () => {
    const s = setup();
    try {
      const id = readyIssue(s);
      const w: WorkItemStore = s.store;
      const claim = w.claim(id, "human:worker");
      const { binding } = dispatchToSpecialist(s.issues, s.provenance, { ref: id, specialist: "executor", holder: "human:worker", workspace: "/tmp/w", claimId: claim.claimId });
      assert.equal(binding.claimId, claim.claimId);
      assert.throws(
        () => dispatchToSpecialist(s.issues, s.provenance, { ref: id, specialist: "executor", holder: "human:worker", workspace: "/tmp/w", claimId: 9999 }),
        /not the live claim/,
      );
    } finally {
      s.db.close();
    }
  });
});

describe("journal-vs-memory: the seam exposes continuity, never memory authority", () => {
  it("journal reads return entries; no memory/promote API exists on the seam", async () => {
    const s = setup();
    try {
      const id = readyIssue(s);
      const w: WorkItemStore = s.store;
      await w.checkpoint(id, {});
      // Instance shape: only the 15 D-35 methods plus backend, nothing
      // resembling remember/promote/recall.
      const names = new Set<string>();
      let proto = Object.getPrototypeOf(w);
      while (proto && proto !== Object.prototype) {
        for (const n of Object.getOwnPropertyNames(proto)) names.add(n);
        proto = Object.getPrototypeOf(proto);
      }
      for (const n of [...names, ...Object.keys(w)]) {
        assert.ok(!/remember|recall|promote|memory/i.test(n), `memory authority leaked into seam: ${n}`);
      }
      const batch = w.changesSince(id, 0);
      assert.ok(batch.events.every((e) => typeof e.type === "string"));
    } finally {
      s.db.close();
    }
  });
});

describe("beads compat backend: reads pass, writes fail closed with parity notes", () => {
  function fixture(dir: string): string {
    const p = join(dir, "issues.jsonl");
    writeFileSync(p, [
      JSON.stringify({ id: "xtrm-abc", title: "Old bead", status: "open", kind: "task", priority: 1 }),
      JSON.stringify({ id: "xtrm-def", title: "Done bead", status: "done", kind: "bug" }),
      "not json at all",
      JSON.stringify({ noId: true }),
    ].join("\n"));
    return p;
  }

  it("get/search/validate read the export; ready is empty; mutations refuse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-beads-"));
    const store = new BeadsWorkItemStore(fixture(dir));
    assert.equal(store.backend, "beads");
    assert.equal(store.get("xtrm-abc").issue.title, "Old bead");
    assert.equal(store.search("", "done bead").length, 1);
    assert.equal(store.get("xtrm-abc").dispatchable, false);
    assert.deepEqual(store.ready(""), []);
    assert.throws(() => store.claim("xtrm-abc", "h"), /read-only compatibility/);
    assert.throws(() => store.update("xtrm-abc", {}), /read-only compatibility/);
    await assert.rejects(() => store.checkpoint("xtrm-abc"), /read-only compatibility/);
    assert.throws(() => store.close("xtrm-abc"), /read-only compatibility/);
    assert.throws(() => new BeadsWorkItemStore(join(dir, "missing.jsonl")).get("x"), /not readable/);
  });
});
