// The client half of `sb serve --stdio`: one connection per process, typed calls.
//
// Two ways to reach the same operation table:
//   - `createLocalService` runs it in-process (a machine that owns the store);
//   - `createServiceClient` speaks the wire protocol to a `sb serve --stdio`
//     process, locally or through `ssh` (`openSshService`).
// Both answer `ServiceCallError` with the same codes, so a caller written
// against one mode works in the other.
//
// The connection is a child process's pipes. A call is a frame on stdin and a
// frame on stdout, matched by id, with a per-call timeout so a caller cannot
// hang forever on a server that died mid-answer. stdout is protocol only; the
// child's stderr is diagnostics and is never folded into an error message (it
// is the server's own text, which the caller cannot trust to be one line).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { openSubstrate } from "../store/sqlite.ts";
import { migrate } from "../store/migrations/runner.ts";
import { parseRemoteSpec, shellQuote, type RemoteSpec } from "../remote/spec.ts";
import { sshArgv } from "../remote/ssh.ts";
import { RemoteError } from "../remote/spec.ts";
import { mappingKey, selectRemote, type RemoteConfig, type RemoteSelection } from "../remote/config.ts";
import { discoverRepository } from "../domain/repository-discovery.ts";
import { CAPABILITIES, OPERATIONS, assertKnownArgs, classifyError, createServices } from "./ops.ts";
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  ServiceCallError,
  decodeResponse,
  encodeRequest,
  type HelloResult,
  type ServiceRequestLike,
} from "./protocol.ts";

export interface SubstrateService {
  /** The handshake result; awaited by the first call. */
  ready(): Promise<HelloResult>;
  call<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Why a link ended. A spawn failure, a broken stdin pipe and an ordinary exit need
 * different answers from the caller, so the transport says which happened instead
 * of leaving the client to guess from an exit code.
 */
export type LinkExitKind = "exit" | "spawn_failed" | "stdin_broken";

/** The transport a client needs: write a frame, hear frames, hear the end. */
export interface ServiceLink {
  write(frame: string): void;
  onFrame(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null, reason?: string, kind?: LinkExitKind) => void): void;
  /** Diagnostics from the far side, for a caller that wants to log them. */
  diagnostics(): string;
  close(): Promise<void>;
}

const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/** One line may not exceed a frame plus a newline; a longer one is a broken peer. */
const MAX_LINE_BYTES = MAX_FRAME_BYTES + 1024;

/**
 * Environment a service session may inherit.
 *
 * An allowlist rather than a filter: these names are interpolated into the
 * remote command line, so a caller-supplied key such as `X; rm -rf /` must never
 * reach it, and an unexpected name is refused instead of silently dropped (the
 * caller then knows its identity did not travel).
 */
const FORWARDED_ENV_KEYS = new Set([
  "SUBSTRATE_HOLDER",
  "SUBSTRATE_ISSUE_REF",
  "SUBSTRATE_ISSUE",
  "SUBSTRATE_ACTIVATION_ID",
  "SUBSTRATE_SPECIALIST",
  "XTRM_SESSION_ID",
  "XTRM_SESSION_NAME",
  "LANG",
  "TZ",
]);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sanitizeDiagnostic(text: string): string {
  return text.replace(/[^\x20-\x7e\n]/g, "").slice(0, 400);
}

/** Runs the operation table in this process. */
export function createLocalService(dbPath: string, version: string): SubstrateService {
  const db = openSubstrate(dbPath);
  migrate(db);
  const services = createServices(db);
  return {
    ready: async () => ({
      protocol: PROTOCOL_VERSION,
      substrate: version,
      dbPath,
      capabilities: CAPABILITIES,
    }),
    call: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (!Object.hasOwn(OPERATIONS, op)) {
        throw new ServiceCallError("unknown_op", `unknown operation "${op}"`);
      }
      try {
        assertKnownArgs(op, args);
        const answer = OPERATIONS[op]!(services, args);
        return (answer instanceof Promise ? await answer : answer) as T;
      } catch (error) {
        const classified = classifyError(error);
        throw new ServiceCallError(classified.code, classified.message);
      }
    },
    close: async () => {
      db.close();
    },
  };
}

export interface RemoteServiceOptions {
  timeoutMs?: number;
  client?: string;
  clientVersion?: string;
  protocol?: number;
  /** How errors name the far side, e.g. `ssh:server`. */
  remoteLabel?: string;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** Speaks the protocol over a link. */
export function createServiceClient(link: ServiceLink, options: RemoteServiceOptions = {}): SubstrateService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const where = options.remoteLabel ?? "the server";
  const pending = new Map<number | string, Pending>();
  let nextId = 1;
  let hello: Promise<HelloResult> | null = null;
  let ended: string | null = null;
  let endedCode: "peer_noise" | "protocol_mismatch" | "connection_lost" = "connection_lost";
  let sawFrame = false;
  let closed = false;

