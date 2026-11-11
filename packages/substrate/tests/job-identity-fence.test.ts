// XTRM-451 regression fence: a specialists job identity must never reach the
// session column.
//
// The historical defect (XTRM-379, 2026-09-15) stored the same job identity
// twice: `issue_journal.session_id = "122c14"` beside `run_id = "job-122c14"`,
// and `execution_bindings.session_id = "122c14"` beside
// `activation_id = "job-122c14"`. The trace (XTRM-451 rev2) showed the writer
// was a hand-typed CLI call during a live settlement verification, not a code
// producer: the specialists publication path always stamps `ctx.actor` and
// never assigns `runId`, and the activation host mints `act:<uuid12>`.
//
// These tests pin the durable half of that finding: the historic shape is
// refused fail-closed with ZERO rows written, and the corrected shape stores
// the job id in `run_id` with the session absent. Asserting row counts matters
// as much as the message: a frozen error string with a half-written row would
// be a worse outcome than the original bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { runUxCli } from "../cli/sb-ux.ts";
import { contract, tempDir } from "./helpers.ts";

const JOB_ID = "122c14";
const JOB_ACTIVATION = "job-122c14";
const JOB_RUN = "job-122c14";
const SESSION_REFUSAL = /session identity must be a canonical lowercase UUID or tmux session id/;

// Identity env is scrubbed per test and restored afterwards (XTRM-448): an
// ambient XTRM_SESSION_ID would otherwise fill the session the test asserts is
// absent, and an ambient SUBSTRATE_HOLDER would fill participant identity.
const IDENTITY_ENV = ["SUBSTRATE_PROJECT", "XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"];

async function withScratchEnv(body: (ctx: {
  dir: string;
  dbPath: string;
  db: ReturnType<typeof openSubstrate>;
  svc: IssueService;
  issueRef: string;
}) => Promise<void>): Promise<void> {
  const saved = new Map(IDENTITY_ENV.map((key) => [key, process.env[key]]));
  const dir = tempDir("job-identity-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  try {
    for (const key of IDENTITY_ENV) delete process.env[key];
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_test", prefix: "TEST", name: "test" });
    const issue = svc.createIssue({
      projectId: "prj_test",
      title: "job identity fence",
      kind: "task",
      contract: contract(),
      scrutiny: "LOW",
      authoredBy: "tester",
    });
    svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    svc.claimIssue(issue.id, "tester");
    await body({ dir, dbPath, db, svc, issueRef: issue.id });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("XTRM-451 provenance dispatch refuses a job id in the session field and writes no binding", async () => {
  await withScratchEnv(async ({ dir, dbPath, db, svc, issueRef }) => {
    const result = await runUxCli([
      "--db", dbPath, "--project", "prj_test",
      "provenance", "dispatch", issueRef,
      "--workspace", dir,
      "--participant", "specialist::explorer",
      "--activation", JOB_ACTIVATION,
      "--session", JOB_ID,
    ]);
    assert.equal(result.code, 1, "the historic dispatch shape must fail closed");
    assert.match(result.stderr, SESSION_REFUSAL);
    assert.match(result.stderr, /xtrmSessionId/, "the refusal must name the rejected field");
    assert.equal(
      new ProvenanceService(db, svc).listBindings(issueRef).length,
      0,
      "a refused dispatch must leave no execution binding",
    );
  });
});

test("XTRM-451 journal append refuses a job id in the session field and writes no entry", async () => {
  await withScratchEnv(async ({ dbPath, db, svc, issueRef }) => {
    const result = await runUxCli([
      "--db", dbPath, "--project", "prj_test",
      "journal", "append", issueRef,
      "--kind", "result",
      "--result", JSON.stringify({ summary: "job settlement" }),
      "--run", JOB_RUN,
      "--session", JOB_ID,
    ]);
    assert.equal(result.code, 1, "the historic journal shape must fail closed");
    assert.match(result.stderr, SESSION_REFUSAL);
    assert.match(result.stderr, /sessionId/, "the refusal must name the rejected field");
    assert.equal(
      new JournalService(db, svc).timeline(issueRef).length,
      0,
      "a refused append must leave no journal row",
    );
  });
});

test("XTRM-451 the corrected shape stores the job id in run_id with the session absent", async () => {
  await withScratchEnv(async ({ dbPath, db, svc, issueRef }) => {
    const result = await runUxCli([
      "--db", dbPath, "--project", "prj_test",
      "journal", "append", issueRef,
      "--kind", "result",
      "--result", JSON.stringify({ summary: "job settlement" }),
      "--run", JOB_RUN,
      "--activation", JOB_ACTIVATION,
      "--participant", "specialist::explorer",
    ]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const entries = new JournalService(db, svc).timeline(issueRef);
    assert.equal(entries.length, 1);
    const entry = entries[0]!;
    assert.equal(entry.runId, JOB_RUN, "the job id belongs in run_id");
    assert.equal(entry.sessionId, null, "the session must stay absent, never the job id");
    assert.equal(entry.activationId, JOB_ACTIVATION);
  });
});
