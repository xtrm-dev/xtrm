// C1 First-class Closure (XTRM-252.7, ADR §96): the §96 close-reason
// matrix, reopen immutability, three-attempt failure history,
// cancellation separation, Beads close-reason migration, and legacy-verb
// preservation.
//
// Store discipline: every store opens on an explicit temporary
// SUBSTRATE_DB under TMPDIR=/var/tmp, and every CLI call passes an
// explicit --db. The live store (~/.xtrm/state.db) is never touched.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { importBeads } from "../src/compatibility/beads/import.ts";
import { CLOSURE_OUTCOMES } from "../src/domain/closure.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

const SCOPE = "/var/tmp";
process.env["TMPDIR"] = SCOPE;

let scratchDirs: string[] = [];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    SUBSTRATE_DB: process.env["SUBSTRATE_DB"],
    SUBSTRATE_PROJECT: process.env["SUBSTRATE_PROJECT"],
    XTRM_SESSION_ID: process.env["XTRM_SESSION_ID"],
    XTRM_SESSION_NAME: process.env["XTRM_SESSION_NAME"],
  };
  delete process.env["SUBSTRATE_PROJECT"];
  delete process.env["XTRM_SESSION_ID"];
  delete process.env["XTRM_SESSION_NAME"];
});

afterEach(() => {
  for (const key of Object.keys(savedEnv)) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch() {
  const dir = mkdtempSync(join(SCOPE, "c1-"));
  scratchDirs.push(dir);
  const dbPath = join(dir, "state.db");
  process.env["SUBSTRATE_DB"] = dbPath;
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_c1", prefix: "C1", name: "closure" });
  const closures = new ClosureService(db, svc);
  return { dir, dbPath, db, svc, closures };
}

function seedIssue(svc: IssueService, title = "closure work") {
  return svc.createIssue({
    projectId: "prj_c1",
    title,
    kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
}

function cli(dbPath: string, argv: string[]): unknown {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

function cliFail(dbPath: string, argv: string[]): string {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 1, `sb ${argv.join(" ")} should fail`);
  const env = JSON.parse(res.stdout) as { ok: boolean; error: string };
  assert.equal(env.ok, false);
  return env.error;
}

function contractFile(dir: string): string {
  const c = join(dir, "c.json");
  writeFileSync(c, JSON.stringify(contract()));
  return c;
}

describe("C1 §96 close-reason matrix", () => {
  it("completed, superseded, duplicate and cancelled closings persist reason/actor/session/revision/hash/refs with immutable history", () => {
    const { db, svc, closures } = scratch();
    process.env["XTRM_SESSION_ID"] = "01a0ac95-0000-4000-8000-000000000001";
    const cases = [
      { outcome: "completed", reason: "shipped the work" },
      { outcome: "superseded", reason: "replaced by C1-9" },
      { outcome: "duplicate", reason: "same as C1-1" },
      { outcome: "cancelled", reason: "no longer wanted" },
    ] as const;
    const seen: string[] = [];
    for (const [i, c] of cases.entries()) {
      const issue = seedIssue(svc, `matrix ${c.outcome}`);
      const before = svc.getIssue(issue.id);
      const closure = closures.closeIssue(issue.id, {
        outcome: c.outcome,
        reason: c.reason,
        actor: `actor-${c.outcome}`,
        executionContext: {
          version: 1,
          participantId: "holder-matrix",
          xtrmSessionId: "01a0ac95-0000-4000-8000-000000000001",
          timestamp: Date.now(),
        },
        validationRefs: [`val-${i}`],
        journalResultRefs: [`jrn-${i}`],
        receiptRefs: [`rcpt-${i}`],
        artifactRefs: [`art-${i}`],
      });
      assert.equal(closure.outcome, c.outcome);
      assert.equal(closure.reason, c.reason);
      assert.equal(closure.actor, `actor-${c.outcome}`);
      assert.equal(closure.executionContext?.xtrmSessionId, "01a0ac95-0000-4000-8000-000000000001");
      assert.equal(closure.issueRevision, before.currentRevision);
      assert.equal(closure.contractHash, before.currentContractHash);
      assert.deepEqual(closure.validationRefs, [`val-${i}`]);
      assert.deepEqual(closure.journalResultRefs, [`jrn-${i}`]);
      assert.deepEqual(closure.receiptRefs, [`rcpt-${i}`]);
      assert.deepEqual(closure.artifactRefs, [`art-${i}`]);
      // Outcome and lifecycle state are distinct facts (§42): duplicate
      // rests on done, cancelled rests on cancelled, and one state
      // (done) hosts several outcomes — the state alone never implies why.
      assert.equal(closure.terminalState, c.outcome === "cancelled" ? "cancelled" : "done");
      if (c.outcome !== "cancelled") assert.notEqual(closure.outcome, closure.terminalState);
      assert.equal(svc.getIssue(issue.id).lifecycleState, closure.terminalState);
      // Directly queryable by closure id, and history is immutable: a
      // second read returns the identical row.
      const again = closures.getClosure(closure.closureId);
      assert.deepEqual(again, closure);
      seen.push(closure.closureId);
      void db;
    }
    assert.equal(new Set(seen).size, 4);
  });

  it("canonical CLI close binds session automatically and persists refs", () => {
    const { dbPath, dir } = scratch();
    process.env["XTRM_SESSION_ID"] = "01a0ac95-0000-4000-8000-0000000000c7";
    const c = contractFile(dir);
    cli(dbPath, ["project", "create", "--prefix", "EV", "--name", "e"]);
    const created = cli(dbPath, ["issue", "create", "--project", "prj_c1", "--title", "cli close", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
    const out = cli(dbPath, [
      "issue", "close", created.humanRef,
      "--outcome", "completed", "--reason", "done via cli", "--actor", "cli-actor",
      "--participant", "holder-cli", "--result", "jr1,jr2", "--receipt", "rc1",
      "--validation", "v1", "--artifact", "a1", "--project", "prj_c1",
    ]) as { lifecycleState: string; closure: Record<string, unknown> };
    assert.equal(out.lifecycleState, "done");
    const closure = out.closure;
    assert.equal(closure["outcome"], "completed");
    assert.equal(closure["reason"], "done via cli");
    assert.equal(closure["actor"], "cli-actor");
    assert.equal((closure["executionContext"] as { xtrmSessionId?: string }).xtrmSessionId, "01a0ac95-0000-4000-8000-0000000000c7");
    assert.deepEqual(closure["journalResultRefs"], ["jr1", "jr2"]);
    assert.deepEqual(closure["receiptRefs"], ["rc1"]);
    // issue show surfaces the durable closure, never an invented reason.
    const shown = cli(dbPath, ["issue", "show", created.humanRef]) as { closure: Record<string, unknown> };
    assert.equal(shown.closure["outcome"], "completed");
    assert.equal(shown.closure["reason"], "done via cli");
    assert.equal(shown.closure["actor"], "cli-actor");
  });

  it("close without outcome/reason fails closed and records nothing terminal", () => {
    const { svc, closures } = scratch();
    const issue = seedIssue(svc);
    assert.throws(() => closures.closeIssue(issue.id, { outcome: "completed", reason: "  ", actor: "a" }), /reason is required/);
    assert.throws(
      () => closures.closeIssue(issue.id, { outcome: "bogus" as never, reason: "r", actor: "a" }),
      /unknown closure outcome/,
    );
    assert.equal(svc.getIssue(issue.id).lifecycleState, "open");
    assert.equal(closures.getLatestClosure(issue.id), null);
  });
});

describe("C1 reopen immutability", () => {
  it("reopen keeps the prior Closure byte-identical, adds an event, and restores open", () => {
    const { svc, closures } = scratch();
    const issue = seedIssue(svc);
    const first = closures.closeIssue(issue.id, { outcome: "duplicate", reason: "dup of C1-2", actor: "holder-a" });
    const snapshot = JSON.parse(JSON.stringify(first));
    const reopened = closures.reopenIssue(issue.id, { reason: "wrong duplicate call", actor: "holder-b" });
    assert.equal(reopened.lifecycleState, "open");
    assert.equal(svc.getIssue(issue.id).lifecycleState, "open");
    // The historical row is untouched.
    assert.deepEqual(closures.getClosure(first.closureId), snapshot);
    assert.deepEqual(closures.getLatestClosure(issue.id), snapshot);
    // The reopen event names the kept closures.
    const events = svc.listEvents(issue.id);
    const reopened2 = events.filter((e) => e.type === "issue.reopened");
    assert.equal(reopened2.length, 1);
    assert.deepEqual((reopened2[0]!.payload as { priorClosures: string[] }).priorClosures, [first.closureId]);
    // The supplied actor must be durable, not validated and dropped (C1
    // review P2-1): a reopen that silently discarded it would fail here.
    assert.equal((reopened2[0]!.payload as { actor?: string }).actor, "holder-b");
    // A second close writes a second Closure; both stay queryable.
    const second = closures.closeIssue(issue.id, { outcome: "completed", reason: "actually done", actor: "holder-c" });
    assert.notEqual(second.closureId, first.closureId);
    assert.deepEqual(closures.listClosures(issue.id).map((c) => c.closureId), [first.closureId, second.closureId]);
    assert.deepEqual(closures.getClosure(first.closureId), snapshot);
  });

  it("CLI reopen keeps the Closure and restores open", () => {
    const { dbPath, dir } = scratch();
    const c = contractFile(dir);
    const created = cli(dbPath, ["issue", "create", "--project", "prj_c1", "--title", "cli reopen", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string; locator: string };
    const closed = cli(dbPath, ["issue", "close", created.humanRef, "--outcome", "completed", "--reason", "v1 done", "--project", "prj_c1"]) as { closure: { closureId: string } };
    const firstId = closed.closure.closureId;
    const reopened = cli(dbPath, ["issue", "reopen", created.humanRef, "--reason", "regression found", "--project", "prj_c1"]) as { lifecycleState: string };
    assert.equal(reopened.lifecycleState, "open");
    const shown = cli(dbPath, ["issue", "show", created.humanRef]) as { closure: Record<string, unknown> };
    assert.equal(shown.closure["closureId"], firstId);
    assert.equal(shown.closure["outcome"], "completed");
  });
});

describe("C1 failure history", () => {
  it("three attempts (failed, failed, completed) all remain queryable", () => {
    const { svc, closures } = scratch();
    const issue = seedIssue(svc);
    assert.throws(() => closures.closeIssue(issue.id, { outcome: "nope" as never, reason: "r1", actor: "a" }), /unknown closure outcome/);
    assert.throws(() => closures.closeIssue(issue.id, { outcome: "completed", reason: "", actor: "a" }), /reason is required/);
    const closure = closures.closeIssue(issue.id, { outcome: "completed", reason: "third try lands", actor: "a" });
    const attempts = closures.listAttempts(issue.id);
    assert.equal(attempts.length, 3);
    assert.deepEqual(attempts.map((a) => a.status), ["failed", "failed", "completed"]);
    assert.deepEqual(attempts.map((a) => a.kind), ["close", "close", "close"]);
    assert.match(attempts[0]!.error ?? "", /unknown closure outcome/);
    assert.match(attempts[1]!.error ?? "", /reason is required/);
    assert.equal(attempts[2]!.closureId, closure.closureId);
    // The later success never rewrites the failures away.
    assert.equal(closures.listAttempts(issue.id).length, 3);
    assert.equal(svc.getIssue(issue.id).lifecycleState, "done");
  });
});

describe("C1 cancellation separation", () => {
  it("cancelling an activation leaves lifecycle untouched; cancelling the Issue writes terminal closure", () => {
    const { svc, closures } = scratch();
    const issue = seedIssue(svc);
    svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    svc.claimIssue(issue.id, "worker-h", { activationId: "act-1" });
    const stopped = closures.cancelActivation(issue.id, "worker-h", { activationId: "act-1" });
    assert.equal(stopped.released, true);
    assert.equal(stopped.lifecycleState, "open");
    assert.equal(svc.getIssue(issue.id).lifecycleState, "open");
    assert.equal(closures.getLatestClosure(issue.id), null);
    assert.deepEqual(closures.listAttempts(issue.id), []);
    const kinds = svc.listEvents(issue.id).map((e) => e.type);
    assert.ok(kinds.includes("activation.cancelled"));
    assert.ok(!kinds.includes("issue.closed"));
    // Cancelling the Issue itself is terminal with the cancelled outcome.
    const closure = closures.cancelIssue(issue.id, { reason: "scope dropped", actor: "owner-h" });
    assert.equal(closure.outcome, "cancelled");
    assert.equal(closure.terminalState, "cancelled");
    assert.equal(svc.getIssue(issue.id).lifecycleState, "cancelled");
    assert.equal(closures.getLatestClosure(issue.id)?.closureId, closure.closureId);
  });

  it("CLI cancel writes cancelled closure; release stops only the execution", () => {
    const { dbPath, dir } = scratch();
    const c = contractFile(dir);
    const created = cli(dbPath, ["issue", "create", "--project", "prj_c1", "--title", "cli cancel", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
    cli(dbPath, ["issue", "attest", created.humanRef, "--outcome", "ready", "--policy", "default", "--attested-by", "t", "--project", "prj_c1"]);
    cli(dbPath, ["issue", "claim", created.humanRef, "--holder", "w", "--activation", "act-9", "--project", "prj_c1"]);
    const released = cli(dbPath, ["issue", "release", created.humanRef, "--holder", "w", "--activation", "act-9", "--project", "prj_c1"]) as { released: boolean };
    assert.equal(released.released, true);
    const still = cli(dbPath, ["issue", "show", created.humanRef]) as { lifecycleState: string };
    assert.equal(still.lifecycleState, "open");
    const cancelled = cli(dbPath, ["issue", "cancel", created.humanRef, "--reason", "dropped", "--actor", "o", "--project", "prj_c1"]) as {
      lifecycleState: string;
      closure: Record<string, unknown>;
    };
    assert.equal(cancelled.lifecycleState, "cancelled");
    assert.equal(cancelled.closure["outcome"], "cancelled");
  });
});

describe("C1 Beads close-reason migration", () => {
  it("preserves reason, legacy state, timestamp, actor and source=beads without guessing", () => {
    const { db, svc, closures } = scratch();
    const journal = new JournalService(db, svc);
    const before = Date.now();
    const result = importBeads(
      svc,
      "prj_c1",
      [
        { id: "bd-done", title: "Done bead", description: "PROBLEM: x\nSUCCESS: y", status: "closed", priority: 1, issue_type: "task", created_by: "human:finisher", close_reason: "shipped in v2" },
        { id: "bd-open", title: "Open bead", description: "PROBLEM: y\nSUCCESS: z", status: "open", priority: 0, issue_type: "task", created_by: "human:dev" },
      ],
      [],
      { journal, closures },
    );
    assert.ok(result.created.includes("bd-done"));
    const doneId = svc.issueIdForAlias("bd-done")!;
    const closure = closures.getLatestClosure(doneId)!;
    assert.ok(closure, "closed Beads record lands a Closure row");
    assert.equal(closure.reason, "shipped in v2");
    assert.equal(closure.actor, "human:finisher");
    assert.equal(closure.source, "beads");
    assert.equal(closure.legacyState, "closed");
    assert.equal(closure.outcome, "completed");
    assert.ok(closure.closedAt >= before && closure.closedAt <= Date.now());
    // The close reason is queryable closure data, not generic journal prose.
    assert.equal(svc.getIssue(doneId).lifecycleState, "done");
    // Open records get no Closure row.
    assert.equal(closures.getLatestClosure(svc.issueIdForAlias("bd-open")!), null);
    // Rerun is idempotent: no new closures, no new attempts.
    const closuresBefore = closures.listClosures(doneId).length;
    const attemptsBefore = closures.listAttempts(doneId).length;
    importBeads(
      svc,
      "prj_c1",
      [
        { id: "bd-done", title: "Done bead", description: "PROBLEM: x\nSUCCESS: y", status: "closed", priority: 1, issue_type: "task", created_by: "human:finisher", close_reason: "shipped in v2" },
      ],
      [],
      { journal, closures },
    );
    assert.equal(closures.listClosures(doneId).length, closuresBefore);
    assert.equal(closures.listAttempts(doneId).length, attemptsBefore);
  });
});

describe("C1 legacy preservation", () => {
  it("bare close/reopen/cancel/state verbs keep working with lifecycle-only semantics", () => {
    const { dbPath, dir } = scratch();
    const c = contractFile(dir);
    const created = cli(dbPath, ["issue", "create", "--project", "prj_c1", "--title", "legacy verbs", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
    const P = ["--project", "prj_c1"];
    assert.equal((cli(dbPath, ["issue", "close", created.humanRef, ...P]) as { lifecycleState: string }).lifecycleState, "done");
    assert.equal((cli(dbPath, ["issue", "reopen", created.humanRef, ...P]) as { lifecycleState: string }).lifecycleState, "open");
    assert.equal((cli(dbPath, ["issue", "cancel", created.humanRef, ...P]) as { lifecycleState: string }).lifecycleState, "cancelled");
    assert.equal((cli(dbPath, ["issue", "state", created.humanRef, "done", ...P]) as { lifecycleState: string }).lifecycleState, "done");
    assert.equal((cli(dbPath, ["issue", "state", created.humanRef, "open", ...P]) as { lifecycleState: string }).lifecycleState, "open");
    // Bare verbs invent no Closure rows.
    const shown = cli(dbPath, ["issue", "show", created.humanRef]) as { closure: Record<string, unknown> };
    assert.equal(shown.closure["closed"], false);
  });

  it("close --outcome without --reason fails closed with usage", () => {
    const { dbPath, dir } = scratch();
    const c = contractFile(dir);
    const created = cli(dbPath, ["issue", "create", "--project", "prj_c1", "--title", "half flags", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
    const err = cliFail(dbPath, ["issue", "close", created.humanRef, "--outcome", "completed", "--project", "prj_c1"]);
    assert.match(err, /--reason is required/);
  });

  it("the outcome vocabulary is exactly the seven bounded values", () => {
    assert.deepEqual([...CLOSURE_OUTCOMES], ["completed", "superseded", "duplicate", "wont_fix", "invalid", "cancelled", "abandoned"]);
  });

  it("close and reopen help document the canonical flags", () => {
    for (const verb of ["close", "reopen", "cancel"]) {
      const res = runCli(["--db", join(SCOPE, "c1-help-never.db"), "--json", "issue", verb, "--help"]);
      assert.equal(res.code, 0);
      const env = JSON.parse(res.stdout) as { data: { text: string } };
      assert.match(env.data.text, /--reason/, `${verb} help must document --reason`);
    }
  });
});

// XTRM-447: the closure write seam enforces the same identity rule as the
// journal seam (XTRM-412) - canonicalise what is recoverable, refuse what is
// not, store nothing on refusal. Historical rows are never rewritten.
describe("C1 §96 closure identity canonical write seam (XTRM-447)", () => {
  it("refuses a non-canonical session id at close and stores nothing", () => {
    const { db, svc, closures } = scratch();
    const issue = seedIssue(svc, "seam refuses junk");
    assert.throws(
      () =>
        closures.closeIssue(issue.id, {
          outcome: "completed",
          reason: "should never persist",
          actor: "actor-junk",
          executionContext: {
            version: 1,
            participantId: "holder-junk",
            xtrmSessionId: "sess-junk-999",
            timestamp: Date.now(),
          },
        }),
      /invalid executionContext\.xtrmSessionId/,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM issue_closures WHERE issue_id = ?").get(issue.id)!.n,
      0,
      "a refused closure stores zero rows",
    );
    assert.notEqual(
      svc.getIssue(issue.id).lifecycleState,
      "done",
      "lifecycle is untouched by a refused close",
    );
  });

  it("canonicalises an uppercase UUID at close and stores it lowercase", () => {
    const { db, svc, closures } = scratch();
    const issue = seedIssue(svc, "seam canonicalises uuid");
    const upper = "01A0AC95-0000-4000-8000-0000000000AB";
    const closure = closures.closeIssue(issue.id, {
      outcome: "completed",
      reason: "canonicalisation at the closure seam",
      actor: "actor-canonical",
      executionContext: { version: 1, participantId: "holder-upper", xtrmSessionId: upper, timestamp: Date.now() },
    });
    assert.equal(closure.executionContext?.xtrmSessionId, upper.toLowerCase(), "stored canonicalised");
    const storedRaw = db
      .prepare("SELECT execution_context_json FROM issue_closures WHERE closure_id = ?")
      .get(closure.closureId)!.execution_context_json as string;
    assert.ok(storedRaw.includes(upper.toLowerCase()), "the persisted envelope carries the canonical form");
    assert.ok(!storedRaw.includes(upper), "the uppercase spelling is not persisted");
  });
});
