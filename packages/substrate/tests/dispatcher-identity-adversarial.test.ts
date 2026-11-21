// XTRM-844 (adversarial pass over XTRM-839): dispatcher participant and
// session on the execution binding. Where tests/dispatcher-identity.test.ts
// proves the happy path, this file tries to break it:
//   * claimed dispatch: the dispatcher can never satisfy or launder the
//     anti-steal fence, and a dispatched claim still records its dispatcher;
//   * a rejected dispatch writes neither a binding row nor a
//     provenance.dispatched event (state and audit stay in step);
//   * the dispatcher survives allocate -> receipt -> commit/pr -> bundle and
//     the backwards lookups keep resolving;
//   * boundary values (tmux $0/$12, uppercase UUID, padding, label grammar)
//     are canonicalised exactly like the executor identity beside them;
//   * CLI surface: repeated flags are last-wins, an empty value fails closed;
//   * two bindings with different dispatchers keep per-binding values in
//     trace order;
//   * migration 017 reopen is idempotent and the ledger checksum is stable;
//   * the JSON surfaces stay additive: every pre-017 key is still there.
//
// Every assertion is derived from the contract that ships with the change
// (docs/provenance-and-closure.md: dispatcher is an observed label stored
// beside the executor identity, malformed values fail closed and write no
// binding, absent reads as null) or from the documented behaviour of the
// argv parser, never from the implementation's own constants.

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
const DISPATCH_SESSION_UPPER = "01B1BD06-9481-85D6-A192-55A1764F8F02";
const SHA_A = "1".repeat(40);
const SHA_B = "2".repeat(40);

