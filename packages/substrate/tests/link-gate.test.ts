// Close gate and links check (XTRM-729): the join, the modes, the override.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { contract, setup } from "./helpers.ts";
import { runCli } from "../cli/sb.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { PullRequestService } from "../src/service/pull-request-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { GATE_CODES, LinkGateService, type PullRequestStateReader } from "../src/service/link-gate-service.ts";
import { syncReportText } from "../src/service/pull-request-sync-service.ts";

class FakeReader implements PullRequestStateReader {
  states = new Map<string, { state: string; baseRef: string | null }>();
  defaultBranchValue: string | null = "main";
  fail = false;
  stateCalls = 0;
  defaultCalls = 0;
  state(repository: string, number: number) {
    this.stateCalls += 1;
    if (this.fail) throw new Error("gh unreachable");
    return this.states.get(`${repository}#${number}`) ?? null;
  }
  defaultBranch() {
    this.defaultCalls += 1;
    if (this.fail) throw new Error("gh unreachable");
    return this.defaultBranchValue;
  }
}

function world() {
  const ctx = setup();
  const issue = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "work", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  ctx.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  const journal = new JournalService(ctx.db, ctx.svc);
  const prov = new ProvenanceService(ctx.db, ctx.svc, journal);
  const links = new PullRequestService(ctx.db, ctx.svc, prov);
  const reader = new FakeReader();
  const gate = new LinkGateService(ctx.db, ctx.svc, reader);
  const closures = new ClosureService(ctx.db, ctx.svc, gate);
  return { ...ctx, issue, prov, links, reader, gate, closures, journal };
}

function receiptFor(w: ReturnType<typeof world>) {
  const claim = w.svc.claimIssue(w.issue.id, "w", { ttlMs: 60_000 });
  const binding = w.prov.dispatch(w.issue.id, { workspace: "/tmp/ws", participantId: "w", claimId: claim.id });
  return w.prov.allocateReceipt(binding.id);
}

const PR = { repository: "o/r", number: 7, canonical: "o/r#7", url: "https://github.com/o/r/pull/7" };

function t1(w: ReturnType<typeof world>) {
  return w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receiptFor(w).id }, PR);
}

function t2(w: ReturnType<typeof world>, number = 7) {
  const receipt = receiptFor(w);
  return w.links.linkCommits({
    issueId: w.issue.id,
    repository: "o/r",
    number,
    actor: "w",
    commits: [{ sha: `${number}`.repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }],
  });
}

function mergeState(w: ReturnType<typeof world>, number: number, state: string, baseRef = "main", syncedAt = Date.now()) {
  w.db
    .prepare(
      `INSERT INTO pull_requests (repository, number, state, draft, head_sha, merge_commit_sha, title, url, base_ref, merged_at, closed_at, etag, last_modified, last_synced_at)
       VALUES (?,?,?,0,NULL,NULL,NULL,NULL,?,NULL,NULL,NULL,NULL,?)
       ON CONFLICT (repository, number) DO UPDATE SET state = excluded.state, base_ref = excluded.base_ref, last_synced_at = excluded.last_synced_at`,
    )
    .run("o/r", number, state, baseRef, syncedAt);
}

function baseBranch(w: ReturnType<typeof world>, branch: string) {
  w.db
    .prepare("INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?,?,?,?,?,?)")
    .run("github.com/o/r", "prj_xtrm", branch, "github.com/o/r", 1, 1);
}

function close(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) {
  return w.closures.closeIssue(w.issue.id, { outcome: "completed", reason: "done", actor: "closer", ...extra } as never);
}

