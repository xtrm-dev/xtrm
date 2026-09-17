// XTRM-252.13 / H1: hooks and stop gate against Journal/Closure semantics
// (ADR §§76-77). One file for the four contract VALIDATION clauses:
//
// - Noise: repeated hook invocations append no additional Journal entries.
// - PreCompact: mechanical checkpoint durable with actor/session identity;
//   a failing semantic summary leaves continuity valid.
// - Stop-gate matrix: active claim, unrecorded result, pending ask, missing
//   checkpoint, closure readiness — documented action each, never a false
//   completion.
// - Commit/provenance: receipt and commit bindings are created.
//
// Consumes J1 shapes, C1 readiness/closure, X1 envelope, and the XTRM-335
// drained write path; duplicates none of them. Plain `node --test` suite;
// every store is a scratch DB (TMPDIR-aware), never the live store.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { contract } from "./helpers.ts";
import { handlePreCompact } from "../integrations/claude-code/precompact.ts";
import { handleStopGate } from "../integrations/claude-code/stop-gate.ts";
import { handleCommitCheck } from "../integrations/claude-code/commit-check.ts";
import { handleEditGate } from "../integrations/claude-code/edit-gate.ts";
import { handleSessionStart } from "../integrations/claude-code/session-start.ts";
import { evaluateStopContinuity } from "../integrations/pi/handlers.ts";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-h1-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "h1 work",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  db.close();
  return { dir, dbPath, humanRef: issue.humanRef, issueId: issue.id };
}

function countEntries(dbPath: string, issueId: string): number {
  const db = openSubstrate(dbPath);
  try {
    const svc = new IssueService(db);
    return new JournalService(db, svc).listEntries(issueId).length;
  } finally {
    db.close();
  }
}

function claim(s: ReturnType<typeof scratch>, holder = "op") {
  const db = openSubstrate(s.dbPath);
  try {
    return new IssueService(db).claimIssue(s.issueId, holder);
  } finally {
    db.close();
  }
}

it("compact and stop checkpoints retain ambient activation (XTRM-435)", async () => {
  const s = scratch();
  const keys = ["XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"];
  const prior = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    process.env["SUBSTRATE_HOLDER"] = "op";
    process.env["SUBSTRATE_ACTIVATION_ID"] = "act:23b2212a-c44";
    claim(s);
    const input = { cwd: s.dir, session_id: "claude-session", issueRef: s.humanRef, dbPath: s.dbPath };
    const stop = await handleStopGate(input);
    assert.equal(stop.checkpointed, true);
    const compact = await handlePreCompact(input);
    assert.ok(compact.entryId, compact.reason);
    const db = openSubstrate(s.dbPath);
    try {
      const rows = db.prepare("SELECT participant_id, activation_id, execution_context_json FROM issue_journal WHERE issue_id = ? AND kind IN ('checkpoint', 'compaction')").all(s.issueId) as Array<{
        participant_id: string | null; activation_id: string | null; execution_context_json: string;
      }>;
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.participant_id, "op");
        assert.equal(row.activation_id, "act:23b2212a-c44");
        assert.deepEqual(JSON.parse(row.execution_context_json).host, { type: "claude", sessionId: "claude-session" });
      }
    } finally { db.close(); }
  } finally {
    keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; });
    rmSync(s.dir, { recursive: true, force: true });
  }
});

// ---- VALIDATION 1: noise ----------------------------------------------------