function scratch() {
  const dir = tempDir("substrate-844-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const prov = new ProvenanceService(db, svc, new JournalService(db, svc));
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

function dispatchedEvents(svc: IssueService, issueId: string) {
  return svc.listEvents(issueId).filter((e) => e.type === "provenance.dispatched");
}

describe("XTRM-844 adversarial: dispatcher identity on the binding", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  // Guards: the dispatcher is an observed label, not an authority. If the
  // write seam ever let a dispatcher value stand in for the live holder (or
  // skipped the fence once the fields are present), a non-holder could bind
  // claimed work and the trace would record a legitimate-looking dispatch.
  it("claimed dispatch still enforces the anti-steal fence and records the dispatcher", () => {
    const issue = readyIssue(s.svc);
    const claim = s.svc.claimIssue(issue.id, "holder-a", { activationId: "act-1" });

    const binding = s.prov.dispatch(issue.id, {
      workspace: s.dir,
      participantId: "holder-a",
      activationId: "act-1",
      dispatcherParticipantId: "lead-1",
      dispatcherSessionId: "$1",
    });
    assert.equal(binding.claimId, claim.id, "the binding is fenced to the live claim");
    assert.equal(binding.dispatcherParticipantId, "lead-1");
    assert.equal(binding.dispatcherSessionId, "$1");

    const eventsBefore = dispatchedEvents(s.svc, issue.id).length;
    const bindingsBefore = s.prov.listBindings(issue.id).length;

    // The thief names the holder as its dispatcher: a dispatcher value must
    // never launder a mismatched participant.
    assert.throws(
      () => s.prov.dispatch(issue.id, {
        workspace: s.dir,
        participantId: "holder-b",
        activationId: "act-1",
        dispatcherParticipantId: "holder-a",
        dispatcherSessionId: "$9",
      }),
      /anti-steal|holder\/activation mismatch/,
    );
    // Same holder, wrong activation: still fenced.
    assert.throws(
      () => s.prov.dispatch(issue.id, {
        workspace: s.dir,
        participantId: "holder-a",
        activationId: "act-2",
        dispatcherParticipantId: "lead-1",
      }),
      /anti-steal|holder\/activation mismatch/,
    );
    // A dispatch that omits the participant cannot be rescued by dispatcher fields.
    assert.throws(
      () => s.prov.dispatch(issue.id, {
        workspace: s.dir,
        dispatcherParticipantId: "holder-a",
        dispatcherSessionId: "$1",
      }),
      /participant is required|anti-steal/,
    );

    assert.equal(s.prov.listBindings(issue.id).length, bindingsBefore, "no binding written by a rejected dispatch");
    assert.equal(dispatchedEvents(s.svc, issue.id).length, eventsBefore, "no provenance.dispatched event written");
  });

  // Guards: fail-closed at the write seam. A row or an event left behind by a
  // rejected dispatch would make an unauthorized execution look legitimate in
  // `trace` and in the audit log, and would survive the retry that follows.
  it("a rejected dispatch writes no binding row and no provenance.dispatched event", () => {
    const issue = readyIssue(s.svc);
    const claim = s.svc.claimIssue(issue.id, "holder-a", { activationId: "act-1" });
    assert.deepEqual(dispatchedEvents(s.svc, issue.id).map((e) => e.type), [], "nothing dispatched yet");

    // 1. stale claim pin (generation rotated after the caller's check)
    assert.throws(
      () => s.prov.dispatch(issue.id, {
        workspace: s.dir, participantId: "holder-a", activationId: "act-1",
        dispatcherParticipantId: "lead-1", dispatcherSessionId: "$1",
      }, { expectedClaim: { id: claim.id, generation: claim.generation + 1 } }),
      /live claim changed/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0);
    assert.equal(dispatchedEvents(s.svc, issue.id).length, 0);

    // 2. a claim appeared where the caller pinned "no live claim"
    assert.throws(
      () => s.prov.dispatch(issue.id, {
        workspace: s.dir, participantId: "holder-a", activationId: "act-1",
        dispatcherParticipantId: "lead-1",
      }, { expectedClaim: null }),
      /claim \d+ appeared after check/,
    );
    assert.equal(s.prov.listBindings(issue.id).length, 0);
    assert.equal(dispatchedEvents(s.svc, issue.id).length, 0);

    // 3. malformed dispatcher values, rejected AFTER the fence has passed
    for (const bad of [
      { dispatcherSessionId: "not-a-session" },
      { dispatcherSessionId: "$" },
      { dispatcherSessionId: "01b1bd06-9481-85d6-a192" },
      { dispatcherParticipantId: "lead 1" },
      { dispatcherParticipantId: "lead;rm -rf /" },
    ]) {
      assert.throws(
        () => s.prov.dispatch(issue.id, {
          workspace: s.dir, participantId: "holder-a", activationId: "act-1", ...bad,
        }),
        /dispatcher/,
        `${JSON.stringify(bad)} must be rejected`,
      );
      assert.equal(s.prov.listBindings(issue.id).length, 0, `${JSON.stringify(bad)} wrote no binding`);
      assert.equal(dispatchedEvents(s.svc, issue.id).length, 0, `${JSON.stringify(bad)} wrote no event`);
    }

    // The rejected attempts did not damage the live claim: the honest dispatch works.
    const ok = s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "holder-a", activationId: "act-1",
      dispatcherParticipantId: "lead-1", dispatcherSessionId: "$1",
    });
    assert.equal(ok.claimId, claim.id);
    assert.equal(dispatchedEvents(s.svc, issue.id).length, 1);
  });

  // Guards: the sixteen-positional INSERT and the receipt joins. If the new
  // columns shifted the workspace/base_commit positions or the receipt path
  // stopped carrying the binding through, the dispatcher (or worse, the
  // workspace) would be attached to the wrong column and every backwards
  // lookup would report a plausible but wrong lineage.
  it("dispatcher survives allocate -> receipt -> commit/pr -> bundle and the backwards lookups", () => {
    const issue = readyIssue(s.svc);
    const binding = s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "worker-1", sessionId: EXEC_SESSION, baseCommit: SHA_B,
      dispatcherParticipantId: "lead-1", dispatcherSessionId: DISPATCH_SESSION,
    });
    assert.equal(binding.workspace, s.dir, "workspace still lands in the workspace column");

    const receipt = s.prov.allocateReceipt(binding.id);
    assert.equal(receipt.executionBindingId, binding.id);
    s.prov.bindCommit(receipt.id, SHA_A);
    s.prov.attachArtifact(receipt.id, "pr", "github:xtrm/xtrm#844", { provider: "github" });

    const trace = s.prov.trace(issue.id);
    assert.deepEqual(trace.commits, [SHA_A]);
    assert.deepEqual(trace.prs.map((p) => p.value), ["github:xtrm/xtrm#844"]);
    assert.equal(trace.bindings.length, 1);
    assert.equal(trace.bindings[0]!.dispatcherParticipantId, "lead-1");
    assert.equal(trace.bindings[0]!.dispatcherSessionId, DISPATCH_SESSION);
    assert.equal(trace.bindings[0]!.workspace, s.dir, "no column drift on the read path");
    assert.equal(trace.bindings[0]!.baseCommit, SHA_B);
    assert.equal(trace.bindings[0]!.sessionId, EXEC_SESSION);
    assert.equal(trace.bindings[0]!.participantId, "worker-1");

    const byCommit = s.prov.findByCommit(SHA_A);
    assert.equal(byCommit.length, 1);
    assert.equal(byCommit[0]!.receipt.id, receipt.id);
    assert.equal(byCommit[0]!.binding.dispatcherParticipantId, "lead-1");
    assert.equal(byCommit[0]!.binding.dispatcherSessionId, DISPATCH_SESSION);

    const byPr = s.prov.findByPr("github:xtrm/xtrm#844");
    assert.equal(byPr.length, 1);
    assert.equal(byPr[0]!.receipt.id, receipt.id);
    assert.equal(byPr[0]!.binding.dispatcherParticipantId, "lead-1");

    const { bundle } = s.prov.generateBundle(issue.id, { repoRoot: s.dir });
    assert.deepEqual(bundle.executionBindingIds, [binding.id]);
    assert.deepEqual(bundle.commitShas, [SHA_A]);

    const reread = s.prov.getBinding(binding.id);
    assert.equal(reread.dispatcherParticipantId, "lead-1");
    assert.equal(reread.dispatcherSessionId, DISPATCH_SESSION);

    const human = cliText(s.dbPath, ["provenance", "trace", issue.humanRef]);
    assert.match(human, /dispatched by lead-1 \(sess 01b1bd06-9481-85d6-a192-55a1764f8f02\)/);
  });

  // Guards: canonicalisation parity with the executor identity. A laxer rule
  // lets a non-canonical label or an uppercase/mixed session id into the
  // store (two spellings of one identity, so session/activation queries
  // silently miss); a stricter rule rejects a legitimate dispatcher that the
  // same value is accepted for as `--participant`.
  it("canonicalises tmux ids, UUID case and padding, with the executor label grammar", () => {
    const issue = readyIssue(s.svc);

    // Documented boundaries, asserted absolutely.
    const tmux0 = s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherSessionId: "$0" });
    assert.equal(tmux0.dispatcherSessionId, "$0", "tmux session 0 is valid");
    const tmux12 = s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherSessionId: "$12" });
    assert.equal(tmux12.dispatcherSessionId, "$12", "multi-digit tmux ids are valid");
    const upper = s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherSessionId: DISPATCH_SESSION_UPPER });
    assert.equal(upper.dispatcherSessionId, DISPATCH_SESSION, "uppercase UUID is canonicalised to lowercase");
    const padded = s.prov.dispatch(issue.id, {
      workspace: s.dir, dispatcherParticipantId: "  lead-1  ", dispatcherSessionId: `  ${DISPATCH_SESSION_UPPER}  `,
    });
    assert.equal(padded.dispatcherParticipantId, "lead-1", "surrounding whitespace is trimmed");
    assert.equal(padded.dispatcherSessionId, DISPATCH_SESSION);

    // Parity with the executor identity for every probe, including the label
    // length boundary and shell metacharacters, without hardcoding the grammar.
    const probes = [
      "lead-1",
      "a.b_c:d@e/f+g-h",
      "x".repeat(128),
      "x".repeat(129),
      "x".repeat(512),
      "a b",
      "a;b",
      "a|b",
      "$(id)",
      "`id`",
      "a'b",
      "-leading-dash",
      "ünïcode",
      "  padded  ",
    ];
    for (const probe of probes) {
      let asParticipant: string | null = null;
      let participantRejected = false;
      try {
        asParticipant = s.prov.dispatch(issue.id, { workspace: s.dir, participantId: probe }).participantId;
      } catch {
        participantRejected = true;
      }
      let asDispatcher: string | null = null;
      let dispatcherRejected = false;
      try {
        asDispatcher = s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherParticipantId: probe }).dispatcherParticipantId;
      } catch {
        dispatcherRejected = true;
      }
      assert.equal(
        dispatcherRejected,
        participantRejected,
        `${JSON.stringify(probe)}: --dispatcher-participant must accept exactly what --participant accepts`,
      );
      if (!participantRejected) {
        assert.equal(asDispatcher, asParticipant, `${JSON.stringify(probe)} canonicalises the same both ways`);
      }
    }
  });

  // Guards: the CLI wiring. Repeated flags are documented last-wins and a bare
  // flag never clobbers an earlier value; an empty value is not "absent", it
  // is a malformed identity. Wiring the dispatcher flags through a list reader
  // (or coercing "" to null) would silently store a dispatcher nobody named.
  it("CLI: repeated dispatcher flags are last-wins and an empty value fails closed", () => {
    const issue = readyIssue(s.svc);
    const data = cliJson(s.dbPath, [
      "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--dispatcher-participant", "first", "--dispatcher-participant", "last",
      "--dispatcher-session", "$1", "--dispatcher-session", "$2",
    ]);
    assert.equal(data["dispatcherParticipantId"], "last");
    assert.equal(data["dispatcherSessionId"], "$2");

    const bare = cliJson(s.dbPath, [
      "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--dispatcher-participant", "kept", "--dispatcher-participant",
    ]);
    assert.equal(bare["dispatcherParticipantId"], "kept", "a bare flag never clobbers a supplied value");

    for (const argv of [
      ["--dispatcher-participant", ""],
      ["--dispatcher-session", ""],
    ]) {
      const res = runCli([
        "--db", s.dbPath, "--project", "prj_xtrm", "--json",
        "provenance", "dispatch", issue.humanRef, "--workspace", s.dir, ...argv,
      ]);
      assert.equal(res.code, 1, `sb provenance dispatch ${argv.join(" ")} must fail closed`);
      assert.match(res.stdout, /dispatcher/);
    }
    assert.equal(s.prov.listBindings(issue.id).length, 2, "the two accepted dispatches only");
  });

  // Guards: per-binding association and order. A join or projection that
  // reads the dispatcher from the wrong row (or collapses the array to the
  // last value) reports one session's dispatcher for another session's work.
  it("two bindings with different dispatchers keep per-binding values in trace order", () => {
    const issue = readyIssue(s.svc);
    const first = s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "worker-1", activationId: "act-1", sessionId: EXEC_SESSION,
      dispatcherParticipantId: "lead-1", dispatcherSessionId: "$1",
    });
    const second = s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "worker-2", activationId: "act-2", sessionId: EXEC_SESSION,
      dispatcherParticipantId: "lead-2", dispatcherSessionId: "$2",
    });

    const trace = s.prov.trace(issue.id);
    assert.deepEqual(trace.bindings.map((b) => b.id), [first.id, second.id], "trace keeps dispatch order");
    assert.deepEqual(trace.bindings.map((b) => b.dispatcherParticipantId), ["lead-1", "lead-2"]);
    assert.deepEqual(trace.bindings.map((b) => b.dispatcherSessionId), ["$1", "$2"]);

    const session = s.prov.sessionDetail(EXEC_SESSION);
    assert.deepEqual(session.dispatchers, [
      { bindingId: first.id, dispatcherParticipantId: "lead-1", dispatcherSessionId: "$1" },
      { bindingId: second.id, dispatcherParticipantId: "lead-2", dispatcherSessionId: "$2" },
    ]);

    const activation = s.prov.activationDetail("act-1");
    assert.deepEqual(
      activation.dispatchers,
      [{ bindingId: first.id, dispatcherParticipantId: "lead-1", dispatcherSessionId: "$1" }],
      "one activation reports only its own binding's dispatcher",
    );

    const human = cliText(s.dbPath, ["provenance", "trace", issue.humanRef]);
    const firstAt = human.indexOf("dispatched by lead-1 (sess $1)");
    const secondAt = human.indexOf("dispatched by lead-2 (sess $2)");
    assert.ok(firstAt >= 0 && secondAt >= 0, `both dispatchers print:\n${human}`);
    assert.ok(firstAt < secondAt, "human trace prints them in dispatch order");
  });

  // Guards: the JSON surfaces stay additive. The dispatcher fields are new, so
  // every pre-017 key a consumer already reads must still be present under the
  // same name; a rename or a drop is a silent contract break.
  it("JSON output for dispatch, trace, session and activation is additive", () => {
    const issue = readyIssue(s.svc);
    const binding = s.prov.dispatch(issue.id, {
      workspace: s.dir, participantId: "worker-1", activationId: "act-1", sessionId: EXEC_SESSION,
      dispatcherParticipantId: "lead-1", dispatcherSessionId: "$1",
    });
    const receipt = s.prov.allocateReceipt(binding.id);
    s.prov.bindCommit(receipt.id, SHA_A);

    const dispatched = cliJson(s.dbPath, [
      "provenance", "dispatch", issue.humanRef, "--workspace", s.dir,
      "--dispatcher-participant", "lead-1", "--dispatcher-session", "$1",
    ]);
    for (const key of ["bindingId", "issueId", "revision", "contractHash", "dispatcherParticipantId", "dispatcherSessionId"]) {
      assert.ok(key in dispatched, `dispatch json still carries ${key}`);
    }

    const trace = cliJson(s.dbPath, ["provenance", "trace", issue.humanRef]);
    const bindingView = (trace["bindings"] as Array<Record<string, unknown>>)[0]!;
    for (const key of [
      "id", "issueId", "issueRevision", "contractHash", "resolvedContextHash", "claimId",
      "participantId", "activationId", "attemptId", "sessionId", "workspace", "baseCommit", "createdAt",
      "dispatcherParticipantId", "dispatcherSessionId",
    ]) {
      assert.ok(key in bindingView, `trace binding still carries ${key}`);
    }
    assert.equal(bindingView["dispatcherParticipantId"], "lead-1");

    const session = cliJson(s.dbPath, ["provenance", "session", EXEC_SESSION]);
    for (const key of ["sessionId", "issueIds", "bindingIds", "receiptIds", "artifacts", "resultCount", "dispatchers"]) {
      assert.ok(key in session, `session json still carries ${key}`);
    }
    assert.equal(session["sessionId"], EXEC_SESSION);

    const activation = cliJson(s.dbPath, ["provenance", "activation", "act-1"]);
    for (const key of ["activationId", "issueIds", "bindingIds", "receiptIds", "artifacts", "dispatchers"]) {
      assert.ok(key in activation, `activation json still carries ${key}`);
    }
    assert.equal(activation["activationId"], "act-1");
  });
});

