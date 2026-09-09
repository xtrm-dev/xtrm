import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SB = join(here, "..", "cli", "sb.ts");

function setupDb(): { dir: string; dbPath: string; svc: IssueService } {
  const dir = mkdtempSync(join(tmpdir(), "sb-smoke-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_demo", prefix: "DEMO", name: "smoke" });
  db.close();
  return { dir, dbPath, svc };
}

function cli(dbPath: string, argv: string[]): { code: number; data: unknown; raw: string } {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; command: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return { code: res.code, data: env.data, raw: res.stdout };
}

function contractFile(dir: string, name: string, overrides: Record<string, unknown> = {}): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify({ ...contract(), ...overrides }));
  return p;
}

describe("sb CLI smoke: create -> contract -> attest -> claim -> close", () => {
  it("drives the full lifecycle through the CLI with a stable JSON schema", () => {
    const { dir, dbPath } = setupDb();
    const c1 = contractFile(dir, "c1.json", { problem: "Smoke problem", success: "Smoke success" });

    // create
    const created = cli(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "Smoke", "--kind", "task", "--contract", c1, "--scrutiny", "LOW"]).data as {
      locator: string; humanRef: string; revision: number;
    };
    assert.match(created.locator, /^DEMO-1$/);
    assert.equal(created.humanRef, "DEMO-1");
    assert.ok(!("id" in created), "machine ID stays out of summaries");

    // contract (edit) bumps the revision
    const c2 = contractFile(dir, "c2.json", { problem: "Smoke problem v2", success: "Smoke success" });
    const edited = cli(dbPath, ["issue", "edit", created.humanRef, "--contract", c2]).data as { revision: number; revisionCreated: boolean };
    assert.equal(edited.revision, 2);
    assert.equal(edited.revisionCreated, true);

    // attest via the typed service (no attest verb: attestation is service
    // authority, the CLI only proves the service)
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    const issue = svc.resolveRef(created.humanRef);
    svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "smoke" });
    db.close();

    // validate + ready agree through the CLI
    const validated = cli(dbPath, ["issue", "validate", created.humanRef]).data as { state: string; dispatchable: boolean };
    assert.equal(validated.dispatchable, true);
    const ready = cli(dbPath, ["issue", "ready", "--project", "prj_demo"]).data as Array<{ humanRef: string }>;
    assert.ok(ready.some((r) => r.humanRef === "DEMO-1"));

    // claim -> close
    const claimed = cli(dbPath, ["issue", "claim", created.humanRef, "--holder", "smoke-holder"]).data as { holder: string };
    assert.equal(claimed.holder, "smoke-holder");
    const closed = cli(dbPath, ["issue", "close", created.humanRef]).data as { lifecycleState: string };
    assert.equal(closed.lifecycleState, "done");
    cli(dbPath, ["issue", "release", created.humanRef, "--holder", "smoke-holder"]);
  });

  it("resolves all five ID forms through every Issue-taking command", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json");
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    const parent = svc.createIssue({ projectId: "prj_demo", title: "Parent", kind: "epic", contract: contract() });
    db.close();

    const child = cli(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "Child", "--kind", "task", "--contract", c, "--parent", parent.humanRef]).data as {
      locator: string; humanRef: string;
    };
    assert.match(child.locator, /^DEMO-1\.1$/);

    const db2 = openSubstrate(dbPath);
    const svc2 = new IssueService(db2);
    const childId = svc2.resolveRef(child.humanRef).id;
    svc2.addAlias(childId, "smoke-alias", "test");
    const lone = svc2.createIssue({ projectId: "prj_demo", title: "Other", kind: "task", contract: contract() });
    svc2.setParent(childId, lone.id);
    const movedLocator = svc2.currentLocator(childId);
    db2.close();

    const forms = [childId, child.humanRef, movedLocator, child.locator, "smoke-alias"];
    for (const form of forms) {
      const shown = cli(dbPath, ["issue", "show", form]).data as { humanRef: string };
      assert.equal(shown.humanRef, child.humanRef, `form did not resolve: ${form}`);
    }
    // children + relate + tree + list exercise the remaining verbs
    const kids = cli(dbPath, ["issue", "children", lone.humanRef]).data as Array<{ humanRef: string }>;
    assert.ok(kids.some((k) => k.humanRef === child.humanRef));
    cli(dbPath, ["issue", "relate", "--from", child.humanRef, "--to", parent.humanRef, "--kind", "relates_to"]);
    const tree = cli(dbPath, ["issue", "tree", "--project", "prj_demo"]).data as unknown[];
    assert.ok(tree.length >= 1);
    const list = cli(dbPath, ["issue", "list", "--project", "prj_demo"]).data as unknown[];
    assert.equal(list.length, 3);
  });

  it("checks and applies a plan through the CLI", () => {
    const { dir, dbPath } = setupDb();
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, JSON.stringify({
      planKey: "smoke-plan",
      issues: [
        { key: "a", projectId: "prj_demo", title: "Plan A", kind: "task", contract: contract(), scrutiny: "LOW" },
        { key: "b", projectId: "prj_demo", title: "Plan B", kind: "task", contract: contract(), scrutiny: "LOW" },
      ],
      edges: [{ fromKey: "a", toKey: "b", kind: "blocks" }],
    }));
    const check = cli(dbPath, ["plan", "check", "--file", planPath]).data as { ok: boolean };
    assert.equal(check.ok, true);
    const applied = cli(dbPath, ["plan", "apply", "--file", planPath]).data as { applied: boolean; issues: unknown[] };
    assert.equal(applied.applied, true);
    assert.equal(applied.issues.length, 2);
    const list = cli(dbPath, ["issue", "list", "--project", "prj_demo"]).data as unknown[];
    assert.equal(list.length, 2);
  });

  it("fails closed with the error envelope, never a stack", () => {
    const { dbPath } = setupDb();
    const res = runCli(["--db", dbPath, "--json", "issue", "show", "NOPE-999"]);
    assert.equal(res.code, 1);
    const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; error: string };
    assert.equal(env.schema, SCHEMA_VERSION);
    assert.equal(env.ok, false);
    assert.match(env.error, /unresolvable|unknown/i);
  });

  it("the sb bin runs as a real process", () => {
    const { dbPath } = setupDb();
    const out = execFileSync(process.execPath, [SB, "--db", dbPath, "--json", "issue", "list", "--project", "prj_demo"], { encoding: "utf8" });
    const env = JSON.parse(out) as { schema: string; ok: boolean; data: unknown[] };
    assert.equal(env.schema, SCHEMA_VERSION);
    assert.equal(env.ok, true);
    assert.deepEqual(env.data, []);
  });
});
