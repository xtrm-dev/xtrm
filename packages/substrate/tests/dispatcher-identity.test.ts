// XTRM-839 (advisor D8): dispatcher participant and session on the execution
// binding. Covers the write seam, the read surfaces (trace, session,
// activation), backward compatibility with bindings that never recorded a
// dispatcher, and migration 017 applied forward onto a pre-017 store.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

const EXEC_SESSION = "01a0ac95-8370-74c5-9081-4490653e7e91";
const DISPATCH_SESSION = "01b1bd06-9481-85d6-a192-55a1764f8f02";

function scratch() {
  const dir = tempDir("substrate-d8-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const journal = new JournalService(db, svc);
  const prov = new ProvenanceService(db, svc, journal);
  return { dir, dbPath, db, svc, prov };
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

// Only `provenance dispatch` resolves a project from flags; the read verbs
// (trace/session/activation) take no --project and resolve by id.
function withProject(argv: string[]): string[] {
  return argv[0] === "provenance" && argv[1] === "dispatch" ? [...argv, "--project", "prj_xtrm"] : argv;
}

function cliJson(dbPath: string, argv: string[]): Record<string, unknown> {
  const res = runCli(["--db", dbPath, "--json", ...withProject(argv)]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: Record<string, unknown> };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

function cliText(dbPath: string, argv: string[]): string {
  const res = runCli(["--db", dbPath, ...withProject(argv)]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

describe("XTRM-839 dispatcher identity on the binding", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("service: dispatch without the fields stores NULL, never an empty placeholder", () => {
    const issue = readyIssue(s.svc);
    const b = s.prov.dispatch(issue.id, { workspace: s.dir });
    assert.equal(b.dispatcherParticipantId, null);
    assert.equal(b.dispatcherSessionId, null);
    const raw = s.db
      .prepare("SELECT dispatcher_participant_id AS p, dispatcher_session_id AS s FROM execution_bindings WHERE id = ?")
      .get(b.id) as { p: unknown; s: unknown };
    assert.equal(raw.p, null);
    assert.equal(raw.s, null);
  });

  it("service: dispatch with both fields stores them and reads them back", () => {
    const issue = readyIssue(s.svc);
    const b = s.prov.dispatch(issue.id, {
      workspace: s.dir,
      dispatcherParticipantId: "g04z",
      dispatcherSessionId: DISPATCH_SESSION,
    });
    assert.equal(b.dispatcherParticipantId, "g04z");
    assert.equal(b.dispatcherSessionId, DISPATCH_SESSION);
    const again = s.prov.getBinding(b.id);
    assert.equal(again.dispatcherParticipantId, "g04z");
    assert.equal(again.dispatcherSessionId, DISPATCH_SESSION);
    assert.equal(s.prov.listBindings(issue.id)[0]!.dispatcherSessionId, DISPATCH_SESSION);
  });

  it("service: each field is independent and the executor identity is untouched", () => {
    const issue = readyIssue(s.svc);
    const onlyParticipant = s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "worker-1", sessionId: EXEC_SESSION, dispatcherParticipantId: "g04z",
    });
    assert.equal(onlyParticipant.dispatcherParticipantId, "g04z");
    assert.equal(onlyParticipant.dispatcherSessionId, null);
    assert.equal(onlyParticipant.participantId, "worker-1");
    assert.equal(onlyParticipant.sessionId, EXEC_SESSION);
    const onlySession = s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherSessionId: "$2" });
    assert.equal(onlySession.dispatcherParticipantId, null);
    assert.equal(onlySession.dispatcherSessionId, "$2");
  });

  it("service: a malformed dispatcher value fails closed and writes no binding", () => {
    const issue = readyIssue(s.svc);
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherSessionId: "not a session" }),
      /dispatcherSessionId/,
    );
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherParticipantId: "bad label; rm -rf" }),
      /dispatcherParticipantId/,
    );
    assert.throws(
      () => s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherParticipantId: "   " }),
      /dispatcherParticipantId/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0);
  });

  it("service: sessionDetail and activationDetail carry the dispatcher per binding", () => {
    const issue = readyIssue(s.svc);
    s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "w", activationId: "act-1", sessionId: EXEC_SESSION,
      dispatcherParticipantId: "g04z", dispatcherSessionId: DISPATCH_SESSION,
    });
    const session = s.prov.sessionDetail(EXEC_SESSION);
    assert.equal(session.dispatchers.length, 1);
    assert.equal(session.dispatchers[0]!.dispatcherParticipantId, "g04z");
    assert.equal(session.dispatchers[0]!.dispatcherSessionId, DISPATCH_SESSION);
    const activation = s.prov.activationDetail("act-1");
    assert.deepEqual(activation.dispatchers.map((d) => d.dispatcherParticipantId), ["g04z"]);
    assert.deepEqual(s.prov.activationDetail("act-unknown").dispatchers, []);
  });

  it("cli: dispatch with and without the flags; json carries the fields, null when absent", () => {
    const issue = readyIssue(s.svc);
    const plain = cliJson(s.dbPath, ["provenance", "dispatch", issue.humanRef, "--workspace", s.dir]);
    assert.equal(plain["dispatcherParticipantId"], null);
    assert.equal(plain["dispatcherSessionId"], null);
    const flagged = cliJson(s.dbPath, [
      "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--dispatcher-participant", "g04z", "--dispatcher-session", DISPATCH_SESSION,
    ]);
    assert.equal(flagged["dispatcherParticipantId"], "g04z");
    assert.equal(flagged["dispatcherSessionId"], DISPATCH_SESSION);
  });

  it("cli: a malformed --dispatcher-session exits non-zero and records nothing", () => {
    const issue = readyIssue(s.svc);
    const res = runCli([
      "--db", s.dbPath, "--project", "prj_xtrm", "--json", "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--dispatcher-session", "nope",
    ]);
    assert.equal(res.code, 1);
    assert.match(res.stdout, /dispatcherSessionId/);
    assert.equal(s.prov.listBindings(issue.id).length, 0);
  });

  it("cli: trace prints the dispatcher in json and human output; a legacy-shaped binding reads absent", () => {
    const issue = readyIssue(s.svc);
    cliJson(s.dbPath, ["provenance", "dispatch", issue.humanRef, "--workspace", s.dir]);
    cliJson(s.dbPath, [
      "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--dispatcher-participant", "g04z", "--dispatcher-session", DISPATCH_SESSION,
    ]);
    const trace = cliJson(s.dbPath, ["provenance", "trace", issue.humanRef]);
    const bindings = trace["bindings"] as Array<Record<string, unknown>>;
    assert.equal(bindings.length, 2);
    assert.equal(bindings[0]!["dispatcherParticipantId"], null);
    assert.equal(bindings[0]!["dispatcherSessionId"], null);
    assert.equal(bindings[1]!["dispatcherParticipantId"], "g04z");
    assert.equal(bindings[1]!["dispatcherSessionId"], DISPATCH_SESSION);

    const human = cliText(s.dbPath, ["provenance", "trace", issue.humanRef]);
    assert.match(human, new RegExp(`dispatched by g04z \\(sess ${DISPATCH_SESSION}\\)`));
    assert.equal(human.split("dispatched").length - 1, 1, "only the binding that recorded a dispatcher prints one");
  });

  it("cli: session and activation print the dispatcher, with an explicit absence marker", () => {
    const issue = readyIssue(s.svc);
    cliJson(s.dbPath, [
      "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--participant", "worker-1", "--activation", "act-1", "--session", EXEC_SESSION,
      "--dispatcher-participant", "g04z", "--dispatcher-session", "$7",
    ]);
    const issue2 = readyIssue(s.svc, "second");
    cliJson(s.dbPath, [
      "provenance", "dispatch", issue2.humanRef, "--workspace", s.dir,
      "--participant", "worker-2", "--activation", "act-2", "--session", DISPATCH_SESSION,
    ]);

    const sessionJson = cliJson(s.dbPath, ["provenance", "session", EXEC_SESSION]);
    const dispatchers = sessionJson["dispatchers"] as Array<Record<string, unknown>>;
    assert.equal(dispatchers[0]!["dispatcherParticipantId"], "g04z");
    assert.equal(dispatchers[0]!["dispatcherSessionId"], "$7");
    assert.match(cliText(s.dbPath, ["provenance", "session", EXEC_SESSION]), /dispatched by g04z \(sess \$7\)/);
    assert.match(cliText(s.dbPath, ["provenance", "activation", "act-1"]), /dispatched by g04z \(sess \$7\)/);

    assert.match(cliText(s.dbPath, ["provenance", "activation", "act-2"]), /dispatchers: \(none recorded\)/);
    const absent = cliJson(s.dbPath, ["provenance", "activation", "act-2"]);
    assert.deepEqual(absent["dispatchers"], [
      { bindingId: (absent["bindingIds"] as string[])[0], dispatcherParticipantId: null, dispatcherSessionId: null },
    ]);
  });

  it("cli: the dispatcher is never inferred from the ambient session or holder", () => {
    const issue = readyIssue(s.svc);
    const prev = { sid: process.env["XTRM_SESSION_ID"], holder: process.env["SUBSTRATE_HOLDER"] };
    process.env["XTRM_SESSION_ID"] = DISPATCH_SESSION;
    process.env["SUBSTRATE_HOLDER"] = "ambient-holder";
    try {
      const data = cliJson(s.dbPath, ["provenance", "dispatch", issue.humanRef, "--workspace", s.dir]);
      assert.equal(data["dispatcherParticipantId"], null);
      assert.equal(data["dispatcherSessionId"], null);
    } finally {
      if (prev.sid === undefined) delete process.env["XTRM_SESSION_ID"]; else process.env["XTRM_SESSION_ID"] = prev.sid;
      if (prev.holder === undefined) delete process.env["SUBSTRATE_HOLDER"]; else process.env["SUBSTRATE_HOLDER"] = prev.holder;
    }
  });

  it("cli: help documents both flags", () => {
    const res = runCli(["help", "provenance", "dispatch"]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /--dispatcher-participant/);
    assert.match(res.stdout, /--dispatcher-session/);
  });
});

