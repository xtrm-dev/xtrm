// `sb remote setup`: verify the connection and the server checkout, then
// persist them. Every fact recorded here was observed from the server, not
// derived from a client path (ADR-008: bash-identical paths are the primary
// defect; they are treated as a coincidence, not an assumption).

import { RemoteError, parseRemoteSpec } from "./spec.ts";
import { readRemoteConfig, remoteConfigPath, writeRemoteConfig, type RemoteConfig } from "./config.ts";
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
  let checkout: { root: string; projectId: string | null } | null = null;
  if (repositoryKey === null) {
    warnings.push("not inside a Git checkout: no server checkout was verified. Run setup from the repository checkout you want mapped.");
  } else {
    if (options.refresh === true) delete config.checkouts[repositoryKey];
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
