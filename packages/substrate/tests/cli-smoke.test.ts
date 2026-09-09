import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
      id: string; locator: string; humanRef: string; revision: number;
    };
    assert.match(created.locator, /^DEMO-1$/);
    assert.equal(created.humanRef, "DEMO-1");
    assert.match(created.id, /^iss_/, "JSON create carries the machine ID (xtrm-7wc.5.2)");

    // contract (edit) bumps the revision
    const c2 = contractFile(dir, "c2.json", { problem: "Smoke problem v2", success: "Smoke success" });
    const edited = cli(dbPath, ["issue", "edit", created.humanRef, "--contract", c2]).data as { revision: number; revisionCreated: boolean };
    assert.equal(edited.revision, 2);
    assert.equal(edited.revisionCreated, true);

    // attest through the CLI (attestation stays service authority; the CLI
    // only carries the actor + policy + outcome bytes)
    const attested = cli(dbPath, ["issue", "attest", created.humanRef, "--outcome", "ready", "--policy", "default", "--attested-by", "smoke"]).data as {
      outcome: string; policy: string; attestedBy: string;
    };
    assert.equal(attested.outcome, "ready");
    assert.equal(attested.policy, "default");
    assert.equal(attested.attestedBy, "smoke");

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

  it("creates a project through the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-smoke-"));
    const dbPath = join(dir, "state.db");
    const project = cli(dbPath, ["project", "create", "--prefix", "NEW", "--name", "fresh"]).data as {
      id: string; prefix: string; name: string;
    };
    assert.equal(project.id, "prj_new");
    assert.equal(project.prefix, "NEW");
    assert.equal(project.name, "fresh");
    // issues land in the CLI-created project with zero service calls
    const c = contractFile(dir, "c.json", { problem: "P", success: "S" });
    const created = cli(dbPath, ["issue", "create", "--project", project.id, "--title", "T", "--kind", "task", "--contract", c]).data as {
      humanRef: string;
    };
    assert.equal(created.humanRef, "NEW-1");
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

  it("rejects unknown flags instead of silently dropping intent (xtrm-7wc.5.4)", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { problem: "P", success: "S" });
    const created = cli(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c]).data as {
      humanRef: string;
    };
    // the E2E case: --summary does not exist; the entry must not store
    // nothing with exit 0
    const bad = runCli(["--db", dbPath, "--json", "journal", "append", created.humanRef, "--kind", "finding", "--summary", "dropped text"]);
    assert.equal(bad.code, 1);
    const env = JSON.parse(bad.stdout) as { ok: boolean; error: string };
    assert.equal(env.ok, false);
    assert.match(env.error, /--summary/);
    // every documented verb still parses: spot-check one flag per group
    cli(dbPath, ["issue", "validate", created.humanRef]);
    cli(dbPath, ["journal", "show", created.humanRef, "--limit", "5"]);
    cli(dbPath, ["project", "create", "--prefix", "OK", "--name", "fine"]);
  });

  it("renders children indented under parents in human tree output", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { problem: "P", success: "S" });
    const parent = cli(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "Parent", "--kind", "task", "--contract", c]).data as {
      humanRef: string;
    };
    const child = cli(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "Child", "--kind", "task", "--contract", c, "--parent", parent.humanRef]).data as {
      humanRef: string;
    };
    // human forest view: child indented under its parent
    const forest = runCli(["--db", dbPath, "issue", "tree", "--project", "prj_demo"]);
    assert.equal(forest.code, 0, forest.stderr);
    const lines = forest.stdout.split("\n");
    const parentLine = lines.find((l) => l.includes(parent.humanRef));
    const childLine = lines.find((l) => l.includes(child.humanRef));
    assert.ok(parentLine && !parentLine.startsWith(" "), "root starts at depth 0");
    assert.ok(childLine && childLine.startsWith("  ") && !childLine.startsWith("    "), "child indented one level");
    // human single-root view walks too
    const single = runCli(["--db", dbPath, "issue", "tree", "--root", parent.humanRef]);
    assert.equal(single.code, 0, single.stderr);
    assert.ok(single.stdout.split("\n").some((l) => l.startsWith("  ") && l.includes(child.humanRef)));
    // JSON shape unchanged: nested children array intact
    const json = cli(dbPath, ["issue", "tree", "--project", "prj_demo"]).data as Array<{ children: unknown[] }>;
    assert.equal(json.length, 1);
    assert.equal(json[0]?.children.length, 1);
  });

  it("journal show returns entry bodies; since stays compact (xtrm-7wc.6.2)", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { problem: "P", success: "S" });
    const created = cli(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c]).data as {
      humanRef: string;
    };
    cli(dbPath, [
      "journal", "append", created.humanRef, "--kind", "finding",
      "--semantic", JSON.stringify({ summary: "The cache never invalidates", current: "Proving it", next: ["Fix it"] }),
    ]);
    // JSON show round-trips the full body
    const shown = cli(dbPath, ["journal", "show", created.humanRef]).data as Array<{
      semantic: { summary: string; current: string; next: string[] } | null;
      mechanical: unknown;
    }>;
    assert.equal(shown.length, 1);
    assert.equal(shown[0]?.semantic?.summary, "The cache never invalidates");
    assert.deepEqual(shown[0]?.semantic?.next, ["Fix it"]);
    // human show prints the entry text under the header line
    const human = runCli(["--db", dbPath, "journal", "show", created.humanRef]);
    assert.equal(human.code, 0, human.stderr);
    assert.ok(human.stdout.includes("summary: The cache never invalidates"));
    assert.ok(human.stdout.includes("current: Proving it"));
    // since stays compact: headers only, no bodies
    const delta = cli(dbPath, ["journal", "since", created.humanRef, "0"]).data as {
      entries: Array<Record<string, unknown>>;
    };
    assert.equal(delta.entries.length, 1);
    assert.ok(!("semantic" in (delta.entries[0] as Record<string, unknown>)));
    assert.ok(!("mechanical" in (delta.entries[0] as Record<string, unknown>)));
  });

  it("empty human list prints a marker; JSON stays an empty array (xtrm-7wc.5.7)", () => {
    const { dbPath } = setupDb();
    const human = runCli(["--db", dbPath, "issue", "list", "--project", "prj_demo"]);
    assert.equal(human.code, 0, human.stderr);
    assert.equal(human.stdout.trim(), "(no issues)");
    const ready = runCli(["--db", dbPath, "issue", "ready", "--project", "prj_demo"]);
    assert.equal(ready.stdout.trim(), "(no issues)");
    const json = cli(dbPath, ["issue", "list", "--project", "prj_demo"]).data as unknown[];
    assert.deepEqual(json, []);
  });

  it("the sb bin runs as a real process", () => {
    const { dbPath } = setupDb();
    const out = execFileSync(process.execPath, [SB, "--db", dbPath, "--json", "issue", "list", "--project", "prj_demo"], { encoding: "utf8" });
    const env = JSON.parse(out) as { schema: string; ok: boolean; data: unknown[] };
    assert.equal(env.schema, SCHEMA_VERSION);
    assert.equal(env.ok, true);
    assert.deepEqual(env.data, []);
  });

  it("the linked sb bin (argv without .ts) enters main (xtrm-7wc.5.5)", () => {
    // Regression: the npm bin is a symlink named `sb`, so argv[1] never
    // ends with sb.ts. Mirror npm link exactly: symlink named `sb` at the
    // real CLI (a byte copy loses the .ts target Node strips types by).
    const { dbPath } = setupDb();
    const dir = mkdtempSync(join(tmpdir(), "sb-bin-"));
    const link = join(dir, "sb");
    symlinkSync(SB, link);
    const out = execFileSync(link, ["--db", dbPath, "--json", "issue", "list", "--project", "prj_demo"], { encoding: "utf8" });
    const env = JSON.parse(out) as { schema: string; ok: boolean };
    assert.equal(env.schema, SCHEMA_VERSION);
    assert.equal(env.ok, true);
  });
});