describe("XTRM-839 migration 017", () => {
  it("adds two nullable columns without touching a pre-017 binding row", () => {
    const dir = tempDir("substrate-d8-mig-");
    try {
      const dbPath = join(dir, "state.db");
      const db = openSubstrate(dbPath);
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
      const issue = readyIssue(svc);
      const prov = new ProvenanceService(db, svc, new JournalService(db, svc));
      const before = prov.dispatch(issue.id, {
        workspace: dir, participantId: "w", activationId: "act-1", sessionId: EXEC_SESSION,
        dispatcherParticipantId: "g04z", dispatcherSessionId: DISPATCH_SESSION,
      });
      // Rewind this store to the exact pre-017 shape: no columns, no ledger row.
      db.exec("ALTER TABLE execution_bindings DROP COLUMN dispatcher_participant_id");
      db.exec("ALTER TABLE execution_bindings DROP COLUMN dispatcher_session_id");
      db.prepare("DELETE FROM schema_migrations WHERE version = 17").run();
      const rowBefore = db.prepare("SELECT * FROM execution_bindings WHERE id = ?").get(before.id) as Record<string, unknown>;
      db.close();

      const reopened = openSubstrate(dbPath);
      const cols = reopened.prepare("PRAGMA table_info(execution_bindings)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
      for (const name of ["dispatcher_participant_id", "dispatcher_session_id"]) {
        const col = cols.find((c) => c.name === name);
        assert.ok(col, `${name} added`);
        assert.equal(col!.notnull, 0, `${name} is nullable`);
        assert.equal(col!.dflt_value, null, `${name} has no default`);
      }
      const ledger = reopened.prepare("SELECT name FROM schema_migrations WHERE version = 17").get() as { name: string };
      assert.equal(ledger.name, "dispatcher-identity");

      const rowAfter = reopened.prepare("SELECT * FROM execution_bindings WHERE id = ?").get(before.id) as Record<string, unknown>;
      assert.deepEqual(
        { ...Object.fromEntries(Object.entries(rowAfter).filter(([k]) => !k.startsWith("dispatcher_"))) },
        { ...rowBefore },
        "every pre-017 column of the existing row is byte-identical",
      );
      assert.equal(rowAfter["dispatcher_participant_id"], null);
      assert.equal(rowAfter["dispatcher_session_id"], null);

      const svc2 = new IssueService(reopened);
      const prov2 = new ProvenanceService(reopened, svc2, new JournalService(reopened, svc2));
      const read = prov2.getBinding(before.id);
      assert.equal(read.dispatcherParticipantId, null, "old binding reads as absent");
      assert.equal(read.dispatcherSessionId, null);
      assert.equal(read.sessionId, EXEC_SESSION, "executor identity is still readable");
      assert.equal(prov2.activationDetail("act-1").dispatchers[0]!.dispatcherParticipantId, null);
      reopened.close();

      const again = openSubstrate(dbPath);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
