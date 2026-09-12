import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SB = join(here, "..", "cli", "sb.ts");

function jsonEnv(res: { stdout: string }): { command: string; ok: boolean; data: unknown; error?: string } {
  return JSON.parse(res.stdout) as { command: string; ok: boolean; data: unknown; error?: string };
}

describe("sb help/version/doctor (§28): side-effect-free surface", () => {
  it("--help exits 0 without creating a database", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-help-"));
    const dbPath = join(dir, "never-created.db");
    const res = runCli(["--help"], { dbPath });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /usage:/);
    assert.equal(existsSync(dbPath), false, "--help must not open/create SQLite");
  });

  it("help verb and per-verb --help exit 0 without a database", () => {
    for (const argv of [
      ["help"],
      ["issue", "--help"],
      ["issue", "create", "--help"],
      ["issue", "show", "--help"],
      ["project", "--help"],
      ["plan", "--help"],
      ["journal", "--help"],
      ["provenance", "--help"],
      ["import", "--help"],
      ["import", "beads", "--help"],
      ["doctor", "--help"],
      ["init", "--help"],
      ["help", "issue", "create"],
    ]) {
      const res = runCli(argv, { dbPath: join(mkdtempSync(join(tmpdir(), "sb-help-")), "x.db") });
      assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr}`);
      assert.match(res.stdout, /usage:/, `sb ${argv.join(" ")} printed no usage`);
    }
  });

  it("--version is parseable and side-effect free", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-ver-"));
    const dbPath = join(dir, "never-created.db");
    const res = runCli(["--version"], { dbPath });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout.trim(), /^sb \d+\.\d+\.\d+/);
    assert.equal(existsSync(dbPath), false);
    const j = jsonEnv(runCli(["--version", "--json"], { dbPath }));
    assert.equal(j.ok, true);
    assert.match((j.data as { version: string }).version, /^\d+\.\d+\.\d+/);
  });

  it("help --json exposes machine-readable capability data", () => {
    const env = jsonEnv(runCli(["help", "--json"]));
    assert.equal(env.command, "help");
    assert.equal(env.ok, true);
    const data = env.data as { version: string; text: string; commands: string[] };
    assert.match(data.version, /^\d+\.\d+\.\d+/);
    assert.ok(data.text.includes("usage:"));
    assert.ok(data.commands.includes("issue.create") && data.commands.includes("doctor"));
    assert.ok(data.commands.includes("init"), "init is a registered help surface");
  });

  it("unknown help topics fail closed", () => {
    const res = runCli(["help", "bogus-group"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /unknown help topic/);
  });

  it("doctor reports healthy with parseable JSON fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-doc-"));
    const dbPath = join(dir, "state.db");
    const savedProject = process.env["SUBSTRATE_PROJECT"];
    delete process.env["SUBSTRATE_PROJECT"];
    try {
      const human = runCli(["--db", dbPath, "doctor"]);
      assert.equal(human.code, 0, human.stderr);
      assert.match(human.stdout, /healthy/);
      assert.match(human.stdout, /state\.db:/);
      assert.match(human.stdout, /repository: .*initialized: false/);
      const env = jsonEnv(runCli(["--db", dbPath, "doctor", "--json"]));
      assert.equal(env.command, "doctor");
      assert.equal(env.ok, true);
      const data = env.data as {
        dbPath: string;
        schemaHealthy: boolean;
        projects: number;
        gitRoot: unknown;
        repository: { repositoryKey: string | null; gitRoot: string | null; initialized: boolean; baseBranch: string | null; identityError: string | null };
        project: { id: string } | null;
        projectError: string | null;
        effectiveOverride: string | null;
        link: unknown;
        linkError: unknown;
      };
      assert.equal(data.dbPath, dbPath);
      assert.equal(data.schemaHealthy, true);
      // The suite runs inside a real Git checkout, but this temp DB has no
      // binding for it: repository facts are real, initialization is false,
      // and the bound Project stays null (ADR §17).
      assert.equal(typeof data.repository, "object");
      assert.equal(typeof data.repository.repositoryKey, "string");
      assert.equal(data.repository.gitRoot, data.gitRoot);
      assert.equal(data.repository.initialized, false);
      assert.equal(data.project, null);
      assert.equal(data.effectiveOverride, null);
      assert.ok(!JSON.stringify(data).includes('"single"'), "doctor must not emit source:\"single\"");
    } finally {
      if (savedProject !== undefined) process.env["SUBSTRATE_PROJECT"] = savedProject;
    }
  });

  it("doctor exits nonzero with parseable JSON on corrupt state.db", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-doc-"));
    const dbPath = join(dir, "corrupt.db");
    writeFileSync(dbPath, "not a database");
    const res = runCli(["--db", dbPath, "doctor", "--json"]);
    assert.equal(res.code, 1);
    const env = jsonEnv(res);
    assert.equal(env.ok, false);
    assert.equal((env.data as { schemaHealthy: boolean }).schemaHealthy, false);
  });

  it("HOME=/empty real process: --help exits 0 and creates nothing", () => {
    const parent = mkdtempSync(join(tmpdir(), "sb-empty-home-"));
    const emptyHome = join(parent, "empty");
    assert.equal(existsSync(emptyHome), false);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: emptyHome };
    delete env["SUBSTRATE_DB"];
    const out = execFileSync(process.execPath, [SB, "--help"], { encoding: "utf8", env });
    assert.match(out, /usage:/);
    const out2 = execFileSync(process.execPath, [SB, "--version"], { encoding: "utf8", env });
    assert.match(out2.trim(), /^sb \d+\.\d+\.\d+/);
    assert.equal(existsSync(emptyHome), false, "help/version must not create state under $HOME");
  });
});
