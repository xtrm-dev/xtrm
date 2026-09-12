// XTRM-331 regression: `sb` must deliver its complete stdout when stdout is a
// PIPE. Writes to a pipe are asynchronous, so the old `process.exit(code)` after
// process.stdout.write() discarded everything past the 64 KiB pipe buffer and
// silently corrupted --json output. Redirection to a file is synchronous, which
// is why the defect only appeared in pipes.
//
// The pipe cases go through a real shell pipeline (`| { sleep 1; cat; }`,
// `| wc -c`): an in-process spawnSync reader can drain fast enough that the
// writer never blocks, which makes the truncation intermittent, so the consumer
// sleeps first to force the writer up against the 64 KiB pipe buffer. Set
// SB_UNDER_TEST=<path to a pre-fix sb.ts> to confirm this file fails there.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SB = process.env["SB_UNDER_TEST"] ?? join(here, "..", "cli", "sb.ts");
const PIPE_BUFFER = 65536;
// A consumer that does not read for a second: the writer must fill the 64 KiB
// pipe buffer and keep the rest pending, which is the state the old
// process.exit() destroyed.
const SLOW_CAT = "{ sleep 1; cat; }";
const SLOW_COUNT = "{ sleep 1; wc -c; }";
const LIST = (dbPath: string): string[] => ["--db", dbPath, "--json", "issue", "list", "--project", "prj_big"];
const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const cli = (argv: string[]): string => [process.execPath, SB, ...argv].map(quote).join(" ");

// One shared fixture: enough Issues that `issue list --json` crosses the pipe
// buffer size. Seeded in batches, measuring the real payload between batches.
let fixture: { dbPath: string; expected: string; issues: number } | null = null;
function bigFixture(): { dbPath: string; expected: string; issues: number } {
  if (fixture) return fixture;
  const dir = mkdtempSync(join(tmpdir(), "sb-flush-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_big", prefix: "BIG", name: "big" });
  let expected = "";
  let issues = 0;
  while (expected.length <= PIPE_BUFFER + 8192) {
    for (let i = 0; i < 50; i += 1) {
      svc.createIssue({
        projectId: "prj_big",
        title: `flush ${issues} ${"x".repeat(120)}`,
        kind: "task",
        contract: { ...contract(), success: `s${issues} ${"y".repeat(200)}` },
        scrutiny: "LOW",
      });
      issues += 1;
    }
    expected = runCli(LIST(dbPath)).stdout;
  }
  db.close();
  assert.ok(expected.length > PIPE_BUFFER, `fixture must exceed the pipe buffer, got ${expected.length}`);
  fixture = { dbPath, expected, issues };
  return fixture;
}

// Runs `<cli> <argv> | <consumer>` through /bin/sh so the child's stdout is a
// real pipe to another process.
function shellPipe(argv: string[], consumer: string): string {
  return execFileSync("/bin/sh", ["-c", `${cli(argv)} | ${consumer}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

describe("sb piped stdout is not truncated (XTRM-331)", () => {
  it("a >64 KiB piped --json payload arrives complete and parses", () => {
    const { dbPath, expected, issues } = bigFixture();
    const bytes = Number(shellPipe(LIST(dbPath), SLOW_COUNT).trim());
    assert.equal(bytes, expected.length, "the pipe must carry the full payload, not the 64 KiB pipe buffer");
    const piped = shellPipe(LIST(dbPath), SLOW_CAT);
    const env = JSON.parse(piped) as { ok: boolean; data: unknown[] };
    assert.equal(env.ok, true);
    assert.equal(env.data.length, issues);
  });

  it("piped and file-redirected output are byte-identical", () => {
    const { dbPath, expected } = bigFixture();
    const file = join(tmpdir(), `sb-flush-redirect-${process.pid}.json`);
    execFileSync("/bin/sh", ["-c", `${cli(LIST(dbPath))} > '${file}'`]);
    const redirected = readFileSync(file, "utf8");
    assert.equal(redirected, expected);
    assert.equal(shellPipe(LIST(dbPath), SLOW_CAT), redirected);
  });

  it("a large --json failure keeps its exit code and delivers the whole stdout payload", () => {
    // The error envelope echoes the unknown project id, so the failure output is
    // itself larger than the pipe buffer.
    const argv = ["--db", bigFixture().dbPath, "--json", "issue", "list", "--project", "z".repeat(70_000)];
    const inProc = runCli(argv);
    assert.notEqual(inProc.code, 0, "fixture command must fail");
    assert.ok(inProc.stdout.length > PIPE_BUFFER, `failure payload must exceed the buffer, got ${inProc.stdout.length}`);
    const direct = spawnSync(process.execPath, [SB, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(direct.status, inProc.code, "exit code must be preserved exactly");
    const pipedOut = shellPipe(argv, SLOW_CAT);
    assert.equal(pipedOut.length, inProc.stdout.length, "the full failure payload must cross the pipe");
    assert.equal((JSON.parse(pipedOut) as { ok: boolean }).ok, false);
  });

  it("a large non-zero payload on stderr is delivered when stderr is piped", () => {
    const argv = ["--db", bigFixture().dbPath, "issue", "list", "--project", "x".repeat(70_000)];
    const inProc = runCli(argv);
    assert.notEqual(inProc.code, 0);
    assert.ok(inProc.stderr.length > PIPE_BUFFER, `fixture must exceed the pipe buffer, got ${inProc.stderr.length}`);
    const direct = spawnSync(process.execPath, [SB, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(direct.status, inProc.code, "exit code must be preserved exactly");
    const pipedErr = execFileSync("/bin/sh", ["-c", `${cli(argv)} 2>&1 >/dev/null | { sleep 1; wc -c; }`], { encoding: "utf8" });
    assert.equal(Number(pipedErr.trim()), inProc.stderr.length, "the full stderr payload must cross the pipe");
  });

  it("an early-closing consumer does not crash the CLI or change its exit code", () => {
    const { dbPath } = bigFixture();
    const out = join(tmpdir(), `sb-flush-head-${process.pid}.out`);
    const err = join(tmpdir(), `sb-flush-head-${process.pid}.err`);
    // `head -c 10` closes the read end after ten bytes, so the CLI sees EPIPE.
    // bash exposes the CLI's own status through PIPESTATUS.
    const res = spawnSync("/bin/bash", ["-c", `set -o pipefail; ${cli(LIST(dbPath))} 2>'${err}' | head -c 10 > '${out}'; echo "\${PIPESTATUS[0]}"`], {
      encoding: "utf8",
    });
    const stderr = readFileSync(err, "utf8");
    assert.equal(res.stdout.trim(), "0", `a closed reader is not a failure; stderr was: ${stderr.slice(0, 200)}`);
    assert.ok(!stderr.includes("EPIPE") && !stderr.includes("Unhandled"), `stderr must not carry an unhandled write error: ${stderr.slice(0, 200)}`);
    assert.equal(readFileSync(out, "utf8").length, 10);
  });

  it("bun delivers the same complete piped payload", () => {
    const bun = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim();
    if (!bun) return; // bun is optional in throwaway environments; the node coverage above is authoritative
    const { dbPath, expected } = bigFixture();
    const cmd = [bun, SB, ...LIST(dbPath)].map(quote).join(" ");
    const bytes = Number(execFileSync("/bin/sh", ["-c", `${cmd} | ${SLOW_COUNT}`], { encoding: "utf8" }).trim());
    assert.equal(bytes, expected.length);
    assert.equal(execFileSync("/bin/sh", ["-c", `${cmd} | ${SLOW_CAT}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }), expected);
  });
});
