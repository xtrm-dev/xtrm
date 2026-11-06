// X1 Shared ExecutionContext (XTRM-252.6 / XTRM-258, ADR sbcloseout4
// §§33-37, 57, 97-98): envelope validation, migration/legacy rollout,
// write/read storage, retry/resume, §97 automatic propagation (R4 env →
// Pi/Claude → Journal), coordinator→Specialist lineage with receipt
// inheritance, and joint §98 no-fabrication.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { migrate } from "../src/store/migrations/runner.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import {
  canonicalizeWriteIdentity,
  IdentityFormatError,
  enrichExecutionContext,
  executionContextFromLegacy,
  normalizeExecutionContext,
  projectFlatIdentity,
  validateExecutionContext,
  EXECUTION_CONTEXT_VERSION,
  XTRM_SESSION_ID_ENV,
  XTRM_SESSION_NAME_ENV,
} from "../src/domain/execution-context.ts";
import { dispatchToSpecialist } from "../src/workitems/dispatch-gate.ts";
import { openBacking, type Backing } from "../integrations/pi/backing.ts";
import { toolJournalAppend, toolJournalCheckpoint, runBeforeCompact } from "../integrations/pi/handlers.ts";
import { handlePreCompact } from "../integrations/claude-code/precompact.ts";
import { contract } from "./helpers.ts";

const ENV_ID = "01a0ac95-8370-74c5-9081-4490653e7e92";
const ENV_NAME = "x1-r4-session";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-x1-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  return { dir, dbPath, db, svc };
}