  const failAll = (error: Error): void => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  };

  const settled = (id: number | string, error: Error | null, value?: unknown): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve(value);
  };

  link.onFrame((line) => {
    sawFrame = true;
    if (line.length > MAX_LINE_BYTES) {
      endedCode = "peer_noise";
      ended = `${where} sent a ${line.length}-byte line, above the ${MAX_LINE_BYTES}-byte limit`;
      failAll(new ServiceCallError(endedCode, ended));
      void link.close();
      return;
    }
    const response = decodeResponse(line);
    if ("code" in response) {
      // A line that is not a frame means the far end is not this service at all: a
      // login banner, a shell startup message, a proxy. Quote what it actually said
      // (sanitised) instead of guessing an installation problem.
      endedCode = "peer_noise";
      ended =
        `${where} answered with something other than the service protocol: ` +
        `${sanitizeDiagnostic(line).slice(0, 120) || "(an unreadable line)"}. ` +
        "Nothing before the handshake is a frame; check for a login banner or a proxy on the far side.";
      failAll(new ServiceCallError(endedCode, ended));
      return;
    }
    if (response.id === null) {
      // A frame the server could not attribute (an oversize request, a malformed
      // one) belongs to the oldest call in flight: settle it instead of leaving
      // the caller to time out with no reason.
      const first = pending.keys().next();
      if (!first.done) {
        const refused = response.ok ? null : response.error;
        const error = new ServiceCallError(
          (refused?.code as never) ?? "bad_request",
          refused?.message ?? "the service refused a frame",
        );
        settled(first.value, error);
      }
      return;
    }
    if (response.ok) {
      settled(response.id, null, response.result);
    } else {
      const error = new ServiceCallError(
        (response.error?.code as never) ?? "internal",
        response.error?.message ?? "the service failed without a message",
      );
      settled(response.id, error);
    }
  });

  link.onExit((code, signal, reason, kind) => {
    closed = true;
    // The server's own stderr is not reproduced here: it is untrusted text from
    // the far side, and a caller logging it as an error line would make it look
    // like our own diagnostic. `link.diagnostics()` is the place to read it.
    if (ended !== null) {
      failAll(new ServiceCallError(endedCode, ended));
      return;
    }
    if (kind === "spawn_failed") {
      failAll(new ServiceCallError("spawn_failed", `${where}: ${reason ?? "the connection program could not be started"}`));
      return;
    }
    if (kind === "stdin_broken") {
      failAll(
        new ServiceCallError(
          "connection_lost",
          `${where}: the pipe to the service closed mid-session (${reason ?? "a write failed"}); calls already sent may or may not have run`,
        ),
      );
      return;
    }
    // Nothing was read and the far side printed usage: that is an sb without the
    // verb, not a dropped connection.
    if (!sawFrame && /usage|unknown (command|verb)|serve/i.test(link.diagnostics())) {
      failAll(
        new ServiceCallError(
          "not_installed",
          `${where} has no \`sb serve --stdio\`: its sb printed usage and exited ${code ?? "?"} ` +
            "(the service ships in a release after 0.2.4)",
        ),
      );
      return;
    }
    failAll(
      new ServiceCallError(
        "connection_lost",
        `${where}: the service connection ended (exit ${code ?? "none"}${signal ? `, ${signal}` : ""})`,
      ),
    );
  });

  const send = <T>(request: ServiceRequestLike): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (closed) {
        reject(new ServiceCallError(endedCode, ended ?? "the service connection is closed"));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(request.id);
        reject(
          new ServiceCallError(
            "timeout",
            `${where} did not answer "${request.op}" within ${timeoutMs} ms; the call is not cancelled and may still ` +
              "run there, and a retry may therefore run it twice (the protocol carries no idempotency key yet)",
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(request.id, { resolve: resolve as (value: unknown) => void, reject, timer });
      link.write(encodeRequest(request));
    });

  const handshake = async (): Promise<HelloResult> => {
    const id = nextId++;
    let hello: HelloResult;
    try {
      hello = await send<HelloResult>({
        id,
        op: "hello",
        args: { protocol: options.protocol ?? PROTOCOL_VERSION, client: options.client ?? "substrate-client", version: options.clientVersion ?? "unknown" },
      });
    } catch (error) {
      // The server refuses a protocol it does not speak with `unsupported`: that is
      // a version skew between two working sides, not a broken peer.
      if (error instanceof ServiceCallError && error.code === "unsupported") {
        throw new ServiceCallError("protocol_mismatch", `${where}: ${error.message}`);
      }
      throw error;
    }
    if (typeof hello?.protocol !== "number") {
      throw new ServiceCallError("protocol_mismatch", `${where}: the handshake did not answer with a protocol version`);
    }
    return hello;
  };

  return {
    ready: () => {
      hello ??= handshake();
      return hello;
    },
    call: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      await (hello ??= handshake());
      return send<T>({ id: nextId++, op, args });
    },
    close: async () => {
      closed = true;
      failAll(new ServiceCallError("connection_lost", "the client closed the connection"));
      await link.close();
    },
  };
}

