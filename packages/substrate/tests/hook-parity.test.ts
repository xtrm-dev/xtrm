// Hook parity acceptance (§54, bead xtrm-6qu.6): every retired Beads hook
// names its Substrate disposition, and each disposition is exercised live
// against a scratch database — not asserted statically.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { contract, tempDir } from "./helpers.ts";
import { evaluateEditState, handleCommitCheck, handleEditGate, handleStopGate, isGitCommit } from "../integrations/claude-code/index.ts";
import { handlePreCompact } from "../integrations/claude-code/precompact.ts";
import { handleSessionStart } from "../integrations/claude-code/session-start.ts";
import { SessionBindings, evaluateEditGate as piEditGate, evaluateStopContinuity as piStop } from "../integrations/pi/handlers.ts";
import { discoverIssueRef } from "../integrations/claude-code/runtime.ts";

function scratch() {
  const dir = tempDir("substrate-parity-");
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

  it("beads-edit-gate → substrate-edit-gate (live claim only)", () => {
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
    // XTRM-969: a closed binding is not a missing claim, and neither gate may
    // answer a closed issue with "claim it". Both name the ref, the state and
    // the command that rebinds — the two surfaces must not diverge here. One
    // structural input type covers both gates, so the loop needs no cast.
    type GateInput = {
      issueRef: string | null;
      lifecycleState?: "done" | "cancelled" | "archived" | null;
      displayRef?: string | null;
      claim?: { holder: string; activationId: string | null } | null;
      claimed?: boolean;
      holder?: string | null;
      activationId?: string | null;
    };
    const gates: Array<[string, (state: GateInput) => { allow: boolean; reason?: string | null }]> = [
      ["Pi", piEditGate],
      ["Claude", evaluateEditState],
    ];
    for (const [name, gate] of gates) {
      const dead = gate({ issueRef: s.issueId, displayRef: s.humanRef, lifecycleState: "done", claimed: false });
      assert.equal(dead.allow, false, `${name} gate refuses a closed binding without a claim`);
      const reason = dead.reason ?? "";
      assert.match(reason, new RegExp(s.humanRef), `${name} gate names the human ref`);
      assert.doesNotMatch(reason, /iss_/, `${name} gate never shows a machine id alone`);
      assert.match(reason, /\bdone\b/, `${name} gate names the lifecycle state`);
      assert.match(reason, /sb issue claim/, `${name} gate names the command that rebinds`);
      const claimedDead = gate({ issueRef: s.issueId, displayRef: s.humanRef, lifecycleState: "done", claim: { holder: "op", activationId: null }, claimed: true, holder: "op" });
      assert.equal(claimedDead.allow, false, `${name} gate: a live claim cannot authorise a closed issue`);
      // No human ref supplied: the machine id must not become the message.
      const bare = gate({ issueRef: s.issueId, lifecycleState: "done", claimed: false });
      const bareReason = bare.reason ?? "";
      assert.equal(bare.allow, false, `${name} gate still refuses a closed binding with no display ref`);
      assert.doesNotMatch(bareReason, /iss_/, `${name} gate: no machine id when the human ref is unknown`);
      assert.match(bareReason, /\bdone\b/, `${name} gate: the state still carries the meaning`);
      assert.match(bareReason, /sb issue claim/, `${name} gate: the remedy survives a missing ref`);
      // The command the operator is meant to paste must stay a placeholder: with
      // only a machine id, `sb issue claim this issue` claims nothing.
      assert.match(bareReason, /sb issue claim <ref>/, `${name} gate: the remedy keeps a <ref> placeholder`);
      assert.doesNotMatch(bareReason, /claim this issue/, `${name} gate: prose must not leak into the command`);
      // A non-machine issueRef is its own display: the human ref reaches the message
      // even when no displayRef was supplied, so dropping that fallback is visible.
      const humanOnly = gate({ issueRef: s.humanRef, lifecycleState: "done", claimed: false });
      assert.match(humanOnly.reason ?? "", new RegExp(s.humanRef), `${name} gate: a human ref needs no displayRef`);

      // XTRM-969 rev 2, SUCCESS: the ordering is settled by the case where the two
      // orderings differ observably — a live claim held by ANOTHER holder under a
      // closed issue. Shipped order answers with the state; claim-first would answer
      // `holder … may not mutate`.
      const foreignLive = gate({
        issueRef: s.issueId,
        displayRef: s.humanRef,
        lifecycleState: "done",
        claim: { holder: "other", activationId: null },
        claimed: true,
        holder: "op",
      });
      assert.equal(foreignLive.allow, false, `${name} gate: a foreign live claim cannot authorise a closed issue`);
      assert.match(foreignLive.reason ?? "", /\bdone\b/, `${name} gate: the closed-issue reason precedes the holder check`);
      assert.doesNotMatch(foreignLive.reason ?? "", /may not mutate/, `${name} gate: the claim check does not answer first`);

      // The same state with no human ref: neither gate may print the machine id it
      // holds, which is what the two surfaces diverged on.
      const foreignBare = gate({ issueRef: s.issueId, claim: { holder: "other", activationId: null }, claimed: true, holder: "op" });
      assert.equal(foreignBare.allow, false, `${name} gate refuses a foreign claim with no display ref`);
      assert.doesNotMatch(foreignBare.reason ?? "", /iss_/, `${name} gate: no machine id on the holder path`);
      assert.match(foreignBare.reason ?? "", /may not mutate/, `${name} gate: the holder refusal still reads as one`);

      const unclaimedBare = gate({ issueRef: s.issueId, claimed: false });
      assert.doesNotMatch(unclaimedBare.reason ?? "", /iss_/, `${name} gate: no machine id on the unclaimed path`);
      assert.match(unclaimedBare.reason ?? "", /sb issue claim <ref>/, `${name} gate: the unclaimed remedy is pasteable`);
    }
    const cont = piStop({ issueRef: s.humanRef, claimed: true, holder: "op", checkpointsSinceClaim: 0, blockers: 1, handoffs: 0 });
    assert.equal(cont.needsCheckpoint, true);
    assert.ok(cont.continuity?.includes("sb issue resume"));
    assert.equal(piStop({ issueRef: null, claimed: false, checkpointsSinceClaim: 0, blockers: 0, handoffs: 0 }).continuity, null);
  });
});
