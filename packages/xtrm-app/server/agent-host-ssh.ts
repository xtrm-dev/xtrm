// Dev-server bridge to a remote XTRM agent host over the operator's SSH (PRD §35.5, §35.8 item 2).
//
// Connect = bootstrap + forward:
//   1. `ssh -o BatchMode=yes <target> -- <remote>` with stdin closed and a timeout, where <remote> is
//      tried in order: `"${SHELL:-/bin/sh}" -lc 'xt host ensure --json'`; on exit 127 the same with
//      `-ilc` (version managers load from ~/.zshrc / ~/.bashrc); then the operator-set remote command
//      stored with the connection. The last stdout line that parses as xtrm.agent-host-ensure.v1 wins;
//      rc-file noise before it is ignored.
//   2. A different protocol major is rejected with a message that names the fix.
//   3. `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<port> <target>` is held until disconnect; the bridge
//      reads the host API through that loopback port. A ControlMaster in the operator's ssh config is
//      reused by ssh itself.
//
// Only the operator's ssh binary and agent are used; nothing here reads or writes ~/.ssh. Every
// argument is an argv element; the only shell strings are the fixed bootstrap commands and the remote
// command the operator stored. Every route answers loopback clients only: the dev server may be
// reachable on the tailnet, and the forwarded host API must not be.
//
// Write route (XTRM-597): POST /api/v1/submit forwards one xtrm.agent-host-api.v1 submit_request to
// the host's POST /v1/submit. Same-origin JSON only (a cross-site form cannot send
// application/json without a preflight, which this bridge never answers).
// Reference route (XTRM-598): POST /api/v1/references/resolve forwards one reference_resolve_request
// to the host's POST /v1/references/resolve, under the same rules. Submit and resolve bodies may carry
// resolved references (96 KB per submit, twice: index and message), so they get a larger body limit.
// Direct mode (XTRM-600): POST /direct/pair exchanges a pairing token at an HTTPS front and
// POST /direct/forget drops the stored device (server/agent-host-direct.ts). While no SSH connection
// is up and a device is paired, the read and write routes go to the front with the device token; a
// 401 from the front turns the connection into a re-pair prompt.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import type { AgentHostConnectionState, AgentHostSettings, BootstrapAttempt, TerminalLaunch } from "../src/adapters/agent/host-connection.ts";
import { DirectConnection, PairError, REPAIR_MESSAGE } from "./agent-host-direct.ts";
import { endpointHeaders, localEndpoint, loopbackOrigin, proxyEvents, resolveRepo, type HostEndpoint } from "./agent-host-live.ts";
import { resolveSbBin } from "./substrate-cli.ts";

export const ENSURE_SCHEMA = "xtrm.agent-host-ensure.v1";
export const API_SCHEMA = "xtrm.agent-host-api.v1";
/** The xtrm.agent-host-api major this app speaks. */
export const AGENT_HOST_PROTOCOL_MAJOR = 1;
export const LOGIN_COMMAND = `"\${SHELL:-/bin/sh}" -lc 'xt host ensure --json'`;
export const INTERACTIVE_COMMAND = `"\${SHELL:-/bin/sh}" -ilc 'xt host ensure --json'`;

const BOOTSTRAP_TIMEOUT_MS = 45_000;
const FORWARD_TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 1024 * 1024;
const TARGET_RE = /^[A-Za-z0-9_.@%+:[\]-]{1,255}$/;
const TMUX_SESSION_RE = /^[A-Za-z0-9_.@%+=-]{1,128}$/;

export class ConnectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

// --- pure parts ----------------------------------------------------------------

/** `user@host`, `host`, or a ~/.ssh/config alias. Never an option, never whitespace or shell syntax. */
export function validateTarget(value: unknown): string | null {
  return typeof value === "string" && TARGET_RE.test(value) && !value.startsWith("-") ? value : null;
}

/** One line of remote shell, set by the operator for hosts where neither shell finds `xt`. */
export function validateRemoteCommand(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 && v.length <= 4096 && !/[\0\r\n]/.test(v) ? v : null;
}

export function bootstrapArgv(target: string, remote: string): string[] {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", target, "--", remote];
}

