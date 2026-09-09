import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, setup } from "./helpers.ts";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";

// Acceptance C15-C21 (claims + workspace leases, PRD §§17-18) plus the
// crash-restart lease-uncertainty check (§47). `now` is injected everywhere
// so expiry never depends on wall-clock guessing.

const T0 = 1_786_000_000_000;

function readyIssue(ctx: ReturnType<typeof setup>) {
  const issue = ctx.svc.createIssue({
    projectId: "prj_xtrm",
    title: "work",
    kind: "task",
    contract: contract(),
    scrutiny: "HIGH",
  });
  ctx.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  return ctx.svc.getIssue(issue.id);
}

describe("claims + workspace leases (C15-C21, §47)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("C15: concurrent claims have exactly one winner (real processes, WAL)", async () => {
    const issue = readyIssue(ctx);
    const racer = join(dirname(fileURLToPath(import.meta.url)), "claim-racer.ts");
    const dbPath = join(ctx.dir, "state.db");
    const run = (holder: string) =>
      new Promise<number>((resolve, reject) => {
        const p = spawn(process.execPath, [racer, dbPath, issue.id, holder], { stdio: ["ignore", "ignore", "inherit"] });
        p.on("error", reject);
        p.on("close", (code) => resolve(code ?? 1));
      });
    const codes = await Promise.all(Array.from({ length: 8 }, (_, i) => run(`w${i}`)));
    assert.equal(codes.filter((c) => c === 0).length, 1, `exactly one winner, got codes ${codes}`);
    assert.equal(codes.filter((c) => c === 2).length, 7, `losers report claim-held, got codes ${codes}`);
    const open = ctx.svc.listClaims(issue.id).filter((c) => c.releasedAt === null);
    assert.equal(open.length, 1);
    assert.equal(open[0]!.generation, 1);
  });

  it("C16: same holder retry is idempotent; draft work is not claimable", () => {
    const issue = readyIssue(ctx);
    const a = ctx.svc.claimIssue(issue.id, "w0", { activationId: "a1", now: T0 });
    const b = ctx.svc.claimIssue(issue.id, "w0", { activationId: "a1", now: T0 + 1 });
    assert.equal(a.id, b.id);
    assert.equal(a.generation, 1);
    assert.equal(ctx.svc.listClaims(issue.id).length, 1);

    const draft = ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: "draft",
      kind: "task",
      contract: contract({ scope: [] }),
      scrutiny: "HIGH",
    });
    assert.throws(() => ctx.svc.claimIssue(draft.id, "w0", { now: T0 }), /not-claimable/);
  });

  it("C17: live claim cannot be stolen; claimed derives, release restores ready", () => {
    const issue = readyIssue(ctx);
    ctx.svc.claimIssue(issue.id, "w0", { activationId: "a1", now: T0 });
    assert.throws(() => ctx.svc.claimIssue(issue.id, "w1", { now: T0 + 1 }), /claim-held/);
    assert.throws(() => ctx.svc.claimIssue(issue.id, "w0", { activationId: "a2", now: T0 + 1 }), /claim-held/);

    const report = ctx.svc.getReadiness(issue.id, { now: T0 + 1 });
    assert.equal(report.state, "claimed");
    assert.equal(report.dispatchable, false);
    assert.throws(() => ctx.svc.assertDispatchable(issue.id, { now: T0 + 1 }), /not dispatchable/);

    assert.throws(() => ctx.svc.releaseClaim(issue.id, "w1", { now: T0 + 2 }), /claim-held/);
    ctx.svc.releaseClaim(issue.id, "w0", { activationId: "a1", now: T0 + 2 });
    assert.equal(ctx.svc.getReadiness(issue.id, { now: T0 + 3 }).state, "ready");
    assert.equal(ctx.svc.releaseClaim(issue.id, "w0", { now: T0 + 4 }), null);
  });

  it("C18: expired claim is reclaimable per policy; renew follows the rules", () => {
    const issue = readyIssue(ctx);
    const first = ctx.svc.claimIssue(issue.id, "w0", { now: T0, ttlMs: 1000 });
    assert.equal(ctx.svc.getActiveClaim(issue.id, { now: T0 + 2000 }), null);
    assert.throws(() => ctx.svc.renewClaim(issue.id, "w0", { now: T0 + 2000 }), /claim-expired/);

    const second = ctx.svc.claimIssue(issue.id, "w1", { now: T0 + 2000 });
    assert.equal(second.generation, first.generation + 1);
    assert.equal(ctx.svc.getActiveClaim(issue.id, { now: T0 + 2001 })?.holder, "w1");
    const types = ctx.svc.listEvents(issue.id).map((e) => e.type);
    assert.ok(types.includes("claim.expired"), `expected claim.expired in ${types}`);

    const renewed = ctx.svc.renewClaim(issue.id, "w1", { now: T0 + 2500, ttlMs: 5000 });
    assert.equal(renewed.expiresAt, T0 + 7500);
    assert.throws(() => ctx.svc.renewClaim(issue.id, "w0", { now: T0 + 2600 }), /claim-held/);
  });

  it("claimReady attests and claims in one transaction", () => {
    const issue = ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: "work",
      kind: "task",
      contract: contract(),
      scrutiny: "HIGH",
    });
    const { attestation, claim } = ctx.svc.claimReady(
      issue.id,
      "w0",
      { outcome: "ready", policy: "default", attestedBy: "tester" },
      { now: T0 },
    );
    assert.equal(attestation.outcome, "ready");
    assert.equal(claim.holder, "w0");
    assert.equal(claim.issueRevision, 1);
    assert.equal(ctx.svc.getReadiness(issue.id, { now: T0 }).state, "claimed");
  });

  it("C19: two writers cannot hold the same workspace lease", () => {
    const ws = join(ctx.dir, "wt");
    const a = ctx.svc.acquireWriterLease(ws, "child", { activationId: "a1", now: T0 });
    assert.equal(a.generation, 1);
    assert.throws(() => ctx.svc.acquireWriterLease(ws, "coordinator", { now: T0 + 1 }), /lease-held/);
    // Same holder retry is idempotent; trailing-slash form is the same key.
    const retry = ctx.svc.acquireWriterLease(`${ws}/`, "child", { activationId: "a1", now: T0 + 2 });
    assert.equal(retry.id, a.id);
    assert.equal(ctx.svc.listWorkspaceLeases(ws).length, 1);
  });

  it("C20: readers coexist with the writer; C21: coordinator is fenced", () => {
    const ws = join(ctx.dir, "wt");
    ctx.svc.acquireWriterLease(ws, "child", { activationId: "a1", now: T0 });
    assert.equal(ctx.svc.canReadWorkspace(), true);
    assert.equal(ctx.svc.holdsWriterLease(ws, "child", { activationId: "a1", now: T0 }), true);
    assert.equal(ctx.svc.holdsWriterLease(ws, "coordinator", { now: T0 }), false);
    ctx.svc.assertCanWrite(ws, "child", { activationId: "a1", now: T0 });
    assert.throws(() => ctx.svc.assertCanWrite(ws, "coordinator", { now: T0 }), /lease-fenced/);

    ctx.svc.releaseWriterLease(ws, "child", { activationId: "a1", now: T0 + 1 });
    assert.throws(() => ctx.svc.assertCanWrite(ws, "child", { now: T0 + 2 }), /lease-fenced/);
    ctx.svc.acquireWriterLease(ws, "coordinator", { now: T0 + 3 });
    ctx.svc.assertCanWrite(ws, "coordinator", { now: T0 + 4 });
  });

  it("writer lease renew/release/expiry mirror the claim policy", () => {
    const ws = join(ctx.dir, "wt");
    ctx.svc.acquireWriterLease(ws, "child", { now: T0, ttlMs: 1000 });
    assert.throws(() => ctx.svc.renewWriterLease(ws, "coordinator", { now: T0 + 1 }), /lease-held/);
    const renewed = ctx.svc.renewWriterLease(ws, "child", { now: T0 + 500, ttlMs: 2000 });
    assert.equal(renewed.expiresAt, T0 + 2500);
    assert.throws(() => ctx.svc.renewWriterLease(ws, "child", { now: T0 + 3000 }), /lease-expired/);
    const next = ctx.svc.acquireWriterLease(ws, "coordinator", { now: T0 + 3000 });
    assert.equal(next.generation, 2);
    assert.throws(() => ctx.svc.releaseWriterLease(ws, "child", { now: T0 + 3100 }), /lease-held/);
    const released = ctx.svc.releaseWriterLease(ws, "coordinator", { now: T0 + 3100 });
    assert.equal(released?.generation, 2);
    assert.equal(ctx.svc.releaseWriterLease(ws, "coordinator", { now: T0 + 3200 }), null);
  });

  it("§47: crash restart honors live leases; uncertainty is never guessed", () => {
    const issue = readyIssue(ctx);
    const ws = join(ctx.dir, "wt");
    ctx.svc.claimIssue(issue.id, "w0", { activationId: "a1", now: T0, ttlMs: 60_000 });
    ctx.svc.acquireWriterLease(ws, "child", { activationId: "a1", now: T0, ttlMs: 60_000 });
    const dbPath = join(ctx.dir, "state.db");
    ctx.db.close();

    const db2 = openSubstrate(dbPath);
    try {
      const svc2 = new IssueService(db2);
      // Live rows survive restart and stay enforced — no guessing.
      assert.throws(() => svc2.claimIssue(issue.id, "w1", { now: T0 + 1000 }), /claim-held/);
      assert.throws(() => svc2.assertCanWrite(ws, "coordinator", { now: T0 + 1000 }), /lease-fenced/);
      // The holder can still renew after restart.
      svc2.renewClaim(issue.id, "w0", { activationId: "a1", now: T0 + 1000, ttlMs: 60_000 });
      // Past expiry, anyone may reclaim — including after restart.
      const reclaimed = svc2.claimIssue(issue.id, "w1", { now: T0 + 120_000 });
      assert.equal(reclaimed.generation, 2);
      const lease2 = svc2.acquireWriterLease(ws, "coordinator", { now: T0 + 120_000 });
      assert.equal(lease2.generation, 2);
    } finally {
      db2.close();
    }
    ctx.db = openSubstrate(dbPath);
    ctx.svc = new IssueService(ctx.db);
  });
});
