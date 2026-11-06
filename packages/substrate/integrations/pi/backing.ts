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
import { isConnectionLost, isReadOperation } from "../../src/service/operations.ts";

export type BackingKind = "local" | "remote";

/** What a tool handler needs: one call surface, whichever transport answers. */
export interface StoreCall {
  call<T>(op: string, args?: Record<string, unknown>): Promise<T>;
}

export interface Backing extends StoreCall {
  kind: BackingKind;
  /** The transport's name for diagnostics: "local" or "ssh:<host>". */
  where: string;
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

/**
 * One backing for the life of a session (XTRM-711).
 *
 * A Pi session makes many calls; opening ssh for each of them paid a handshake
 * every time (639/658/633 ms measured). The connection is opened on first use,
 * reused afterwards, and closed when the session ends.
 *
 * A connection that drops is not reused: the backing is discarded and, for a
 * read only, the call is attempted once on a new connection. A mutation is never
 * retried — the protocol carries no idempotency key, so a retry may run twice.
 */
export class SessionBacking implements StoreCall {
  private backing: Backing | null = null;
  private opens = 0;
  private readonly open: () => Backing;

  constructor(open: () => Backing = () => openBacking()) {
    this.open = open;
  }

  /** How many connections this session has opened; a second one is a diagnostic, not a habit. */
  get connectionCount(): number {
    return this.opens;
  }

  private async current(): Promise<Backing> {
    if (this.backing === null) {
      this.backing = this.open();
      this.opens += 1;
    }
    return this.backing;
  }

  async call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    try {
      return await (await this.current()).call<T>(op, args);
    } catch (error) {
      if (!isConnectionLost(error) || !isReadOperation(op)) throw error;
      await this.close();
      return await (await this.current()).call<T>(op, args);
    }
  }

  async close(): Promise<void> {
    const backing = this.backing;
    this.backing = null;
    if (backing !== null) {
      try {
        await backing.close();
      } catch {
        // A connection that already failed cannot be closed politely, and the
        // failure is the caller's news, not this one's.
      }
    }
  }
}