function readyIssue(svc: IssueService, title = "x1 work", holder = "coord-holder", activationId?: string) {
  const issue = svc.createIssue({
    projectId: "prj_xtrm", title, kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW", authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  const claim = svc.claimIssue(issue.id, holder, activationId ? { activationId } : undefined);
  return { issue, claim };
}

let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = {
    [XTRM_SESSION_ID_ENV]: process.env[XTRM_SESSION_ID_ENV],
    [XTRM_SESSION_NAME_ENV]: process.env[XTRM_SESSION_NAME_ENV],
  };
  delete process.env[XTRM_SESSION_ID_ENV];
  delete process.env[XTRM_SESSION_NAME_ENV];
});
afterEach(() => {
  for (const k of [XTRM_SESSION_ID_ENV, XTRM_SESSION_NAME_ENV]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("X1 envelope: version, closed fields, presence/absence", () => {
  it("missing version normalizes to v1; null/undefined input normalizes to null", () => {
    assert.equal(normalizeExecutionContext({ participantId: "p" })?.version, EXECUTION_CONTEXT_VERSION);
    assert.equal(normalizeExecutionContext(null), null);
    assert.equal(normalizeExecutionContext(undefined), null);
    assert.deepEqual(validateExecutionContext(null), []);
  });

  it("unknown explicit versions fail closed", () => {
    assert.match(validateExecutionContext({ version: 2 })[0] ?? "", /version 2 is unknown/);
    assert.throws(() => normalizeExecutionContext({ version: 2 }), /version 2 is unknown/);
    assert.throws(() => normalizeExecutionContext({ version: "1" }), /unknown/);
  });

  it("unknown fields fail closed at every level", () => {
    assert.ok(validateExecutionContext({ bogus: 1 }).some((p) => p.includes("executionContext.bogus")));
    assert.ok(validateExecutionContext({ actor: { type: "human", rank: "x" } }).some((p) => p.includes("actor.rank")));
    assert.ok(validateExecutionContext({ host: { type: "pi", dc: "x" } }).some((p) => p.includes("host.dc")));
    assert.ok(validateExecutionContext({ specialist: { name: "s", foo: 1 } }).some((p) => p.includes("specialist.foo")));
    assert.ok(validateExecutionContext({ workspace: { branch: "b", foo: 1 } }).some((p) => p.includes("workspace.foo")));
  });

  it("actor.type stays the bounded §33 vocabulary; host.type stays an open trusted label", () => {
    assert.ok(validateExecutionContext({ actor: { type: "manager" } }).some((p) => p.includes("actor.type")));
    for (const t of ["human", "coordinator", "agent", "specialist", "reviewer", "validator", "hook", "runtime", "system"]) {
      assert.deepEqual(validateExecutionContext({ actor: { type: t } }), []);
    }
    // No ADR host vocabulary exists: any trusted non-empty label is accepted.
    assert.deepEqual(validateExecutionContext({ host: { type: "pi", sessionId: "s" } }), []);
    assert.deepEqual(validateExecutionContext({ host: { type: "custom-runner", sessionId: "s" } }), []);
    assert.ok(validateExecutionContext({ host: { type: "" } }).some((p) => p.includes("host.type")));
    assert.ok(validateExecutionContext({ host: { sessionId: "s" } }).some((p) => p.includes("host.type")));
  });

  it("present-but-blank strings are rejected as invalid; null/undefined means absent", () => {
    assert.throws(() => normalizeExecutionContext({ participantId: "  " }), /non-empty string/);
    assert.throws(() => normalizeExecutionContext({ xtrmSessionId: "" }), /non-empty string/);
    assert.throws(() => normalizeExecutionContext({ host: { type: "pi", sessionId: " " } }), /non-empty string/);
    assert.throws(() => normalizeExecutionContext({ coordinator: { participantId: " " } }), /non-empty string/);
    assert.throws(() => normalizeExecutionContext({ coordinator: { scope: "x" } as never }), /coordinator.scope/);
    const out = normalizeExecutionContext({ participantId: null, host: undefined, coordinator: null });
    assert.equal(out?.participantId, undefined);
    assert.equal(out?.host, undefined);
    assert.equal(out?.coordinator, undefined);
    // Known host type with no session is legitimate partial knowledge.
    assert.deepEqual(normalizeExecutionContext({ host: { type: "pi" } })?.host, { type: "pi" });
  });
});

describe("X1 enrich: R4 env only, null when nothing known", () => {
  it("reads the exact R4 variables and nothing else", () => {
    process.env[XTRM_SESSION_ID_ENV] = ENV_ID;
    process.env[XTRM_SESSION_NAME_ENV] = ENV_NAME;
    const out = enrichExecutionContext({ host: { type: "pi", sessionId: "pi-s" } }, process.env, { now: 1000 });
    assert.equal(out?.xtrmSessionId, ENV_ID);
    assert.equal(out?.xtrmSessionName, ENV_NAME);
    assert.equal(out?.timestamp, 1000);
  });

  it("returns null when env and typed fields are all unavailable", () => {
    assert.equal(enrichExecutionContext(null, {}), null);
    assert.equal(enrichExecutionContext({ participantId: null, host: null }, {}), null);
  });

  it("explicit typed input wins over env; never mints activation/participant", () => {
    const out = enrichExecutionContext(
      { xtrmSessionId: "typed-id", participantId: "typed-p" },
      { [XTRM_SESSION_ID_ENV]: "env-id", [XTRM_SESSION_NAME_ENV]: "env-name" },
      { now: 5 },
    );
    assert.equal(out?.xtrmSessionId, "typed-id");
    assert.equal(out?.xtrmSessionName, "env-name");
    assert.equal(out?.participantId, "typed-p");
    assert.equal(out?.specialist, undefined);
  });
});

describe("X1 migration 010: forward, idempotent, legacy rows", () => {
  it("fresh migrate lands v10 with both envelope columns; re-migrate is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-x1-mig-"));
    try {
      const dbPath = join(dir, "state.db");
      const db = openSubstrate(dbPath);
      const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
      assert.ok(versions.some((r) => r.version === 10));
      for (const t of ["execution_bindings", "issue_journal"]) {
        const cols = db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>;
        assert.ok(cols.some((c) => c.name === "execution_context_json"), `${t} carries the envelope column`);
      }
      const again = migrate(db);
      assert.ok(again.includes(10), "re-migrate replays the ledger without rewriting");
      db.close();
      const db2 = openSubstrate(dbPath);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies forward onto a v9-schema database", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-x1-mig9-"));
    try {
      const dbPath = join(dir, "state.db");
      const db = openSubstrate(dbPath);
      db.exec("ALTER TABLE execution_bindings DROP COLUMN execution_context_json");
      db.exec("ALTER TABLE issue_journal DROP COLUMN execution_context_json");
      db.prepare("DELETE FROM schema_migrations WHERE version = 10").run();
      db.close();
      const reopened = openSubstrate(dbPath);
      const cols = reopened.prepare("PRAGMA table_info(issue_journal)").all() as Array<{ name: string }>;
      assert.ok(cols.some((c) => c.name === "execution_context_json"), "010 re-applied forward from v9 state");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("legacy rows (NULL envelope) hydrate without fabricating time or identity", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc);
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      // Pre-010 shaped writes: legacy flat columns only, envelope NULL.
      s.db.prepare(
        `INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, run_id, participant_id,
          activation_id, session_id, kind, mechanical_json, semantic_json, result_json, refs_json,
          execution_context_json, created_at)
         VALUES ('jrn_legacy1', ?, 1, 1, NULL, 'holder-1', 'act-9', 'sess-9', 'finding',
          NULL, '{"summary":"legacy"}', NULL, '[]', NULL, 4242)`,
      ).run(issue.id);
      s.db.prepare(
        `INSERT INTO execution_bindings (id, issue_id, issue_revision, contract_hash, resolved_context_hash,
          claim_id, participant_id, activation_id, attempt_id, session_id, workspace, base_commit,
          execution_context_json, created_at)
         VALUES ('exb_legacy1', ?, 1, 'h', 'rh', NULL, 'holder-1', 'act-9', 'att-9', 'sess-9',
          '/tmp/w', NULL, NULL, 8484)`,
      ).run(issue.id);
      const entry = journal.getEntry("jrn_legacy1");
      assert.equal(entry.executionContext?.version, 1, "missing legacy version reads as v1");
      assert.equal(entry.executionContext?.timestamp, 4242, "timestamp is the durable row createdAt, not the clock");
      assert.equal(entry.executionContext?.participantId, "holder-1");
      assert.equal(entry.executionContext?.specialist?.activationId, "act-9");
      const binding = prov.getBinding("exb_legacy1");
      assert.equal(binding.executionContext?.version, 1);
      assert.equal(binding.executionContext?.timestamp, 8484);
      assert.equal(binding.executionContext?.specialist?.attemptId, "att-9");
      assert.equal(binding.executionContext?.workspace?.worktree, "/tmp/w", "flat checkout maps to worktree, not repoPath");
      // Nothing known at all stays null rather than an empty envelope.
      assert.equal(executionContextFromLegacy({}), null);
      s.db.prepare(
        `INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, run_id, participant_id,
          activation_id, session_id, kind, mechanical_json, semantic_json, result_json, refs_json,
          execution_context_json, created_at)
         VALUES ('jrn_legacy2', ?, 1, 2, NULL, NULL, NULL, NULL, 'note',
          NULL, NULL, NULL, '[]', NULL, 9999)`,
      ).run(issue.id);
      assert.equal(journal.getEntry("jrn_legacy2").executionContext, null);
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("X1 storage: envelope write/read with flat projection agreement", () => {
  it("dispatch persists the envelope; flat columns agree with the projection", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "x1 storage", "coord-holder", "act-1");
      const prov = new ProvenanceService(s.db, s.svc);
      const ctx = {
        version: 1, participantId: "coord-holder", xtrmSessionId: ENV_ID, xtrmSessionName: ENV_NAME,
        host: { type: "pi", sessionId: "pi-sess-1" }, runId: "run-1",
        specialist: { name: "builder", activationId: "act-1", attemptId: "att-1" },
        workspace: { repoPath: s.dir, branch: "main" },
      };
      const b = prov.dispatch(issue.id, { workspace: s.dir, participantId: "coord-holder", executionContext: ctx });
      assert.deepEqual(b.executionContext?.xtrmSessionId, ENV_ID);
      assert.deepEqual(b.executionContext?.specialist, { name: "builder", activationId: "act-1", attemptId: "att-1" });
      const reread = prov.getBinding(b.id);
      assert.deepEqual(reread.executionContext, b.executionContext);
      const flat = projectFlatIdentity(reread.executionContext, {});
      assert.equal(reread.participantId, flat.participantId);
      assert.equal(reread.activationId, flat.activationId);
      assert.equal(reread.attemptId, flat.attemptId);
      assert.equal(reread.sessionId, flat.sessionId);
      const raw = s.db.prepare("SELECT execution_context_json AS j FROM execution_bindings WHERE id = ?").get(b.id) as { j: string };
      assert.ok((JSON.parse(raw.j) as { version: number }).version === 1);
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("journal append requires envelope/legacy agreement; equal values are allowed", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc);
      const journal = new JournalService(s.db, s.svc);
      const e = journal.appendEntry(issue.id, {
        kind: "finding",
        participantId: "p1",
        executionContext: { participantId: "p1", xtrmSessionId: ENV_ID },
      });
      assert.equal(e.participantId, "p1");
      assert.equal(e.executionContext?.participantId, "p1");
      assert.equal(e.executionContext?.xtrmSessionId, ENV_ID);
      const reread = journal.getEntry(e.id);
      assert.deepEqual(reread.executionContext, e.executionContext);
      // Conflicting non-empty values fail closed instead of diverging.
      assert.throws(
        () => journal.appendEntry(issue.id, {
          kind: "finding",
          participantId: "legacy-p",
          executionContext: { participantId: "env-p" },
        }),
        /conflict on participantId/,
      );
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("journal append and dispatch reject unknown fields, versions, and blanks at the persistence path", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc);
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      for (const bad of [
        { version: 2 },
        { bogus: 1 },
        { actor: { type: "human", rank: "x" } },
        { specialist: { name: "s", foo: 1 } },
        { coordinator: { participantId: "p", scope: "x" } },
        { participantId: " " },
      ]) {
        assert.throws(
          () => journal.appendEntry(issue.id, { kind: "note", executionContext: bad as never }),
          /invalid execution context|unknown|non-empty/,
          `journal append rejects ${JSON.stringify(bad)}`,
        );
        assert.throws(
          () =>
            prov.dispatch(issue.id, {
              workspace: s.dir,
              participantId: "coord-holder",
              executionContext: bad as never,
            }),
          /invalid|unknown|non-empty/,
          `dispatch rejects ${JSON.stringify(bad)}`,
        );
      }
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("X1 projection: session/workspace precedence and conflict fail-closed", () => {
  it("session prefers xtrmSessionId, then host.sessionId, then legacy", () => {
    assert.equal(
      projectFlatIdentity({ version: 1, xtrmSessionId: "x", host: { type: "pi", sessionId: "p" } }, {}).sessionId,
      "x",
    );
    assert.equal(
      projectFlatIdentity({ version: 1, host: { type: "pi", sessionId: "p" } }, {}).sessionId,
      "p",
    );
    assert.equal(projectFlatIdentity(null, { sessionId: "l" }).sessionId, "l");
    // Equal envelope/legacy values are allowed through.
    assert.equal(
      projectFlatIdentity({ version: 1, host: { type: "pi", sessionId: "p" } }, { sessionId: "p" }).sessionId,
      "p",
    );
  });

  it("workspace prefers worktree over repoPath, legacy fills absence", () => {
    assert.equal(
      projectFlatIdentity({ version: 1, workspace: { repoPath: "r", worktree: "w" } }, {}).workspace,
      "w",
    );
    assert.equal(projectFlatIdentity({ version: 1, workspace: { repoPath: "r" } }, {}).workspace, "r");
    assert.equal(projectFlatIdentity(null, { workspace: "/cwd" }).workspace, "/cwd");
  });

  it("conflicting non-empty envelope/legacy values throw; xtrmSessionId never conflicts", () => {
    assert.throws(
      () => projectFlatIdentity({ version: 1, participantId: "a" }, { participantId: "b" }),
      /conflict on participantId/,
    );
    assert.throws(
      () =>
        projectFlatIdentity(
          { version: 1, specialist: { activationId: "a1" } },
          { activationId: "a2" },
        ),
      /conflict on activationId/,
    );
    assert.throws(
      () => projectFlatIdentity({ version: 1, host: { type: "pi", sessionId: "p" } }, { sessionId: "q" }),
      /conflict on sessionId/,
    );
    // The R4 session and the provider session are different fields: both
    // present is agreement, not conflict.
    assert.equal(
      projectFlatIdentity(
        { version: 1, xtrmSessionId: "x", host: { type: "pi", sessionId: "p" } },
        { sessionId: "p" },
      ).sessionId,
      "x",
    );
  });

  it("dispatch fails closed on envelope/legacy conflict", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "conflict work", "coord-holder", "act-1");
      const prov = new ProvenanceService(s.db, s.svc);
      assert.throws(
        () =>
          prov.dispatch(issue.id, {
            workspace: s.dir,
            participantId: "coord-holder",
            activationId: "act-1",
            attemptId: "other-attempt",
            executionContext: { specialist: { activationId: "act-1", attemptId: "att-1" } },
          }),
        /conflict on attemptId/,
      );
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("X1 retry/resume: one activation, distinct attempts, both queryable", () => {
  it("same activation with new attempt ids stays distinguishable and ordered", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "retry work", "coord-holder", "act-7");
      const prov = new ProvenanceService(s.db, s.svc);
      const first = prov.dispatch(issue.id, {
        workspace: s.dir, participantId: "coord-holder", activationId: "act-7", attemptId: "att-1",
        executionContext: { specialist: { name: "builder", activationId: "act-7", attemptId: "att-1" } },
      });
      const second = prov.dispatch(issue.id, {
        workspace: s.dir, participantId: "coord-holder", activationId: "act-7", attemptId: "att-2",
        executionContext: { specialist: { name: "builder", activationId: "act-7", attemptId: "att-2" } },
      });
      const all = prov.listBindings(issue.id).filter((b) => b.activationId === "act-7");
      assert.equal(all.length, 2);
      assert.deepEqual(all.map((b) => b.attemptId).sort(), ["att-1", "att-2"]);
      assert.ok(all[0]!.createdAt <= all[1]!.createdAt, "attempts stay ordered");
      assert.equal(all[0]!.executionContext?.specialist?.attemptId, all[0]!.attemptId);
      assert.equal(all[1]!.executionContext?.specialist?.attemptId, all[1]!.attemptId);
      assert.notEqual(first.id, second.id);
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("X1 §97: R4 env → Pi/Claude → Journal carries equal session id/name", () => {
  it("Pi trusted adapter path propagates the exact env session", async () => {
    process.env[XTRM_SESSION_ID_ENV] = ENV_ID;
    process.env[XTRM_SESSION_NAME_ENV] = ENV_NAME;
    const s = scratch();
    // Seeding reads through the concrete services; the handlers go through the
    // typed service, which is what this test is about.
    const backing: Backing = openBacking({ env: { ...process.env, SUBSTRATE_DB: s.dbPath } });
    const journal = new JournalService(s.db, s.svc);
    try {
      const { issue } = readyIssue(s.svc);
      const appended = await toolJournalAppend(backing, { ref: issue.id, kind: "finding", sessionId: "pi-sess-9" });
      const entry = journal.getEntry(appended.entryId as string);
      assert.equal(entry.executionContext?.xtrmSessionId, ENV_ID);
      assert.equal(entry.executionContext?.xtrmSessionName, ENV_NAME);
      assert.equal(entry.executionContext?.host?.type, "pi");
      assert.equal(entry.executionContext?.host?.sessionId, "pi-sess-9");
      // Flat session follows the automatic R4 session first (finding 2),
      // while the provider session stays typed in the envelope.
      assert.equal(entry.sessionId, ENV_ID, "flat session column follows xtrmSessionId");
      const cp = await toolJournalCheckpoint(backing, { ref: issue.id, sessionId: "pi-sess-9" });
      const cpEntry = journal.getEntry(cp.entryId as string);
      assert.equal(cpEntry.executionContext?.xtrmSessionId, ENV_ID);
      assert.equal(cpEntry.executionContext?.xtrmSessionName, ENV_NAME);
      const compact = await runBeforeCompact(backing, { issueRef: issue.id, sessionId: "pi-sess-9" });
      const compactEntry = journal.getEntry(compact.entryId as string);
      assert.equal(compactEntry.executionContext?.xtrmSessionId, ENV_ID);
      assert.equal(compactEntry.executionContext?.xtrmSessionName, ENV_NAME);
      // A known activation is recorded, not dropped (X1 review P2-1): the
      // envelope and the flat column agree on the same activation id.
      const withActivation = await toolJournalAppend(backing, {
        ref: issue.id, kind: "finding", sessionId: "pi-sess-9", activationId: "act-pi-1",
      });
      const activationEntry = journal.getEntry(withActivation.entryId as string);
      assert.equal(activationEntry.executionContext?.specialist?.activationId, "act-pi-1");
      assert.equal(activationEntry.activationId, "act-pi-1");
    } finally {
      await backing.close();
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("Claude trusted adapter path propagates the exact env session", async () => {
    process.env[XTRM_SESSION_ID_ENV] = ENV_ID;
    process.env[XTRM_SESSION_NAME_ENV] = ENV_NAME;
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc);
      const res = await handlePreCompact({ issueRef: issue.id, dbPath: s.dbPath, cwd: s.dir, session_id: "claude-sess-4" });
      assert.ok(res.entryId, `precompact wrote a checkpoint: ${res.reason ?? ""}`);
      const journal = new JournalService(s.db, s.svc);
      const entry = journal.getEntry(res.entryId!);
      assert.equal(entry.executionContext?.xtrmSessionId, ENV_ID);
      assert.equal(entry.executionContext?.xtrmSessionName, ENV_NAME);
      assert.equal(entry.executionContext?.host?.type, "claude");
      assert.equal(entry.executionContext?.host?.sessionId, "claude-sess-4");
      // A provider session id must never be recorded as participant identity
      // (X1 review P1-1): neither the envelope nor the flat column may claim
      // a participant the host never supplied (§98).
      assert.equal(entry.executionContext?.participantId ?? null, null, "no participant is invented from the session id");
      assert.equal(entry.participantId, null, "flat participant stays absent");
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("X1 §37/§97: coordinator → Specialist lineage, receipt inherits the envelope", () => {
  it("child binding keeps parent lineage while specialist fields identify the child", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "gated work", "coord-holder", "act-3");
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      process.env[XTRM_SESSION_ID_ENV] = ENV_ID;
      process.env[XTRM_SESSION_NAME_ENV] = ENV_NAME;
      const { binding } = dispatchToSpecialist(s.svc, prov, {
        ref: issue.id, specialist: "builder", holder: "coord-holder",
        activationId: "act-3", attemptId: "att-1", workspace: s.dir,
        executionContext: { participantId: "coord-holder" },
      });
      const ctx = binding.executionContext!;
      // Parent/coordinator lineage preserved.
      assert.equal(ctx.participantId, "coord-holder");
      assert.equal(ctx.xtrmSessionId, ENV_ID);
      assert.equal(ctx.xtrmSessionName, ENV_NAME);
      // Child identified; trusted boundary asserts exactly the specialist type.
      assert.equal(ctx.actor?.type, "specialist");
      assert.equal(ctx.specialist?.name, "builder");
      assert.equal(ctx.specialist?.activationId, "act-3");
      assert.equal(ctx.specialist?.attemptId, "att-1");
      // Nothing else invented at the boundary.
      assert.equal(ctx.actor?.id ?? null, null);
      assert.equal(ctx.actor?.name ?? null, null);
      assert.equal(ctx.specialist?.agentSessionId ?? null, null);
      assert.equal(ctx.workspace?.repositoryKey ?? null, null);
      // The gate knows the execution checkout, so the authority envelope
      // carries it instead of the flat column knowing it alone (P1-2).
      assert.equal(ctx.workspace?.worktree, s.dir, "gate dispatch records the workspace in the envelope");
      // Same-holder parent: no separate coordinator leg is needed — the
      // shared participant and XTRM session already carry the lineage.
      assert.equal(ctx.coordinator ?? null, null);
      assert.equal(binding.participantId, "coord-holder", "flat participant equals envelope participant");
      // Retry keeps the activation, mints a new attempt, both queryable.
      const retry = dispatchToSpecialist(s.svc, prov, {
        ref: issue.id, specialist: "builder", holder: "coord-holder",
        activationId: "act-3", attemptId: "att-2", workspace: s.dir,
      });
      assert.equal(retry.binding.executionContext?.specialist?.activationId, "act-3");
      assert.equal(retry.binding.executionContext?.specialist?.attemptId, "att-2");
      const attempts = prov.listBindings(issue.id).map((b) => b.attemptId).sort();
      assert.deepEqual(attempts, ["att-1", "att-2"]);
      // WorkReceipt inherits the exact envelope through its binding — no copy.
      const receipt = prov.allocateReceipt(binding.id);
      assert.deepEqual(prov.receiptExecutionContext(receipt.id), ctx);
      const receiptCols = s.db.prepare("PRAGMA table_info(work_receipts)").all() as Array<{ name: string }>;
      assert.ok(!receiptCols.some((c) => c.name === "execution_context_json"), "no duplicated envelope column on work_receipts");
      const trace = prov.trace(issue.id);
      const traced = trace.receipts.find((r) => r.id === receipt.id);
      assert.deepEqual(traced?.executionContext, ctx, "typed trace output carries the inherited envelope");
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("divergent parent participant/session moves to the coordinator leg; child participant stays current", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "divergent work", "spec-holder", "act-5");
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      const { binding } = dispatchToSpecialist(s.svc, prov, {
        ref: issue.id, specialist: "builder", holder: "spec-holder",
        activationId: "act-5", attemptId: "att-1", workspace: s.dir,
        executionContext: {
          participantId: "parent-coord",
          xtrmSessionId: ENV_ID,
          host: { type: "pi", sessionId: "parent-sess" },
        },
      });
      const ctx = binding.executionContext!;
      assert.equal(ctx.participantId, "spec-holder", "top-level participant is the current specialist");
      assert.equal(binding.participantId, "spec-holder", "flat participant agrees — no dual semantics");
      assert.deepEqual(ctx.coordinator, { participantId: "parent-coord", sessionId: "parent-sess" });
      assert.equal(ctx.xtrmSessionId, ENV_ID, "XTRM session stays shared");
      assert.equal(ctx.actor?.type, "specialist");
      assert.equal(ctx.host ?? null, null, "parent provider session is not inherited as the child host");
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("contradictory parent workspace location fails closed at the gate", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "located work", "spec-holder", "act-5");
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      assert.throws(
        () =>
          dispatchToSpecialist(s.svc, prov, {
            ref: issue.id, specialist: "builder", holder: "spec-holder",
            activationId: "act-5", attemptId: "att-1", workspace: s.dir,
            executionContext: { workspace: { repoPath: "/elsewhere/repo" } },
          }),
        /conflict on workspace/,
      );
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("coordinator leg round-trips through Journal results and receipt trace", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "result work", "spec-holder", "act-5");
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      const { binding } = dispatchToSpecialist(s.svc, prov, {
        ref: issue.id, specialist: "builder", holder: "spec-holder",
        activationId: "act-5", attemptId: "att-1", workspace: s.dir,
        executionContext: { participantId: "parent-coord", xtrmSessionId: ENV_ID },
      });
      const entry = journal.appendEntry(issue.id, {
        kind: "result",
        result: { summary: "child outcome" },
        executionContext: binding.executionContext,
      });
      assert.deepEqual(entry.executionContext?.coordinator, { participantId: "parent-coord" });
      const receipt = prov.allocateReceipt(binding.id);
      const traced = prov.trace(issue.id).receipts.find((r) => r.id === receipt.id);
      assert.deepEqual(traced?.executionContext?.coordinator, { participantId: "parent-coord" });
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("X1 joint §98 with R1: unavailable identity stays absent/null", () => {
  it("journal and binding rows carry no fabricated session/activation/participant/repository", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "unknown work", "coord-holder");
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      const e = journal.appendEntry(issue.id, { kind: "note" });
      assert.equal(e.executionContext, null);
      const b = prov.dispatch(issue.id, { workspace: s.dir, participantId: "coord-holder" });
      const bRaw = s.db.prepare("SELECT execution_context_json AS j FROM execution_bindings WHERE id = ?").get(b.id) as { j: string | null };
      assert.equal(bRaw.j, null, "service stores no synthesized envelope");
      // Read-path legacy hydration maps ONLY the known flat fields: holder
      // is known, so a v1 envelope appears — with no session, activation,
      // repository, host, or actor invented around it.
      assert.equal(b.executionContext?.version, 1);
      assert.equal(b.executionContext?.participantId, "coord-holder");
      assert.equal(b.executionContext?.xtrmSessionId ?? null, null);
      assert.equal(b.executionContext?.xtrmSessionName ?? null, null);
      assert.equal(b.executionContext?.specialist?.activationId ?? null, null);
      assert.equal(b.executionContext?.specialist?.attemptId ?? null, null);
      assert.equal(b.executionContext?.workspace?.repositoryKey ?? null, null);
      assert.equal(b.executionContext?.host ?? null, null);
      assert.equal(b.executionContext?.actor ?? null, null);
      const jRaw = s.db.prepare("SELECT execution_context_json AS j FROM issue_journal WHERE id = ?").get(e.id) as { j: string | null };
      assert.equal(jRaw.j, null);
      const reread = journal.getEntry(e.id);
      assert.equal(reread.executionContext, null);
      assert.equal(reread.participantId, null);
      assert.equal(reread.sessionId, null);
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("provider-unknown legacy session stays flat-only: queryable, never typed into the envelope", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "flat session work", "coord-holder");
      const journal = new JournalService(s.db, s.svc);
      // Legacy manual flag with no envelope and no provider knowledge.
      const e = journal.appendEntry(issue.id, { kind: "note", sessionId: "01a0ac95-8370-74c5-9081-4490653e7e94" });
      assert.equal(e.sessionId, "01a0ac95-8370-74c5-9081-4490653e7e94", "flat session column stays queryable");
      const reread = journal.getEntry(e.id);
      assert.equal(reread.sessionId, "01a0ac95-8370-74c5-9081-4490653e7e94");
      assert.equal(reread.executionContext?.host ?? null, null, "no host.type invented for the unknown provider");
      assert.equal(reread.executionContext?.xtrmSessionId ?? null, null);
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("XTRM-412: canonical identity at the write seam", () => {
  const SESSION = "01a0ac95-8370-74c5-9081-4490653e7e95";
  const base = {
    executionContext: null,
    participantId: null,
    activationId: null,
    attemptId: null,
    sessionId: null,
    runId: null,
  };

  function rejects(field: string, build: () => Record<string, unknown>): void {
    try {
      canonicalizeWriteIdentity(build() as never);
      assert.fail(`${field} must reject its value`);
    } catch (err) {
      assert.ok(err instanceof IdentityFormatError, `${field} raises IdentityFormatError`);
      assert.equal(err.field, field);
    }
  }

  it("accepts the tmux session form and rejects genuine non-identifiers with a named error", () => {
    // $N is the launcher-surfaced tmux session id (core session-identity.ts),
    // a legitimate session form alongside UUIDs - never a shell token.
    for (const field of ["executionContext.xtrmSessionId", "sessionId"] as const) {
      const build =
        field === "sessionId"
          ? () => ({ ...base, sessionId: "$2" })
          : () => ({ ...base, executionContext: { version: 1, xtrmSessionId: "$2" } });
      const accepted = canonicalizeWriteIdentity(build() as never);
      const got = field === "sessionId" ? accepted.sessionId : accepted.executionContext?.xtrmSessionId;
      assert.equal(got, "$2", `${field} accepts the tmux form unchanged`);
    }
    rejects("participantId", () => ({ ...base, participantId: "coord; rm -rf /" }));
    rejects("activationId", () => ({ ...base, activationId: "$2" }));
    rejects("attemptId", () => ({ ...base, attemptId: "att 1" }));
    rejects("runId", () => ({ ...base, runId: "job$(id)" }));
    rejects("executionContext.host.sessionId", () => ({ ...base, executionContext: { version: 1, host: { type: "pi", sessionId: "`whoami`" } } }));
    // 122c14 has no known producer: rejected, but provisional, not proven junk.
    rejects("sessionId", () => ({ ...base, sessionId: "122c14" }));
    try {
      canonicalizeWriteIdentity({ ...base, sessionId: "not a session!!" });
      assert.fail("non-identifier session must be refused");
    } catch (err) {
      assert.ok(err instanceof IdentityFormatError);
      assert.match(err.message, /session identity must be a canonical lowercase UUID or tmux session id/);
    }
  });

  it("canonicalises a recoverable uppercase UUID and is idempotent", () => {
    const upper = "01A0AC95-8370-74C5-9081-4490653E7E95";
    const first = canonicalizeWriteIdentity({ ...base, sessionId: upper });
    assert.equal(first.sessionId, SESSION, "uppercase session identity canonicalises to lowercase");
    const second = canonicalizeWriteIdentity({ ...base, sessionId: first.sessionId });
    assert.equal(second.sessionId, first.sessionId, "re-running canonicalisation changes nothing");
    const withEnv = canonicalizeWriteIdentity({ ...base, executionContext: { version: 1, xtrmSessionId: upper } });
    assert.equal(withEnv.executionContext?.xtrmSessionId, SESSION);
    // A manual scalar equal to the host provider label is a provider echo.
    const echo = canonicalizeWriteIdentity({
      ...base,
      sessionId: "pi-sess-9",
      executionContext: { version: 1, host: { type: "pi", sessionId: "pi-sess-9" } },
    });
    assert.equal(echo.sessionId, "pi-sess-9");
  });

  it("derives an ambient tmux session instead of failing, and still refuses junk", () => {
    const s = scratch();
    const prev = process.env[XTRM_SESSION_ID_ENV];
    try {
      const { issue } = readyIssue(s.svc, "write gate");
      const journal = new JournalService(s.db, s.svc);
      assert.throws(() => journal.appendEntry(issue.id, { kind: "note", sessionId: "not a session!!" }), IdentityFormatError);
      assert.equal(journal.listEntries(issue.id).length, 0, "nothing is stored on rejection");
      // The launcher-surfaced tmux session is derived, not refused.
      process.env[XTRM_SESSION_ID_ENV] = "$2";
      const derived = journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "x" } });
      assert.equal(derived.sessionId, "$2", "ambient tmux session is derived");
      assert.equal(journal.listEntries(issue.id).length, 1);
    } finally {
      if (prev === undefined) delete process.env[XTRM_SESSION_ID_ENV];
      else process.env[XTRM_SESSION_ID_ENV] = prev;
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-canonical legacy session shape on the dispatch path too", () => {
    const s = scratch();
    try {
      const { issue } = readyIssue(s.svc, "dispatch gate");
      const journal = new JournalService(s.db, s.svc);
      const prov = new ProvenanceService(s.db, s.svc, journal);
      assert.throws(
        () => prov.dispatch(issue.id, { workspace: s.dir, participantId: "coord-holder", sessionId: "122c14" }),
        IdentityFormatError,
      );
      assert.equal(prov.listBindings(issue.id).length, 0, "no binding is written on rejection");
    } finally {
      try { s.db.close(); } catch { /* closed */ }
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});
