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
//     launcher sets the variable explicitly from $CLAUDE_PROJECT_DIR, else the git toplevel of the
//     launch cwd, else the cwd. The child then resolves that exact checkout, and every tool result
//     echoes the root it used.
//
//     An INHERITED SERVICE_KNOWLEDGE_ROOT is deliberately NOT honoured (CORE-2714 review). The pi
//     adapter always passes the git toplevel of the session cwd, and an xt pi worker can inherit
//     the variable from a Claude parent session: honouring it would let a parent point the child at
//     a different checkout, which is the cross-repo read the pi side already refuses. The host
//     decides, once, from its own cwd.
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
  // Not process.env.SERVICE_KNOWLEDGE_ROOT: see the header. The host resolves the root itself.
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) return projectDir;
  try {
    const toplevel = runCapture("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      timeout: 5000,
    });
    if (toplevel) return toplevel;
  } catch {
    /* not a git checkout: fall through to cwd */
  }
  return process.cwd();
}

function cliVersion() {
  try {
    // `service-knowledge --version` prints "service-knowledge X.Y.Z".
    // Bounded: a wedged binary must not hang the MCP handshake for the whole session.
    const raw = runCapture(CLI, ["--version"], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    const match = raw.match(/(\d+\.\d+\.\d+)/);
    return match ? { version: match[1] } : { broken: `unparseable --version output: ${raw.slice(0, 200)}` };
  } catch (error) {
    if (error && error.code === "ENOENT") return { missing: true };
    // The binary exists but did not answer: most often a broken install (for example the
    // vaultctl dependency absent). Surface its own stderr instead of calling it "missing".
    const detail = String((error && (error.stderr || error.message)) || error).trim().slice(-400); // the tail: a traceback's exception line comes last
    return { broken: detail };
  }
}

const INSTALL_HINT =
  "Install it with packages/service-knowledge/install.sh from an xtrm-dev/xtrm checkout " +
  "(it also installs the vaultctl dependency).";

function main() {
  const root = resolveRoot();
  const probe = cliVersion();
  if (probe.missing) {
    fail(
      "cli-missing",
      `the '${CLI}' CLI is not on PATH. ${INSTALL_HINT} ` +
        `(needs >= ${MINIMUM_VERSION.join(".")} for the 'mcp' subcommand). The knowledge tools are ` +
        `unavailable until then; nothing else in this session is affected.`,
    );
    return;
  }
  if (probe.broken) {
    fail(
      "cli-broken",
      `'${CLI} --version' failed: ${probe.broken}${probe.broken.includes("install.sh") ? "" : " " + INSTALL_HINT} The knowledge tools are ` +
        `unavailable until it runs; nothing else in this session is affected.`,
    );
    return;
  }
  const version = probe.version;
  if (!atLeast(version, MINIMUM_VERSION)) {
    fail(
      "cli-too-old",
      `found ${CLI} ${version}, but the knowledge MCP server needs >= ` +
        `${MINIMUM_VERSION.join(".")} (the 'mcp' subcommand). Update the ` +
        `xtrm-dev/xtrm checkout the CLI was installed from (editable install) or re-run ` +
        `packages/service-knowledge/install.sh.`,
    );
    return;
  }

  const child = spawn(CLI, ["mcp", "serve"], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, SERVICE_KNOWLEDGE_ROOT: root },
  });

  // Signals the launcher forwarded to the child. A child that dies from one of these is a
  // shutdown the host asked for, not a crash.
  const forwarded = new Set();

  child.on("error", (error) => {
    fail("spawn-failed", `could not start '${CLI} mcp serve': ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (failed) return;
    if (signal) {
      if (forwarded.has(signal)) return; // the host asked for it: clean shutdown
      // The child died from a signal the launcher did NOT send (SIGTERM and SIGINT are forwarded
      // below, so those settle as the child's own exit). An OOM kill or an external SIGKILL lands
      // here. Reporting 0 would present a crash as a clean shutdown, which hides the crash from
      // the client and from every reader of the exit code.
      process.stderr.write(
        `service-knowledge-mcp: server-killed: ${CLI} mcp serve was terminated by ${signal}\n`,
      );
      process.exitCode = 1;
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
      forwarded.add(signal);
      child.kill(signal);
    });
  }
  process.on("exit", () => {
    child.kill("SIGTERM");
  });
}

main();
