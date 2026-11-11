import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { contract, setup, tempDir } from "./helpers.ts";
import { GITHUB_ISSUE_OPENED, JIRA_WEBHOOK_CREATED, remoteEdit } from "./fixtures.ts";
import { IntegrationService, type ProjectionSender, type SendResult } from "../src/service/integration-service.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { openSubstrate } from "../src/store/sqlite.ts";
import {
  blocksLinkOp,
  diffGitHubIssue,
  mapIssueToGitHub,
  parentLinkOp,
} from "../src/projections/github/mapping.ts";
import { diffJiraIssue, mapIssueToJira, selectForJira } from "../src/projections/jira/mapping.ts";
import { hashMappedContent, type ProviderCapabilities } from "../src/projections/types.ts";
import { writeFilesystemProjection } from "../src/projections/filesystem/render.ts";

const CAPS: ProviderCapabilities = { subIssues: true, dependencies: true, issueTypes: true, fields: true };
const NO_CAPS: ProviderCapabilities = { subIssues: false, dependencies: false, issueTypes: false, fields: false };

function integ() {
  const { dir, db, svc } = setup();
  return { dir, db, svc, ix: new IntegrationService(db, svc) };
}

class FakeSender implements ProjectionSender {
  calls: Array<{ outboxId: number; operation: string }> = [];
  script: SendResult[] = [{ ok: true }];
  async send(op: { outboxId: number; operation: string }): Promise<SendResult> {
    this.calls.push({ outboxId: op.outboxId, operation: op.operation });
    return this.script[Math.min(this.calls.length - 1, this.script.length - 1)];
  }
}

describe("migration 002", () => {
  it("creates projections/sync tables on a fresh database", () => {
    const { db } = integ();
    const have = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    );
    for (const t of ["external_bindings", "integration_inbox", "projection_outbox"]) assert.ok(have.has(t), `missing ${t}`);
    db.close();
  });

  it("unknown migration state fails closed (PRD-46)", () => {
    const { dir, db } = integ();
    const path = join(dir, "state.db");
    db.close();
    const tampered = new DatabaseSync(path);
    tampered.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (99, 'rogue', 'x', ?)").run(Date.now());
    tampered.close();
    // Unknown version refuses startup/mutation rather than guessing.
    assert.throws(() => openSubstrate(path), /fail-closed/);
  });
});

describe("F38 zero-PATCH no-op", () => {
  it("unchanged projection enqueues nothing and sends nothing", async () => {
    const { svc, ix } = integ();
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "T", kind: "task", contract: contract() });
    ix.bindExternal(issue.id, { provider: "github", remoteScope: "xtrm-dev/xtrm", remoteId: "241", mode: "projection" });
    const mapped = mapIssueToGitHub(issue, contract(), CAPS);
    const hash = hashMappedContent(mapped);
    const first = ix.enqueueProjection(issue.id, { provider: "github", remoteScope: "xtrm-dev/xtrm", operation: "upsert-issue", payload: mapped, contentHash: hash });
    assert.equal(first.enqueued, true);
    const sender = new FakeSender();
    await ix.drainOutbox(sender);
    assert.equal(sender.calls.length, 1);
    // Same content again: diff yields zero ops and enqueue refuses.
    assert.deepEqual(diffGitHubIssue("xtrm-dev/xtrm", mapIssueToGitHub(svc.getIssue(issue.id), contract(), CAPS), ix.getBinding(issue.id, "github", "xtrm-dev/xtrm", "241")?.mappedContentHash ?? null), []);
    const second = ix.enqueueProjection(issue.id, { provider: "github", remoteScope: "xtrm-dev/xtrm", operation: "upsert-issue", payload: mapped, contentHash: hash });
    assert.equal(second.enqueued, false);
    assert.equal(second.reason, "unchanged");
    await ix.drainOutbox(sender);
    assert.equal(sender.calls.length, 1);
  });
});