describe("H1 noise: repeated hook invocations append no Journal entries", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("read-only hooks never write, with or without a live claim", async () => {
    claim(s);
    const before = countEntries(s.dbPath, s.issueId);
    for (let i = 0; i < 3; i++) {
      handleCommitCheck({ command: "git commit -m x", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      handleEditGate({ cwd: s.dir, issueRef: s.humanRef, holder: "op", dbPath: s.dbPath });
      handleSessionStart({ source: "compact", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      await handleStopGate({ cwd: s.dir, dbPath: s.dbPath }); // unbound: silent
    }
    assert.equal(countEntries(s.dbPath, s.issueId), before, "commit-check / edit-gate / session-start / unbound stop append nothing");
  });

  it("stop gate writes at most one checkpoint, then goes quiet", async () => {
    claim(s);
    const before = countEntries(s.dbPath, s.issueId);
    const first = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(first.checkpointed, true, "first stop with no checkpoint writes exactly one (J1 checkpoint kind, not a generic entry)");
    assert.equal(countEntries(s.dbPath, s.issueId), before + 1);
    for (let i = 0; i < 3; i++) {
      const again = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
      assert.equal(again.checkpointed, false, "continuity secured: later stops write nothing");
    }
    assert.equal(countEntries(s.dbPath, s.issueId), before + 1, "repeated stops converge, never one entry per invocation");
    const db = openSubstrate(s.dbPath);
    try {
      const kinds = new JournalService(db, new IssueService(db)).listEntries(s.issueId).map((e) => e.kind);
      assert.ok(!kinds.includes("note"), "no generic note entry was used as a hook marker");
    } finally {
      db.close();
    }
  });
});

// ---- VALIDATION 2: precompact -----------------------------------------------

describe("H1 precompact: mechanical-first checkpoint with actor/session identity", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
    delete process.env["XTRM_SESSION_ID"];
    delete process.env["XTRM_SESSION_NAME"];
  });

  it("checkpoint carries actor and session identity", async () => {
    claim(s);
    process.env["XTRM_SESSION_ID"] = "01a0ac95-8370-74c5-9081-4490653e7107";
    process.env["XTRM_SESSION_NAME"] = "h1-run";
    const pre = await handlePreCompact({
      session_id: "claude-sess-1",
      cwd: s.dir,
      issueRef: s.humanRef,
      dbPath: s.dbPath,
      actor: { type: "agent", name: "op" },
      participantId: "op",
    });
    assert.equal(pre.continue, true, "compaction always proceeds");
    assert.ok(pre.entryId, "mechanical checkpoint row written");
    const db = openSubstrate(s.dbPath);
    try {
      const journal = new JournalService(db, new IssueService(db));
      const entry = journal.latest(s.issueId, { kind: "compaction" });
      assert.ok(entry?.mechanical, "mechanical payload durable");
      // X1 projection: the XTRM session is the queryable flat identity;
      // the provider session is preserved in the envelope host leg (§98).
      assert.equal(entry.sessionId, "01a0ac95-8370-74c5-9081-4490653e7107", "flat session column carries the XTRM session");
      assert.equal(entry.executionContext?.actor?.type, "agent", "actor identity carried in the X1 envelope");
      assert.equal(entry.executionContext?.actor?.name, "op");
      assert.equal(entry.executionContext?.participantId, "op", "participant carried, never confused with the session id");
      assert.equal(entry.executionContext?.host?.sessionId, "claude-sess-1");
      assert.equal(entry.executionContext?.xtrmSessionId, "01a0ac95-8370-74c5-9081-4490653e7107", "R4 env session enriched automatically");
      assert.equal(entry.executionContext?.xtrmSessionName, "h1-run");
    } finally {
      db.close();
    }
  });

  it("a failing semantic summary leaves continuity valid", async () => {
    claim(s);
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      const journal = new JournalService(db, svc);
      const result = await journal.compactionCheckpoint(s.issueId, {
        kind: "compaction",
        sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
        executionContext: null,
        summarizer: () => {
          throw new Error("summarizer exploded");
        },
      });
      assert.equal(result.degraded, true, "failed summary degrades, never blocks");
      assert.ok(result.entry, "mechanical row durable before the summarizer ran");
      assert.ok(result.entry.mechanical, "mechanical payload present without any semantic");
      assert.equal(result.entry.sessionId, "01a0ac95-8370-74c5-9081-4490653e7109");
      // Continuity valid: the checkpoint renders and anchors a resume capsule.
      const rendered = journal.renderCheckpoint(result.entry);
      assert.match(rendered, /mechanical-only/);
      const latest = journal.latestCheckpoint(s.issueId);
      assert.equal(latest?.id, result.entry.id, "degraded checkpoint still anchors resume");
    } finally {
      db.close();
    }
  });
});

// ---- VALIDATION 3: stop-gate matrix ------------------------------------------

