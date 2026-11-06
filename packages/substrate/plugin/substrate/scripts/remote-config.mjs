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
  return { root, key };
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** ssh arguments shared by every remote consumer: no pty, no prompts, keepalive. */
export function sshArgs(host, remoteCommand) {
  return [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "LogLevel=ERROR",
    "sh",
    host,
    remoteCommand,
  ];
}

/** Identity and workspace arguments the far side applies to itself. */
export function identityArgs(workspace) {
  return ["--identity", ...IDENTITY_KEYS.map((name) => process.env[name] ?? ""), "--workspace", workspace];
}
