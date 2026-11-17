// XTRM-335 regression: hook/integration entrypoints must not truncate piped
// output at the 64 KiB pipe buffer, must preserve exact exit codes, and must
// not surface unhandled EPIPE on an early-closing consumer. Same shape as the
// XTRM-331 suite (tests/cli-stdout-flush.test.ts): real shell pipelines with
// a sleeping consumer force the writer against the pipe buffer.
//
// SUCCESS rule: EVERY scoped path that writes stdout/stderr and then
// terminates drains via process.exitCode + natural return. Immediate
// process.exit() remains ONLY on proven zero-byte quiet paths (no stream
// write precedes the exit). Only `setup check --json` can exceed the buffer
// in production (the naming probe echoes every home-inventory remnant entry,
// so a large registry is the seeded large inventory); the rest are proven at
// pipe-identity/matrix/EPIPE level plus a synthetic >64 KiB dual-stream
// fixture for the shared pattern.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { withoutNodeSqliteWarning } from "./hermetic-env.ts";

// XTRM-824: these hooks import node:sqlite, so Node v25 announces an
// ExperimentalWarning on stderr. The assertions below are about what the hook
// wrote, not about what the runtime announced.
const quietStderr = (s: string | null): string => withoutNodeSqliteWarning(s ?? "");
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, "..");
const SETUP = join(PKG, "integrations", "setup.ts");
const PILOAD = join(PKG, "integrations", "pi-load-check.ts");
const HOOKS = join(PKG, "hooks");
const CLAUDE = join(PKG, "integrations", "claude-code");
const SCRIPTS = join(PKG, "plugin", "substrate", "scripts");
const PIPE_BUFFER = 65536;
const SLOW_CAT = "{ sleep 1; cat; }";
const SLOW_COUNT = "{ sleep 1; wc -c; }";
const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const node = (script: string, argv: string[]): string => [process.execPath, script, ...argv].map(quote).join(" ");

