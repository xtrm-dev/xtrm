// XTRM-671: the shared deterministic advisory catalogue. Table-driven so each
// rule is exercised in isolation, plus one snapshot over a live scratch DB.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { contract } from "./helpers.ts";
import {
  cooldownFile,
  evaluateIssue,
  evaluateOperation,
  loadCooldowns,
  resolveIdentity,
  saveCooldowns,
  selectAdvisory,
  snapshotIssue,
  type Identity,
  type IssueSnapshot,
} from "../src/presentation/advisories.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const me: Identity = { holder: "op", source: "env" };

function snap(over: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    ref: "XTRM-1",
    lifecycleState: "open",
    readinessState: "claimed",
    claim: { holder: "op", activationId: null, acquiredAt: NOW - 10 * 60_000, expiresAt: NOW + HOUR },
    journalSeq: 3,
    lastCheckpointSeq: 2,
    latestKind: "note",
    handoffsSinceClaim: 1,
    now: NOW,
    ...over,
  };
}

const codes = (s: IssueSnapshot, id: Identity = me, phase?: "tool" | "stop") => evaluateIssue(s, id, { phase }).map((a) => a.code);

describe("XTRM-671 identity resolution", () => {
  it("prefers SUBSTRATE_HOLDER, then the xt worktree name, never the shared session name", () => {
    assert.deepEqual(resolveIdentity({ SUBSTRATE_HOLDER: " wed-coord " }, "/x"), { holder: "wed-coord", source: "env" });
    assert.deepEqual(
      resolveIdentity({ XTRM_SESSION_NAME: "market-data" }, "/home/u/p/market-data/.xtrm/worktrees/market-data-xt-claude-wed-coord/src"),
      { holder: "wed-coord", source: "worktree" },
    );
    assert.deepEqual(resolveIdentity({ XTRM_SESSION_NAME: "market-data" }, "/home/u/p/market-data"), { holder: null, source: "none" });
  });
});

describe("XTRM-671 issue rules", () => {
  it("healthy claimed work is silent", () => assert.deepEqual(codes(snap()), []));
  it("terminal issues are silent", () => assert.deepEqual(codes(snap({ lifecycleState: "done", latestKind: "result" })), []));
  it("missing identity on a claimed issue names the holder to export", () => {
    const [a] = evaluateIssue(snap(), { holder: null, source: "none" });
    assert.equal(a?.code, "identity_missing");
    assert.match(a?.instruction ?? "", /export SUBSTRATE_HOLDER=op/);
  });
  it("another holder's claim", () => assert.deepEqual(codes(snap(), { holder: "b", source: "env" }), ["holder_mismatch"]));
  it("unclaimed draft asks for attestation; unclaimed ready asks for a claim", () => {
    assert.deepEqual(codes(snap({ claim: null, readinessState: "draft" })), ["attest_ready"]);
    assert.deepEqual(codes(snap({ claim: null, readinessState: "ready" })), ["claim_start"]);
    assert.deepEqual(codes(snap({ claim: null, readinessState: "blocked" })), []);
  });
  it("expiry: renew inside 20% of the TTL (5 min floor), expired after", () => {
    const acquiredAt = NOW - 4 * HOUR;
    assert.deepEqual(codes(snap({ claim: { holder: "op", activationId: null, acquiredAt, expiresAt: NOW + 40 * 60_000 } })), ["claim_renew"]);
    assert.deepEqual(codes(snap({ claim: { holder: "op", activationId: null, acquiredAt, expiresAt: NOW + 60 * 60_000 } })), []);
    assert.deepEqual(codes(snap({ claim: { holder: "op", activationId: null, acquiredAt: NOW - 14 * 60_000, expiresAt: NOW + 60_000 } })), ["claim_renew"]);
    assert.deepEqual(codes(snap({ claim: { holder: "op", activationId: null, acquiredAt, expiresAt: NOW - 60_000 } })), ["claim_expired"]);
  });
  it("a recorded result asks for closure", () => assert.deepEqual(codes(snap({ latestKind: "result" })), ["close_due"]));
  it("a draft revision under a claim asks for re-attestation", () => assert.deepEqual(codes(snap({ readinessState: "draft" })), ["revise_contract"]));
  it("eight entries since the checkpoint, or none ever, asks for a checkpoint", () => {
    assert.deepEqual(codes(snap({ journalSeq: 10, lastCheckpointSeq: 2 })), ["checkpoint_due"]);
    assert.deepEqual(codes(snap({ journalSeq: 2, lastCheckpointSeq: 0 })), []);
    assert.deepEqual(codes(snap({ journalSeq: 3, lastCheckpointSeq: 0 })), ["checkpoint_due"]);
  });
  it("handoff is due only at stop, only after 30 min without one", () => {
    const old = snap({ handoffsSinceClaim: 0, claim: { holder: "op", activationId: null, acquiredAt: NOW - HOUR, expiresAt: NOW + HOUR } });
    assert.deepEqual(codes(old), []);
    assert.deepEqual(codes(old, me, "stop"), ["handoff_due"]);
    assert.deepEqual(codes(snap({ handoffsSinceClaim: 0 }), me, "stop"), [], "fresh claim: too early");
  });
});