/** A link over a child process's pipes. */
export function spawnLink(argv: string[], env: NodeJS.ProcessEnv = process.env): ServiceLink {
  const child: ChildProcessWithoutNullStreams = spawn(argv[0]!, argv.slice(1), {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let frames: ((line: string) => void) | null = null;
  let exits:
    | ((code: number | null, signal: NodeJS.Signals | null, reason?: string, kind?: LinkExitKind) => void)
    | null = null;
  let queued: string[] = [];
  let stderrTail = "";

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (frames) frames(line);
    else queued.push(line);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-8192);
  });
  child.on("error", (error) => {
    // A program that cannot be started is not a connection that closed: the
    // reason travels with the exit, or the caller sees "it ended (exit none)".
    const reason = `cannot run ${argv[0]}: ${error.message}`;
    stderrTail = (stderrTail + "\n" + reason).trim();
    exits?.(null, null, reason, "spawn_failed");
  });
  // A child that answers the handshake and then closes fd 0 leaves a pipe that
  // reports EPIPE on the next write. Without this listener that error is
  // unhandled, and the host process (a Pi session, a commit hook, a specialists
  // run) dies with exit 1.
  child.stdin.on("error", (error) => {
    const reason = error.message;
    stderrTail = (stderrTail + "\nstdin: " + reason).trim();
    exits?.(null, null, reason, "stdin_broken");
  });
  child.on("close", (code, signal) => {
    exits?.(code, signal, undefined, "exit");
  });

  return {
    write: (frame) => {
      if (child.stdin.destroyed || child.stdin.writableEnded) {
        exits?.(null, null, "the pipe to the service is already closed", "stdin_broken");
        return;
      }
      try {
        child.stdin.write(frame + "\n");
      } catch (error) {
        // A synchronous EPIPE is the same condition as the async one above.
        exits?.(null, null, error instanceof Error ? error.message : String(error), "stdin_broken");
      }
    },
    onFrame: (handler) => {
      frames = handler;
      const early = queued;
      queued = [];
      for (const line of early) handler(line);
    },
    onExit: (handler) => {
      exits = handler;
    },
    diagnostics: () => sanitizeDiagnostic(stderrTail),
    close: async () => {
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        // Resolve on the child's exit, not on the signal being sent: a child that
        // ignores SIGTERM would otherwise outlive the close and keep the host alive,
        // and a wedged service is exactly what close() is for.
        child.once("exit", finish);
        child.stdin.end();
        const term = setTimeout(() => child.kill("SIGTERM"), 150);
        const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
        const giveUp = setTimeout(finish, 3000);
        term.unref?.();
        kill.unref?.();
        giveUp.unref?.();
      });
    },
  };
}

export interface OpenSshServiceOptions {
  host: string;
  /** Absolute path of `sb` on the server; a bare name is not assumed. */
  sbPath: string;
  root?: string | null;
  env?: NodeJS.ProcessEnv;
  forwardedEnv?: Record<string, string | undefined>;
  timeoutMs?: number;
  client?: string;
  clientVersion?: string;
}

/** Builds the ssh command for a service session. Exported for the argv test. */
export function sshServiceArgv(options: Pick<OpenSshServiceOptions, "host" | "sbPath" | "root" | "forwardedEnv">): string[] {
  const forwarded = options.forwardedEnv ?? {};
  const assignments = Object.entries(forwarded)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      if (!ENV_KEY.test(key)) {
        throw new ServiceCallError("bad_request", `"${key}" is not an environment variable name`);
      }
      if (!FORWARDED_ENV_KEYS.has(key)) {
        throw new ServiceCallError(
          "bad_request",
          `"${key}" is not forwarded to a service session (allowed: ${[...FORWARDED_ENV_KEYS].join(", ")})`,
        );
      }
      return `${key}=${shellQuote(String(value))}`;
    });
  const parts: string[] = [];
  if (options.root) parts.push(`cd ${shellQuote(options.root)}`);
  parts.push([...assignments, shellQuote(options.sbPath), "serve", "--stdio"].join(" "));
  const command = parts.join(" && ");
  // `sshArgv` returns the ssh OPTIONS and the host, not the program: the program
  // belongs to the caller (and spawnLink needs it, or it tries to exec "-T").
  return ["ssh", ...sshArgv(options.host, command)];
}

