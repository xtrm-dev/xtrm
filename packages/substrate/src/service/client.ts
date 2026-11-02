// The client half: the same `SubstrateService` interface, either in-process
// (unset `substrate.remote`) or over one ssh connection per client process.
//
// Consumers keep one call site: they hold a `SubstrateService`, and whether it
// opens the store locally or asks a server depends on configuration, not on the
// consumer (ADR-008: every setting works both ways).

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import type { SubstrateDatabase } from "../store/database.ts";
import { openSubstrate } from "../store/sqlite.ts";
import { migrate } from "../store/migrations/runner.ts";
import { CAPABILITIES, OPERATIONS, classifyError, createServices } from "./ops.ts";
import {
  PROTOCOL_VERSION,
  ServiceCallError,
  decodeResponse,
  encodeRequest,
  type HelloResult,
  type ServiceErrorCode,
} from "./protocol.ts";
import { sshArgv } from "../remote/ssh.ts";
import { shellQuote } from "../remote/spec.ts";

export interface SubstrateService {
  /** Handshake, performed once; callers use it to name a skew early. */
  ready(): Promise<HelloResult>;
  call<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
  close(): void;
}

/** A duplex byte channel to a server: stdin frames out, stdout lines in. */
export interface ServiceLink {
  write(frame: string): void;
  onFrame(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, stderr: string) => void): void;
  close(): void;
}

export function createLocalService(dbPath: string, version: string): SubstrateService {
  const db = openSubstrate(dbPath);
  migrate(db);
  const services = createServices(db);
  const hello: HelloResult = { protocol: PROTOCOL_VERSION, substrate: version, dbPath, capabilities: CAPABILITIES };
  return {
    ready: async () => hello,
    call: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      const handler = OPERATIONS[op];
      if (!handler) throw new ServiceCallError("unknown_op", `unknown operation "${op}" (this build has ${CAPABILITIES.length})`);
      try {
        return handler(services, args) as T;
      } catch (error) {
        const { code, message } = classifyError(error);
        throw new ServiceCallError(code, message);
      }
    },
    close: () => db.close(),
  };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RemoteServiceOptions {
  /** Per-call ceiling; a stuck server must not hold a hook or a tool call open. */
  timeoutMs?: number;
  client?: string;
  clientVersion?: string;
  protocol?: number;
}

export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export function createServiceClient(link: ServiceLink, options: RemoteServiceOptions = {}): SubstrateService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const protocol = options.protocol ?? PROTOCOL_VERSION;
  const pending = new Map<number | string, Pending>();
  let nextId = 1;
  let exit: { code: number | null; stderr: string } | null = null;
  let closed = false;
  let helloPromise: Promise<HelloResult> | null = null;

  const failAll = (error: Error): void => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  link.onExit((code, stderr) => {
    exit = { code, stderr };
    const tail = stderr.trim().split("\n").slice(-3).join(" ");
    failAll(new ServiceCallError("internal", `the service connection ended (exit ${code ?? "null"})${tail ? ": " + tail : ""}`));
  });

  link.onFrame((line) => {
    if (line.trim() === "") return;
    const response = decodeResponse(line);
    if ("code" in response) {
      // Not our protocol at all: name the likely cause instead of a parse error.
      failAll(
        new ServiceCallError(
          "unsupported",
          "the server did not answer with the service protocol (is a Substrate with `sb serve --stdio` installed there, 0.2.4 or newer?)",
        ),
      );
      return;
    }
    const entry = response.id === null ? undefined : pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id as number | string);
    clearTimeout(entry.timer);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new ServiceCallError(response.error.code, response.error.message));
  });

  const send = <T>(id: number | string, op: string, args: Record<string, unknown>, timeout = timeoutMs): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (closed) {
        reject(new ServiceCallError("internal", "the service connection is closed"));
        return;
      }
      if (exit !== null) {
        reject(new ServiceCallError("unsupported", `the service connection is not running (exit ${exit.code ?? "null"})`));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new ServiceCallError("timeout", `${op} did not answer within ${timeout} ms`));
      }, timeout);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        link.write(encodeRequest({ id, op, args }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  const service: SubstrateService = {
    ready: () => {
      helloPromise ??= send<HelloResult>(0, "hello", {
        protocol,
        client: options.client ?? "substrate-client",
        clientVersion: options.clientVersion,
      });
      return helloPromise;
    },
    call: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      await service.ready();
      return send<T>(nextId++, op, args);
    },
    close: () => {
      if (closed) return;
      closed = true;
      failAll(new ServiceCallError("internal", "the service connection was closed by the client"));
      link.close();
    },
  };
  return service;
}

