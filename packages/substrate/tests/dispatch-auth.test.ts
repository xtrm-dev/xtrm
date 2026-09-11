// A7-auth: claimed dispatch fenced by live holder + activation (bead xtrm-6qu.7.2).
// Every claimed dispatch requires sameHolder(live, holder/participant, activation);
// omission or mismatch fails closed; ready/unclaimed claim-first flow stays open;
// binding claim/participant/activation cannot diverge.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { checkDispatch, dispatchToSpecialist } from "../src/workitems/dispatch-gate.ts";
import { contract } from "./helpers.ts";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-dauth-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const journal = new JournalService(db, svc);
  const prov = new ProvenanceService(db, svc, journal);
  return { dir, dbPath, db, svc, journal, prov };
}

function readyIssue(svc: IssueService, title = "work") {
  const issue = svc.createIssue({
    projectId: "prj_xtrm", title, kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW", authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  return issue;
}

describe("A7-auth gate: checkDispatch fenced by live claim", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("A claim / A dispatch allows (claimId omitted still binds live)", () => {
    const issue = readyIssue(s.svc, "a-allow");
    const claim = s.svc.claimIssue(issue.id, "holder-A");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w" });
    assert.equal(check.issueId, issue.id);
    const withPin = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w", claimId: claim.id });
    assert.equal(withPin.revision, 1);
  });

  it("A claim / B dispatch rejects even when claimId is omitted", () => {
    const issue = readyIssue(s.svc, "a-b");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-B", workspace: "/tmp/w" }),
      /live-held.*holder-A|holder\/activation mismatch/,
    );
  });

  it("same holder with different activation rejects", () => {
    const issue = readyIssue(s.svc, "act");
    s.svc.claimIssue(issue.id, "holder-A", { activationId: "act-1" });
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", activationId: "act-2", workspace: "/tmp/w" }),
      /holder\/activation mismatch|live-held/,
    );
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w" }),
      /holder\/activation mismatch|live-held/,
    );
  });

  it("claim without activation rejects dispatch that fabricates one", () => {
    const issue = readyIssue(s.svc, "noact");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", activationId: "act-9", workspace: "/tmp/w" }),
      /holder\/activation mismatch|live-held/,
    );
  });

  it("missing holder fails closed", () => {
    const issue = readyIssue(s.svc, "missing");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "   ", workspace: "/tmp/w" }),
      /holder is required/,
    );
  });

  it("claimId mismatch rejects", () => {
    const issue = readyIssue(s.svc, "mismatch");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w", claimId: 99999 }),
      /not the live claim/,
    );
  });

  it("ready/unclaimed claim-first flow remains valid", () => {
    const issue = readyIssue(s.svc, "first");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "anyone", workspace: "/tmp/w" });
    assert.equal(check.revision, 1);
    assert.throws(
      () => checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "anyone", workspace: "/tmp/w", claimId: 123 }),
      /not the live claim/,
    );
  });
});

describe("A7-auth service: provenance.dispatch fenced by live claim", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("A claim / A dispatch allows and pins live claim + identity", () => {
    const issue = readyIssue(s.svc, "svc-allow");
    const claim = s.svc.claimIssue(issue.id, "holder-A", { activationId: "act-1" });
    const b = s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-A", activationId: "act-1" });
    assert.equal(b.claimId, claim.id);
    assert.equal(b.participantId, "holder-A");
    assert.equal(b.activationId, "act-1");
    const pinned = s.prov.dispatch(issue.id, { workspace: s.dir, claimId: claim.id, participantId: "holder-A", activationId: "act-1" });
    assert.equal(pinned.claimId, claim.id);
  });

  it("A claim / B dispatch rejects (claimId omitted does not bypass)", () => {
    const issue = readyIssue(s.svc, "svc-deny");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-B" }),
      /live-held.*holder-A|holder\/activation mismatch/,
    );
  });

  it("omitted participant fails closed on claimed work", () => {
    const issue = readyIssue(s.svc, "svc-omit");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir }),
      /participant is required|live-held/,
    );
  });

  it("same holder different activation rejects", () => {
    const issue = readyIssue(s.svc, "svc-act");
    s.svc.claimIssue(issue.id, "holder-A", { activationId: "act-1" });
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-A", activationId: "act-2" }),
      /holder\/activation mismatch|live-held/,
    );
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-A" }),
      /holder\/activation mismatch|live-held/,
    );
  });

  it("claimId mismatch rejects", () => {
    const issue = readyIssue(s.svc, "svc-pin");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, claimId: 99999, participantId: "holder-A" }),
      /not the live claim/,
    );
  });

  it("ready/unclaimed dispatch stays open (claim-first)", () => {
    const issue = readyIssue(s.svc, "svc-first");
    const open = s.prov.dispatch(issue.id, { workspace: s.dir });
    assert.equal(open.claimId, null);
    const labelled = s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "anyone" });
    assert.equal(labelled.participantId, "anyone");
  });
});

describe("A7-auth binding: dispatchToSpecialist pins identity without divergence", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("claimed binding carries the live claim, holder, and activation", () => {
    const issue = readyIssue(s.svc, "bind");
    const claim = s.svc.claimIssue(issue.id, "holder-A", { activationId: "act-1" });
    const { binding } = dispatchToSpecialist(s.svc, s.prov, {
      ref: issue.id, specialist: "executor", holder: "holder-A", activationId: "act-1",
      workspace: "/tmp/w", claimId: claim.id,
    });
    assert.equal(binding.claimId, claim.id);
    assert.equal(binding.participantId, "holder-A");
    assert.equal(binding.activationId, "act-1");
  });

  it("B dispatch through the full gate rejects", () => {
    const issue = readyIssue(s.svc, "bind-deny");
    s.svc.claimIssue(issue.id, "holder-A");
    assert.throws(
      () => dispatchToSpecialist(s.svc, s.prov, { ref: issue.id, specialist: "executor", holder: "holder-B", workspace: "/tmp/w" }),
      /live-held|holder\/activation mismatch/,
    );
  });

  it("unclaimed full dispatch binds without a claim", () => {
    const issue = readyIssue(s.svc, "bind-open");
    const { binding } = dispatchToSpecialist(s.svc, s.prov, {
      ref: issue.id, specialist: "executor", holder: "anyone", workspace: "/tmp/w",
    });
    assert.equal(binding.claimId, null);
    assert.equal(binding.participantId, "anyone");
  });
});

