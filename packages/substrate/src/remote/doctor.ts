// `sb doctor` remote section: what mode this machine is in, what the server can
// do, and what it cannot. Capability gaps are stated, never assumed away
// (ADR-008 amendment §1).

import { compareVersions } from "./version.ts";
import { openRemoteSession, resolveMapping, measureLatency, serverVersion, clientRepositoryKey, storedMapping, type RemoteSession } from "./session.ts";
import type { RemoteTransport } from "./ssh.ts";
import { remoteConfigPath } from "./config.ts";

export interface RemoteCapabilities {
  // SUBSTRATE_HOLDER is read by 0.2.3+; 0.2.2 records a participant only from
  // --participant, so worker identity needs that flag on an older server.
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
  checkout: { root: string; projectId: string | null; cached: boolean } | null;
  capabilities: RemoteCapabilities;
  error: string | null;
}

export interface RemoteDoctorDeps {
  transport?: RemoteTransport;
  env?: NodeJS.ProcessEnv;
  clientVersion?: string | null;
}

// Verified against a live server, not assumed: sb 0.2.2 accepts
// --participant/--workspace on `provenance dispatch` and on `journal
// checkpoint`, but NOT on `journal append`, and its binary contains no
// SUBSTRATE_HOLDER (so host identity never reaches a forwarded append).
// 0.2.3 adds --participant to `journal.append` and reads SUBSTRATE_HOLDER.
// The typed stdio service named in ADR-008 is not shipped on either side yet;
// it stays a follow-up, and doctor says so instead of implying it exists.
const SERVER_SERVICE_VERSION = "0.2.3";

function capabilitiesFor(server: string | null): RemoteCapabilities {
  const known = server !== null;
  const modern = server !== null && compareVersions(server, SERVER_SERVICE_VERSION) >= 0;
  return {
    holderEnv: modern
      ? "server sb " + server + " reads SUBSTRATE_HOLDER and accepts --participant on journal appends"
      : known
        ? "server sb " + server + " has no journal --participant flag and no SUBSTRATE_HOLDER: forwarded journal appends record no participant (needs server " + SERVER_SERVICE_VERSION + ")"
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
  };

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
      report.checkout = { root: mapping.root, projectId: mapping.projectId, cached: cached !== null };
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  }
  return report;
}
