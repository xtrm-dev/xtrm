// A1 (§22,§24,§26,§27): CLI journal + lifecycle surfaces.
// note (append-only, no revision bump), edit metadata vs execution-bearing
// classification, state machine + aliases, relate/unrelate.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

function setupDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "sb-a1-"));
  return join(dir, "state.db");
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

function seed(dbPath: string): { a: string; b: string } {
  const dir = mkdtempSync(join(tmpdir(), "sb-a1c-"));
  const c = join(dir, "c.json");
  writeFileSync(
    c,
    JSON.stringify(contract({ nonGoals: ["b"], constraints: ["c"] })),
  );
  cli(dbPath, ["project", "create", "--prefix", "EV", "--name", "e"]);
  const a = cli(dbPath, ["issue", "create", "--project", "prj_ev", "--title", "A", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
  const b = cli(dbPath, ["issue", "create", "--project", "prj_ev", "--title", "B", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
  return { a: a.humanRef, b: b.humanRef };
}

describe("A1 CLI journal + lifecycle", () => {
  it("§22: note is append-only journal, never bumps the revision", () => {
    const db = setupDb();
    const { a } = seed(db);
    cli(db, ["issue", "note", a, "a finding"]);
    cli(db, ["issue", "note", a, "a decision", "--kind", "decision"]);
    const shown = cli(db, ["issue", "show", a]) as { revision: number };
    assert.equal(shown.revision, 1);
    const entries = cli(db, ["journal", "show", a]) as Array<{ kind: string; semantic: { summary: string } }>;
    assert.deepEqual(entries.map((e) => e.kind), ["note", "decision"]);
    assert.equal(entries[0]!.semantic.summary, "a finding");
    assert.match(cliFail(db, ["issue", "note", a, "x", "--kind", "checkpoint"]), /unknown note kind/);
    assert.match(cliFail(db, ["issue", "note", a]), /note text is required/);
  });

  it("§24: title/priority keep revision + readiness; contract/ownership/context/scrutiny bump", () => {
    const db = setupDb();
    const { a } = seed(db);
    cli(db, ["issue", "attest", a, "--outcome", "ready", "--policy", "default", "--attested-by", "t"]);
    const meta = cli(db, ["issue", "edit", a, "--title", "A2", "--priority", "2"]) as { revision: number; revisionCreated: boolean };
    assert.equal(meta.revision, 1);
    assert.equal(meta.revisionCreated, false);
    const still = cli(db, ["issue", "validate", a]) as { state: string };
    assert.equal(still.state, "ready");
    for (const args of [
      ["--scrutiny", "HIGH"],
      ["--ownership", '{"paths":["x"]}'],
      ["--context-refs", '[{"key":"k","value":1}]'],
    ]) {
      const r = cli(db, ["issue", "edit", a, ...args]) as { revisionCreated: boolean };
      assert.equal(r.revisionCreated, true, args.join(" "));
    }
    const after = cli(db, ["issue", "validate", a]) as { revision: number; attestationCurrent: boolean; state: string };
    assert.equal(after.revision, 4);
    assert.equal(after.attestationCurrent, false);
    assert.equal(after.state, "draft");
    assert.match(cliFail(db, ["issue", "edit", a]), /nothing to edit/);
  });

  it("§26: state machine + aliases emit durable transitions", () => {
    const db = setupDb();
    const { a } = seed(db);
    const s = (st: string) => cli(db, ["issue", "state", a, st]) as { lifecycleState: string };
    assert.equal(s("deferred").lifecycleState, "deferred");
    assert.equal(s("open").lifecycleState, "open");
    assert.equal(s("done").lifecycleState, "done");
    assert.equal(s("cancelled").lifecycleState, "cancelled");
    assert.equal(s("archived").lifecycleState, "archived");
    const alias = (verb: string) => cli(db, ["issue", verb, a]) as { lifecycleState: string };
    assert.equal(alias("reopen").lifecycleState, "open");
    assert.equal(alias("defer").lifecycleState, "deferred");
    assert.equal(alias("cancel").lifecycleState, "cancelled");
    assert.equal(alias("archive").lifecycleState, "archived");
    assert.equal(alias("close").lifecycleState, "done");
    assert.match(cliFail(db, ["issue", "state", a, "bogus"]), /unknown lifecycle state/);
  });

  it("§27: relate + unrelate typed edges; parent_child stays structural", () => {
    const db = setupDb();
    const { a, b } = seed(db);
    cli(db, ["issue", "relate", "--from", a, "--to", b, "--kind", "blocks"]);
    const un = cli(db, ["issue", "unrelate", "--from", a, "--to", b, "--kind", "blocks"]) as { kind: string };
    assert.equal(un.kind, "blocks");
    assert.match(cliFail(db, ["issue", "unrelate", "--from", a, "--to", b, "--kind", "blocks"]), /no active blocks edge/);
    assert.match(cliFail(db, ["issue", "unrelate", "--from", a, "--to", b, "--kind", "parent_child"]), /structural/);
  });
});