function shell(cmd: string, env: Record<string, string> = {}): string {
  return execFileSync("/bin/sh", ["-c", cmd], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

// bash, not sh: only bash exposes PIPESTATUS for the writer's own status.
function bash(cmd: string, env: Record<string, string> = {}): string {
  return execFileSync("/bin/bash", ["-c", cmd], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

// A HOME whose plugin registry carries 4000 beads remnants: the naming probe
// echoes every entry, so `setup check --json` crosses the pipe buffer.
let bigHome: string | null = null;
function largeHome(): string {
  if (bigHome) return bigHome;
  const home = tempDir("x335-bighome-");
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  const plugins: Record<string, Array<{ installPath: string }>> = {};
  for (let i = 0; i < 4000; i += 1) plugins[`beads-fake-${String(i).padStart(5, "0")}@mkt`] = [{ installPath: `/x/${i}` }];
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
  bigHome = home;
  return home;
}

const CHECK_JSON = (home: string): string[] => ["check", "--json", "--dir", PKG];

describe("XTRM-335 setup check --json over a pipe", () => {
  it("a >64 KiB piped payload arrives complete and parses", () => {
    const home = largeHome();
    const file = `/var/tmp/x335-t335-exp-${process.pid}.json`;
    shell(`${node(SETUP, CHECK_JSON(home))} > '${file}' || true`, { HOME: home });
    const redirected = readFileSync(file, "utf8");
    assert.ok(redirected.length > PIPE_BUFFER, `fixture must exceed the pipe buffer, got ${redirected.length}`);
    const env = { HOME: home };
    const bytes = Number(shell(`${node(SETUP, CHECK_JSON(home))} | ${SLOW_COUNT}`, env).trim());
    assert.equal(bytes, redirected.length, "the pipe must carry the full payload, not the 64 KiB pipe buffer");
    const piped = shell(`${node(SETUP, CHECK_JSON(home))} | ${SLOW_CAT}`, env);
    const parsed = JSON.parse(piped) as { dir: string; naming: { beadsRemnants: unknown[] } };
    assert.equal(parsed.dir, PKG);
    assert.ok(parsed.naming.beadsRemnants.length >= 4000);
  });

  it("piped and file-redirected output are byte-identical", () => {
    const home = largeHome();
    const env = { HOME: home };
    const file = `/var/tmp/x335-t335-redir-${process.pid}.json`;
    shell(`${node(SETUP, CHECK_JSON(home))} > '${file}' || true`, env);
    const redirected = readFileSync(file, "utf8");
    assert.equal(shell(`${node(SETUP, CHECK_JSON(home))} | ${SLOW_CAT}`, env), redirected);
  });

  it("the nonzero exit code survives the pipe", () => {
    const home = largeHome();
    const direct = spawnSync(process.execPath, [SETUP, ...CHECK_JSON(home)], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HOME: home },
    });
    assert.equal(direct.status, 1, "unenrolled fixture home must fail closed");
    const code = bash(`set -o pipefail; ${node(SETUP, CHECK_JSON(home))} 2>/dev/null | ${SLOW_CAT} > /dev/null; echo "\${PIPESTATUS[0]}"`, {
      HOME: home,
    });
    assert.equal(code.trim(), "1", "piped exit code must equal the direct exit code");
  });

  it("plan --json is byte-identical piped vs redirected with exit 0", () => {
    const argv = ["plan", "--json", "--dir", PKG];
    const file = `/var/tmp/x335-t335-plan-${process.pid}.json`;
    shell(`${node(SETUP, argv)} > '${file}'`);
    const direct = spawnSync(process.execPath, [SETUP, ...argv], { encoding: "utf8" });
    assert.equal(direct.status, 0);
    assert.equal(shell(`${node(SETUP, argv)} | ${SLOW_CAT}`), readFileSync(file, "utf8"));
  });

  it("an early-closing consumer keeps the normal exit code with no EPIPE noise", () => {
    const home = largeHome();
    const out = `/var/tmp/x335-t335-head-${process.pid}.out`;
    const err = `/var/tmp/x335-t335-head-${process.pid}.err`;
    const res = spawnSync("/bin/bash", ["-c", `set -o pipefail; ${node(SETUP, CHECK_JSON(home))} 2>'${err}' | head -c 10 > '${out}'; echo "\${PIPESTATUS[0]}"`], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    const stderr = readFileSync(err, "utf8");
    assert.equal(res.stdout.trim(), "1", `a closed reader is not a failure; stderr was: ${stderr.slice(0, 200)}`);
    assert.ok(!stderr.includes("EPIPE") && !stderr.includes("Unhandled"), `no unhandled write error: ${stderr.slice(0, 200)}`);
    assert.equal(readFileSync(out, "utf8").length, 10);
  });
});

describe("XTRM-335 exit-code matrix", () => {
  it("setup usage errors exit 2 with the full error line over a pipe", () => {
    for (const argv of [["check", "--dir"], ["check", "--json", "--dir", "/nonexistent"], ["plan", "--dir", "/nonexistent"]] as string[][]) {
      const r = spawnSync(process.execPath, [SETUP, ...argv], { encoding: "utf8" });
      assert.equal(r.status, 2, `setup ${argv.join(" ")} must exit 2`);
      assert.ok(r.stderr.length > 0, "usage error line must be emitted");
      // Drained, not truncated: the piped stderr line equals the direct one.
      const pipedErr = shell(`${node(SETUP, argv)} 2>&1 >/dev/null | ${SLOW_CAT}`);
      assert.equal(pipedErr, r.stderr, "usage error line must cross the pipe whole");
    }
  });

  it("pi-load-check usage errors exit 2, probe result exit is preserved over a pipe", () => {
    const bad = spawnSync(process.execPath, [PILOAD, "--json", "--dir", "/nonexistent"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.equal(shell(`${node(PILOAD, ["--json", "--dir", "/nonexistent"])} 2>&1 >/dev/null | ${SLOW_CAT}`), bad.stderr);
    const home = largeHome();
    const argv = ["--json", "--dir", PKG];
    const direct = spawnSync(process.execPath, [PILOAD, ...argv], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, HOME: home },
    });
    assert.ok(direct.status === 0 || direct.status === 1);
    const file = `/var/tmp/x335-t335-piload-${process.pid}.json`;
    shell(`${node(PILOAD, argv)} > '${file}' || true`, { HOME: home });
    assert.equal(shell(`${node(PILOAD, argv)} | ${SLOW_CAT}`, { HOME: home }), readFileSync(file, "utf8"));
    const code = bash(`set -o pipefail; ${node(PILOAD, argv)} 2>/dev/null | ${SLOW_CAT} > /dev/null; echo "\${PIPESTATUS[0]}"`, { HOME: home });
    assert.equal(code.trim(), String(direct.status));
  });

  it("pi-load-check survives an early-closing consumer", () => {
    const home = largeHome();
    const err = `/var/tmp/x335-t335-piload-head-${process.pid}.err`;
    const res = spawnSync("/bin/bash", ["-c", `set -o pipefail; ${node(PILOAD, ["--json", "--dir", PKG])} 2>'${err}' | head -c 10 > /dev/null; echo "\${PIPESTATUS[0]}"`], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    const stderr = readFileSync(err, "utf8");
    assert.ok(res.stdout.trim() === "0" || res.stdout.trim() === "1");
    assert.ok(!stderr.includes("EPIPE") && !stderr.includes("Unhandled"), `no unhandled write error: ${stderr.slice(0, 200)}`);
  });

  it("hooks: quiet paths exit 0 with zero bytes, corrupt state exits 1 over a pipe", () => {
    const envNoReceipt: Record<string, string> = { ...process.env } as Record<string, string>;
    delete envNoReceipt["XTRM_RECEIPT_ID"];
    const q1 = spawnSync(process.execPath, [join(HOOKS, "post-commit.ts")], { encoding: "utf8", env: envNoReceipt });
    assert.equal(q1.status, 0);
    assert.equal(q1.stdout, "", "quiet no-receipt path must emit zero bytes");
    assert.equal(quietStderr(q1.stderr), "");
    const q2 = spawnSync(process.execPath, [join(HOOKS, "prepare-commit-msg.ts")], { encoding: "utf8" });
    assert.equal(q2.status, 0);
    assert.equal(q2.stdout, "", "quiet no-arg path must emit zero bytes");
    assert.equal(quietStderr(q2.stderr), "", "quiet no-arg path must emit zero bytes on stderr");
    const msgDir = tempDir("x335-msg-");
    const msgFile = join(msgDir, "COMMIT_EDITMSG");
    writeFileSync(msgFile, "subject\n\nbody\n");
    const q2b = spawnSync(process.execPath, [join(HOOKS, "prepare-commit-msg.ts"), msgFile], { encoding: "utf8", env: envNoReceipt });
    assert.equal(q2b.status, 0);
    assert.equal(q2b.stdout, "", "quiet with-arg/no-receipt path must emit zero bytes");
    assert.equal(quietStderr(q2b.stderr), "", "quiet with-arg/no-receipt path must emit zero bytes on stderr");
    assert.equal(readFileSync(msgFile, "utf8"), "subject\n\nbody\n", "quiet path must leave the message file untouched");
    const q3 = spawnSync(process.execPath, [join(HOOKS, "post-rewrite.ts")], { input: "\n", encoding: "utf8" });
    assert.equal(q3.status, 0);
    assert.equal(q3.stdout, "", "quiet no-pairs path must emit zero bytes");
    assert.equal(quietStderr(q3.stderr), "", "quiet no-pairs path must emit zero bytes on stderr");
    // Failure path against an explicit temp store (never the live DB).
    const dbPath = `/var/tmp/x335-t335-hook-${process.pid}.db`;
    const failEnv = {
      XTRM_RECEIPT_ID: "rcpt-missing",
      XTRM_COMMIT_SHA: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      SUBSTRATE_DB: dbPath,
    };
    const fail = spawnSync(process.execPath, [join(HOOKS, "post-commit.ts")], {
      encoding: "utf8",
      env: { ...process.env, ...failEnv },
    });
    assert.equal(fail.status, 1, "corrupt state must fail closed with exit 1");
    assert.ok(fail.stderr.includes("xtrm post-commit"));
    const pipedErr = shell(`${node(join(HOOKS, "post-commit.ts"), [])} 2>&1 >/dev/null | ${SLOW_CAT}`, failEnv);
    // XTRM-824: each child prints its own node:sqlite warning with its own PID,
    // so compare the diagnostics, not the PIDs inside the runtime notice.
    assert.equal(withoutNodeSqliteWarning(pipedErr), withoutNodeSqliteWarning(fail.stderr), "diagnostic must cross the pipe whole");
  });

  it("claude-code adapters: exit 0 with byte-identical output over a pipe, quiet paths zero-byte", () => {
    const emptyCwd = tempDir("x335-unbound-");
    const cases: Array<{ script: string; stdin: string }> = [
      { script: join(CLAUDE, "commit-check.ts"), stdin: JSON.stringify({ tool_name: "Write", tool_input: { command: "ls" } }) },
      { script: join(CLAUDE, "edit-gate.ts"), stdin: "{}" },
      { script: join(CLAUDE, "session-start.ts"), stdin: JSON.stringify({ source: "other" }) },
      { script: join(CLAUDE, "stop-gate.ts"), stdin: "{}" },
      { script: join(CLAUDE, "precompact.ts"), stdin: "{}" },
      { script: join(CLAUDE, "postcompact.ts"), stdin: "{}" },
    ];
    for (const c of cases) {
      const direct = spawnSync(process.execPath, [c.script], { input: c.stdin, encoding: "utf8", cwd: emptyCwd });
      assert.equal(direct.status, 0, `${c.script} must exit 0`);
      const piped = execFileSync("/bin/sh", ["-c", `printf %s ${quote(c.stdin)} | ${node(c.script, [])} | ${SLOW_CAT}`], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        cwd: emptyCwd,
      });
      assert.equal(piped, direct.stdout, `${c.script} piped output must equal direct output`);
    }
    // Zero-byte proof for the retained quiet exits.
    const nonBash = spawnSync(process.execPath, [join(CLAUDE, "commit-check.ts")], {
      input: JSON.stringify({ tool_name: "Write" }),
      encoding: "utf8",
      cwd: emptyCwd,
    });
    assert.equal(nonBash.status, 0);
    assert.equal(nonBash.stdout, "", "non-Bash quiet path must emit zero bytes");
    assert.equal(nonBash.stderr, "", "non-Bash quiet path must emit zero bytes on stderr");
    const noNudge = spawnSync(process.execPath, [join(CLAUDE, "commit-check.ts")], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" } }),
      encoding: "utf8",
      cwd: emptyCwd,
    });
    assert.equal(noNudge.status, 0);
    assert.equal(noNudge.stdout, "", "Bash/no-nudge quiet path must emit zero bytes");
    assert.equal(noNudge.stderr, "", "Bash/no-nudge quiet path must emit zero bytes on stderr");
    const allow = spawnSync(process.execPath, [join(CLAUDE, "edit-gate.ts")], { input: "{}", encoding: "utf8", cwd: emptyCwd });
    assert.equal(allow.status, 0);
    assert.equal(allow.stdout, "", "allow quiet path must emit zero bytes");
    const noCont = spawnSync(process.execPath, [join(CLAUDE, "stop-gate.ts")], { input: "{}", encoding: "utf8", cwd: emptyCwd });
    assert.equal(noCont.status, 0);
    assert.equal(noCont.stdout, "", "no-continuity quiet path must emit zero bytes");
  });

  it("plugin .mjs adapters: exit 0 with byte-identical output over a pipe, quiet paths zero-byte", () => {
    const emptyCwd = tempDir("x335-mjs-");
    const env = { SUBSTRATE_HOME: PKG };
    const cases: Array<{ script: string; stdin: string }> = [
      { script: join(SCRIPTS, "commit-check.mjs"), stdin: JSON.stringify({ tool_name: "Write" }) },
      { script: join(SCRIPTS, "edit-gate.mjs"), stdin: "{}" },
      { script: join(SCRIPTS, "session-start.mjs"), stdin: JSON.stringify({ source: "other" }) },
      { script: join(SCRIPTS, "stop-gate.mjs"), stdin: "{}" },
      { script: join(SCRIPTS, "precompact.mjs"), stdin: "{}" },
      { script: join(SCRIPTS, "postcompact.mjs"), stdin: "{}" },
      { script: join(SCRIPTS, "session-precondition.mjs"), stdin: "{}" },
      { script: join(SCRIPTS, "xtrm-primer.mjs"), stdin: "{}" },
    ];
    for (const c of cases) {
      const direct = spawnSync(process.execPath, [c.script], {
        input: c.stdin,
        encoding: "utf8",
        cwd: emptyCwd,
        env: { ...process.env, ...env },
      });
      assert.equal(direct.status, 0, `${c.script} must exit 0 (stderr: ${direct.stderr.slice(0, 300)})`);
      const piped = execFileSync("/bin/sh", ["-c", `printf %s ${quote(c.stdin)} | ${node(c.script, [])} | ${SLOW_CAT}`], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        cwd: emptyCwd,
        env: { ...process.env, ...env },
      });
      assert.equal(piped, direct.stdout, `${c.script} piped output must equal direct output`);
    }
    // Zero-byte proof for the retained quiet exits.
    const nonBash = spawnSync(process.execPath, [join(SCRIPTS, "commit-check.mjs")], {
      input: JSON.stringify({ tool_name: "Write" }),
      encoding: "utf8",
      cwd: emptyCwd,
      env: { ...process.env, ...env },
    });
    assert.equal(nonBash.status, 0);
    assert.equal(nonBash.stdout, "", "non-Bash quiet path must emit zero bytes");
    const noRefEnv: Record<string, string> = { ...process.env, SUBSTRATE_HOME: PKG } as Record<string, string>;
    delete noRefEnv["SUBSTRATE_ISSUE_REF"];
    for (const s of ["wake-on-event.mjs", "tail-events.mjs"]) {
      const r = spawnSync(process.execPath, [join(SCRIPTS, s)], { encoding: "utf8", env: noRefEnv });
      assert.equal(r.status, 0, `${s} no-ref guard must exit 0`);
      assert.equal(r.stdout, "", `${s} no-ref guard must emit zero bytes`);
      assert.equal(r.stderr, "", `${s} no-ref guard must emit zero bytes on stderr`);
    }
    // Null-baseline proof: ref set but unresolvable in a temp store exits 0
    // with zero bytes before any watch/monitor output (wake exit 2 / tail loop
    // never reached). Temp SUBSTRATE_DB, never the live store.
    const nullBaseEnv = {
      ...process.env,
      SUBSTRATE_HOME: PKG,
      SUBSTRATE_DB: `/var/tmp/x335-t335-nullbase-${process.pid}.db`,
      SUBSTRATE_ISSUE_REF: "XTRM-335-NONEXISTENT",
    } as Record<string, string>;
    const nullWake = spawnSync(process.execPath, [join(SCRIPTS, "wake-on-event.mjs")], {
      encoding: "utf8",
      env: nullBaseEnv,
      timeout: 30000,
    });
    assert.equal(nullWake.status, 0, "wake-on-event null-baseline guard must exit 0");
    assert.equal(nullWake.stdout, "", "wake-on-event null-baseline guard must emit zero bytes");
    assert.equal(nullWake.stderr, "", "wake-on-event null-baseline guard must emit zero bytes on stderr");
    const nullFirst = spawnSync(process.execPath, [join(SCRIPTS, "tail-events.mjs")], {
      encoding: "utf8",
      env: nullBaseEnv,
      timeout: 30000,
    });
    assert.equal(nullFirst.status, 0, "tail-events null-first guard must exit 0");
    assert.equal(nullFirst.stdout, "", "tail-events null-first guard must emit zero bytes");
    assert.equal(nullFirst.stderr, "", "tail-events null-first guard must emit zero bytes on stderr");
  });

  it(".mjs adapters survive an early-closing consumer", () => {
    const emptyCwd = tempDir("x335-mjs-head-");
    const env = { ...process.env, SUBSTRATE_HOME: PKG };
    const err = `/var/tmp/x335-t335-mjs-head-${process.pid}.err`;
    const res = spawnSync(
      "/bin/bash",
      ["-c", `set -o pipefail; printf '%s' '{}' | ${node(join(SCRIPTS, "session-precondition.mjs"), [])} 2>'${err}' | head -c 10 > /dev/null; echo "\${PIPESTATUS[1]}"`],
      { encoding: "utf8", cwd: emptyCwd, env },
    );
    const stderr = readFileSync(err, "utf8");
    assert.equal(res.stdout.trim(), "0");
    assert.ok(!stderr.includes("EPIPE") && !stderr.includes("Unhandled"), `no unhandled write error: ${stderr.slice(0, 200)}`);
  });
});

describe("XTRM-335 shared pattern delivers >64 KiB on stdout and stderr", () => {
  it("a synthetic fixture child using armPipeDrain + exitCode delivers both streams fully with its exit code", () => {
    const dir = tempDir("x335-synth-");
    const child = join(dir, "big-writer.ts");
    writeFileSync(
      child,
      `import { armPipeDrain } from ${JSON.stringify(join(PKG, "integrations", "write-and-exit.ts"))};\n` +
        `armPipeDrain();\n` +
        `process.stdout.write("o".repeat(100 * 1024) + "\\n");\n` +
        `process.stderr.write("e".repeat(80 * 1024) + "\\n");\n` +
        `process.exitCode = 3;\n`,
    );
    const outBytes = Number(shell(`${node(child, [])} 2>/dev/null | ${SLOW_COUNT}`).trim());
    assert.equal(outBytes, 100 * 1024 + 1, "full stdout payload must cross the pipe");
    const errBytes = Number(shell(`${node(child, [])} 2>&1 >/dev/null | ${SLOW_COUNT}`).trim());
    assert.equal(errBytes, 80 * 1024 + 1, "full stderr payload must cross the pipe");
    const code = bash(`set -o pipefail; ${node(child, [])} 2>/dev/null | ${SLOW_CAT} > /dev/null; echo "\${PIPESTATUS[0]}"`);
    assert.equal(code.trim(), "3", "nonzero exit must survive the pipe");
  });

  it("the .mjs helper pattern delivers a >64 KiB payload with its exit code", () => {
    const dir = tempDir("x335-synth-mjs-");
    const child = join(dir, "big-writer.mjs");
    writeFileSync(
      child,
      `import { armPipeDrain } from ${JSON.stringify(join(SCRIPTS, "write-and-exit.mjs"))};\n` +
        `armPipeDrain();\n` +
        `process.stdout.write("m".repeat(100 * 1024) + "\\n");\n` +
        `process.exitCode = 5;\n`,
    );
    const outBytes = Number(shell(`${node(child, [])} 2>/dev/null | ${SLOW_COUNT}`).trim());
    assert.equal(outBytes, 100 * 1024 + 1, "full .mjs payload must cross the pipe");
    const code = bash(`set -o pipefail; ${node(child, [])} 2>/dev/null | ${SLOW_CAT} > /dev/null; echo "\${PIPESTATUS[0]}"`);
    assert.equal(code.trim(), "5", "nonzero exit must survive the pipe");
  });
});

// Structural detector (XTRM-335): an immediate process.exit() is a violation
// unless it is a PROVEN zero-byte quiet path — no stdout/stderr/console write
// may appear lexically before it in the file (fail-closed: an exit placed
// after a write in an earlier-executed branch is still flagged, and must then
// be justified by moving the exit before the write or draining instead).
// Every scope file that writes must also arm the EPIPE drain.
const WRITE_RE = /(process\.stdout\.write|process\.stderr\.write|console\.(log|error|warn))\s*\(/g;
const EXIT_RE = /process\.exit\s*\(/g;

interface ExitSite {
  rel: string;
  line: number;
  quiet: boolean;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => {
      const idx = l.indexOf("//");
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
}

function scanExitSites(root: string): ExitSite[] {
  const sites: ExitSite[] = [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
  const scope = (rel: string): boolean =>
    /^(integrations\/(setup|pi-load-check|write-and-exit)\.ts|integrations\/claude-code\/.*\.ts|hooks\/.*\.ts|plugin\/substrate\/scripts\/.*\.mjs)$/.test(rel);
  for (const file of walk(root)) {
    const rel = file.slice(root.length + 1);
    if (!scope(rel)) continue;
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    const writeLines = new Set<number>();
    lines.forEach((l, i) => {
      WRITE_RE.lastIndex = 0;
      if (WRITE_RE.test(l)) writeLines.add(i);
    });
    lines.forEach((l, i) => {
      EXIT_RE.lastIndex = 0;
      if (EXIT_RE.test(l)) {
        const quiet = ![...writeLines].some((w) => w < i);
        sites.push({ rel, line: i + 1, quiet });
      }
    });
  }
  return sites;
}

// Exact pinned inventory of remaining immediate exits: every one is a
// zero-byte quiet path (dynamic zero-byte proof lives in the matrix tests
// above: each asserts stdout === "" and stderr === "").
const QUIET_ALLOWLIST: Record<string, { count: number; why: string }> = {
  "hooks/post-commit.ts": { count: 1, why: "no-receipt guard before any write" },
  "hooks/prepare-commit-msg.ts": { count: 2, why: "no-arg / no-receipt guards before any write" },
  "hooks/post-rewrite.ts": { count: 1, why: "no-pairs guard before any write" },
  "integrations/claude-code/commit-check.ts": { count: 2, why: "non-Bash and no-nudge guards; the JSON write drains via exitCode" },
  "integrations/claude-code/edit-gate.ts": { count: 1, why: "allow guard; the block JSON drains via exitCode" },
  "integrations/claude-code/stop-gate.ts": { count: 1, why: "no-continuity guard; the context JSON drains via exitCode" },
  "plugin/substrate/scripts/commit-check.mjs": { count: 1, why: "non-Bash guard; the nudge JSON drains via exitCode" },
  "plugin/substrate/scripts/wake-on-event.mjs": { count: 2, why: "no-ref / null-baseline guards; the wake line drains via exitCode" },
  "plugin/substrate/scripts/tail-events.mjs": { count: 2, why: "no-ref / null-first guards before the monitor loop writes" },
};

describe("XTRM-335 structural detector", () => {
  it("no write-before-exit path remains: every immediate exit is zero-byte quiet", () => {
    const sites = scanExitSites(PKG);
    const loud = sites.filter((s) => !s.quiet);
    assert.deepEqual(
      loud.map((s) => `${s.rel}:${s.line}`),
      [],
      "write-before-exit must drain via exitCode, never process.exit()",
    );
    const counts = new Map<string, number>();
    for (const s of sites) counts.set(s.rel, (counts.get(s.rel) ?? 0) + 1);
    for (const [rel, n] of counts) {
      const pinned = QUIET_ALLOWLIST[rel];
      assert.ok(pinned, `unlisted immediate exit in ${rel}: justify or drain it before allowing`);
      assert.equal(n, pinned.count, `${rel}: expected ${pinned.count} quiet exits (${pinned.why}), found ${n}`);
    }
    for (const rel of Object.keys(QUIET_ALLOWLIST)) {
      assert.ok(counts.has(rel), `allowlisted file ${rel} lost its quiet exits`);
    }
  });

  it("every scope file that writes arms the EPIPE drain and never swallows real errors", () => {
    const scopeFiles = [
      "integrations/setup.ts",
      "integrations/pi-load-check.ts",
      "hooks/post-commit.ts",
      "hooks/prepare-commit-msg.ts",
      "hooks/post-rewrite.ts",
      "integrations/claude-code/commit-check.ts",
      "integrations/claude-code/edit-gate.ts",
      "integrations/claude-code/session-start.ts",
      "integrations/claude-code/stop-gate.ts",
      "integrations/claude-code/precompact.ts",
      "integrations/claude-code/postcompact.ts",
      "plugin/substrate/scripts/stop-gate.mjs",
      "plugin/substrate/scripts/session-start.mjs",
      "plugin/substrate/scripts/edit-gate.mjs",
      "plugin/substrate/scripts/commit-check.mjs",
      "plugin/substrate/scripts/precompact.mjs",
      "plugin/substrate/scripts/postcompact.mjs",
      "plugin/substrate/scripts/session-precondition.mjs",
      "plugin/substrate/scripts/xtrm-primer.mjs",
      "plugin/substrate/scripts/wake-on-event.mjs",
      "plugin/substrate/scripts/tail-events.mjs",
    ];
    for (const rel of scopeFiles) {
      const src = readFileSync(join(PKG, rel), "utf8");
      assert.ok(src.includes("armPipeDrain()"), `${rel} must arm the EPIPE drain`);
    }
    for (const helper of ["integrations/write-and-exit.ts", "plugin/substrate/scripts/write-and-exit.mjs"]) {
      const src = readFileSync(join(PKG, helper), "utf8");
      assert.ok(src.includes("EPIPE"), `${helper} must key on EPIPE only`);
      assert.ok(!/catch\s*{\s*}/.test(src), `${helper} must not contain a bare swallow`);
    }
  });

  it("mutants prove the detector discriminates: TS and .mjs writers fail, quiet guards pass", () => {
    const dir = tempDir("x335-mutant-");
    // Mutant 1: TS write-then-exit must fail.
    mkdirSync(join(dir, "hooks"), { recursive: true });
    writeFileSync(join(dir, "hooks", "evil.ts"), `process.stdout.write("x");\nprocess.exit(0);\n`);
    // Mutant 2: .mjs write-then-exit must fail.
    mkdirSync(join(dir, "plugin", "substrate", "scripts"), { recursive: true });
    writeFileSync(join(dir, "plugin/substrate/scripts/evil.mjs"), `process.stdout.write("x");\nprocess.exit(0);\n`);
    // Control: a quiet guard (exit before any write) with a drained write path must pass.
    writeFileSync(
      join(dir, "hooks", "guard.ts"),
      `if (!process.env["X"]) process.exit(0);\nprocess.stdout.write("y");\nprocess.exitCode = 0;\n`,
    );
    const sites = scanExitSites(dir);
    const byFile = (rel: string): ExitSite[] => sites.filter((s) => s.rel === rel);
    assert.equal(byFile("hooks/evil.ts").length, 1);
    assert.equal(byFile("hooks/evil.ts")[0]?.quiet, false, "TS writer mutant must be flagged loud");
    assert.equal(byFile("plugin/substrate/scripts/evil.mjs").length, 1);
    assert.equal(byFile("plugin/substrate/scripts/evil.mjs")[0]?.quiet, false, ".mjs writer mutant must be flagged loud");
    assert.equal(byFile("hooks/guard.ts").length, 1);
    assert.equal(byFile("hooks/guard.ts")[0]?.quiet, true, "quiet-guard shape must stay clean (no blanket ban)");
    assert.ok(!QUIET_ALLOWLIST["hooks/evil.ts"] && !QUIET_ALLOWLIST["plugin/substrate/scripts/evil.mjs"], "mutants must not be allowlisted");
  });
});
