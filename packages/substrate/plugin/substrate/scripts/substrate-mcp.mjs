// MCP server entry for the packaged plugin (bead xtrm-iip.1, closeout E1;
// remote transport XTRM-692, ADR-008).
//
// This is the path .mcp.json names, exactly as contracted:
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/substrate-mcp.mjs
// and it stays byte-identical: the manifest carries no host, no path and no ssh
// command. The decision between a local store and a server-owned one is made
// here, at launch, from the same configuration `sb` reads.
//
// Remote mode starts the SAME script on the store-owning machine over ssh and
// proxies MCP over the pipe. Store access there is genuinely local — the server
// process records against its own disk and pins its own package version — and
// this process never opens a store.
//
// The first bytes from the far side are untrusted: a login shell may print
// something to stdout before our command runs. The remote side prints a sentinel
// line first, and nothing before it ever reaches the MCP stream. The sentinel
// carries the version and the identity it accepted: handshake and version probe
// in one.

import { spawn } from "node:child_process";
import { resolveSubstrate } from "./resolve-substrate.mjs";
import {
  applyIdentityArguments,
  handshakeFailure,
  identityArgs,
  parseHandshake,
  pluginVersion,
  remoteCommand,
  remoteScriptCommand,
  remoteSelection,
  serverRoot,
  shellQuote,
  sshArgs,
} from "./remote-config.mjs";

const READY = "@@substrate-mcp-ready ";
const LOCAL_MARKER = "SUBSTRATE_MCP_LOCAL=1";

// A disconnected MCP server with a named reason, never a silent local answer.
// The exit code is set and the process left to drain (XTRM-335): an immediate
// exit can truncate the reason the operator needs.
let failed = false;
let child = null;
function fail(code, message) {
  if (failed) return;
  failed = true;
  process.exitCode = 78;
  process.stderr.write(`substrate-mcp: ${code}: ${message}\n`);
  child?.kill("SIGTERM");
  process.stdin.pause();
}

// ---- server side ------------------------------------------------------------
// Started by the launcher on the store-owning machine. Identity arrives as
// arguments and is applied before the server module loads, so rows record the
// PC's participant; the workspace travels the same way, because this process's
// cwd is the server checkout, not the caller's worktree.
function applyRemoteArguments() {
  const index = process.argv.indexOf("--remote-ready");
  if (index < 0) return null;
  const sentinel = process.argv[index + 1] ?? READY;
  const applied = applyIdentityArguments();
  process.env["SUBSTRATE_MCP_REMOTE"] = "1";
  const version = pluginVersion(import.meta.url);
  process.stdout.write(
    `${sentinel}${JSON.stringify({
      version,
      participant: applied.holder,
      workspace: applied.workspace || null,
      ...(applied.parsed ? {} : { identity: "unparsed" }),
    })}\n`,
  );
  return applied;
}

// ---- client side ------------------------------------------------------------
function proxy(selection) {
  const server = serverRoot(selection);
  if (Array.isArray(server.error)) {
    fail(server.error[0], server.error[1]);
    return;
  }
  // The script ships with the installed package, not with the checkout: the
  // checkout may be a different repository entirely (review, HIGH).
  const { prelude, script } = remoteScriptCommand(selection, "substrate-mcp.mjs", READY);
  const command = remoteCommand(
    { ...selection, home: server.home },
    server.root,
    script,
    prelude,
    ["--remote-ready", /* sentinel */ shellQuote(READY), "--version", shellQuote(selection.version), ...identityArgs(process.cwd())],
  );

  child = spawn("ssh", sshArgs(selection.host, command), { stdio: ["pipe", "pipe", "pipe"] });
  child.on("error", (error) => fail("spawn_failed", `cannot run ssh: ${error.message}`));

  let ready = false;
  let buffer = "";
  let discarded = 0;
  const prefix = READY.trim();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (failed) return;
    if (ready) {
      process.stdout.write(chunk);
      return;
    }
    buffer += chunk;
    // A login shell may banner before our command runs. Those lines are
    // discarded — they must not reach the MCP stream, and failing a working
    // connection over a banner would be worse — but the discard is bounded and
    // the handshake is mandatory.
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith(prefix)) {
        // A sentinel that is not JSON is a protocol failure with a name, never a
        // stack trace in the middle of an MCP session.
        const handshake = parseHandshake(line, prefix);
        const problem = handshakeFailure(handshake, selection.version, selection.host);
        if (problem !== null) {
          fail(problem[0], problem[1]);
          return;
        }
        ready = true;
        if (buffer.length > 0) process.stdout.write(buffer);
        buffer = "";
        return;
      }
      discarded += line.length + 1;
      if (discarded > 32768) {
        fail("peer_noise", "the far side printed more than 32768 bytes before the handshake");
        return;
      }
    }
    if (buffer.length > 8192) fail("peer_noise", "the far side printed more than 8192 bytes without a newline");
  });

  // stderr is diagnostics, never MCP frames.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  process.stdin.pipe(child.stdin);
  process.stdin.on("end", () => child.stdin.end());

  child.on("close", (code, signal) => {
    if (failed) return;
    if (!ready) {
      fail("connection_lost", `the remote service ended before the handshake (exit ${code ?? "none"}${signal ? `, ${signal}` : ""})`);
      return;
    }
    process.exitCode = code ?? 0;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      failed = true;
      process.exitCode = 130;
      child?.kill("SIGTERM");
    });
  }
}

const serverSide = applyRemoteArguments();
const chosen = serverSide === null ? remoteSelection(import.meta.url) : null;
if (chosen !== null && Array.isArray(chosen.error)) {
  fail(chosen.error[0], chosen.error[1]);
} else if (chosen === null) {
  const { serveMain } = await resolveSubstrate("mcp-server.ts");
  serveMain();
} else {
  proxy(chosen);
}
