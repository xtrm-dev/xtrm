import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli } from "../cli/sb.ts";
import type { WorkContract } from "../src/domain/contract.ts";

export function contract(overrides: Partial<WorkContract> = {}): WorkContract {
  return {
    problem: "P",
    success: "S",
    scope: ["a"],
    nonGoals: ["b"],
    constraints: ["c"],
    validation: [{ check: "v" }],
    output: [{ artifact: "o" }],
    ...overrides,
  };
}

// CORE-2612: every temp directory this suite creates is registered here and
// removed by the root `after` hook below, so a run leaves zero entries in the OS
// temp dir even when a test fails before its own cleanup.
const tempDirs = new Set<string>();

// The guard wrapper (scripts/test-tmp-guard.mjs) sets SUBSTRATE_TEST_TMP, so a
// run's scratch dirs live in one directory the wrapper owns and can count.
const suiteTmp = process.env["SUBSTRATE_TEST_TMP"] ?? null;

export function tempDir(prefix = "substrate-"): string {
  const dir = mkdtempSync(join(suiteTmp ?? tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
}

after(() => cleanupTempDirs());

export function setup() {
  const dir = tempDir("substrate-");
  const db = openSubstrate(join(dir, "state.db"));
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  return { dir, db, svc };
}

// -- repository-relative CLI harness (XTRM-252.2, ADR §§84-91) --------------
// Real `git init` checkouts, a temp DB, and an isolated HOME + Git config so
// remote derivation and base-branch detection are hermetic. Every `run` passes
// an explicit --db and SUBSTRATE_DB is set as a belt, so a bug in the harness
// cannot touch the live store.

export interface SbRun {
  code: number;
  data: unknown;
  error: string | undefined;
  stdout: string;
  stderr: string;
}

export interface RepoEnv {
  home: string;
  dbPath: string;
  temp(prefix?: string): string;
  git(dir: string, args: string[]): string;
  gitRepo(basename: string, opts?: { branch?: string; remote?: string }): string;
  run(argv: string[], opts?: { json?: boolean }): SbRun;
  inCwd<T>(dir: string, fn: () => T): T;
  restore(): void;
}

export function repoEnv(prefix = "sb-repo-"): RepoEnv {
  const saved: Record<string, string | undefined> = {
    HOME: process.env["HOME"],
    SUBSTRATE_DB: process.env["SUBSTRATE_DB"],
    SUBSTRATE_PROJECT: process.env["SUBSTRATE_PROJECT"],
    GIT_CONFIG_GLOBAL: process.env["GIT_CONFIG_GLOBAL"],
    GIT_CONFIG_NOSYSTEM: process.env["GIT_CONFIG_NOSYSTEM"],
  };
  const dirs: string[] = [];
  const temp = (p = prefix): string => {
    const d = tempDir(p);
    dirs.push(d);
    return d;
  };
  const home = temp("sb-home-");
  process.env["HOME"] = home;
  process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  delete process.env["SUBSTRATE_PROJECT"];
  const dbPath = join(temp("sb-db-"), "state.db");
  process.env["SUBSTRATE_DB"] = dbPath;

  const git = (dir: string, args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  const gitRepo = (basename: string, opts?: { branch?: string; remote?: string }): string => {
    const root = join(temp(`${prefix}co-`), basename);
    mkdirSync(root, { recursive: true });
    git(root, ["init", "-q", "-b", opts?.branch ?? "main"]);
    git(root, ["-c", "user.email=harness@example.com", "-c", "user.name=Harness", "commit", "-q", "--allow-empty", "-m", "init"]);
    if (opts?.remote !== undefined) git(root, ["remote", "add", "origin", opts.remote]);
    return root;
  };

  const run = (argv: string[], opts?: { json?: boolean }): SbRun => {
    const res = runCli(["--db", dbPath, ...(opts?.json === false ? [] : ["--json"]), ...argv]);
    let data: unknown = null;
    let error: string | undefined;
    try {
      const env = JSON.parse(res.stdout) as { ok: boolean; data: unknown; error?: string };
      data = env.data;
      error = env.error;
    } catch {
      /* non-JSON result: keep stdout for the assertion message */
    }
    return { code: res.code, data, error, stdout: res.stdout, stderr: res.stderr };
  };

  const inCwd = <T>(dir: string, fn: () => T): T => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      return fn();
    } finally {
      process.chdir(prev);
    }
  };

  return {
    home,
    dbPath,
    temp,
    git,
    gitRepo,
    run,
    inCwd,
    restore(): void {
      for (const key of Object.keys(saved)) {
        const value = saved[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