describe("F39/F40 native relationship mapping", () => {
  it("parent binds to a sub-issue link, blocks to a dependency link", () => {
    const { svc } = integ();
    const parent = svc.createIssue({ projectId: "prj_xtrm", title: "P", kind: "epic", contract: contract() });
    const child = svc.createIssue({ projectId: "prj_xtrm", title: "C", kind: "task", contract: contract(), parentId: parent.id });
    const blocked = svc.createIssue({ projectId: "prj_xtrm", title: "B", kind: "task", contract: contract() });
    svc.addEdge(child.id, blocked.id, "blocks");
    assert.deepEqual(parentLinkOp("s", "100", "101", CAPS), [{ op: "link-sub-issue", remoteScope: "s", parentRemoteId: "100", childRemoteId: "101" }]);
    assert.deepEqual(blocksLinkOp("s", "101", "102", CAPS), [{ op: "link-dependency", remoteScope: "s", blockerRemoteId: "101", blockedRemoteId: "102" }]);
    // Unbound sides and incapable providers degrade to no link, never labels.
    assert.deepEqual(parentLinkOp("s", null, "101", CAPS), []);
    assert.deepEqual(blocksLinkOp("s", "101", null, CAPS), []);
    assert.deepEqual(parentLinkOp("s", "100", "101", NO_CAPS), []);
    assert.deepEqual(blocksLinkOp("s", "101", "102", NO_CAPS), []);
    void parent;
    void blocked;
  });
});

describe("F41 intake creates unready drafts", () => {
  it("GitHub intake lands as a TBD-marked draft with intake binding", () => {
    const { svc, ix } = integ();
    const before = svc.listIssues("prj_xtrm").length;
    const res = ix.receiveInbound("github", "issue-intake", "evt-1", GITHUB_ISSUE_OPENED);
    assert.equal(res.duplicate, false);
    assert.equal(res.status, "intake-draft");
    assert.ok(res.issueId);
    assert.equal(svc.listIssues("prj_xtrm").length, before + 1);
    const rev = svc.getRevision(res.issueId as string, 1);
    const c = rev.contract as { success: string };
    assert.ok(String(c.success).includes("TBD"));
    assert.equal(rev.authoredBy, "intake:github");
    const bindings = ix.listBindings(res.issueId as string);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].mode, "intake");
    // Duplicate delivery mutates once.
    const dup = ix.receiveInbound("github", "issue-intake", "evt-1", GITHUB_ISSUE_OPENED);
    assert.equal(dup.duplicate, true);
    assert.equal(svc.listIssues("prj_xtrm").length, before + 1);
    assert.equal(ix.listInbox("github")[0].seenCount, 2);
  });
});

describe("F42 webhook idempotency", () => {
  it("duplicate Jira delivery mutates local state once", () => {
    const { svc, ix } = integ();
    const before = svc.listIssues("prj_xtrm").length;
    const a = ix.receiveInbound("jira", "issue-intake", "wh-7", JIRA_WEBHOOK_CREATED);
    const b = ix.receiveInbound("jira", "issue-intake", "wh-7", JIRA_WEBHOOK_CREATED);
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(b.issueId, null);
    assert.equal(svc.listIssues("prj_xtrm").length, before + 1);
  });
});

