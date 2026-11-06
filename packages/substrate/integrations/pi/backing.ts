// How the Pi integration reaches a Substrate store: through the typed service,
// whether the store is on this machine or behind ssh (ADR-008, XTRM-691).
//
// One call surface for both. `openService` answers a local service when no remote
// is configured — the same operation table, in process — and a client over ssh
// when one is, so a handler never branches on transport and a tool cannot behave
// differently on the two paths. A configured remote that cannot be reached throws
// the transport's own code; it never falls back to the local store, because a
// silent fallback writes to a store the operator did not choose.

import { localOrRemote, openService, type SubstrateService } from "../../src/service/client.ts";

export type BackingKind = "local" | "remote";

export interface Backing {
  kind: BackingKind;
  /** The transport's name for diagnostics: "local" or "ssh:<host>". */
  where: string;
  call<T>(op: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

/** Opens the store this process is configured for, failing closed on a bad remote. */
export function openBacking(options: { env?: NodeJS.ProcessEnv; version?: string } = {}): Backing {
  const env = options.env ?? process.env;
  // Resolved twice on purpose: once to name the transport in diagnostics, and once
  // by openService, which owns the connection. Both read the same configuration.
  const endpoint = localOrRemote(env);
  const opened: { service: SubstrateService } = openService({ env, version: options.version });
  return {
    kind: endpoint.kind,
    where: endpoint.kind === "local" ? "local" : endpoint.remote,
    call: <T>(op: string, args: Record<string, unknown> = {}) => opened.service.call<T>(op, args),
    close: () => opened.service.close(),
  };
}
