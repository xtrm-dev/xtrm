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
import { join } from "node:path";
import { homedir } from "node:os";
import { openSubstrate } from "../store/sqlite.ts";
import { migrate } from "../store/migrations/runner.ts";
import { parseRemoteSpec, shellQuote, type RemoteSpec } from "../remote/spec.ts";
import { sshArgv } from "../remote/ssh.ts";
import { RemoteError } from "../remote/spec.ts";
import { mappingKey, selectRemote, type RemoteConfig, type RemoteSelection } from "../remote/config.ts";
import { discoverRepository } from "../domain/repository-discovery.ts";
import { ARGS, CAPABILITIES, OPERATIONS, assertKnownArgs, classifyError, createServices } from "./ops.ts";
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
export type LinkExitKind = "exit" | "spawn_failed" | "stdin_broken" | "line_too_long";

/** The transport a client needs: write a frame, hear frames, hear the end. */
export interface ServiceLink {
  write(frame: string): void;
  onFrame(handler: (line: string) => void): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null, reason?: string, kind?: LinkExitKind) => void): void;
  /** Diagnostics from the far side, for a caller that wants to log them. */
  diagnostics(): string;
  /** The child's pid when this link owns a process, so a test can prove it exited. */
  pid: number | null;
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
// Identity is not here. The server strips its own ambient identity, and a
// forwarded variable would be read by the server process rather than declared by
// the caller: the client resolves identity from its own environment and sends it
// in the operation arguments, where the operation can validate it.
const FORWARDED_ENV_KEYS = new Set(["LANG", "TZ"]);

/** Identity fields an operation accepts, and where in its arguments they live. */
const IDENTITY_ARGS: Record<string, "args" | "input"> = {
  "journal.appendEntry": "input",
  "journal.checkpoint": "input",
  "journal.compactionCheckpoint": "input",
  "journal.collectMechanical": "input",
  "store.addJournal": "args",
  "issue.claimIssue": "args",
  "issue.claimReady": "args",
  "issue.renewClaim": "args",
  "issue.releaseClaim": "args",
};

export interface ClientIdentity {
  participantId?: string | null;
  activationId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
}

/** The caller's identity, from the same variables the CLI reads. */
export function resolveIdentity(env: NodeJS.ProcessEnv = process.env): ClientIdentity {
  const pick = (key: string): string | undefined => {
    const value = env[key];
    return value === undefined || value === "" ? undefined : value;
  };
  const identity: ClientIdentity = {
    participantId: pick("SUBSTRATE_HOLDER"),
    activationId: pick("SUBSTRATE_ACTIVATION_ID"),
    sessionId: pick("XTRM_SESSION_ID"),
  };
  return identity;
}

/**
 * Adds the caller's identity to an operation that records it, without overriding
 * a value the caller set explicitly.
 */
export function applyIdentity(op: string, args: Record<string, unknown>, identity: ClientIdentity): Record<string, unknown> {
  const target = IDENTITY_ARGS[op];
  if (target === undefined) return args;
  // An operation accepts an identity field only when its argument table names it.
  // Merging `participantId` into issue.claimIssue, whose identity is `holder`,
  // made every harness session fail with "argument participantId is not part of
  // issue.claimIssue" — locally and remotely alike.
  const accepted = target === "args" ? new Set(ARGS[op] ?? []) : null;
  const fields: Array<[string, string | null | undefined]> = (
    [
      ["participantId", identity.participantId],
      ["activationId", identity.activationId],
      ["sessionId", identity.sessionId],
    ] as Array<[string, string | null | undefined]>
  ).filter(([key]) => accepted === null || accepted.has(key));
  if (target === "args") {
    const merged = { ...args };
    for (const [key, value] of fields) if (value != null && merged[key] === undefined) merged[key] = value;
    return merged;
  }
  const input = args["input"];
  const base = input !== null && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  for (const [key, value] of fields) if (value != null && base[key] === undefined) base[key] = value;
  return { ...args, input: base };
}
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * What a closed transport means, decided from what was read and what the far side
 * printed. Pure, because this is the rule operators act on: "no sb serve --stdio
 * there" sends them to install a release; "connection lost" sends them to ssh.
 */
export function classifyTransportEnd(
  diagnostics: string,
  sawFrame: boolean,
): "not_installed" | "connection_lost" {
  if (sawFrame) return "connection_lost";
  // sb's own usage text only. A bare /serve/ matches the host name "server", which
  // reported every DNS failure as a missing verb.
  return /(?:usage: sb\b|^sb: unknown (command|verb)\b)/m.test(diagnostics) ? "not_installed" : "connection_lost";
}

function sanitizeDiagnostic(text: string): string {
  return text.replace(/[^\x20-\x7e\n]/g, "").slice(0, 400);
}

