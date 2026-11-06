// Shared remote-selection logic for the plugin entry scripts (XTRM-692).
// One reader for one decision: which machine owns the store. Both consumers —
// the MCP server and the hook adapters — ask this module, so they can never
// disagree about whether a remote is configured.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const IDENTITY_KEYS = ["SUBSTRATE_HOLDER", "XTRM_SESSION_ID", "SUBSTRATE_ACTIVATION_ID"];

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Package version of the plugin this process is running from. */
export function pluginVersion(scriptUrl) {
  return readJson(join(new URL("../../../package.json", scriptUrl).pathname))?.version ?? "unknown";
}

/**
 * The configured remote, or null for a fully local deployment.
 * Returns { error: [code, message] } when a remote is configured but unusable:
 * a configured remote never degrades into local.
 */
export function remoteSelection(scriptUrl) {
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
  return { host: match[1], sbPath, checkouts: file?.checkouts ?? {}, configPath, version: pluginVersion(scriptUrl) };
}

/** The repository this process serves, so the server checkout can be found. */
export function repositoryKey() {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const scp = /^(?:[^@:/\s]+@)?([^@:/\s]+):(.+)$/.exec(remote);
    if (scp) return `${scp[1]}/${scp[2].replace(/\.git$/, "")}`;
    const url = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(remote);
    if (url) return `${url[1]}/${url[2].replace(/\.git$/, "")}`;
  } catch {
    // not a git checkout: the caller must pass a root explicitly
  }
  return null;
}

/** The server checkout for this repository, or an error naming how to record one. */
export function serverRoot(remote) {
  const key = repositoryKey();
  const root =
    process.env["SUBSTRATE_MCP_SERVER_ROOT"] ?? (key === null ? null : remote.checkouts[`${remote.host} ${key}`]?.root ?? null);
  if (typeof root !== "string" || root === "") {
    return {
      error: [
        "not_installed",
        `no verified checkout of ${key ?? "this repository"} is recorded for ssh:${remote.host}; run \`sb remote setup ssh:${remote.host}\` on this machine`,
      ],
    };
  }
  const home = remote.checkouts[`${remote.host} ${key}`]?.home ?? null;
  return { root, key, home: typeof home === "string" && home.startsWith("/") ? home : null };
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * ssh arguments shared by every remote consumer: no pty, no prompts, keepalive.
 * ssh takes options, then the destination, then the command — nothing may sit
 * between the options and the host, or ssh reads that token as the host.
 */
export function sshArgs(host, remoteCommand) {
  return [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "LogLevel=ERROR",
    host,
    remoteCommand,
  ];
}

/**
 * Identity and workspace arguments the far side applies to itself.
 * One JSON argument, not positional values: an empty identity component would be
 * a zero-length word in the remote command, and a shell that drops it shifts
 * every later value into the wrong slot.
 */
export function identityArgs(workspace) {
  const identity = Object.fromEntries(IDENTITY_KEYS.map((name) => [name, process.env[name] ?? ""]));
  return ["--identity", JSON.stringify(identity), "--workspace", workspace];
}

/** Applies what identityArgs() carried. Returns the workspace the caller had. */
export function applyIdentityArguments(argv = process.argv) {
  const at = argv.indexOf("--identity");
  const raw = at < 0 ? "" : (argv[at + 1] ?? "");
  let identity = {};
  let parsed = raw === "";
  try {
    identity = raw === "" ? {} : JSON.parse(raw);
    parsed = true;
  } catch {
    identity = {};
    parsed = false;
  }
  for (const name of IDENTITY_KEYS) {
    const value = identity[name];
    if (typeof value === "string" && value !== "") process.env[name] = value;
  }
  const workspaceAt = argv.indexOf("--workspace");
  const workspace = workspaceAt < 0 ? "" : (argv[workspaceAt + 1] ?? "");
  if (workspace) process.env["SUBSTRATE_MCP_WORKSPACE"] = workspace;
  return { identity, workspace, holder: identity["SUBSTRATE_HOLDER"] || null, parsed };
}

/**
 * Where the plugin script runs on the far side (XTRM-692 review, HIGH).
 * The script ships with the INSTALLED package, not with the store checkout: the
 * server may hold a checkout of a different repository, or of this one without
 * packages/. The package directory is resolved on the far side from the recorded
 * sb path — <pkg>/bin/sb → <pkg> — and the checkout is used only to resolve the
 * repository.
 * SUBSTRATE_MCP_SERVER_ROOT overrides the SCRIPT directory for tests and
 * development; it is not the checkout.
 */
export function remoteScriptCommand(selection, scriptName, sentinel) {
  const override = process.env["SUBSTRATE_MCP_SERVER_ROOT"];
  if (typeof override === "string" && override.startsWith("/")) {
    return { prelude: [], script: shellQuote(`${override}/${scriptName}`) };
  }
  // `sb` resolves through dist/cli to a file inside the package, so the nearest
  // ancestor that actually ships the script is the package root — not a fixed
  // number of dirname() steps.
  const scriptExpr = `"$PKG/plugin/substrate/scripts/${scriptName}"`;
  return {
    prelude: [
      `PKG=$(dirname "$(readlink -f ${shellQuote(selection.sbPath)})")`,
      `while [ ! -f ${scriptExpr} ] && [ "$PKG" != "/" ]; do PKG=$(dirname "$PKG"); done`,
      `if [ ! -f ${scriptExpr} ]; then printf '%s%s\\n' ${shellQuote(sentinel)} '{"error":"not_installed"}'; exit 78; fi`,
    ],
    script: scriptExpr,
  };
}

/** The command for one remote invocation, shared so both consumers agree. */
export function remoteCommand(selection, checkout, script, prelude, argv) {
  const segments = [`cd ${shellQuote(checkout)}`, ...prelude];
  const env = ["SUBSTRATE_MCP_LOCAL=1"];
  if (selection.home) env.push(`SUBSTRATE_HOME=${shellQuote(selection.home)}`);
  // Every argument is quoted here, once: the identity is JSON, and an unquoted
  // argument loses its quotes to the remote shell, which turned a valid identity
  // into an unparsable one.
  const quoted = argv.map(shellQuote).join(" ");
  segments.push(`${env.join(" ")} node ${script}${quoted === "" ? "" : ` ${quoted}`}`);
  return segments.join(" && ");
}

/**
 * Reads the far side's handshake line. A sentinel that is not JSON, or one that
 * reports an identity it could not parse, must fail with a named code rather than
 * throw a stack trace or (worse) serve on with no identity.
 */
export function handshakeFailure(handshake, expectedVersion, host) {
  if (handshake === null || typeof handshake !== "object" || Array.isArray(handshake)) {
    return ["protocol_mismatch", "the far side sent a handshake that is not an object"];
  }
  if (handshake["error"] === "not_installed") {
    return ["not_installed", `the installed substrate package on ${host} does not ship the plugin script; install it there`];
  }
  if (handshake["identity"] === "unparsed") {
    return ["protocol_mismatch", "the far side could not parse the identity argument, so no row would record this participant"];
  }
  if (typeof handshake["version"] !== "string") {
    return ["protocol_mismatch", "the far side sent a handshake without a version"];
  }
  if (handshake["version"] !== expectedVersion) {
    return [
      "version_mismatch",
      `the server runs substrate ${handshake["version"]} and this plugin is ${expectedVersion}; install the matching version on ${host}`,
    ];
  }
  return null;
}

export function parseHandshake(line, prefix) {
  try {
    return JSON.parse(line.slice(prefix.length).trim() || "{}");
  } catch {
    return null;
  }
}
