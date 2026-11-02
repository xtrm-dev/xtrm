// `sb remote setup`: verify the connection and the server checkout, then
// persist them. Every fact recorded here was observed from the server, not
// derived from a client path (ADR-008: bash-identical paths are the primary
// defect; they are treated as a coincidence, not an assumption).

import { execFileSync } from "node:child_process";
import { RemoteError, parseRemoteSpec } from "./spec.ts";
import { mappingKey, readRemoteConfig, remoteConfigPath, writeRemoteConfig, type RemoteConfig } from "./config.ts";
import { clientRepositoryKey, measureLatency, resolveMapping, resolveServerSb, serverRoots, serverVersion, type RemoteSession } from "./session.ts";
import { sshTransport, type RemoteTransport } from "./ssh.ts";

export interface RemoteSetupOptions {
  serverRoot?: string | null;
  refresh?: boolean;
  env?: NodeJS.ProcessEnv;
  transport?: RemoteTransport;
}

export interface RemoteSetupResult {
  configPath: string;
  remote: string;
  sbPath: string;
  serverVersion: string;
  latencyMs: number | null;
  repositoryKey: string | null;
  checkout: { root: string; projectId: string | null } | null;
  candidates: string[];
  warnings: string[];
}

// The host text in `remote.origin.url`, as written, or null when there is no
// origin or it cannot be read. Used only for the mismatch warning.
function originHost(): string | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
  if (raw === "") return null;
  if (/[\s?#\\\u0000-\u001f\u007f]/.test(raw)) return raw;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/]*)\//.exec(raw);
  if (scheme !== null) {
    const authority = scheme[1]!.slice(scheme[1]!.lastIndexOf("@") + 1);
    return authority.replace(/:\d+$/, "");
  }
  // Same rule as normalizeRemote: a ':' in the user part means the real host is
  // the earlier token, so the warning must not compare against the later one.
  const scp = /^(?:[^@:/\\]+@)?([^:/]+):/.exec(raw);
  return scp === null ? null : scp[1]!;
}

export function remoteSetup(rawSpec: string, options: RemoteSetupOptions = {}): RemoteSetupResult {
  const env = options.env ?? process.env;
  const spec = parseRemoteSpec(rawSpec);
  if (spec === null) throw new RemoteError("config", "a remote spec is required: sb remote setup ssh:<host>");
  const remote = spec.transport + ":" + spec.host;
  const existing = readRemoteConfig(env);
  const config: RemoteConfig = existing ?? { remote, remoteSb: null, serverVersion: null, checkouts: {} };
  // A different host invalidates everything observed from the old one.
  if (config.remote !== remote) {
    config.remote = remote;
    config.remoteSb = null;
    config.serverVersion = null;
    config.checkouts = {};
  }

  const session: RemoteSession = {
    spec,
    config,
    configPath: remoteConfigPath(env),
    sbPath: config.remoteSb ?? "",
    transport: options.transport ?? sshTransport,
    env,
    // setup persists everything itself, at the end, once: an intermediate
    // cache write would record a half-verified mapping.
    envOverride: true,
  };
  if (session.sbPath === "") session.sbPath = resolveServerSb(session);

  const version = serverVersion(session);
  let latencyMs: number | null = null;
  try {
    latencyMs = measureLatency(session);
  } catch {
    latencyMs = null;
  }

  const warnings: string[] = [];
  const repositoryKey = clientRepositoryKey();
  // A key is folded from the origin's authority, so a raw host that differs
  // from the key's host means the origin is not the remote it looks like (a
  // credential, a proxy or an unusual scheme). Warn instead of trusting it.
  const rawHost = originHost();
  if (repositoryKey !== null && rawHost !== null) {
    const keyHost = repositoryKey.split("/")[0] ?? "";
    if (keyHost !== rawHost.toLowerCase()) {
      warnings.push(
        "origin host " + JSON.stringify(rawHost) + " differs from the repository key host " + JSON.stringify(keyHost) +
          ": the key is used to match the server checkout, so check the origin before relying on this mapping",
      );
    }
  }
  let checkout: { root: string; projectId: string | null } | null = null;
  if (repositoryKey === null) {
    warnings.push("not inside a Git checkout: no server checkout was verified. Run setup from the repository checkout you want mapped.");
  } else {
    if (options.refresh === true) delete config.checkouts[mappingKey(spec.host, repositoryKey)];
    const mapping = resolveMapping(session, repositoryKey, { serverRoot: options.serverRoot ?? null, refresh: true });
    checkout = { root: mapping.root, projectId: mapping.projectId };
  }

  let candidates: string[] = [];
  try {
    candidates = serverRoots(session);
  } catch {
    // diagnostics only
  }

  const configPath = writeRemoteConfig(config, env);
  return {
    configPath,
    remote,
    sbPath: session.sbPath,
    serverVersion: version,
    latencyMs,
    repositoryKey,
    checkout,
    candidates,
    warnings,
  };
}
