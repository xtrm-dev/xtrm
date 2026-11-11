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
export function repositoryKey(remote) {
  try {
    const origin = remote ?? execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    return parseRemoteKey(origin);
  } catch {
    // not a git checkout: the caller must pass a root explicitly
    return null;
  }
}

// The key rules live in `normalizeRemote` (src/domain/repository.ts). This
// script ships inside the package and must stay import-free, so the rules are
// mirrored here; tests/remote-config.test.ts asserts parity on a table, and a
// divergence there is the signal to change both.
const ACCEPTED_SCHEMES = new Set(["ssh", "git", "git+ssh", "ssh+git", "https", "http"]);
const DEFAULT_PORTS = { http: "80", https: "443", ssh: "22", git: "9418" };

/**
 * One key per repository, whatever form the remote takes (XTRM-733). The URL
 * form is parsed FIRST: the scp pattern `host:path` also matches `https://…`,
 * which derived `https///github.com/owner/repo` and never matched the key a
 * checkout was recorded under.
 *
 * The refusals matter as much as the normalizations: a scheme outside
 * ACCEPTED_SCHEMES, a backslash, or a query/fragment/backslash/control
 * character in the authority means the input can be read as a different remote
 * than it appears (`http://127.0.0.1:1#@github.com/acme/app`), and folding it
 * into another repository's key would let the launcher pick that repository's
 * recorded checkout.
 */
export function parseRemoteKey(raw) {
  const input = String(raw ?? "").trim();
  if (input === "") return null;
  // Absolute or home-relative paths are local checkouts, not remotes.
  if (input.startsWith("/") || input.startsWith(".") || input.startsWith("~")) return null;

  let host;
  let rawPath;
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(input);
  if (schemeMatch !== null) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!ACCEPTED_SCHEMES.has(scheme)) return null;
    const rest = input.slice(schemeMatch[0].length);
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    const authorityRaw = rest.slice(0, slash);
    rawPath = rest.slice(slash + 1);
    // Credentials live in userinfo; the last '@' keeps a password containing
    // '@' from leaking the host into the key.
    const at = authorityRaw.lastIndexOf("@");
    let authority = at >= 0 ? authorityRaw.slice(at + 1) : authorityRaw;
    if (authority === "") return null;
    if (/[\s?#\\\u0000-\u001f\u007f]/.test(authorityRaw)) return null;
    const portMatch = /^(.*?):(\d+)$/.exec(authority);
    if (portMatch !== null && DEFAULT_PORTS[scheme] === portMatch[2]) authority = portMatch[1];
    host = authority;
  } else {
    // SCP-like form: [user@]host:path. Git splits at the FIRST ':', so
    // `evil.com:path@github.com:acme/app` belongs to host `evil.com` and can
    // never fold onto github.com.
    if (input.includes("://")) return null;
    const bracketed = /^(?:[^@/]+@)?\[([^\]\s]+)\]:(.+)$/.exec(input);
    if (bracketed !== null) {
      host = `[${bracketed[1]}]`;
      rawPath = bracketed[2];
    } else {
      const colon = input.indexOf(":");
      if (colon < 0) return null;
      const authority = input.slice(0, colon);
      const at = authority.lastIndexOf("@");
      host = at >= 0 ? authority.slice(at + 1) : authority;
      rawPath = input.slice(colon + 1);
    }
    if (host === "" || rawPath === "") return null;
  }

  if (rawPath.includes("\\")) return null;
  rawPath = rawPath.split("?")[0].split("#")[0];
  let path = rawPath.replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (path.toLowerCase().endsWith(".git")) path = path.slice(0, -4);
  path = path.replace(/\/+$/, "");
  if (host === "" || /\s/.test(host) || path === "") return null;
  // A single-token host without a dot is text, not a remote ("origin:thing").
  if (!host.startsWith("[") && !host.includes(".") && !path.includes("/")) return null;

  return `${host.toLowerCase()}/${path}`;
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
  // XTRM-722: the caller's session is the only identity source. Delete what this
  // process inherited before applying the wire values — the rule `sb serve`
  // already follows (src/service/serve.ts:261-263): a server login shell that
  // exports SUBSTRATE_HOLDER must never decide a holder, so a client with no
  // holder leaves the key absent and a claim fails closed with the local message
  // instead of claiming as the server. Absence is a real value here: the other
  // identity keys behave the same way.
  for (const name of IDENTITY_KEYS) delete process.env[name];
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
