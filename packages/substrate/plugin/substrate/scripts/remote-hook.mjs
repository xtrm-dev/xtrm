// Hook-side remote transport (XTRM-692, ADR-008).
//
// A hook is one short-lived process per lifecycle event, so unlike the MCP
// server it does not hold a connection: it forwards this event to the same
// script on the store-owning machine and relays the answer. The hook payload
// already carries the caller's cwd, so the far side records the PC workspace and
// never its own checkout.
//
// The far side prints a sentinel before the handler runs. Everything printed
// before it is discarded — a login shell may banner, and a hook's stdout is
// consumed as JSON by Claude — and a missing sentinel is a lost connection,
// never a local answer.

import { spawn } from "node:child_process";
import {
  applyIdentityArguments,
  handshakeFailure,
  identityArgs,
  parseHandshake,
  remoteCommand,
  remoteScriptCommand,
  remoteSelection,
  serverRoot,
  shellQuote,
  sshArgs,
} from "./remote-config.mjs";

const READY = "@@substrate-hook-ready ";
const LOCAL_MARKER = "SUBSTRATE_MCP_LOCAL=1";
const SERVER_FLAG = "--remote-hook";

export class RemoteUnavailable extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Applies the launcher's arguments when this process is the far side.
 * Returns true when the process is the server side of a proxied hook.
 */
export function applyServerArguments() {
  if (!process.argv.includes(SERVER_FLAG)) return false;
  const applied = applyIdentityArguments();
  const workspace = applied.workspace;
  process.env["SUBSTRATE_MCP_REMOTE"] = "1";
  const sentinelAt = process.argv.indexOf("--sentinel");
  const sentinel = sentinelAt < 0 ? READY : (process.argv[sentinelAt + 1] ?? READY);
  const version = process.argv[process.argv.indexOf("--version") + 1] ?? "unknown";
  process.stdout.write(
    `${sentinel}${JSON.stringify({
      version,
      participant: applied.holder,
      workspace: workspace || null,
      ...(applied.parsed ? {} : { identity: "unparsed" }),
    })}\n`,
  );
  return true;
}

/**
 * Forwards this hook event to the store-owning machine.
 * Returns false when the deployment is local and the caller should run in-process.
 * Throws RemoteUnavailable when a remote is configured and cannot be reached —
 * the caller decides how that hook degrades, but it never runs locally.
 */
export async function proxyHook(scriptPath) {
  const selection = remoteSelection(import.meta.url);
  if (selection === null) return false;
  if (Array.isArray(selection.error)) throw new RemoteUnavailable(selection.error[0], selection.error[1]);
  const server = serverRoot(selection);
  if (Array.isArray(server.error)) throw new RemoteUnavailable(server.error[0], server.error[1]);
  // Same rule as the MCP launcher: the script belongs to the installed package,
  // never to the checkout that only resolves the repository.
  const { prelude, script } = remoteScriptCommand(selection, scriptPath, READY);
  const command = remoteCommand(
    { ...selection, home: server.home },
    server.root,
    script,
    prelude,
    [SERVER_FLAG, "--sentinel", READY, "--version", selection.version, ...identityArgs(process.cwd())],
  );

  const child = spawn("ssh", sshArgs(selection.host, command), { stdio: ["pipe", "pipe", "pipe"] });
  let settled = false;
  let buffer = "";
  let ready = false;
  let discarded = 0;

  const exitCode = new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new RemoteUnavailable("spawn_failed", `cannot run ssh: ${error.message}`)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      if (ready) {
        process.stdout.write(chunk);
        return;
      }
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.startsWith(READY.trim())) {
          const handshake = parseHandshake(line, READY.trim());
          const problem = handshakeFailure(handshake, selection.version, selection.host);
          if (problem !== null) {
            reject(new RemoteUnavailable(problem[0], problem[1]));
            return;
          }
          ready = true;
          if (buffer.length > 0) process.stdout.write(buffer);
          buffer = "";
          return;
        }
        discarded += line.length + 1;
        if (discarded > 32768) reject(new RemoteUnavailable("peer_noise", "the far side printed more than 32768 bytes before the handshake"));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => {
      if (!ready) reject(new RemoteUnavailable("connection_lost", `the far side ended before the handshake (exit ${code ?? "none"})`));
      else resolve(code ?? 0);
    });
  });

  process.stdin.pipe(child.stdin);
  process.stdin.on("end", () => child.stdin.end());

  // Hooks are synchronous from the caller's point of view: the answer must be on
  // stdout before the event completes, so this waits for the exit code.
  const code = await exitCode;
  settled = true;
  return code;
}

export { SERVER_FLAG };