export function forwardArgv(target: string, localPort: number, remotePort: number): string[] {
  return ["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, target];
}

/** Open in terminal (PRD §35.5): `ssh -t <target> tmux attach -t <session>`. */
export function terminalArgv(target: string, tmuxSession: string): string[] | null {
  if (!validateTarget(target) || !TMUX_SESSION_RE.test(tmuxSession) || tmuxSession.startsWith("-")) return null;
  return ["ssh", "-t", target, "tmux", "attach", "-t", tmuxSession];
}

export type EnsureLine =
  | { kind: "result"; version: string; protocolMajor: number; port: number; pid: number }
  | { kind: "error"; code: string; message: string };

/** The last stdout line that is an xtrm.agent-host-ensure.v1 object; start-up file noise is ignored. */
export function parseEnsureOutput(stdout: string): EnsureLine | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    let v: Record<string, unknown>;
    try {
      v = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!v || v.schema !== ENSURE_SCHEMA) continue;
    const err = v.error as Record<string, unknown> | undefined;
    if (err && typeof err.code === "string" && typeof err.message === "string") return { kind: "error", code: err.code, message: err.message };
    const major = (v.protocol as Record<string, unknown> | undefined)?.major;
    const { version, port, pid } = v;
    if (typeof version === "string" && Number.isInteger(major) && Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536 && Number.isInteger(pid)) {
      return { kind: "result", version, protocolMajor: major as number, port: port as number, pid: pid as number };
    }
  }
  return null;
}

export interface SshRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
export type SshRunner = (argv: string[], timeoutMs: number) => Promise<SshRun>;

const lastLine = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .pop()
    ?.slice(0, 500) ?? "";

export interface BootstrapResult {
  version: string;
  protocolMajor: number;
  port: number;
  pid: number;
  via: BootstrapAttempt;
}

/**
 * PRD §35.8 item 2. The interactive shell is tried only after the login shell exits 127. The stored
 * remote command runs when the shells produce no ensure line (for example `xt` missing in both, or
 * an old `xt` without `host ensure`). An ensure error line, a timeout, or an ssh failure (255) stops.
 */
export async function bootstrap(target: string, opts: { remoteCommand?: string | null; run: SshRunner; timeoutMs?: number }): Promise<BootstrapResult> {
  const timeoutMs = opts.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS;
  const attempts: Array<[BootstrapAttempt, string]> = [
    ["login", LOGIN_COMMAND],
    ["interactive", INTERACTIVE_COMMAND],
  ];
  if (opts.remoteCommand) attempts.push(["stored", opts.remoteCommand]);

  let last: SshRun | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const [via, remote] = attempts[i]!;
    const r = await opts.run(bootstrapArgv(target, remote), timeoutMs);
    if (r.timedOut) throw new ConnectError("timeout", `ssh ${target} did not finish the ${via} bootstrap within ${Math.round(timeoutMs / 1000)} s.`);
    const line = parseEnsureOutput(r.stdout);
    if (line?.kind === "error") throw new ConnectError("ensure_failed", `xt host ensure failed on ${target}: ${line.code}: ${line.message}`);
    if (line?.kind === "result") {
      if (line.protocolMajor !== AGENT_HOST_PROTOCOL_MAJOR) {
        const fix = line.protocolMajor < AGENT_HOST_PROTOCOL_MAJOR ? `Run \`xt update\` on ${target}.` : "Update xtrm-app.";
        throw new ConnectError(
          "protocol_mismatch",
          `The agent host on ${target} (xt ${line.version}) speaks protocol v${line.protocolMajor}; this app speaks v${AGENT_HOST_PROTOCOL_MAJOR}. ${fix}`,
        );
      }
      return { version: line.version, protocolMajor: line.protocolMajor, port: line.port, pid: line.pid, via };
    }
    if (r.code === 255) throw new ConnectError("ssh_failed", `ssh ${target} failed: ${lastLine(r.stderr) || "exit 255"}`);
    last = r;
    // Login shell → interactive login shell only on "command not found"; otherwise go to the stored command.
    if (via === "login" && r.code !== 127) i++;
  }
  if (last?.code === 127) {
    throw new ConnectError(
      "xt_not_found",
      `xt was not found on ${target} by a login shell or an interactive login shell. Set a remote command for this connection, for example the absolute path: /path/to/xt host ensure --json.`,
    );
  }
  throw new ConnectError("ensure_missing", `ssh ${target} exited ${last?.code ?? "?"} without an ${ENSURE_SCHEMA} line${last?.stderr.trim() ? `: ${lastLine(last.stderr)}` : "."}`);
}