describe("close gate", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
    delete process.env["XTRM_LINK_GATE"];
  });
  afterEach(() => {
    w.db.close();
    rmSync(w.dir, { recursive: true, force: true });
    delete process.env["XTRM_LINK_GATE"];
  });

  it("no links refuses gate_no_evidence and enforce writes nothing", () => {
    assert.deepEqual(w.gate.evaluate(w.issue.id).codes, [GATE_CODES.noEvidence]);
    assert.throws(() => close(w, { linkGate: "enforce" }), /gate_no_evidence/);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM issue_closures").get() as { n: number }).n, 0);
  });

  it("a mention only refuses gate_mentioned_only", () => {
    w.links.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    assert.deepEqual(w.gate.evaluate(w.issue.id).codes, [GATE_CODES.mentioned]);
  });

  it("an orphan provenance row fails gate_orphan_link even beside a passing T2", () => {
    w.db
      .prepare("INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at, superseded_at) VALUES (?,?,?,?,?,NULL,NULL,?,NULL)")
      .run(w.issue.id, "o/r", 8, "created_from", "provenance", Date.now());
    t2(w);
    const evaluation = w.gate.evaluate(w.issue.id);
    assert.equal(evaluation.verdict, "fail");
    assert.ok(evaluation.codes.includes(GATE_CODES.orphan));
  });

  it("T1 and T2 pass the manual gate, and enforce closes", () => {
    t1(w);
    assert.deepEqual(w.gate.evaluate(w.issue.id).codes, []);
    const closure = close(w, { linkGate: "enforce" });
    assert.equal(closure.outcome, "completed");
  });

  it("a T2 PR that is still open passes manual", () => {
    t2(w);
    const closure = close(w, { linkGate: "enforce" });
    assert.equal(closure.outcome, "completed");
  });

  it("auto refuses an unmerged T2 PR with gate_pr_not_merged", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "open");
    baseBranch(w, "main");
    assert.deepEqual(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes, [GATE_CODES.notMerged]);
  });

  it("auto passes a merged T2 PR on the default branch", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "merged");
    baseBranch(w, "main");
    assert.deepEqual(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes, []);
  });

  it("auto fails closed on an unknown default branch and unreachable GitHub", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "merged", "main", Date.now() - 48 * 60 * 60 * 1000);
    w.reader.defaultBranchValue = null;
    assert.ok(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes.includes(GATE_CODES.defaultBranch));
    w.reader.fail = true;
    assert.ok(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes.includes(GATE_CODES.unreachable));
  });

  it("auto refuses another open created_from PR", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "merged");
    baseBranch(w, "main");
    w.db
      .prepare("INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at, superseded_at) VALUES (?,?,?,?,?,NULL,NULL,?,NULL)")
      .run(w.issue.id, "o/r", 8, "created_from", "trailer", Date.now());
    mergeState(w, 8, "open");
    assert.ok(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes.includes(GATE_CODES.otherOpenPr));
  });

  it("auto refuses a live claim", () => {
    t2(w);
    mergeState(w, 7, "merged");
    baseBranch(w, "main");
    w.svc.claimIssue(w.issue.id, "w", { ttlMs: 60_000 });
    assert.ok(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes.includes(GATE_CODES.liveClaim));
  });

  it("an auto PR merged into a non-default branch refuses gate_pr_not_merged", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "merged", "release");
    baseBranch(w, "main");
    assert.deepEqual(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes, [GATE_CODES.notMerged]);
  });

  it("the binding's base_branch is tried before the reader", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "merged", "trunk");
    baseBranch(w, "trunk");
    w.reader.defaultBranchValue = "main";
    assert.deepEqual(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes, []);
    assert.equal(w.reader.defaultCalls, 0);
  });

  it("a failing PR-state read and a failing default-branch read fail separately", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    mergeState(w, 7, "merged", "main", Date.now() - 48 * 60 * 60 * 1000);
    baseBranch(w, "main");
    w.reader.fail = true;
    assert.ok(w.gate.evaluate(w.issue.id, { mode: "auto" }).codes.includes(GATE_CODES.unreachable));
    const fresh = world();
    try {
      t2(fresh);
      fresh.svc.releaseClaim(fresh.issue.id, "w");
      mergeState(fresh, 7, "merged", "main");
      fresh.reader.fail = true;
      assert.ok(fresh.gate.evaluate(fresh.issue.id, { mode: "auto" }).codes.includes(GATE_CODES.unreachable));
    } finally {
      fresh.db.close();
      rmSync(fresh.dir, { recursive: true, force: true });
    }
  });

  it("the 24h trust window uses the injected clock", () => {
    t2(w);
    w.svc.releaseClaim(w.issue.id, "w");
    baseBranch(w, "main");
    const now = 1_000_000_000;
    mergeState(w, 7, "merged", "main", now - 23 * 60 * 60 * 1000);
    assert.deepEqual(w.gate.evaluate(w.issue.id, { mode: "auto", now }).codes, []);
    assert.equal(w.reader.stateCalls, 0);
    mergeState(w, 7, "merged", "main", now - 25 * 60 * 60 * 1000);
    w.gate.evaluate(w.issue.id, { mode: "auto", now });
    assert.equal(w.reader.stateCalls, 1);
  });

  it("non-delivery outcomes skip the gate and emit no warn event", () => {
    w.closures.closeIssue(w.issue.id, { outcome: "wont_fix", reason: "not doing it", actor: "closer", linkGate: "enforce" });
    assert.equal(w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_gate_warned").length, 0);
  });

  it("the done transition itself is gated once, and an exemption skips it", () => {
    assert.throws(() => w.svc.setLifecycleState(w.issue.id, "done", undefined, { linkGate: "enforce" }), /gate_no_evidence/);
    assert.equal(w.svc.getIssue(w.issue.id).lifecycleState, "open");
    w.svc.setLifecycleState(w.issue.id, "done", undefined, { exemption: "beads-import", linkGate: "enforce" });
    assert.equal(w.svc.getIssue(w.issue.id).lifecycleState, "done");
  });

  it("re-closing a done issue adds no gate event", () => {
    close(w, { linkGate: "warn" });
    const before = w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_gate_warned").length;
    assert.throws(() => close(w, { linkGate: "warn" }));
    assert.equal(w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_gate_warned").length, before);
  });

  it("an unknown gate value is an error, never enforce", () => {
    assert.throws(() => w.gate.enforce(w.issue.id, { mode: "Enforce" as never, actor: "a" }), /unknown gate mode/);
    process.env["XTRM_LINK_GATE"] = "ENFORCE";
    try {
      assert.throws(() => w.gate.enforce(w.issue.id, { actor: "a" }), /unknown XTRM_LINK_GATE/);
    } finally {
      delete process.env["XTRM_LINK_GATE"];
    }
  });

  it("an override in warn mode is still recorded, with the actor", () => {
    w.closures.closeIssue(w.issue.id, { outcome: "completed", reason: "done", actor: "operator", linkGate: "warn", gateOverride: "docs only" });
    const decisions = w.journal.timeline(w.issue.id, { kind: "decision" });
    assert.equal(decisions.at(-1)?.participantId, "operator");
  });

  it("state done accepts --link-gate and --gate-override", () => {
    const enforced = runCli(["--db", join(w.dir, "state.db"), "issue", "state", w.issue.humanRef, "done", "--project", "prj_xtrm", "--link-gate", "enforce"]);
    assert.equal(enforced.code, 1);
    assert.equal(w.svc.getIssue(w.issue.id).lifecycleState, "open");
    const overridden = runCli([
      "--db", join(w.dir, "state.db"), "issue", "state", w.issue.humanRef, "done", "--project", "prj_xtrm",
      "--link-gate", "enforce", "--gate-override", "no PR for this close", "--actor", "operator",
    ]);
    assert.equal(overridden.code, 0, JSON.stringify(overridden));
    assert.equal(w.svc.getIssue(w.issue.id).lifecycleState, "done");
  });

  it("the sync text line uses findingCount", () => {
    const text = syncReportText({
      dryRun: false, repositories: 1, scanned: 1, created: 0, mentioned: 0,
      findings: [{ repository: "o/r", number: 99, code: "pr_unavailable", detail: "x" }],
      findingCount: 2, failures: 1, skipped: 0, truncated: 0,
    });
    assert.match(text.detail, /findings 2/);
  });

  it("warn records the event and closes; off skips; override writes a Journal decision", () => {
    close(w, { linkGate: "warn" });
    assert.ok(w.svc.listEvents(w.issue.id).some((e) => e.type === "provenance.link_gate_warned"));

    const second = world();
    try {
      second.closures.closeIssue(second.issue.id, { outcome: "completed", reason: "done", actor: "closer", linkGate: "off" });
      assert.equal(second.svc.listEvents(second.issue.id).filter((e) => e.type === "provenance.link_gate_warned").length, 0);
    } finally {
      second.db.close();
      rmSync(second.dir, { recursive: true, force: true });
    }

    const third = world();
    try {
      third.closures.closeIssue(third.issue.id, {
        outcome: "completed",
        reason: "done",
        actor: "operator",
        linkGate: "enforce",
        gateOverride: "no PR needed for this docs-only close",
      });
      const decision = third.journal.latest(third.issue.id, { kind: "decision" });
      assert.match(JSON.stringify(decision), /close-gate override/);
    } finally {
      third.db.close();
      rmSync(third.dir, { recursive: true, force: true });
    }
  });

  it("with no mode passed the env default is warn", () => {
    delete process.env["XTRM_LINK_GATE"];
    close(w);
    assert.ok(w.svc.listEvents(w.issue.id).some((e) => e.type === "provenance.link_gate_warned"));
  });

  it("the legacy bare close is gated too", () => {
    const res = runCli(["--db", join(w.dir, "state.db"), "issue", "close", w.issue.humanRef, "--project", "prj_xtrm", "--link-gate", "enforce"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr + res.stdout, /gate_no_evidence/, JSON.stringify(res));
    assert.equal(w.svc.getIssue(w.issue.id).lifecycleState, "open");
  });

  it("links check --issue reports the verdict and exits on enforce", () => {
    const warn = runCli(["--db", join(w.dir, "state.db"), "--json", "links", "check", "--issue", w.issue.humanRef, "--project", "prj_xtrm", "--link-gate", "warn"]);
    assert.equal(warn.code, 0, JSON.stringify(warn));
    const payload = JSON.parse(warn.stdout) as { data: { issue: { manual: { codes: string[] } } } };
    assert.deepEqual(payload.data.issue.manual.codes, [GATE_CODES.noEvidence]);
    const enforce = runCli(["--db", join(w.dir, "state.db"), "links", "check", "--issue", w.issue.humanRef, "--project", "prj_xtrm", "--link-gate", "enforce"]);
    assert.equal(enforce.code, 1);
  });
});
