// Hook parity acceptance (§54, bead xtrm-6qu.6): every retired Beads hook
// names its Substrate disposition, and each disposition is exercised live
// against a scratch database — not asserted statically.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { contract } from "./helpers.ts";
import { evaluateEditState, handleCommitCheck, handleEditGate, handleStopGate, isGitCommit } from "../integrations/claude-code/index.ts";
import { handlePreCompact } from "../integrations/claude-code/precompact.ts";
import { handleSessionStart } from "../integrations/claude-code/session-start.ts";
import { SessionBindings, evaluateEditGate as piEditGate, evaluateStopContinuity as piStop } from "../integrations/pi/handlers.ts";
import { discoverIssueRef } from "../integrations/claude-code/runtime.ts";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-parity-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "parity work",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  db.close();
  return { dir, dbPath, humanRef: issue.humanRef, issueId: issue.id };
}

describe("§54 hook parity", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("beads-edit-gate → substrate-edit-gate (claim + writer lease)", () => {
    assert.equal(handleEditGate({ cwd: s.dir, dbPath: s.dbPath }).allow, true, "unbound session edits freely");
    assert.equal(handleEditGate({ cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath }).allow, false, "bound issue without claim blocks");
    const db = openSubstrate(s.dbPath);
    try {
      new IssueService(db).claimIssue(s.issueId, "op");
    } finally {
      db.close();
    }
    assert.equal(handleEditGate({ cwd: s.dir, issueRef: s.humanRef, holder: "op", dbPath: s.dbPath }).allow, true, "claim holder allows");
    assert.equal(
      handleEditGate({ cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath }).allow,
      false,
      "live claim with missing holder is fail-closed",
    );
    assert.equal(
      handleEditGate({ cwd: s.dir, issueRef: s.humanRef, holder: "intruder", dbPath: s.dbPath }).allow,
      false,
      "holder B may not mutate holder A's claim",
    );
    assert.equal(
      evaluateEditState({
        issueRef: s.humanRef,
        claim: { holder: "op", activationId: "act-1" },
        claimed: true,
        holder: "op",
        activationId: "act-2",
      }).allow,
      false,
      "same holder under a different activation may not inherit the claim",
    );
    assert.equal(
      evaluateEditState({
        issueRef: s.humanRef,
        claim: { holder: "op", activationId: "act-1" },
        claimed: true,
        holder: "op",
        activationId: "act-1",
      }).allow,
      true,
      "same holder + activation allows",
    );
    assert.equal(
      evaluateEditState({ issueRef: s.humanRef, claim: { holder: "other", activationId: null }, claimed: true, holder: "op" }).allow,
      false,
      "foreign claim blocks despite presented holder",
    );
  });

  it("beads-commit-gate → provenance/commit check (nudge, never block)", () => {
    assert.equal(isGitCommit("git commit -m x"), true);
    assert.equal(isGitCommit("git status"), false);
    const plain = handleCommitCheck({ command: "git status", cwd: s.dir, dbPath: s.dbPath });
    assert.equal(plain.intercept, false);
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      assert.equal(handleCommitCheck({ command: "git commit -m x", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath }).nudge, null, "no claim → silent");
      const claim = svc.claimIssue(s.issueId, "op");
      const journal = new JournalService(db, svc);
      const prov = new ProvenanceService(db, svc, journal);
      const nudged = handleCommitCheck({ command: "git commit -m x", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      assert.equal(nudged.allow, true);
      assert.ok(nudged.nudge, "claim without dispatch nudges");
      const binding = prov.dispatch(s.issueId, { workspace: s.dir, claimId: claim.id, participantId: "op" });
      prov.allocateReceipt(binding.id);
      const quiet = handleCommitCheck({ command: "git commit -m x", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      assert.equal(quiet.allow, true);
      assert.equal(quiet.nudge, null, "open receipt silences the nudge");
    } finally {
      db.close();
    }
  });

  it("beads-claim-sync → native session/claim binding (no sync hook)", () => {
    const bindings = new SessionBindings();
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      svc.claimIssue(s.issueId, "op");
      assert.ok(svc.getActiveClaim(s.issueId), "claim is a DB row, visible to every surface without sync");
    } finally {
      db.close();
    }
    bindings.bind("sess-1", s.issueId);
    assert.equal(bindings.boundRef("sess-1"), s.issueId);
    writeFileSync(join(s.dir, ".substrate-issue"), s.humanRef + "\n");
    assert.equal(discoverIssueRef(s.dir), s.humanRef, ".substrate-issue file rebinds a fresh process");
  });

  it("beads-stop-gate → continuity gate (checkpoint, never block)", async () => {
    const silent = await handleStopGate({ cwd: s.dir, dbPath: s.dbPath });
    assert.equal(silent.continuity, null, "unbound stop is silent");
    const db = openSubstrate(s.dbPath);
    try {
      new IssueService(db).claimIssue(s.issueId, "op");
    } finally {
      db.close();
    }
    const gated = await handleStopGate({ cwd: s.dir, session_id: "sess-1", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(gated.allow, true, "stop never blocks: unfinished work stays open");
    assert.equal(gated.checkpointed, true, "stop without checkpoint writes one");
    assert.ok(gated.continuity?.includes(s.humanRef));
    const db2 = openSubstrate(s.dbPath);
    try {
      assert.ok(new JournalService(db2, new IssueService(db2)).listEntries(s.issueId, { kind: "checkpoint" }).length >= 1);
    } finally {
      db2.close();
    }
  });

  it("beads-compact-save → Journal mechanical checkpoint; beads-compact-restore → Resume Capsule", async () => {
    const pre = await handlePreCompact({ session_id: "sess-1", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(pre.continue, true);
    assert.ok(pre.entryId, "mechanical checkpoint row written");
    const post = handleSessionStart({ source: "compact", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.ok(post.additionalContext?.includes(s.humanRef), "compact SessionStart injects the resume capsule");
  });

  it("beads-status-cache → retired: bounded live queries, no second store", () => {
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      assert.equal(svc.listIssues("prj_xtrm").length, 1);
      svc.createIssue({ projectId: "prj_xtrm", title: "second", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "tester" });
      assert.equal(svc.listIssues("prj_xtrm").length, 2, "list reflects the live DB, never a stale cache");
    } finally {
      db.close();
    }
    const stray = readdirSync(s.dir).filter((f) => f.endsWith(".json"));
    assert.deepEqual(stray, [], "no cache file written beside the database");
  });

  it("beads-memory-gate → retired: separate memory architecture, stop never blocks", async () => {
    assert.equal((await handleStopGate({ cwd: s.dir, issueRef: "XTRM-999", dbPath: s.dbPath })).allow, true, "unknown ref fails open");
  });

  it("Pi extension carries the ported gates (§39)", () => {
    assert.equal(piEditGate({ issueRef: null }).allow, true);
    assert.equal(piEditGate({ issueRef: s.humanRef, claimed: false }).allow, false);
    assert.equal(piEditGate({ issueRef: s.humanRef, claim: { holder: "op", activationId: null }, claimed: true, holder: "op" }).allow, true);
    assert.equal(piEditGate({ issueRef: s.humanRef, claim: { holder: "a", activationId: null }, claimed: true, holder: "b" }).allow, false, "Pi gate: holder B blocked on A's claim");
    assert.equal(
      piEditGate({ issueRef: s.humanRef, claim: { holder: "op", activationId: "act-1" }, claimed: true, holder: "op", activationId: "act-2" }).allow,
      false,
      "Pi gate: same holder different activation blocked",
    );
    const cont = piStop({ issueRef: s.humanRef, claimed: true, holder: "op", checkpointsSinceClaim: 0, blockers: 1, handoffs: 0 });
    assert.equal(cont.needsCheckpoint, true);
    assert.ok(cont.continuity?.includes("sb issue resume"));
    assert.equal(piStop({ issueRef: null, claimed: false, checkpointsSinceClaim: 0, blockers: 0, handoffs: 0 }).continuity, null);
  });
});
