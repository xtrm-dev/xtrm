import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { contract, setup } from "./helpers.ts";

describe("identity, locators, slots (A7-A9)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("A7: reparent preserves machine ID + human ref, changes only locator", () => {
    const root = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "root", kind: "epic", contract: contract() });
    const other = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "other", kind: "epic", contract: contract() });
    const kid = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "kid", kind: "task", contract: contract(), parentId: root.id });
    const before = ctx.svc.getIssue(kid.id);
    const moved = ctx.svc.setParent(kid.id, other.id);
    assert.equal(moved.id, kid.id);
    assert.equal(moved.humanRef, before.humanRef);
    assert.notEqual(moved.locator, before.locator);
    assert.match(moved.locator, new RegExp(`^${other.humanRef}\\.`));
  });

  it("A8: old locator resolves as historical alias and reports current", () => {
    const root = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "r", kind: "epic", contract: contract() });
    const other = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "o", kind: "epic", contract: contract() });
    const kid = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "k", kind: "task", contract: contract(), parentId: root.id });
    const oldLocator = ctx.svc.getIssue(kid.id).locator;
    const moved = ctx.svc.setParent(kid.id, other.id);
    const viaHistory = ctx.svc.resolveRef(oldLocator);
    assert.equal(viaHistory.id, kid.id);
    assert.equal(viaHistory.locator, moved.locator);
  });

  it("A9: sibling insert/reorder never renumbers existing locators", () => {
    const root = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "r", kind: "epic", contract: contract() });
    const a = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "a", kind: "task", contract: contract(), parentId: root.id });
    const locA = ctx.svc.getIssue(a.id).locator;
    ctx.svc.createIssue({ projectId: "prj_xtrm", title: "b", kind: "task", contract: contract(), parentId: root.id });
    ctx.svc.createIssue({ projectId: "prj_xtrm", title: "c", kind: "task", contract: contract(), parentId: root.id });
    assert.equal(ctx.svc.getIssue(a.id).locator, locA);
  });

  it("moved-away slots are never reused", () => {
    const root = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "r", kind: "epic", contract: contract() });
    const other = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "o", kind: "epic", contract: contract() });
    const a = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "a", kind: "task", contract: contract(), parentId: root.id });
    const locA = ctx.svc.getIssue(a.id).locator;
    ctx.svc.setParent(a.id, other.id);
    const b = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "b", kind: "task", contract: contract(), parentId: root.id });
    assert.notEqual(ctx.svc.getIssue(b.id).locator, locA);
  });

  it("three forms + alias resolve to the same issue", () => {
    const root = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "r", kind: "epic", contract: contract() });
    const kid = ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: "k",
      kind: "task",
      contract: contract(),
      parentId: root.id,
      aliases: [{ alias: "unitAI-xoum6", kind: "beads" }],
    });
    const v = ctx.svc.getIssue(kid.id);
    assert.equal(ctx.svc.resolveRef(kid.id).id, kid.id);
    assert.equal(ctx.svc.resolveRef(v.humanRef).id, kid.id);
    assert.equal(ctx.svc.resolveRef(v.locator).id, kid.id);
    assert.equal(ctx.svc.resolveRef("unitAI-xoum6").id, kid.id);
    assert.throws(() => ctx.svc.resolveRef("XTRM-9999"), /unresolvable/);
  });

  it("contract edit creates a revision; identical edit does not", () => {
    const i = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "r", kind: "task", contract: contract() });
    assert.equal(i.currentRevision, 1);
    const same = ctx.svc.updateContract(i.id, contract(), "op");
    assert.equal(same.created, false);
    assert.equal(same.issue.currentRevision, 1);
    const next = ctx.svc.updateContract(i.id, contract({ problem: "P2" }), "op");
    assert.equal(next.created, true);
    assert.equal(next.issue.currentRevision, 2);
    assert.equal(ctx.svc.listRevisions(i.id).length, 2);
    assert.throws(() => ctx.svc.updateContract(i.id, contract({ problem: "P3" }), "op", { expectedRevision: 1 }), /revision conflict/);
  });
});

describe("cycles (A10, service-level)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("rejects parent/child cycles", () => {
    const mk = (t: string, p?: string) =>
      ctx.svc.createIssue({ projectId: "prj_xtrm", title: t, kind: "task", contract: contract(), parentId: p });
    const a = mk("a");
    const b = mk("b", a.id);
    const c = mk("c", b.id);
    assert.throws(() => ctx.svc.setParent(a.id, c.id), /cycle/);
    assert.throws(() => ctx.svc.setParent(a.id, a.id), /cycle/);
  });

  it("rejects blocks cycles", () => {
    const mk = (t: string) => ctx.svc.createIssue({ projectId: "prj_xtrm", title: t, kind: "task", contract: contract() });
    const a = mk("a");
    const b = mk("b");
    ctx.svc.addEdge(a.id, b.id, "blocks");
    assert.throws(() => ctx.svc.addEdge(b.id, a.id, "blocks"), /cycle/);
  });

  it("self edges rejected", () => {
    const a = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "a", kind: "task", contract: contract() });
    assert.throws(() => ctx.svc.addEdge(a.id, a.id, "relates_to"));
  });
});