describe("H1 stop gate: §77 scenario matrix, never a false completion", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  function served() {
    const db = openSubstrate(s.dbPath);
    return { db, svc: new IssueService(db), journal: new JournalService(db, new IssueService(db)) };
  }

  function assertStillOpen(dbPath: string, issueId: string) {
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      assert.equal(svc.getIssue(issueId).lifecycleState, "open", "the gate never closes the issue (no fake completion)");
      assert.equal(new ClosureService(db, svc).getLatestClosure(issueId), null, "no Closure row without the close path");
    } finally {
      db.close();
    }
  }

  it("no claim → silent", async () => {
    const r = await handleStopGate({ cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(r.allow, true);
    assert.equal(r.action, "silent");
    assert.equal(r.continuity, null);
    assert.equal(r.signals, null);
    assert.equal(countEntries(s.dbPath, s.issueId), 0, "silent stop writes nothing");
  });

  it("active claim, missing checkpoint → checkpointed, may end unfinished", async () => {
    claim(s);
    const r = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(r.allow, true, "unfinished work may end");
    assert.equal(r.action, "checkpointed");
    assert.equal(r.checkpointed, true);
    assert.equal(r.signals?.checkpointsSinceClaim, 0);
    assert.equal(r.signals?.resultsSinceClaim, 0, "unrecorded result signal");
    assert.match(r.continuity ?? "", /no meaningful result recorded/);
    assertStillOpen(s.dbPath, s.issueId);
  });

  it("active claim with checkpoint, unrecorded result → continuity", async () => {
    claim(s);
    const { db, journal } = served();
    try {
      await journal.checkpoint(s.issueId, { sessionId: "01a0ac95-8370-74c5-9081-4490653e7101" });
    } finally {
      db.close();
    }
    const r = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(r.allow, true);
    assert.equal(r.action, "continuity");
    assert.equal(r.checkpointed, false, "checkpoint exists: write nothing more");
    assert.equal(r.signals?.handoffsSinceClaim, 0, "missing handoff signal");
    assert.match(r.continuity ?? "", /no handoff since claim/);
    assert.match(r.continuity ?? "", /work stays open/);
    assertStillOpen(s.dbPath, s.issueId);
  });

  it("pending Specialist asks are named, never completed over", async () => {
    claim(s);
    const { db, journal } = served();
    try {
      await journal.checkpoint(s.issueId, { sessionId: "01a0ac95-8370-74c5-9081-4490653e7101", pendingAsks: ["specialist: confirm scope of X"] });
    } finally {
      db.close();
    }
    const r = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(r.allow, true);
    assert.deepEqual(r.signals?.pendingAsks, ["specialist: confirm scope of X"]);
    assert.equal(r.signals?.closureReady, false, "pending asks block the closure-ready path");
    assert.match(r.continuity ?? "", /pending Specialist asks/);
    assertStillOpen(s.dbPath, s.issueId);
  });

  it("recorded result, nothing pending → closure-ready, still never closes", async () => {
    claim(s);
    const { db, journal } = served();
    try {
      await journal.checkpoint(s.issueId, { sessionId: "01a0ac95-8370-74c5-9081-4490653e7101" });
      journal.appendEntry(s.issueId, { kind: "result", result: { summary: "done", outcome: "PASS" } });
    } finally {
      db.close();
    }
    const r = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(r.allow, true);
    assert.equal(r.action, "closure-ready");
    assert.equal(r.signals?.resultsSinceClaim, 1);
    assert.equal(r.signals?.closureReady, true);
    assert.match(r.continuity ?? "", /result → validation\/provenance/);
    assert.match(r.continuity ?? "", /sb issue close/);
    assert.match(r.continuity ?? "", /never closes for you/);
    assertStillOpen(s.dbPath, s.issueId);
  });

  it("an open receipt blocks the closure-ready advice until provenance is bound", async () => {
    claim(s);
    const { db, svc, journal } = served();
    const prov = new ProvenanceService(db, svc, journal);
    let bindingId = "";
    try {
      await journal.checkpoint(s.issueId, { sessionId: "01a0ac95-8370-74c5-9081-4490653e7101" });
      journal.appendEntry(s.issueId, { kind: "result", result: { summary: "done", outcome: "PASS" } });
      // Dispatch + allocate a receipt and leave it unfinalized: the work looks
      // finished but its provenance is not bound yet.
      const binding = prov.dispatch(s.issueId, { workspace: s.dir, participantId: "op" });
      bindingId = binding.id;
      prov.allocateReceipt(bindingId);
    } finally {
      db.close();
    }
    const r = await handleStopGate({ cwd: s.dir, session_id: "01a0ac95-8370-74c5-9081-4490653e7101", issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(r.allow, true, "the gate still never blocks");
    assert.equal(r.signals?.openReceipts, 1, "the open receipt is surfaced");
    assert.equal(r.signals?.closureReady, false, "an open receipt is not closure-ready");
    assert.notEqual(r.action, "closure-ready");
    assert.match(r.continuity ?? "", /receipt\(s\) are still open/);
    assertStillOpen(s.dbPath, s.issueId);
  });

  it("release/retain per policy: default retains, opt-in releases the holder claim", async () => {
    claim(s, "op");
    const keep = await handleStopGate({ cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(keep.claimReleased, false, "default retains the claim");
    const db = openSubstrate(s.dbPath);
    try {
      assert.ok(new IssueService(db).getActiveClaim(s.issueId), "claim survives a retaining stop");
    } finally {
      db.close();
    }
    const rel = await handleStopGate({ cwd: s.dir, issueRef: s.humanRef, holder: "op", releaseClaim: true, dbPath: s.dbPath });
    assert.equal(rel.allow, true);
    assert.equal(rel.claimReleased, true, "policy release stops one execution");
    const db2 = openSubstrate(s.dbPath);
    try {
      assert.equal(new IssueService(db2).getActiveClaim(s.issueId), null, "claim released");
    } finally {
      db2.close();
    }
    assertStillOpen(s.dbPath, s.issueId);
  });

  it("Pi continuity carries the same §77 actions", () => {
    assert.equal(evaluateStopContinuity({ issueRef: null, claimed: false, checkpointsSinceClaim: 0, blockers: 0, handoffs: 0 }).action, "silent");
    const unfinished = evaluateStopContinuity({ issueRef: s.humanRef, claimed: true, holder: "op", checkpointsSinceClaim: 0, blockers: 0, handoffs: 0 });
    assert.equal(unfinished.action, "checkpointed");
    assert.equal(unfinished.needsCheckpoint, true);
    const ready = evaluateStopContinuity({
      issueRef: s.humanRef, claimed: true, holder: "op", checkpointsSinceClaim: 2, blockers: 0, handoffs: 1,
      resultsSinceClaim: 1, pendingAsks: [], closureReady: true,
    });
    assert.equal(ready.action, "closure-ready");
    assert.match(ready.continuity ?? "", /never closes for you/);
  });
});

// ---- VALIDATION 4: commit/provenance ------------------------------------------

describe("H1 commit/provenance: receipt and commit bindings are created", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("dispatch → receipt → trailers → bindCommit, the exact hook-adapter sequence", () => {
    const sha = "a".repeat(40);
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      const journal = new JournalService(db, svc);
      const prov = new ProvenanceService(db, svc, journal);
      // …so the session claims, then dispatches (the service pins claim+revision+hash).
      const claimRow = svc.claimIssue(s.issueId, "op");
      const nudged = handleCommitCheck({ command: "git commit -m x", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      assert.ok(nudged.nudge, "claim without dispatch nudges before commit");
      const binding = prov.dispatch(s.issueId, { workspace: s.dir, claimId: claimRow.id, participantId: "op" });
      assert.ok(binding.id, "ExecutionBinding created");
      // Receipt allocated for the in-flight commit (post-commit finalizes it).
      const receipt = prov.allocateReceipt(binding.id);
      assert.equal(receipt.commitSha, null, "receipt open before the commit lands");
      // prepare-commit-msg attaches trailers to the message under edit.
      const trailered = prov.trailersForCommit(receipt.id, "do the work\n");
      assert.match(trailered, new RegExp(receipt.id), "trailers name the receipt");
      // post-commit binds the exact SHA git just created.
      const bound = prov.bindCommit(receipt.id, sha);
      assert.equal(bound.commitSha, sha, "receipt finalized to the commit SHA");
      assert.equal(prov.listReceipts(s.issueId).filter((r) => r.commitSha === sha).length, 1);
      const bindings = prov.listBindings(s.issueId);
      assert.ok(bindings.some((b) => b.id === binding.id), "dispatch binding retained beside the receipt");
      // The nudge goes quiet once provenance context exists for the next commit.
      const receipt2 = prov.allocateReceipt(binding.id);
      assert.equal(receipt2.commitSha, null);
      const quiet = handleCommitCheck({ command: "git commit -m x", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      assert.equal(quiet.allow, true);
      assert.equal(quiet.nudge, null, "open receipt silences the nudge; the gate never blocks");
    } finally {
      db.close();
    }
  });
});