/** Runs the operation table in this process. */
export function createLocalService(
  dbPath: string,
  version: string,
  identity: ClientIdentity = resolveIdentity(),
): SubstrateService {
  const db = openSubstrate(dbPath);
  migrate(db);
  const services = createServices(db);
  return {
    ready: async () => ({ protocol: PROTOCOL_VERSION, substrate: version, capabilities: CAPABILITIES }),
    call: async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (!Object.hasOwn(OPERATIONS, op)) {
        throw new ServiceCallError("unknown_op", `unknown operation "${op}"`);
      }
      try {
        const withIdentity = applyIdentity(op, args, identity);
        assertKnownArgs(op, withIdentity);
        const answer = OPERATIONS[op]!(services, withIdentity);
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
  /** The caller's identity; resolved from `process.env` when absent. */
  identity?: ClientIdentity;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** Speaks the protocol over a link. */
export function createServiceClient(link: ServiceLink, options: RemoteServiceOptions = {}): SubstrateService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const identity = options.identity ?? resolveIdentity();
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
    // Nothing was read and the far side printed usage: that is an sb without the
    // verb, not a dropped connection. Match sb's own usage text only — the old
    // pattern included the bare word "serve", which matches the host name "server",
    // so a DNS failure was reported as "no sb serve --stdio installed there".
    const missingVerb = (): boolean => classifyTransportEnd(link.diagnostics(), sawFrame) === "not_installed";
    const farSideTail = (): string => {
      const tail = link
        .diagnostics()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .at(-1);
      return tail === undefined ? "" : ` — the far side said: ${tail.slice(0, 300)}`;
    };
    const notInstalled = (): void => {
      failAll(
        new ServiceCallError(
          "not_installed",
          `${where} has no \`sb serve --stdio\`: its sb printed usage and exited ${code ?? "?"} ` +
            "(the service ships in 0.2.5 and later)",
        ),
      );
    };
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
    if (kind === "line_too_long") {
      failAll(
        new ServiceCallError(
          "connection_lost",
          `${where}: the service sent a line longer than ${MAX_LINE_BYTES} bytes and it was dropped (${reason ?? "no detail"}); the connection cannot be trusted after that`,
        ),
      );
      return;
    }
    if (kind === "stdin_broken") {
      // A program that exits without reading its stdin breaks the pipe before the
      // usage text is classified, which hid both "no such verb" and ssh's own
      // refusal behind "the pipe closed mid-session".
      if (missingVerb()) {
        notInstalled();
        return;
      }
      failAll(
        new ServiceCallError(
          "connection_lost",
          `${where}: the pipe to the service closed mid-session (${reason ?? "a write failed"}); calls already sent may or may not have run${farSideTail()}`,
        ),
      );
      return;
    }
    if (missingVerb()) {
      notInstalled();
      return;
    }
    failAll(
      new ServiceCallError(
        "connection_lost",
        `${where}: the service connection ended (exit ${code ?? "none"}${signal ? `, ${signal}` : ""})${farSideTail()}`,
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
      return send<T>({ id: nextId++, op, args: applyIdentity(op, args, identity) });
    },
    close: async () => {
      closed = true;
      failAll(new ServiceCallError("connection_lost", "the client closed the connection"));
      await link.close();
    },
  };
}

const NEWLINE = 0x0a;

/**
 * Splits a byte stream into lines with a cap.
 *
 * `readline` buffers a whole line before emitting it: a peer that never sends a
 * newline made the client grow with the server's output (150 MB of output took
 * the client to 309 MB). This drops an over-long line to its next newline and
 * reports the size instead.
 */
export class FrameLines {
  private parts: Buffer[] = [];
  private bytes = 0;
  private dropping = false;
  private dropped = 0;
  private reported = false;
  private readonly onLine: (line: string) => void;
  private readonly onOverflow: (bytes: number) => void;

  constructor(onLine: (line: string) => void, onOverflow: (bytes: number) => void) {
    this.onLine = onLine;
    this.onOverflow = onOverflow;
  }

  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.dropping) {
        const end = chunk.indexOf(NEWLINE, offset);
        if (end < 0) {
          this.dropped += chunk.length - offset;
          return;
        }
        this.dropped += end - offset;
        this.dropped = 0;
        this.dropping = false;
        this.reported = false;
        offset = end + 1;
        continue;
      }
      const end = chunk.indexOf(NEWLINE, offset);
      const piece = end < 0 ? chunk.subarray(offset) : chunk.subarray(offset, end);
      this.parts.push(piece);
      this.bytes += piece.length;
      if (this.bytes > MAX_LINE_BYTES) {
        const bytes = this.bytes;
        this.parts = [];
        this.bytes = 0;
        // Report the moment the cap is crossed: a line that never ends must not
        // wait for a newline that will never arrive.
        const report = !this.reported;
        this.reported = true;
        if (end < 0) {
          this.dropping = true;
          this.dropped = 0;
        } else {
          offset = end + 1;
        }
        if (report) this.onOverflow(bytes);
        continue;
      }
      if (end < 0) return;
      const line = Buffer.concat(this.parts, this.bytes).toString("utf8");
      this.parts = [];
      this.bytes = 0;
      offset = end + 1;
      this.onLine(line);
    }
  }

  /** A final line without a newline is still delivered: the frame reader decides. */
  flush(): void {
    if (this.bytes === 0) return;
    const line = Buffer.concat(this.parts, this.bytes).toString("utf8");
    this.parts = [];
    this.bytes = 0;
    this.onLine(line);
  }
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
  // One exit report per link, and a typed failure wins over the plain close that
  // follows it: the reason is what the caller acts on.
  type Exit = { code: number | null; signal: NodeJS.Signals | null; reason?: string; kind: LinkExitKind };
  let stashed: Exit | null = null;
  let delivered = false;
  const report = (exit: Exit): void => {
    // One report per link, first one wins: a typed failure outranks the plain
    // close that follows it, and an end that happens before anyone listens is
    // kept until a listener arrives rather than lost.
    if (delivered || stashed !== null) return;
    stashed = exit;
    if (exits !== null) {
      delivered = true;
      exits(exit.code, exit.signal, exit.reason, exit.kind);
    }
  };

  const lines = new FrameLines(
    (line) => {
      if (frames) frames(line);
      else queued.push(line);
    },
    (bytes) => {
      report({
        code: null,
        signal: null,
        reason: `a line of ${bytes} bytes exceeds the ${MAX_LINE_BYTES}-byte cap`,
        kind: "line_too_long",
      });
      // The far side keeps writing; the connection is unusable, so end it.
      child.kill("SIGKILL");
    },
  );
  child.stdout.on("data", (chunk: Buffer) => lines.push(chunk));
  child.stdout.on("end", () => lines.flush());
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-8192);
  });
  child.on("error", (error) => {
    // A program that cannot be started is not a connection that closed: the
    // reason travels with the exit, or the caller sees "it ended (exit none)".
    const reason = `cannot run ${argv[0]}: ${error.message}`;
    stderrTail = (stderrTail + "\n" + reason).trim();
    report({ code: null, signal: null, reason, kind: "spawn_failed" });
  });
  // A child that answers the handshake and then closes fd 0 leaves a pipe that
  // reports EPIPE on the next write. Without this listener that error is
  // unhandled, and the host process (a Pi session, a commit hook, a specialists
  // run) dies with exit 1.
  child.stdin.on("error", (error) => {
    const reason = error.message;
    stderrTail = (stderrTail + "\nstdin: " + reason).trim();
    report({ code: null, signal: null, reason, kind: "stdin_broken" });
  });
  child.on("close", (code, signal) => {
    report({ code, signal, kind: "exit" });
  });

  return {
    write: (frame) => {
      if (child.stdin.destroyed || child.stdin.writableEnded) {
        report({ code: null, signal: null, reason: "the pipe to the service is already closed", kind: "stdin_broken" });
        return;
      }
      try {
        child.stdin.write(frame + "\n");
      } catch (error) {
        // A synchronous EPIPE is the same condition as the async one above.
        report({
          code: null,
          signal: null,
          reason: error instanceof Error ? error.message : String(error),
          kind: "stdin_broken",
        });
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
      if (stashed !== null && !delivered) {
        delivered = true;
        handler(stashed.code, stashed.signal, stashed.reason, stashed.kind);
      }
    },
    diagnostics: () => sanitizeDiagnostic(stderrTail),
    pid: child.pid ?? null,
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
): { service: SubstrateService; endpoint: ServiceEndpoint; link?: ServiceLink } {
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
  // Only variables the far side may legitimately read reach it. Identity is sent
  // in the operation arguments, so forwarding it would both duplicate it and be
  // refused by sshServiceArgv's allowlist before ssh ever ran.
  const forwarded = opts.forwardedEnv ?? {
    LANG: env["LANG"],
    TZ: env["TZ"],
  };
  // The checkout for the repository this process is in, if setup verified one: the
  // server's `sb` has to run from a directory that resolves to a project.
  const repositoryKey = safeRepositoryKey();
  const root =
    repositoryKey === null ? null : (endpoint.config.checkouts[mappingKey(endpoint.host, repositoryKey)]?.root ?? null);
  const { service, link } = openSshService({
    host: endpoint.host,
    sbPath,
    root,
    env,
    forwardedEnv: forwarded,
    clientVersion: opts.version,
  });
  // The link travels with the service: without it a caller cannot read ssh's own
  // stderr (Permission denied, unknown host) when the handshake never happens.
  return { service, endpoint, link };
}
