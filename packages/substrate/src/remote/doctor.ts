// `sb doctor` remote section: what mode this machine is in, what the server can
// do, and what it cannot. Capability gaps are stated, never assumed away
// (ADR-008 amendment §1).

import { compareVersions } from "./version.ts";
import { openRemoteSession, resolveMapping, measureLatency, serverVersion, clientRepositoryKey, storedMapping, type RemoteSession } from "./session.ts";
import type { RemoteTransport } from "./ssh.ts";
import { remoteConfigPath } from "./config.ts";

export interface RemoteCapabilities {
  // SUBSTRATE_HOLDER is read by 0.2.2 as well (execution-context ambient
  // identity); --participant on journal appends arrives in 0.2.3.
  holderEnv: string;
  // Client-workspace recording needs a server that accepts the override.
  workspaceOverride: string;
  // Commit binding is argv-expressible and works on 0.2.2.
  commitBinding: string;
  // The JSON-RPC stdio service is the follow-up path for in-process consumers.
  codecService: string;
  // Repository-key lookup by probing each server checkout's own doctor output.
  repositoryKeyLookup: string;
}

export interface RemoteDoctorReport {
  mode: "local" | "ssh";
  configPath: string;
  remote: string | null;
  host: string | null;
  remoteSb: string | null;
  clientVersion: string | null;
  serverVersion: string | null;
  latencyMs: number | null;
  repositoryKey: string | null;
  checkout: { root: string; projectId: string | null; cached: boolean; verifiedAt: number } | null;
  capabilities: RemoteCapabilities;
  error: string | null;
  // Why remote mode was not consulted for this invocation (an explicit local
  // store), so `sb doctor` names the reason instead of looking unconfigured.
  note: string | null;
}

export interface RemoteDoctorDeps {
  transport?: RemoteTransport;
  env?: NodeJS.ProcessEnv;
  clientVersion?: string | null;
  // `--db` or SUBSTRATE_DB on this invocation: the local store is deliberate.
  localStore?: string | null;
}

// Verified against a live server, not assumed. sb 0.2.2 rejects
// --participant/--workspace on `journal append`, but its
// src/domain/execution-context.js reads SUBSTRATE_HOLDER as the ambient
// identity for a write that supplies none: a forwarded `issue note` with the
// holder exported records that participant (measured 2026-11-02, journal
// seq 7). 0.2.2 also accepts --participant/--workspace on `provenance
// dispatch` and `--workspace` on `journal checkpoint`. 0.2.3 adds
// --participant to `journal.append`. The typed stdio service named in ADR-008
// is not shipped on either side yet; it stays a follow-up, and doctor says so
// instead of implying it exists.
const SERVER_SERVICE_VERSION = "0.2.3";

function capabilitiesFor(server: string | null): RemoteCapabilities {
  const known = server !== null;
  const modern = server !== null && compareVersions(server, SERVER_SERVICE_VERSION) >= 0;
  return {
    holderEnv: modern
      ? "server sb " + server + " reads SUBSTRATE_HOLDER and accepts --participant on journal appends"
      : known
        ? "server sb " + server + " reads SUBSTRATE_HOLDER (ambient identity) but rejects --participant on journal appends: an exported holder survives a forwarded write, an explicit --participant does not"
        : "unknown until the server answers",
    workspaceOverride: modern
      ? "client workspace is recordable on dispatch and checkpoint (--workspace/--participant)"
      : known
        ? "server sb " + server + " accepts --workspace on provenance dispatch and journal checkpoint; checkpoints from a forwarded run otherwise record the server checkout"
        : "unknown until the server answers",
    commitBinding: "argv (sb provenance bind) works on 0.2.2 and later",
    codecService: "not shipped on either side yet: the typed stdio service for in-process consumers is the ADR-008 follow-up, so those consumers stay local or use argv",
    repositoryKeyLookup: "sb doctor --json per server checkout (0.2.2-compatible)",
  };
}

export function remoteDoctor(deps: RemoteDoctorDeps = {}): RemoteDoctorReport {
  const env = deps.env ?? process.env;
  const configPath = remoteConfigPath(env);
  const report: RemoteDoctorReport = {
    mode: "local",
    configPath,
    remote: null,
    host: null,
    remoteSb: null,
    clientVersion: deps.clientVersion ?? null,
    serverVersion: null,
    latencyMs: null,
    repositoryKey: null,
    checkout: null,
    capabilities: capabilitiesFor(null),
    error: null,
    note: null,
  };

  // An explicit local store outranks every remote setting, including a
  // malformed config file: the operator asked for this store on this machine,
  // and reading the remote config would only fail the invocation.
  if (deps.localStore !== undefined && deps.localStore !== null) {
    report.note = deps.localStore + " selects the local store, so remote mode is not consulted for this invocation";
    return report;
  }

  let session: RemoteSession | null;
  try {
    session = openRemoteSession({ transport: deps.transport, env });
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    return report;
  }
  if (session === null) return report;

  report.mode = "ssh";
  report.remote = session.config.remote;
  report.host = session.spec.host;
  report.remoteSb = session.sbPath;
  try {
    report.serverVersion = serverVersion(session);
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    report.capabilities = capabilitiesFor(null);
    return report;
  }
  report.capabilities = capabilitiesFor(report.serverVersion);
  try {
    report.latencyMs = measureLatency(session);
  } catch {
    // latency is diagnostic only
  }
  try {
    const repositoryKey = clientRepositoryKey();
    report.repositoryKey = repositoryKey;
    if (repositoryKey !== null) {
      const cached = storedMapping(session, repositoryKey);
      const mapping = resolveMapping(session, repositoryKey);
      report.checkout = { root: mapping.root, projectId: mapping.projectId, cached: cached !== null, verifiedAt: mapping.verifiedAt };
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  }
  return report;
}