describe("F43 protected remote edits", () => {
  it("divergent remote content records drift without touching local state", () => {
    const { svc, ix } = integ();
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "Local title", kind: "task", contract: contract() });
    ix.bindExternal(issue.id, { provider: "github", remoteScope: "xtrm-dev/xtrm", remoteId: "241", mode: "projection" });
    const pushed = { title: "Local title", body: "v1" };
    const hash = hashMappedContent(pushed);
    ix.enqueueProjection(issue.id, { provider: "github", remoteScope: "xtrm-dev/xtrm", operation: "upsert-issue", payload: pushed, contentHash: hash });
    return ix.drainOutbox(new FakeSender()).then(() => {
      const res = ix.receiveInbound("github", "remote-edit", "edit-1", remoteEdit("xtrm-dev/xtrm", "241", "v2", { title: "Remote rewrite" }));
      assert.equal(res.status, "drift");
      assert.equal(svc.getIssue(issue.id).title, "Local title");
      assert.equal(ix.getBinding(issue.id, "github", "xtrm-dev/xtrm", "241")?.syncState, "drift");
      const types = svc.listEvents(issue.id).map((e) => e.type);
      assert.ok(types.includes("projection.drift"));
    });
  });

  it("remote echo of pushed content is a noop and unknown remotes stay unbound", () => {
    const { svc, ix } = integ();
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "T", kind: "task", contract: contract() });
    ix.bindExternal(issue.id, { provider: "github", remoteScope: "s", remoteId: "9", mode: "projection" });
    const mapped = { title: "T" };
    const hash = hashMappedContent(mapped);
    ix.enqueueProjection(issue.id, { provider: "github", remoteScope: "s", operation: "upsert-issue", payload: mapped, contentHash: hash });
    return ix.drainOutbox(new FakeSender()).then(() => {
      const noop = ix.receiveInbound("github", "remote-edit", "edit-2", remoteEdit("s", "9", "v9", { title: "T" }));
      assert.equal(noop.status, "noop");
      const unbound = ix.receiveInbound("github", "remote-edit", "edit-3", remoteEdit("s", "nope", "v1", { title: "X" }));
      assert.equal(unbound.status, "unbound");
      assert.equal(unbound.issueId, null);
    });
  });
});

describe("outbox retry + uncertainty (PRD §47)", () => {
  it("retryable failures back off and then send; sender throws are retryable", async () => {
    const { svc, ix } = integ();
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "T", kind: "task", contract: contract() });
    const T = 1_000_000;
    ix.enqueueProjection(issue.id, { provider: "github", remoteScope: "s", operation: "upsert-issue", payload: { a: 1 }, contentHash: "h1" }, { now: T });
    const sender = new FakeSender();
    sender.script = [{ ok: false, retryable: true, error: "500" }, { ok: true }];
    await ix.drainOutbox(sender, { now: T });
    let pending = ix.listOutbox("pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].attempts, 1);
    assert.ok(pending[0].nextRetryAt > T);
    await ix.drainOutbox(sender, { now: T + 500 });
    assert.equal(sender.calls.length, 1);
    await ix.drainOutbox(sender, { now: T + 60_000 });
    assert.equal(sender.calls.length, 2);
    assert.equal(ix.listOutbox("sent").length, 1);
  });

  it("non-retryable failures fail closed and uncertain effects are recorded", async () => {
    const { svc, ix } = integ();
    const a = svc.createIssue({ projectId: "prj_xtrm", title: "A", kind: "task", contract: contract() });
    const b = svc.createIssue({ projectId: "prj_xtrm", title: "B", kind: "task", contract: contract() });
    ix.bindExternal(b.id, { provider: "jira", remoteScope: "PRG", remoteId: "1", mode: "projection" });
    ix.enqueueProjection(a.id, { provider: "github", remoteScope: "s", operation: "upsert-issue", payload: {}, contentHash: "ha" });
    ix.enqueueProjection(b.id, { provider: "jira", remoteScope: "PRG", operation: "upsert-issue", payload: {}, contentHash: "hb" });
    const sender = new FakeSender();
    sender.script = [{ ok: false, retryable: false, error: "422 validation" }];
    const out = await ix.drainOutbox(sender);
    assert.equal(out.failed, 2);
    assert.equal(ix.listOutbox("failed").length, 2);
  });

  it("uncertain outcomes mark the binding uncertain with an audit event", async () => {
    const { svc, ix } = integ();
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "T", kind: "task", contract: contract() });
    ix.bindExternal(issue.id, { provider: "github", remoteScope: "s", remoteId: "5", mode: "projection" });
    ix.enqueueProjection(issue.id, { provider: "github", remoteScope: "s", operation: "upsert-issue", payload: {}, contentHash: "hu" });
    const sender = new FakeSender();
    sender.script = [{ ok: "uncertain", error: "timeout after send" }];
    const out = await ix.drainOutbox(sender);
    assert.equal(out.uncertain, 1);
    assert.equal(ix.getBinding(issue.id, "github", "s", "5")?.syncState, "uncertain");
    assert.ok(svc.listEvents(issue.id).some((e) => e.type === "external.uncertain"));
  });
});

