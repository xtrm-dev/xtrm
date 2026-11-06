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
// something to stdout before our command runs. The remote side therefore prints
// a sentinel line first, and nothing before it is ever forwarded to the MCP
// stream. The sentinel carries the version and the identity it accepted, which
// is the handshake and the version probe in one.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSubstrate } from "./resolve-substrate.mjs";

const READY = "@@substrate-mcp-ready ";
const LOCAL_MARKER = "SUBSTRATE_MCP_LOCAL=1";
const IDENTITY_KEYS = ["SUBSTRATE_HOLDER", "XTRM_SESSION_ID", "SUBSTRATE_ACTIVATION_ID"];

// A disconnected MCP server with a named reason, never a silent local answer.
// The exit code is set and the process is left to drain (XTRM-335): an immediate
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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The remote this process is configured for, or null for fully local. */
function remoteSelection() {
  if (process.env["SUBSTRATE_MCP_LOCAL"] === "1") return null;
  const configPath = process.env["SUBSTRATE_REMOTE_CONFIG"] ?? join(homedir(), ".xtrm", "config", "substrate.json");
  const file = existsSync(configPath) ? readJson(configPath) : null;
  const raw = process.env["SUBSTRATE_REMOTE"] ?? file?.remote ?? null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const match = /^ssh:(.+)$/.exec(raw.trim());
  if (!match) return { error: ["config", `substrate.remote "${raw}" is not an ssh:<host> remote`] };
  const sbPath = file?.remoteSb ?? null;
  if (typeof sbPath !== "string" || !sbPath.startsWith("/")) {
    return {
      error: ["not_installed", `no absolute server sb path is recorded for ssh:${match[1]}; run \`sb remote setup ssh:${match[1]}\` first`],
    };
  }
  return { host: match[1], sbPath, checkouts: file?.checkouts ?? {}, configPath };
}

/** The repository this process serves, so the server checkout can be found. */
function repositoryKey() {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const scp = /^(?:[^@:/\\]+@)?([^@/:\\]+):(.+)$/.exec(remote);
    if (scp) return `${scp[1]}/${scp[2].replace(/\.git$/, "")}`;
    const url = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(remote);
    if (url) return `${url[1]}/${url[2].replace(/\.git$/, "")}`;
  } catch {
    // not a git checkout: the caller must pass a root explicitly
  }
  return null;
}

async function proxy(remote) {
  const key = repositoryKey();
  const serverRoot =
    process.env["SUBSTRATE_MCP_SERVER_ROOT"] ??
    (key === null ? null : remote.checkouts[`${remote.host} ${key}`]?.root ?? null);
  if (serverRoot === null) {
    fail(
      "not_installed",
      `no verified checkout of ${key ?? "this repository"} is recorded for ssh:${remote.host}; run \`sb remote setup ssh:${remote.host}\` on this machine`,
    );
  }
  const script = join(serverRoot, "packages", "substrate", "plugin", "substrate", "scripts", "substrate-mcp.mjs");
  // Identity travels as explicit arguments, not forwarded environment: ssh may
  // refuse SendEnv, and #309 showed a forwarded variable is read by the far-side
  // process rather than declared by the caller.
  const identity = IDENTITY_KEYS.map((name) => process.env[name] ?? "");
  const workspace = process.cwd();
  const remoteCommand = [
    "cd",
    shellQuote(serverRoot),
    "&&",
    LOCAL_MARKER,
    "node",
    shellQuote(script),
    "--remote-ready",
    shellQuote(READY),
    "--identity",
    ...identity.map(shellQuote),
    "--workspace",
    shellQuote(workspace),
  ].join(" ");

  child = spawn(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "LogLevel=ERROR",
      "sh",
      remote.host,
      remoteCommand,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.on("error", (error) => fail("spawn_failed", `cannot run ssh: ${error.message}`));

  const localVersion = readJson(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json"))?.version ?? "unknown";

  let buffer = "";
  let ready = false;
  let discarded = 0;
  const prefix = READY.trim();
  const handshakeLine = (line) => {
    const handshake = JSON.parse(line.slice(prefix.length).trim() || "{}");
    if (handshake.version !== localVersion) {
      fail(
        "version_mismatch",
        `the server runs substrate ${handshake.version} and this plugin is ${localVersion}; install the matching version on ${remote.host}`,
      );
    }
    ready = true;
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (failed) return;
    if (ready) {
      process.stdout.write(chunk);
      return;
    }
    buffer += chunk;
    // A login shell may print a banner before our command runs. Those lines are
    // discarded — they cannot be allowed to reach the MCP stream, and failing the
    // connection over a banner would be worse — but the discard is bounded, and
    // the handshake must still arrive.
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith(prefix)) {
        handshakeLine(line);
        if (buffer.length > 0) process.stdout.write(buffer);
        buffer = "";
        return;
      }
      discarded += line.length + 1;
      if (discarded > 32768) fail("peer_noise", "the far side printed more than 32768 bytes before the handshake");
    }
    if (buffer.startsWith(prefix) && !buffer.includes("\n")) {
      // The handshake line is still arriving; wait for its newline.
      return;
    }
    if (buffer.length > 8192) fail("peer_noise", "the far side printed more than 8192 bytes without a newline");
  });

  // stderr is diagnostics, never MCP frames: it goes to our stderr, prefixed.
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ---- server side ------------------------------------------------------------
// Started by the launcher on the store-owning machine. Identity arrives as
// arguments and is applied to this process before the server module loads, so
// the rows record the PC's participant; the workspace travels the same way,
// because this process's cwd is the server checkout, not the caller's worktree.
function applyRemoteArguments() {
  const index = process.argv.indexOf("--remote-ready");
  if (index < 0) return null;
  const sentinel = process.argv[index + 1] ?? "@@substrate-mcp-ready ";
  const identityAt = process.argv.indexOf("--identity");
  const identity = identityAt < 0 ? ["", "", ""] : process.argv.slice(identityAt + 1, identityAt + 4);
  const workspaceAt = process.argv.indexOf("--workspace");
  const workspace = workspaceAt < 0 ? "" : (process.argv[workspaceAt + 1] ?? "");
  const [holder, sessionId, activationId] = identity;
  if (holder) process.env["SUBSTRATE_HOLDER"] = holder;
  if (sessionId) process.env["XTRM_SESSION_ID"] = sessionId;
  if (activationId) process.env["SUBSTRATE_ACTIVATION_ID"] = activationId;
  process.env["SUBSTRATE_MCP_REMOTE"] = "1";
  if (workspace) process.env["SUBSTRATE_MCP_WORKSPACE"] = workspace;
  const version = readJson(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json"))?.version ?? "unknown";
  // The sentinel is the handshake and the version probe in one: everything the
  // far side printed before it is discarded by the launcher.
  process.stdout.write(`${sentinel}${JSON.stringify({ version, participant: holder || null, workspace: workspace || null })}\n`);
  return { sentinel, holder, workspace };
}

const serverSide = applyRemoteArguments();

const chosen = serverSide === null ? remoteSelection() : null;
if (chosen !== null && Array.isArray(chosen.error)) {
  fail(chosen.error[0], chosen.error[1]);
} else if (chosen === null) {
  const { serveMain } = await resolveSubstrate("mcp-server.ts");
  serveMain();
} else {
  await proxy(chosen);
}