/** Opens a service session on another machine over ssh. */
export function openSshService(options: OpenSshServiceOptions): { service: SubstrateService; link: ServiceLink } {
  const argv = sshServiceArgv(options);
  const link = spawnLink(argv, options.env ?? process.env);
  return {
    service: createServiceClient(link, {
      timeoutMs: options.timeoutMs,
      client: options.client,
      clientVersion: options.clientVersion,
      remoteLabel: `ssh:${options.host}`,
    }),
    link,
  };
}

function safeRepositoryKey(): string | null {
  try {
    return discoverRepository().identity?.repositoryKey ?? null;
  } catch {
    return null;
  }
}

export type ServiceEndpoint =
  | { kind: "local"; dbPath: string }
  | { kind: "remote"; remote: string; host: string; spec: RemoteSpec; config: RemoteConfig; configPath: string };

/**
 * Which store this process should use.
 *
 * Reads both settings that exist: `SUBSTRATE_DB` (an explicit local file) and
 * the remote configuration (`SUBSTRATE_REMOTE` or the file written by
 * `sb remote setup`). Checking only the environment variable silently gave a
 * machine configured for a remote a stale local store, so the file is consulted
 * and a malformed one throws instead of falling back.
 */
export function localOrRemote(env: NodeJS.ProcessEnv = process.env): ServiceEndpoint {
  const explicit = env["SUBSTRATE_DB"] ?? env["SUBSTRATE_LOCAL_DB"];
  if (explicit !== undefined && explicit !== "") return { kind: "local", dbPath: explicit };
  const selection: RemoteSelection | null = selectRemote(env);
  if (selection === null) {
    return { kind: "local", dbPath: join(homedir(), ".xtrm", "state.db") };
  }
  const spec = selection.spec ?? parseRemoteSpec(selection.config.remote);
  if (spec === null) {
    throw new RemoteError("config", `${selection.configPath} records a remote that is not usable as ssh:<host>`);
  }
  return {
    kind: "remote",
    remote: `ssh:${spec.host}`,
    host: spec.host,
    spec,
    config: selection.config,
    configPath: selection.configPath,
  };
}

/**
 * A service for whichever store this process is configured for.
 *
 * Fails closed: a machine configured for a remote whose `sb` path is unknown
 * gets an error naming the setup command, not a local store it did not ask for.
 */
export function openService(
  opts: { env?: NodeJS.ProcessEnv; version?: string; forwardedEnv?: Record<string, string | undefined> } = {},
): { service: SubstrateService; endpoint: ServiceEndpoint } {
  const env = opts.env ?? process.env;
  const endpoint = localOrRemote(env);
  if (endpoint.kind === "local") {
    return { service: createLocalService(endpoint.dbPath, opts.version ?? "unknown"), endpoint };
  }
  const sbPath = endpoint.config.remoteSb;
  if (sbPath === null || !sbPath.startsWith("/")) {
    throw new RemoteError(
      "config",
      `no absolute server sb path is recorded for ${endpoint.remote}; run \`sb remote setup ${endpoint.remote}\` on this machine first`,
    );
  }
  const forwarded = opts.forwardedEnv ?? {
    SUBSTRATE_HOLDER: env["SUBSTRATE_HOLDER"],
    SUBSTRATE_ISSUE_REF: env["SUBSTRATE_ISSUE_REF"],
    SUBSTRATE_ISSUE: env["SUBSTRATE_ISSUE"],
    SUBSTRATE_ACTIVATION_ID: env["SUBSTRATE_ACTIVATION_ID"],
    SUBSTRATE_SPECIALIST: env["SUBSTRATE_SPECIALIST"],
    XTRM_SESSION_ID: env["XTRM_SESSION_ID"],
    XTRM_SESSION_NAME: env["XTRM_SESSION_NAME"],
  };
  // The checkout for the repository this process is in, if setup verified one: the
  // server's `sb` has to run from a directory that resolves to a project.
  const repositoryKey = safeRepositoryKey();
  const root =
    repositoryKey === null ? null : (endpoint.config.checkouts[mappingKey(endpoint.host, repositoryKey)]?.root ?? null);
  const { service } = openSshService({
    host: endpoint.host,
    sbPath,
    root,
    env,
    forwardedEnv: forwarded,
    clientVersion: opts.version,
  });
  return { service, endpoint };
}