describe("XTRM-671 operation rules", () => {
  it("an anonymous write is flagged", () => {
    assert.deepEqual(evaluateOperation({ op: "journal_append", issueRef: "XTRM-1", kind: "note", participantId: null }).map((a) => a.code), ["identity_missing"]);
    assert.deepEqual(evaluateOperation({ op: "journal_append", issueRef: "XTRM-1", kind: "note", participantId: "op" }), []);
  });
  it("a completed close without result or evidence is flagged", () => {
    const fact = { op: "issue_close" as const, issueRef: "XTRM-1", outcome: "completed", resultRefs: 0, evidenceRefs: 0, participantId: "op" };
    assert.deepEqual(evaluateOperation(fact).map((a) => a.code), ["close_without_result"]);
    assert.deepEqual(evaluateOperation({ ...fact, resultRefs: 1 }), []);
    assert.deepEqual(evaluateOperation({ ...fact, outcome: "superseded" }), []);
  });
});

describe("XTRM-671 cooldowns", () => {
  it("selects the first advisory not cooling down and persists cooldowns per session", () => {
    const dir = mkdtempSync(join(tmpdir(), "adv-"));
    try {
      const list = evaluateIssue(snap({ latestKind: "result", journalSeq: 12, lastCheckpointSeq: 2 }), me);
      assert.deepEqual(list.map((a) => a.code), ["close_due", "checkpoint_due"]);
      const file = cooldownFile("sess/1", dir);
      const cd = loadCooldowns(file);
      assert.equal(selectAdvisory(list, cd, NOW)?.code, "close_due");
      saveCooldowns(file, cd);
      const cd2 = loadCooldowns(file);
      assert.equal(selectAdvisory(list, cd2, NOW + 60_000)?.code, "checkpoint_due", "close_due is cooling; next rule surfaces");
      assert.equal(selectAdvisory(list, cd2, NOW + 120_000), null);
      assert.equal(selectAdvisory(list, cd2, NOW + 21 * 60_000)?.code, "close_due", "cooldown elapsed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("XTRM-671 snapshot from live services", () => {
  it("reads claim, readiness, sequences and handoffs since the claim", () => {
    const dir = mkdtempSync(join(tmpdir(), "adv-db-"));
    const db = openSubstrate(join(dir, "state.db"));
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
      const i = svc.createIssue({ projectId: "prj_xtrm", title: "w", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "t" });
      svc.attestReadiness(i.id, { outcome: "ready", policy: "default", attestedBy: "t" });
      const journal = new JournalService(db, svc);
      journal.appendEntry(i.id, { kind: "handoff", semantic: { summary: "before the claim" } });
      svc.claimIssue(i.id, "op", { ttlMs: HOUR });
      journal.appendEntry(i.id, { kind: "handoff", semantic: { summary: "after the claim" } });
      journal.appendEntry(i.id, { kind: "note", semantic: { summary: "a note" } });
      const s = snapshotIssue(svc, journal, i.id);
      assert.equal(s.ref, i.humanRef);
      assert.equal(s.claim?.holder, "op");
      assert.equal(s.journalSeq, 3);
      assert.equal(s.lastCheckpointSeq, 0);
      assert.equal(s.latestKind, "note");
      assert.equal(s.handoffsSinceClaim, 1);
      assert.deepEqual(codes(s), ["checkpoint_due"]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