// --- processes -------------------------------------------------------------------

/**
 * Runs ssh with stdin closed, a hard timeout, and bounded output.
 *
 * The child runs in its own process group so a timeout kills everything it started: a
 * grandchild (a ProxyCommand, or a shell that does not exec its last command) would
 * otherwise keep the pipes open, and `close` would not fire until it exited (XTRM-594).
 */
export function spawnRunner(bin: string): SshRunner {
  return (argv, timeoutMs) =>
    new Promise((resolve) => {
      const child = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"], detached: true });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const finish = (result: Awaited<ReturnType<SshRunner>>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      child.stdout.on("data", (b: Buffer) => void (stdout.length < MAX_OUTPUT && (stdout += b.toString("utf8"))));
      child.stderr.on("data", (b: Buffer) => void (stderr.length < MAX_OUTPUT && (stderr += b.toString("utf8"))));
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, timeoutMs);
      child.on("error", (e) => finish({ code: 255, stdout, stderr: `${stderr}\n${e.message}`, timedOut: false }));
      // After a timeout the process has exited even if a stray holder keeps the pipes open.
      child.on("exit", (code) => {
        if (!timedOut) return;
        child.stdout.destroy();
        child.stderr.destroy();
        finish({ code, stdout, stderr, timedOut });
      });
      child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
    });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

type EndpointTarget = Pick<HostEndpoint, "origin" | "bearer">;