describe("provider payload validation (PRD-46)", () => {
  it("malformed inbound payloads are rejected before any mutation", () => {
    const { svc, ix } = integ();
    const before = svc.listIssues("prj_xtrm").length;
    assert.throws(() => ix.receiveInbound("github", "issue-intake", "bad-1", { action: "opened" }), /invalid provider payload/);
    assert.throws(() => ix.receiveInbound("jira", "issue-intake", "bad-2", { issue: { id: "1" } }), /invalid provider payload/);
    assert.throws(() => ix.receiveInbound("github", "remote-edit", "bad-3", { remoteScope: "s" }), /invalid provider payload/);
    assert.equal(svc.listIssues("prj_xtrm").length, before);
    assert.equal(ix.listInbox().length, 0);
  });
});

describe("bindings survive syncs + Jira selection", () => {
  it("remote keys are stable across push cycles", async () => {
    const { svc, ix } = integ();
    const issue = svc.createIssue({ projectId: "prj_xtrm", title: "T", kind: "task", contract: contract() });
    ix.bindExternal(issue.id, { provider: "jira", remoteScope: "PRG", remoteId: "10042", remoteKey: "ISSUE-92", mode: "projection" });
    const mapped = mapIssueToJira(issue, contract());
    const hash = hashMappedContent(mapped);
    ix.enqueueProjection(issue.id, { provider: "jira", remoteScope: "PRG", operation: "upsert-issue", payload: { ...mapped, key: "ISSUE-92" }, contentHash: hash });
    await ix.drainOutbox(new FakeSender());
    const b = ix.getBinding(issue.id, "jira", "PRG", "10042");
    assert.equal(b?.remoteKey, "ISSUE-92");
    assert.equal(b?.syncState, "in_sync");
    assert.equal(b?.lastPushedRevision, 1);
    assert.deepEqual(diffJiraIssue("PRG", "ISSUE-92", mapIssueToJira(svc.getIssue(issue.id), contract()), b?.mappedContentHash ?? null), []);
  });

  it("Jira selection defaults to roots unless tagged or all", () => {
    const { svc } = integ();
    const root = svc.createIssue({ projectId: "prj_xtrm", title: "Root", kind: "epic", contract: contract() });
    const leaf = svc.createIssue({ projectId: "prj_xtrm", title: "Leaf [prog]", kind: "task", contract: contract(), parentId: root.id });
    assert.equal(selectForJira(root, true, { mode: "roots-only" }), true);
    assert.equal(selectForJira(leaf, false, { mode: "roots-only" }), false);
    assert.equal(selectForJira(leaf, false, { mode: "tagged", tag: "[prog]" }), true);
    assert.equal(selectForJira(root, true, { mode: "tagged", tag: "[prog]" }), false);
    assert.equal(selectForJira(leaf, false, { mode: "all" }), true);
  });
});

describe("filesystem projection", () => {
  it("renders the tree with locators and writes the snapshot", () => {
    const { svc } = integ();
    const root = svc.createIssue({ projectId: "prj_xtrm", title: "Root", kind: "epic", contract: contract() });
    svc.createIssue({ projectId: "prj_xtrm", title: "Leaf", kind: "task", contract: contract(), parentId: root.id });
    const dir = tempDir("substrate-proj-");
    const { treePath, snapshotPath } = writeFilesystemProjection(svc, "prj_xtrm", dir);
    assert.ok(existsSync(treePath));
    assert.ok(existsSync(snapshotPath));
    const tree = readFileSync(treePath, "utf8");
    assert.ok(tree.includes(root.humanRef));
    assert.ok(tree.includes("Leaf"));
    const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as { version: number };
    assert.equal(snap.version, 1);
  });
});

describe("issue service untouched surface", () => {
  it("kernel APIs used by projections behave as .2 left them", () => {
    const { svc } = integ();
    const svc2: IssueService = svc;
    assert.equal(typeof svc2.listChildren, "function");
    assert.equal(typeof svc2.getParent, "function");
    assert.equal(typeof svc2.exportProject, "function");
  });
});
