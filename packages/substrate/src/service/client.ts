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
import { selectRemote, type RemoteConfig, type RemoteSelection } from "../remote/config.ts";
import { CAPABILITIES, OPERATIONS, classifyError, createServices } from "./ops.ts";
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

/** The transport a client needs: write a frame, hear frames, hear the end. */
export interface ServiceLink {
  write(frame: string): void;
  onFrame(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null, reason?: string) => void): void;
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
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** Speaks the protocol over a link. */
export function createServiceClient(link: ServiceLink, options: RemoteServiceOptions = {}): SubstrateService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const pending = new Map<number | string, Pending>();
  let nextId = 1;
  let hello: Promise<HelloResult> | null = null;
  let ended: string | null = null;
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
    if (line.length > MAX_LINE_BYTES) {
      ended = `the service sent a ${line.length}-byte line, above the ${MAX_LINE_BYTES}-byte limit`;
      failAll(new ServiceCallError("unsupported", ended));
      void link.close();
      return;
    }
    const response = decodeResponse(line);
    if ("code" in response) {
      // A first line that is not a frame means the far end is not this service:
      // an older sb, a shell banner, a login prompt. Name the version that ships
      // the service, so the reader knows what to install rather than what to debug.
      ended =
        "the server did not answer with the service protocol " +
        "(is a Substrate with `sb serve --stdio` installed there, 0.2.4 or newer?)";
      failAll(new ServiceCallError("unsupported", ended));
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

  link.onExit((code, signal, reason) => {
    closed = true;
    // The server's own stderr is not reproduced here: it is untrusted text from
    // the far side, and a caller logging it as an error line would make it look
    // like our own diagnostic. `link.diagnostics()` is the place to read it.
    const message =
      ended ?? reason ?? `the service connection ended (exit ${code ?? "none"}${signal ? `, ${signal}` : ""})`;
    failAll(new ServiceCallError("unsupported", message));
  });

  const send = <T>(request: ServiceRequestLike): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (closed) {
        reject(new ServiceCallError("unsupported", ended ?? "the service connection is closed"));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(request.id);
        reject(
          new ServiceCallError(
            "timeout",
            `the service did not answer "${request.op}" within ${timeoutMs} ms; it may still be running on the server`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(request.id, { resolve: resolve as (value: unknown) => void, reject, timer });
      link.write(encodeRequest(request));
    });

  const handshake = async (): Promise<HelloResult> => {
    const id = nextId++;
    const hello = await send<HelloResult>({
      id,
      op: "hello",
      args: { protocol: options.protocol ?? PROTOCOL_VERSION, client: options.client ?? "substrate-client", version: options.clientVersion ?? "unknown" },
    });
    if (typeof hello?.protocol !== "number") {
      throw new ServiceCallError("unsupported", "the handshake did not answer with a protocol version");
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
      failAll(new ServiceCallError("unsupported", "the client closed the connection"));
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
  let exits: ((code: number | null, signal: NodeJS.Signals | null, reason?: string) => void) | null = null;
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
    exits?.(null, null, reason);
  });
  child.on("close", (code, signal) => {
    exits?.(code, signal);
  });

  return {
    write: (frame) => {
      if (child.stdin.destroyed) return;
      child.stdin.write(frame + "\n");
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
        child.once("close", () => resolve());
        child.stdin.end();
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve();
        }, 300);
        timer.unref?.();
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
  const link = spawnLink(sshServiceArgv(options), options.env ?? process.env);
  return {
    service: createServiceClient(link, {
      timeoutMs: options.timeoutMs,
      client: options.client,
      clientVersion: options.clientVersion,
    }),
    link,
  };
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
  const { service } = openSshService({
    host: endpoint.host,
    sbPath,
    root: endpoint.config.checkouts[`${endpoint.host} ${env["SUBSTRATE_SERVICE_REPO"] ?? ""}`]?.root ?? null,
    env,
    forwardedEnv: forwarded,
    clientVersion: opts.version,
  });
  return { service, endpoint };
}