describe("A7-auth TOCTOU: check pin re-verified atomically before INSERT", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("claim generation change between check and dispatch rejects with no insert", () => {
    const issue = readyIssue(s.svc, "toctou-gen");
    s.svc.claimIssue(issue.id, "holder-A");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w" });
    assert.ok(check.expectedClaim !== null);
    // Rotate the claim: same holder, new generation + id.
    s.svc.releaseClaim(issue.id, "holder-A");
    const rotated = s.svc.claimIssue(issue.id, "holder-A");
    assert.notEqual(rotated.id, check.expectedClaim!.id);
    assert.throws(
      () => s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "holder-A" }, { expectedClaim: check.expectedClaim }),
      /live claim changed since check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
  });

  it("claim released (expected claim, now null) rejects with no insert", () => {
    const issue = readyIssue(s.svc, "toctou-release");
    s.svc.claimIssue(issue.id, "holder-A");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w" });
    s.svc.releaseClaim(issue.id, "holder-A");
    assert.equal(s.svc.getActiveClaim(issue.id), null);
    assert.throws(
      () => s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "holder-A" }, { expectedClaim: check.expectedClaim }),
      /live claim changed since check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
  });

  it("claim appearing after expected-null check rejects with no insert", () => {
    const issue = readyIssue(s.svc, "toctou-appear");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "anyone", workspace: "/tmp/w" });
    assert.equal(check.expectedClaim, null);
    // Same holder claims after the check so identity alone would pass;
    // the expected-null pin must still fail closed (retry path).
    s.svc.claimIssue(issue.id, "anyone");
    assert.throws(
      () => s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "anyone" }, { expectedClaim: null }),
      /appeared after check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
  });

  it("direct-service call with stale claimId rejects with no insert", () => {
    const issue = readyIssue(s.svc, "toctou-stale");
    const first = s.svc.claimIssue(issue.id, "holder-A");
    s.svc.releaseClaim(issue.id, "holder-A");
    const second = s.svc.claimIssue(issue.id, "holder-A");
    assert.notEqual(second.id, first.id);
    // No expectedClaim pin (direct-service path): stale claimId still fails.
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, claimId: first.id, participantId: "holder-A" }),
      /not the live claim/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
  });

  it("matching pin allows (no rotation)", () => {
    const issue = readyIssue(s.svc, "toctou-ok");
    s.svc.claimIssue(issue.id, "holder-A");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w" });
    const binding = s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "holder-A" }, { expectedClaim: check.expectedClaim });
    assert.equal(binding.claimId, check.expectedClaim!.id);
  });
});

describe("A7-auth TOCTOU revision: contract edit between check and dispatch binds nothing", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  function dispatchedCount(issueId: string): number {
    return s.svc.listEvents(issueId).filter((e) => e.type === "provenance.dispatched").length;
  }

  it("contract change between check and dispatch rejects with zero bindings and zero dispatched events", () => {
    const issue = readyIssue(s.svc, "toctou-rev");
    s.svc.claimIssue(issue.id, "holder-A");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "holder-A", workspace: "/tmp/w", requestedScope: ["a"] });
    assert.equal(s.prov.listBindings(issue.id).length, 0);
    assert.equal(dispatchedCount(issue.id), 0);
    // Rotate the contract and re-attest so the issue stays dispatchable
    // at rev 2: identity pins still match, only the revision pin differs.
    s.svc.updateContract(issue.id, contract({ problem: "rotated problem", success: "rotated success" }), "tester");
    s.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    assert.throws(
      () => s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "holder-A" }, {
        expectedClaim: check.expectedClaim,
        expectedRevision: check.revision,
        expectedContractHash: check.contractHash,
      }),
      /revision changed since check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
    assert.equal(dispatchedCount(issue.id), 0, "rejected dispatch appends no dispatched event");
  });

  it("stale revision pin without any mutation rejects with zero bindings and zero dispatched events", () => {
    const issue = readyIssue(s.svc, "toctou-stale-rev");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "anyone", workspace: "/tmp/w" });
    assert.throws(
      () => s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "anyone" }, {
        expectedClaim: check.expectedClaim,
        expectedRevision: check.revision + 1,
        expectedContractHash: check.contractHash,
      }),
      /revision changed since check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
    assert.equal(dispatchedCount(issue.id), 0, "rejected dispatch appends no dispatched event");
  });

  it("stale contract hash pin rejects with zero bindings and zero dispatched events", () => {
    const issue = readyIssue(s.svc, "toctou-stale-hash");
    const check = checkDispatch(s.svc, { ref: issue.id, specialist: "executor", holder: "anyone", workspace: "/tmp/w" });
    assert.throws(
      () => s.prov.dispatch(check.issueId, { workspace: s.dir, participantId: "anyone" }, {
        expectedClaim: check.expectedClaim,
        expectedRevision: check.revision,
        expectedContractHash: "0".repeat(64),
      }),
      /contract changed since check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0, "rejected dispatch writes no binding");
    assert.equal(dispatchedCount(issue.id), 0, "rejected dispatch appends no dispatched event");
  });
});