describe("XTRM-844 adversarial: migration 017", () => {
  // Guards: append-only migration discipline. A reopen must not re-run the
  // ALTERs (which would throw or duplicate state), must not rewrite the
  // recorded checksum (a landed migration is immutable, the runner fails
  // closed on any change), and must leave the rows and the columns alone.
  it("reopen is idempotent and the ledger checksum is stable", () => {
    const dir = tempDir("substrate-844-mig-");
    try {
      const dbPath = join(dir, "state.db");
      const seed = openSubstrate(dbPath);
      seed.close();

      const readLedger = (db: ReturnType<typeof openSubstrate>) => {
        const cols = db.prepare("PRAGMA table_info(execution_bindings)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
        const rows = db.prepare("SELECT version, name, checksum FROM schema_migrations WHERE version = 17").all() as Array<{ version: number; name: string; checksum: string }>;
        const maxVersion = (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v;
        return { cols, rows, maxVersion };
      };

      const first = openSubstrate(dbPath);
      const firstLedger = readLedger(first);
      assert.equal(firstLedger.maxVersion, 18, "the store is at head 18 (017 landed, then XTRM-959's 018)");
      assert.equal(firstLedger.rows.length, 1, "exactly one ledger row for 017");
      assert.match(firstLedger.rows[0]!.checksum, /^[0-9a-f]{64}$/, "the checksum is a sha256 hex digest");
      first.close();

      let checksum = firstLedger.rows[0]!.checksum;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const again = openSubstrate(dbPath);
        try {
          const ledger = readLedger(again);
          const dispatcherCols = ledger.cols.filter((c) => c.name.startsWith("dispatcher_"));
          assert.deepEqual(
            dispatcherCols.map((c) => c.name).sort(),
            ["dispatcher_participant_id", "dispatcher_session_id"],
            `reopen ${attempt}: the columns are added exactly once`,
          );
          for (const col of dispatcherCols) {
            assert.equal(col.notnull, 0, `reopen ${attempt}: ${col.name} stays nullable`);
            assert.equal(col.dflt_value, null, `reopen ${attempt}: ${col.name} has no default`);
          }
          assert.equal(ledger.rows.length, 1, `reopen ${attempt}: no duplicate ledger row`);
          assert.equal(ledger.rows[0]!.name, "dispatcher-identity");
          assert.equal(ledger.rows[0]!.checksum, checksum, `reopen ${attempt}: the recorded checksum is unchanged`);
          checksum = ledger.rows[0]!.checksum;
        } finally {
          again.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
