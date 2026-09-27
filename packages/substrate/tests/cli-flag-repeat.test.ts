// XTRM-552: a repeated evidence flag must never silently discard a value.
//
// These are CLI-level tests, not parser-unit tests: every case drives
// `sb issue close` or `sb issue cancel` through runCli (the entry the `sb`
// binary itself uses) and then reads the persisted, immutable
// `issue_closures` row. The loss only manifests through the close/cancel
// path, so the assertions target *_refs_json rather than the in-memory
// parser map.
//
// Store discipline mirrors closure.test.ts: an explicit temporary
// SUBSTRATE_DB under /var/tmp; the live store is never touched.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
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

interface Scratch {
  dbPath: string;
  issueId: string;
}

function scratch(title: string): Scratch {
  const dir = mkdtempSync(join(SCOPE, "x552-"));
  scratchDirs.push(dir);
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title,
    kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  return { dbPath, issueId: issue.id };
}

interface Envelope {
  schema?: string;
  ok?: boolean;
  data?: unknown;
  error?: string;
}

function cli(dbPath: string, argv: string[]): { code: number; env: Envelope } {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  return { code: res.code, env: JSON.parse(res.stdout) as Envelope };
}

function cliOk(dbPath: string, argv: string[]): unknown {
  const { code, env } = cli(dbPath, argv);
  assert.equal(code, 0, `sb ${argv.join(" ")} failed: ${JSON.stringify(env)}`);
  assert.equal(env.ok, true, `sb ${argv.join(" ")} returned ok=false`);
  assert.equal(env.schema, SCHEMA_VERSION);
  return env.data;
}

interface PersistedClosure {
  actor: string;
  validation: string[];
  result: string[];
  receipt: string[];
  artifact: string[];
}

// The immutable evidence of record: read the newest closure row back from
// SQLite, never from the closing process's own output.
function persisted(dbPath: string, issueId: string): PersistedClosure {
  const db = openSubstrate(dbPath);
  try {
    const row = db
      .prepare(
        `SELECT actor, validation_refs_json, journal_result_refs_json, receipt_refs_json, artifact_refs_json
           FROM issue_closures
          WHERE issue_id = ?
          ORDER BY closed_at DESC, closure_id DESC
          LIMIT 1`,
      )
      .get(issueId) as Record<string, string> | undefined;
    assert.ok(row, `no closure row persisted for ${issueId}`);
    return {
      actor: row["actor"] as string,
      validation: JSON.parse(row["validation_refs_json"] as string) as string[],
      result: JSON.parse(row["journal_result_refs_json"] as string) as string[],
      receipt: JSON.parse(row["receipt_refs_json"] as string) as string[],
      artifact: JSON.parse(row["artifact_refs_json"] as string) as string[],
    };
  } finally {
    db.close();
  }
}

describe("XTRM-552 repeated evidence flags — issue close", () => {
  it("persists every repeated --validation/--result/--receipt/--artifact in caller order", () => {
    const { dbPath, issueId } = scratch("repeated close flags");
    cliOk(dbPath, [
      "issue", "close", issueId, "--project", "prj_xtrm",
      "--outcome", "completed", "--reason", "done",
      "--validation", "v1", "--validation", "v2",
      "--result", "r1", "--result", "r2",
      "--receipt", "c1", "--receipt", "c2",
      "--artifact", "a1", "--artifact", "a2",
    ]);
    const row = persisted(dbPath, issueId);
    assert.deepEqual(row.validation, ["v1", "v2"]);
    assert.deepEqual(row.result, ["r1", "r2"]);
    assert.deepEqual(row.receipt, ["c1", "c2"]);
    assert.deepEqual(row.artifact, ["a1", "a2"]);
  });

  it("merges repeated values with comma-separated values in caller order", () => {
    const { dbPath, issueId } = scratch("mixed close flags");
    cliOk(dbPath, [
      "issue", "close", issueId, "--project", "prj_xtrm",
      "--outcome", "completed", "--reason", "done",
      "--validation", "v1,v2", "--validation", "v3",
      "--artifact", "a1", "--artifact", "a2,a3",
    ]);
    const row = persisted(dbPath, issueId);
    assert.deepEqual(row.validation, ["v1", "v2", "v3"]);
    assert.deepEqual(row.artifact, ["a1", "a2", "a3"]);
  });

  it("keeps the documented single comma-separated spelling unchanged", () => {
    const { dbPath, issueId } = scratch("comma close flags");
    cliOk(dbPath, [
      "issue", "close", issueId, "--project", "prj_xtrm",
      "--outcome", "completed", "--reason", "done",
      "--validation", "v1,v2", "--result", "r1,r2",
      "--receipt", "c1,c2", "--artifact", "a1,a2",
    ]);
    const row = persisted(dbPath, issueId);
    assert.deepEqual(row.validation, ["v1", "v2"]);
    assert.deepEqual(row.result, ["r1", "r2"]);
    assert.deepEqual(row.receipt, ["c1", "c2"]);
    assert.deepEqual(row.artifact, ["a1", "a2"]);
  });

  it("documents repeated scalar flags as explicit last-wins, not accident", () => {
    const { dbPath, issueId } = scratch("repeated scalar");
    cliOk(dbPath, [
      "issue", "close", issueId, "--project", "prj_xtrm",
      "--outcome", "completed", "--reason", "first", "--reason", "second",
      "--actor", "actor-one", "--actor", "actor-two",
    ]);
    const row = persisted(dbPath, issueId);
    assert.equal(row.actor, "actor-two");
  });

  it("treats a repeated boolean flag as idempotent presence", () => {
    const { dbPath, issueId } = scratch("repeated boolean");
    const { code, env } = cli(dbPath, [
      "issue", "close", issueId, "--project", "prj_xtrm",
      "--outcome", "completed", "--reason", "done",
      "--json", "--json",
    ]);
    assert.equal(code, 0, `repeated --json failed: ${JSON.stringify(env)}`);
    assert.equal(env.ok, true);
    assert.equal(env.schema, SCHEMA_VERSION);
  });
});

describe("XTRM-552 repeated evidence flags — issue cancel", () => {
  it("persists every repeated evidence flag in caller order", () => {
    const { dbPath, issueId } = scratch("repeated cancel flags");
    cliOk(dbPath, [
      "issue", "cancel", issueId, "--project", "prj_xtrm",
      "--reason", "dropped",
      "--validation", "v1", "--validation", "v2",
      "--result", "r1", "--result", "r2",
      "--receipt", "c1", "--receipt", "c2",
      "--artifact", "a1", "--artifact", "a2",
    ]);
    const row = persisted(dbPath, issueId);
    assert.deepEqual(row.validation, ["v1", "v2"]);
    assert.deepEqual(row.result, ["r1", "r2"]);
    assert.deepEqual(row.receipt, ["c1", "c2"]);
    assert.deepEqual(row.artifact, ["a1", "a2"]);
  });

  it("keeps the documented single comma-separated spelling unchanged", () => {
    const { dbPath, issueId } = scratch("comma cancel flags");
    cliOk(dbPath, [
      "issue", "cancel", issueId, "--project", "prj_xtrm",
      "--reason", "dropped",
      "--validation", "v1,v2", "--artifact", "a1,a2",
    ]);
    const row = persisted(dbPath, issueId);
    assert.deepEqual(row.validation, ["v1", "v2"]);
    assert.deepEqual(row.artifact, ["a1", "a2"]);
  });
});