/** Spawn `argv` and expose its pipes as a `ServiceLink`; stderr is kept for diagnosis. */
export function spawnLink(argv: string[], env: NodeJS.ProcessEnv = process.env): ServiceLink {
  let child: ChildProcess;
  try {
    child = spawn(argv[0]!, argv.slice(1), { env, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    throw new ServiceCallError("unsupported", `cannot run ${argv[0]}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let stderr = "";
  let frameHandler: ((line: string) => void) | null = null;
  let exitHandler: ((code: number | null, stderr: string) => void) | null = null;
  const queue: string[] = [];

  const stdout = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  stdout.on("line", (line) => {
    if (frameHandler) frameHandler(line);
    else queue.push(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 8192) stderr = stderr.slice(-8192);
  });
  child.on("close", (code) => {
    const handler = exitHandler;
    if (handler) handler(code, stderr);
  });
  // A spawn that never started (no ssh binary, no permission) arrives here, not
  // on "close": without this the client keeps a promise nobody can settle.
  child.on("error", (error: Error) => {
    stderr += `cannot run ${argv[0]}: ${error.message}`;
    const handler = exitHandler;
    if (handler) handler(null, stderr);
  });

  return {
    write: (frame) => {
      child.stdin?.write(frame);
    },
    onFrame: (handler) => {
      frameHandler = handler;
      for (const line of queue.splice(0)) handler(line);
    },
    onExit: (handler) => {
      exitHandler = handler;
    },
    close: () => {
      // End the channel (the server exits at EOF), and take the child down if it
      // is still there shortly after: a client that closes must not leave a
      // process holding the store.
      child.stdin?.end();
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      }, 300);
    },
  };
}

export interface SshServiceOptions extends RemoteServiceOptions {
  host: string;
  /** Absolute path of the server's sb. */
  sbPath: string;
  /** The server checkout the store belongs to; the command runs there. */
  root?: string | null;
  env?: NodeJS.ProcessEnv;
  forwardedEnv?: Record<string, string>;
}

/** One ssh-exec connection running `sb serve --stdio` on the server. */
export function openSshService(options: SshServiceOptions): SubstrateService {
  const env = options.env ?? process.env;
  const assignments = Object.entries(options.forwardedEnv ?? {})
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const cd = options.root ? `cd ${shellQuote(options.root)} && ` : "";
  const command = `${cd}${assignments ? assignments + " " : ""}${shellQuote(options.sbPath)} serve --stdio`;
  const link = spawnLink(sshArgv(options.host, command), env);
  return createServiceClient(link, { ...options, clientVersion: options.clientVersion ?? "pc" });
}

/** Which machine's store a client should talk to; null means in-process. */
export function localOrRemote(
  env: NodeJS.ProcessEnv = process.env,
): { kind: "local"; dbPath: string } | { kind: "remote"; host: string } {
  const override = (env["SUBSTRATE_DB"] ?? "").trim();
  if (override) return { kind: "local", dbPath: override };
  const host = (env["SUBSTRATE_REMOTE"] ?? "").trim().replace(/^ssh:/, "");
  if (host) return { kind: "remote", host };
  return { kind: "local", dbPath: (env["SUBSTRATE_LOCAL_DB"] ?? "").trim() || `${homedir()}/.xtrm/state.db` };
}

export type { ServiceErrorCode };
