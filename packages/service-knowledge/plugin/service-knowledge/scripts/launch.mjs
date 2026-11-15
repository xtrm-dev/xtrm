#!/usr/bin/env node
// MCP server entry for the packaged service-knowledge plugin (CORE-2714).
//
// This is the path `.mcp.json` names:
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs
//
// A marketplace install copies ONLY the plugin folder into Claude Code's cache (the
// specialists plugin learned this the hard way, SPECIALISTS-4225), so this process cannot import
// the Python package from a sibling source tree. It resolves the installed `service-knowledge`
// CLI from PATH and hands it the stdio MCP transport.
//
// Two things this launcher owns, and nothing else:
//
//  1. SERVICE_KNOWLEDGE_ROOT. The Python resolver trusts $SERVICE_KNOWLEDGE_ROOT, then
//     $CLAUDE_PROJECT_DIR, then the git toplevel of its cwd. A plugin MCP process does not
//     reliably receive CLAUDE_PROJECT_DIR, and its cwd is not guaranteed to be the project. This
//     launcher sets the variable explicitly from the first of: an inherited
//     SERVICE_KNOWLEDGE_ROOT, $CLAUDE_PROJECT_DIR, the git toplevel of the launch cwd. The child
//     then resolves that exact checkout, and every tool result echoes the root it used.
//
//  2. A NAMED failure. A plugin that installs while the host still runs service-knowledge 0.8.0
//     (no `mcp` subcommand) must say so on stderr, not present an empty tool list. Exit code 78
//     matches the substrate launcher's convention (config/version problem, not a crash).

import { spawn, execFileSync } from "node:child_process";

const CLI = "service-knowledge";
const MINIMUM_VERSION = [0, 9, 0];
const EX_CONFIG = 78;

let failed = false;
function fail(code, message) {
  if (failed) return;
  failed = true;
  process.exitCode = EX_CONFIG;
  process.stderr.write(`service-knowledge-mcp: ${code}: ${message}\n`);
  process.stdin.pause();
}

/** Compare dotted numeric versions; true when `actual` >= `required`. */
function atLeast(actual, required) {
  const a = String(actual).split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < required.length; i += 1) {
    const have = Number.isFinite(a[i]) ? a[i] : 0;
    if (have !== required[i]) return have > required[i];
  }
  return true;
}

function runCapture(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
  }).trim();
}

/** The consumer root this session should read, resolved once and passed down explicitly. */
function resolveRoot() {
  const inherited = process.env.SERVICE_KNOWLEDGE_ROOT;
  if (inherited) return inherited;
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) return projectDir;
  try {
    const toplevel = runCapture("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
    if (toplevel) return toplevel;
  } catch {
    /* not a git checkout: fall through to cwd */
  }
  return process.cwd();
}

function cliVersion() {
  try {
    // `service-knowledge --version` prints "service-knowledge X.Y.Z".
    const raw = runCapture(CLI, ["--version"]);
    const match = raw.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    return null;
  }
}

function main() {
  const root = resolveRoot();
  const version = cliVersion();
  if (version === null) {
    fail(
      "cli-missing",
      `the '${CLI}' CLI is not on PATH. Install it with 'pipx install service-knowledge' ` +
        `(needs >= ${MINIMUM_VERSION.join(".")} for the 'mcp' subcommand). The knowledge tools are ` +
        `unavailable until then; nothing else in this session is affected.`,
    );
    return;
  }
  if (!atLeast(version, MINIMUM_VERSION)) {
    fail(
      "cli-too-old",
      `found ${CLI} ${version}, but the knowledge MCP server needs >= ` +
        `${MINIMUM_VERSION.join(".")} (the 'mcp' subcommand). Upgrade with ` +
        `'pipx upgrade service-knowledge'.`,
    );
    return;
  }

  const child = spawn(CLI, ["mcp", "serve"], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, SERVICE_KNOWLEDGE_ROOT: root },
  });

  child.on("error", (error) => {
    fail("spawn-failed", `could not start '${CLI} mcp serve': ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (failed) return;
    if (signal) {
      process.exitCode = 0;
      return;
    }
    // A clean MCP shutdown ends when the client closes stdin.
    if (code !== 0) {
      process.stderr.write(`service-knowledge-mcp: server-exit: ${CLI} mcp serve exited with ${code}\n`);
      process.exitCode = code ?? 1;
    }
  });

  // Closing stdin must stop the child: the MCP client signals shutdown that way.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
  process.on("exit", () => {
    child.kill("SIGTERM");
  });
}

main();