/** GET on the host API: loopback and forwarded ports, or the direct-mode front with its device token. */
export async function hostApi(ep: EndpointTarget, path: string, timeoutMs = 5_000): Promise<{ status: number; body: unknown }> {
  // Loopback URL, loopback Host header, no proxy headers: the host treats the request as local (§35.5).
  const res = await fetch(`${ep.origin}${path}`, { headers: endpointHeaders(ep), signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, body: await res.json() };
}

/** POST a JSON body to the host API; the host waits up to its command timeout (10 s) for the session. */
export async function hostPost(ep: EndpointTarget, path: string, body: unknown, timeoutMs = 15_000): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${ep.origin}${path}`, {
    method: "POST",
    headers: endpointHeaders(ep, { "content-type": "application/json" }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: await res.json() };
}

/** Shape check of a reference_resolve_request; the host validates the full schema and each reference. */
export function isResolveRequest(b: Record<string, unknown>): boolean {
  const refs = b.references;
  return (
    b.schema === API_SCHEMA &&
    b.kind === "reference_resolve_request" &&
    (b.sessionId === undefined || (typeof b.sessionId === "string" && SESSION_ID_RE.test(b.sessionId))) &&
    Array.isArray(refs) &&
    refs.length >= 1 &&
    refs.length <= 64 &&
    refs.every((r) => typeof r === "string" && r.length >= 1 && r.length <= 1024)
  );
}

/** Body limit of the routes that carry resolved references. */
const REFERENCE_BODY_BYTES = 1024 * 1024;
const JSON_ROUTES = new Set(["/api/v1/submit", "/api/v1/references/resolve"]);

/** Shape check of a submit_request before it leaves the bridge; the host validates the full schema. */
export function isSubmitRequest(b: Record<string, unknown>): boolean {
  const c = b.command as Record<string, unknown> | null | undefined;
  return (
    b.schema === API_SCHEMA &&
    b.kind === "submit_request" &&
    typeof b.sessionId === "string" &&
    SESSION_ID_RE.test(b.sessionId) &&
    !!c &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    typeof c.type === "string" &&
    typeof c.commandId === "string"
  );
}

async function probe(localPort: number): Promise<boolean> {
  try {
    const { status, body } = await hostApi({ origin: loopbackOrigin(localPort) }, "/v1/sessions", 2_000);
    return status === 200 && (body as { schema?: unknown })?.schema === API_SCHEMA;
  } catch {
    return false;
  }
}

export interface ConnectionOptions {
  sshBin?: string;
  run?: SshRunner;
  settingsFile?: string;
  bootstrapTimeoutMs?: number;
  forwardTimeoutMs?: number;
}

/** The SSH half of AgentHostConnectionState; the bridge adds the direct-mode state. */
export type SshConnectionState = Omit<AgentHostConnectionState, "direct">;

/** One connection (target + optional remote command) and its forward lifecycle. */
export class AgentHostConnection {
  private state: SshConnectionState;
  private forward: ChildProcess | null = null;
  private pending: Promise<SshConnectionState> | null = null;
  readonly sshBin: string;
  private readonly run: SshRunner;
  private readonly settingsFile: string;

  constructor(private readonly opts: ConnectionOptions = {}) {
    this.sshBin = opts.sshBin ?? "ssh";
    this.run = opts.run ?? spawnRunner(this.sshBin);
    this.settingsFile = opts.settingsFile ?? join(homedir(), ".xtrm", "app", "agent-host-connection.json");
    const settings = this.load();
    this.state = { phase: settings ? "disconnected" : "unconfigured", settings };
  }

  status(): SshConnectionState {
    return this.state;
  }

  save(settings: AgentHostSettings): SshConnectionState {
    this.disconnect();
    mkdirSync(dirname(this.settingsFile), { recursive: true, mode: 0o700 });
    writeFileSync(this.settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    this.state = { phase: "disconnected", settings };
    return this.state;
  }

  connect(): Promise<SshConnectionState> {
    if (this.pending) return this.pending;
    if (this.state.phase === "connected") return Promise.resolve(this.state);
    const settings = this.state.settings;
    if (!settings) return Promise.resolve(this.state);
    this.pending = this.doConnect(settings).finally(() => (this.pending = null));
    return this.pending;
  }

  private async doConnect(settings: AgentHostSettings): Promise<SshConnectionState> {
    this.state = { phase: "connecting", settings, step: "bootstrap" };
    try {
      const host = await bootstrap(settings.target, { remoteCommand: settings.remoteCommand, run: this.run, timeoutMs: this.opts.bootstrapTimeoutMs });
      this.state = { phase: "connecting", settings, step: "forward" };
      const localPort = await this.openForward(settings.target, host.port);
      this.state = { phase: "connected", settings, host: { ...host, localPort } };
    } catch (e) {
      this.stopForward();
      const error = e instanceof ConnectError ? { code: e.code, message: e.message } : { code: "connect_failed", message: e instanceof Error ? e.message : String(e) };
      this.state = { phase: "error", settings, error };
    }
    return this.state;
  }

  private async openForward(target: string, remotePort: number): Promise<number> {
    const localPort = await freePort();
    const child = spawn(this.sshBin, forwardArgv(target, localPort, remotePort), { stdio: ["ignore", "ignore", "pipe"] });
    this.forward = child;
    let stderr = "";
    let exited: string | null = null;
    child.stderr!.on("data", (b: Buffer) => void (stderr.length < MAX_OUTPUT && (stderr += b.toString("utf8"))));
    child.once("error", (e) => (exited = e.message));
    child.once("exit", (code, signal) => {
      exited ??= signal ? `signal ${signal}` : `exit ${code}`;
      if (this.forward === child) {
        this.forward = null;
        // A forward that dies after connecting puts the connection in error, not silently disconnected.
        if (this.state.phase === "connected") {
          this.state = { phase: "error", settings: this.state.settings, error: { code: "forward_closed", message: `The ssh forward to ${target} closed (${exited}).` } };
        }
      }
    });
    const deadline = Date.now() + (this.opts.forwardTimeoutMs ?? FORWARD_TIMEOUT_MS);
    for (;;) {
      if (exited) throw new ConnectError("forward_failed", `ssh -L to ${target} stopped (${exited})${stderr.trim() ? `: ${lastLine(stderr)}` : "."}`);
      if (await probe(localPort)) return localPort;
      if (Date.now() > deadline) throw new ConnectError("forward_timeout", `The forwarded agent host on ${target} did not answer within ${Math.round((this.opts.forwardTimeoutMs ?? FORWARD_TIMEOUT_MS) / 1000)} s.`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private stopForward() {
    const child = this.forward;
    this.forward = null;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  /** Stops the forward. The remote agent host keeps running: agents outlive the GUI (§35.4). */
  disconnect(): SshConnectionState {
    this.stopForward();
    if (this.state.settings) this.state = { phase: "disconnected", settings: this.state.settings };
    return this.state;
  }

  localPort(): number | null {
    return this.state.phase === "connected" ? (this.state.host?.localPort ?? null) : null;
  }

  /** The forwarded remote host while connected; its identity changes with target and host pid. */
  endpoint(): HostEndpoint | null {
    const host = this.state.phase === "connected" ? this.state.host : undefined;
    return host ? { origin: loopbackOrigin(host.localPort), id: `ssh:${this.state.settings?.target}:${host.pid}`, local: false } : null;
  }

  private load(): AgentHostSettings | null {
    try {
      const raw = JSON.parse(readFileSync(this.settingsFile, "utf8")) as Record<string, unknown>;
      const target = validateTarget(raw.target);
      return target ? { target, remoteCommand: validateRemoteCommand(raw.remoteCommand) } : null;
    } catch {
      return null;
    }
  }
}

// --- HTTP bridge -------------------------------------------------------------------

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,256}$/;

/** Shell-quoted command line for display and copy; the argv is what runs. */
export function displayCommand(argv: string[]): string {
  return argv.map((a) => (/^[A-Za-z0-9_./@%+=:,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > maxBytes) req.destroy();
    });
    req.on("end", () => {
      try {
        const v: unknown = JSON.parse(raw || "{}");
        resolve(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** Terminal launcher from XTRM_TERMINAL (operator config, e.g. `foot` or `kitty --`); argv appended. */
function launchTerminal(argv: string[]): boolean {
  const prefix = (process.env.XTRM_TERMINAL ?? "").split(/\s+/).filter(Boolean);
  if (!prefix.length) return false;
  const child = spawn(prefix[0]!, [...prefix.slice(1), ...argv], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
  return true;
}

const NO_HOST = "no agent host: connect over SSH, pair a direct-mode front, or start `xt host start` on this machine";

/**
 * The host the read and write routes use: the SSH forward while connected, else a paired direct-mode
 * front (XTRM-600), else the loopback host (XTRM-572). `local` and `direct` are injectable for tests.
 */
export function agentHostHandler(
  conn: AgentHostConnection,
  prefix = "/xtrm-api/agent-host",
  local: () => HostEndpoint | null = () => localEndpoint(),
  direct: DirectConnection | null = null,
) {
  const endpoint = () => conn.endpoint() ?? direct?.endpoint() ?? local();
  const state = (ssh: SshConnectionState): AgentHostConnectionState => ({ ...ssh, direct: direct?.status() ?? { phase: "unpaired", url: null } });
  /** A 401 from the front for the stored device token: drop it and ask the operator to pair again. */
  const refused = (ep: HostEndpoint, status: number) => {
    if (status === 401 && ep.bearer) direct?.refused(ep.bearer);
  };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    const path = url.pathname.slice(prefix.length);
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(403, { ok: false, error: "the agent host bridge answers loopback clients only" });

    if (req.method === "GET") {
      if (path === "/connection") return send(200, state(conn.status()));
      // Read-only host API: the session list, one session, and the event stream.
      const m = /^\/api\/v1\/sessions(?:\/([^/]+))?$/.exec(path);
      if (m || path === "/api/v1/events") {
        const ep = endpoint();
        if (!ep) return send(409, { ok: false, error: NO_HOST });
        const id = m?.[1] ? decodeURIComponent(m[1]) : (url.searchParams.get("sessionId") ?? null);
        if (id !== null && !SESSION_ID_RE.test(id)) return send(400, { ok: false, error: "invalid session id" });
        if (!m) return proxyEvents(ep, req, res, id, (status) => refused(ep, status));
        try {
          const r = await hostApi(ep, id ? `/v1/sessions/${encodeURIComponent(id)}` : "/v1/sessions");
          refused(ep, r.status);
          if (r.status === 401 && ep.bearer) return send(401, { ok: false, code: "repair_required", error: REPAIR_MESSAGE });
          res.setHeader("x-xtrm-agent-host", ep.id);
          return send(r.status, r.body);
        } catch (e) {
          return send(502, { ok: false, error: `agent host unreachable: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      // Repository identity of a session path; only the local host's paths exist on this machine.
      if (path === "/repo") {
        const p = url.searchParams.get("path") ?? "";
        const ep = endpoint();
        if (!ep?.local || !p.startsWith("/") || p.length > 4096 || p.includes("\0")) return send(200, { repo: null });
        return send(200, { repo: await resolveRepo(p) });
      }
      return send(404, { ok: false, error: "unknown agent host route" });
    }

    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(403, { ok: false, error: "cross-origin request rejected" });
      if (JSON_ROUTES.has(path) && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
        return send(415, { ok: false, error: "submit and reference bodies must be application/json" });
      }
      const body = await readJson(req, JSON_ROUTES.has(path) ? REFERENCE_BODY_BYTES : undefined);
      if (!body) return send(400, { ok: false, error: "invalid JSON body" });
      switch (path) {
        case "/api/v1/submit":
        case "/api/v1/references/resolve": {
          const submit = path === "/api/v1/submit";
          if (submit ? !isSubmitRequest(body) : !isResolveRequest(body)) {
            return send(400, { ok: false, error: `expected an xtrm.agent-host-api.v1 ${submit ? "submit_request" : "reference_resolve_request"}` });
          }
          const ep = endpoint();
          if (!ep) return send(409, { ok: false, error: NO_HOST });
          try {
            const r = await hostPost(ep, submit ? "/v1/submit" : "/v1/references/resolve", body);
            refused(ep, r.status);
            if (r.status === 401 && ep.bearer) return send(401, { ok: false, code: "repair_required", error: REPAIR_MESSAGE });
            res.setHeader("x-xtrm-agent-host", ep.id);
            return send(r.status, r.body);
          } catch (e) {
            return send(502, { ok: false, error: `agent host unreachable: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
        case "/settings": {
          const target = validateTarget(body.target);
          if (!target) return send(400, { ok: false, error: "invalid SSH target: use user@host or an ~/.ssh/config alias" });
          const hasCommand = typeof body.remoteCommand === "string" && body.remoteCommand.trim() !== "";
          const remoteCommand = hasCommand ? validateRemoteCommand(body.remoteCommand) : null;
          if (hasCommand && !remoteCommand) return send(400, { ok: false, error: "invalid remote command: one line, at most 4096 characters" });
          return send(200, state(conn.save({ target, remoteCommand })));
        }
        case "/connect":
          return send(200, state(await conn.connect()));
        case "/disconnect":
          return send(200, state(conn.disconnect()));
        case "/direct/pair": {
          if (!direct) return send(404, { ok: false, error: "direct mode is not available in this bridge" });
          try {
            await direct.pair({ url: body.url as string, pairingToken: body.pairingToken as string, deviceName: body.deviceName as string });
          } catch (e) {
            if (!(e instanceof PairError)) throw e;
            return send(400, { ok: false, code: e.code, error: e.message });
          }
          return send(200, state(conn.status()));
        }
        case "/direct/forget":
          direct?.forget();
          return send(200, state(conn.status()));
        case "/terminal": {
          const target = conn.status().settings?.target;
          if (!target) return send(409, { ok: false, error: "no SSH connection is configured" });
          const argv = typeof body.tmuxSession === "string" ? terminalArgv(target, body.tmuxSession) : null;
          if (!argv) return send(400, { ok: false, error: "invalid tmux session name" });
          const out: TerminalLaunch = { argv, command: displayCommand(argv), launched: launchTerminal(argv) };
          return send(200, out);
        }
        default:
          return send(404, { ok: false, error: "unknown agent host route" });
      }
    }
    send(405, { ok: false, error: "method not allowed" });
  };
}

export function agentHostSshApi(opts: ConnectionOptions & { prefix?: string; deviceFile?: string } = {}): Plugin {
  let conn: AgentHostConnection | null = null;
  let direct: DirectConnection | null = null;
  // Created lazily so `vite build` neither reads settings nor resolves ssh.
  const get = () =>
    (conn ??= new AgentHostConnection({
      ...opts,
      sshBin: opts.sshBin ?? resolveSbBin(process.env.XTRM_SSH_BIN ?? "ssh"),
      settingsFile: opts.settingsFile ?? (process.env.XTRM_AGENT_CONNECTION_FILE || undefined),
    }));
  const install = (server: { middlewares: { use: (fn: ReturnType<typeof agentHostHandler>) => void }; httpServer?: { once: (e: "close", fn: () => void) => void } | null }) => {
    direct ??= new DirectConnection({ file: opts.deviceFile ?? (process.env.XTRM_AGENT_DEVICE_FILE || undefined) });
    const handler = agentHostHandler(get(), opts.prefix, undefined, direct);
    server.middlewares.use(handler);
    // Stop the forward with the server; the remote host keeps running.
    server.httpServer?.once("close", () => conn?.disconnect());
    process.once("exit", () => conn?.disconnect());
  };
  return { name: "xtrm-agent-host-ssh", configureServer: install, configurePreviewServer: install };
}
