// Real agent host harness for the live Agent half (XTRM-572). Local only: it needs an agent host,
// `pi` (1.0.0), tmux, an opencode-go credential, and the xtrm-dev/core checkout for the
// xtrm-agent-host Pi extension and the Claude hook reporter. The host is
// `node $XTRM_REAL_HOST_XT` when that names a built core `cli/dist/index.cjs` (use the same core commit
// as XTRM_CORE_DIR: a host and an extension from different commits can disagree on frames), else the
// `xt` on PATH.
//
// Direct mode (XTRM-600): the host starts with `--direct --direct-host xtrm-front.test`, and a local
// reverse proxy (the "front", standing in for `tailscale serve`) forwards to it with Host
// xtrm-front.test and X-Forwarded-For / -Host / -Proto, so every request through the front is
// non-local and needs a device token. The front logs method, path, status and whether a bearer was
// present, never the header itself.
//
// Isolation, by construction:
// - The host runs with a temporary HOME: its info file, index cache and journal roots (~/.pi,
//   ~/.claude) are all under the temp dir. It gets a temporary --socket and a fixed --port.
// - Pi runs with PI_CODING_AGENT_DIR / PI_AGENT_DIR set to a temp agent dir that holds only the
//   opencode-go auth entry and a test MCP config. The real ~/.pi is read once (that one entry), never written.
// - tmux runs as its own server (`tmux -L <unique>`); existing tmux servers and sessions are never touched.
// - Teardown kills that tmux server and the host, and deletes the temp dirs (the auth copy included).
//
// Acceptance additions (XTRM-601):
// - Sessions the host launches (POST /v1/launch) run `pi` from a wrapper on the host's PATH that adds
//   `-e <xtrm-agent-host>`, in a tmux server under a private TMUX_TMPDIR (never the default server).
// - A mock OpenAI-compatible provider `retry-probe` answers its first request "overloaded" (a retryable
//   provider error) and then streams a reply, so Pi's real retry path emits agent_end(willRetry=true).
// - Pi resources for discovery checks: AGENTS.md in the work dir, a user skill and a prompt template in
//   the agent dir, a stub "specialists" MCP server (e2e/real-host/specialists-stub.mjs), and one commit.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MODEL = "opencode-go/deepseek-v4.1-flash";
export const PI_NAME = "real-pi";
export const CLAUDE_NAME = "claude-presence";
export const CLAUDE_SESSION = "claude-real-host-572";

export interface RealHostState {
  root: string;
  sockDir: string;
  socket: string;
  home: string;
  agentDir: string;
  work: string;
  port: number;
  hostPid: number;
  tmux: string;
  log: string;
  coreDir: string;
  /** Port of the local front (reverse proxy) on 127.0.0.1. */
  frontPort: number;
  /** TMUX_TMPDIR of the tmux server that host-launched sessions run in. */
  launchTmuxDir: string;
  /** Port of the mock `retry-probe` provider. */
  mockPort: number;
}

/** Model of the mock provider: first request overloaded, then a streamed reply (§31 criterion 8). */
export const RETRY_MODEL = "retry-probe/probe";
export const RETRY_REPLY = "RETRIED-OK";
/** Facts only the Pi resources carry (§31 criteria 4-5). */
export const CODEWORD = "ORCHID-47";
export const SKILL_TOKEN = "LANTERN-12";
export const TEMPLATE_REPLY = "TEMPLATED";
/** History-only sessions seeded into the agent dir, like an operator host with hundreds of sessions. */
export const SCALE_SESSIONS = 550;

/** Host name the front forwards, as `tailscale serve` forwards the tailnet name. */
export const FRONT_HOST = "xtrm-front.test";

const env = process.env;
export const coreDir = () => resolve(env.XTRM_CORE_DIR ?? join(homedir(), "dev", "core"));
/**
 * The host CLI: `XTRM_REAL_HOST_XT=<core>/cli/dist/index.cjs` runs a host built from the same core
 * commit as the extension in XTRM_CORE_DIR (an older installed host rejects newer frames); else `xt`.
 */
const xt = (...args: string[]): [string, string[]] => (env.XTRM_REAL_HOST_XT ? ["node", [resolve(env.XTRM_REAL_HOST_XT), ...args]] : ["xt", args]);
export const hostPort = () => Number(env.XTRM_REAL_HOST_PORT ?? 47573);
export const frontPort = () => Number(env.XTRM_REAL_HOST_FRONT_PORT ?? 47574);

/**
 * Runs `xt host <args>` against the test host (its HOME holds the info file and the device store).
 * The output can hold a pairing token: callers must not log it.
 */
export function hostCli(state: Pick<RealHostState, "home">, ...args: string[]): string {
  return execFileSync(...xt("host", ...args), { encoding: "utf8", env: cleanEnv({ HOME: state.home, XDG_RUNTIME_DIR: "" }), timeout: 15_000 });
}
export function log(state: Pick<RealHostState, "log">, line: string) {
  appendFileSync(state.log, `${new Date().toISOString()} ${line}\n`);
}

/**
 * Environment for child processes: no inherited tmux, xtmux or agent-host identity, and no
 * node_modules/.bin on PATH (`npm run` prepends ancestor dirs that can hold an older `xt`).
 */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!/^(TMUX|TMUX_PANE|XTMUX_.*|XTRM_.*|PI_.*)$/.test(k)) out[k] = v;
  out.PATH = (env.PATH ?? "")
    .split(":")
    .filter((d) => d && !/node_modules\/\.bin\/?$/.test(d))
    .join(":");
  return { ...out, ...extra };
}

export function tmux(state: Pick<RealHostState, "tmux">, ...args: string[]): string {
  return execFileSync("tmux", ["-L", state.tmux, "-f", "/dev/null", ...args], { encoding: "utf8", env: cleanEnv({}) });
}

export async function hostGet<T>(state: Pick<RealHostState, "port">, path: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${state.port}${path}`);
  return (await res.json()) as T;
}

export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // retry
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Starts the host; on any failure, everything already started or written is removed again. */
export async function startRealHost(runLog: string): Promise<RealHostState> {
  const partial: { state?: RealHostState } = {};
  try {
    return await start(runLog, partial);
  } catch (e) {
    if (partial.state) stopRealHost(partial.state);
    throw e;
  }
}

async function start(runLog: string, partial: { state?: RealHostState }): Promise<RealHostState> {
  const root = mkdtempSync(join(tmpdir(), "xtrm-572-"));
  // Unix socket paths are limited to 108 bytes: keep the socket in a short dir.
  const sockDir = mkdtempSync("/tmp/xh-");
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  const work = join(root, "work");
  for (const d of [join(agentDir, "sessions"), join(home, ".claude", "projects"), work]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const state: RealHostState = {
    root,
    sockDir,
    socket: join(sockDir, "host.sock"),
    home,
    agentDir,
    work,
    port: hostPort(),
    hostPid: 0,
    tmux: `xtrm572-${process.pid}`,
    log: runLog,
    coreDir: coreDir(),
    frontPort: frontPort(),
    launchTmuxDir: join(root, "tmux-launch"),
    mockPort: 0,
  };
  partial.state = state;
  const version = execFileSync(...xt("--version"), { encoding: "utf8", env: cleanEnv({}) }).trim();
  const [maj, min] = version.split(".").map(Number);
  if (maj! === 0 && min! < 14) throw new Error(`xt ${version} has no \`xt host start\`; need 0.14.0 or later`);
  let coreRev = "?";
  try {
    coreRev = execFileSync("git", ["-C", state.coreDir, "rev-parse", "--short=8", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // not a git checkout
  }
  log(state, `host ${[xt()[0], ...xt()[1]].join(" ")} (xt ${version}), core ${state.coreDir} @ ${coreRev}, pi ${execFileSync("pi", ["--version"], { encoding: "utf8", env: cleanEnv({}) }).trim()}`);
  log(state, `root ${root} socket ${state.socket} port ${state.port} front ${state.frontPort} tmux -L ${state.tmux}`);

  // Only the opencode-go credential, copied into the isolated agent dir.
  const authSource = env.XTRM_REAL_HOST_AUTH ?? join(homedir(), ".pi", "agent", "auth.json");
  const entry = (JSON.parse(readFileSync(authSource, "utf8")) as Record<string, unknown>)["opencode-go"];
  if (!entry) throw new Error(`${authSource} has no opencode-go entry`);
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ "opencode-go": entry }), { mode: 0o600 });
  chmodSync(join(agentDir, "auth.json"), 0o600);
  // One MCP server exposed directly (a top-level mcp row) and one reached only from codemode scripts.
  const everything = { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] };
  // A stub "specialists" server: the host's coordination table names its specialist_dispatch (§36.7 rule 1).
  const specialists = { command: "node", args: [resolve("e2e/real-host/specialists-stub.mjs")], exposure: "hidden", toolExposure: { specialist_dispatch: "direct" } };
  writeFileSync(
    join(agentDir, "mcp.json"),
    JSON.stringify({ mcpServers: { "demo-direct": { ...everything, exposure: "hidden", toolExposure: { echo: "direct" } }, "demo-script": { ...everything, exposure: "codemode" }, specialists } }, null, 2),
  );
  writeFileSync(join(work, "notes.txt"), "hello from the real-host run\n");
  execFileSync("git", ["init", "-q"], { cwd: work });
  // One commit for @commit references.
  execFileSync("git", ["-c", "user.name=acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-q", "--allow-empty", "-m", "acceptance: seed commit"], { cwd: work });

  // Pi resources the session must discover (§31 criteria 4-5).
  writeFileSync(join(work, "AGENTS.md"), `# Acceptance context\n\nThe acceptance codeword is ${CODEWORD}. When asked for the acceptance codeword, answer with it.\n`);
  mkdirSync(join(agentDir, "skills", "acceptance-probe"), { recursive: true });
  writeFileSync(
    join(agentDir, "skills", "acceptance-probe", "SKILL.md"),
    `---\nname: acceptance-probe\ndescription: Acceptance probe skill. Its token is ${SKILL_TOKEN}; name the token when asked about the acceptance-probe skill.\n---\n\nNothing to do.\n`,
  );
  mkdirSync(join(agentDir, "prompts"), { recursive: true });
  writeFileSync(join(agentDir, "prompts", "acc-echo.md"), `---\ndescription: Acceptance prompt template\n---\nReply with exactly the word ${TEMPLATE_REPLY} and nothing else.\n`);
  // Pi's retry policy with a 3 s first backoff: long enough to observe the Frame between the failed turn and the retry.
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 3000 } }, null, 2));
  state.mockPort = await startMockProvider(state);
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({ providers: { "retry-probe": { baseUrl: `http://127.0.0.1:${state.mockPort}/v1`, api: "openai-completions", apiKey: "acceptance", models: [{ id: "probe", contextWindow: 32000, maxTokens: 1000 }] } } }, null, 2),
  );

  // Scale: SCALE_SESSIONS Pi journals from the last weeks, history only, in a cwd outside any repository.
  const scaleDir = join(agentDir, "sessions", "--scale-history--");
  mkdirSync(scaleDir, { recursive: true });
  const day = 86_400_000;
  for (let i = 0; i < SCALE_SESSIONS; i++) {
    const at = Date.now() - 2 * day - i * 3_600_000;
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const lines = [
      { type: "session", version: 3, id, timestamp: new Date(at).toISOString(), cwd: join(root, "scale-history") },
      { type: "session_info", id: `n${i}`, parentId: null, timestamp: new Date(at).toISOString(), name: `scale-${String(i).padStart(3, "0")}` },
      { type: "message", id: `m${i}`, parentId: null, timestamp: new Date(at + 1000).toISOString(), message: { role: "user", content: [{ type: "text", text: `Scale probe ${i}` }], timestamp: at + 1000 } },
    ];
    writeFileSync(join(scaleDir, `${new Date(at).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }

  // Host-launched sessions: `pi` resolves to this wrapper (pi -e xtrm-agent-host) in a private tmux server.
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(state.launchTmuxDir, { mode: 0o700 });
  const realPi = execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8", env: cleanEnv({}) }).trim();
  const hostExt = join(state.coreDir, "packages", "pi-extensions", "extensions", "xtrm-agent-host", "index.ts");
  writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec ${JSON.stringify(realPi)} -e ${JSON.stringify(hostExt)} "$@"\n`, { mode: 0o755 });

  const hostLog = join(root, "host.log");
  const host = spawn(...xt("host", "start", "--socket", state.socket, "--port", String(state.port), "--direct", "--direct-host", FRONT_HOST, "--json"), {
    // Launched sessions report to this host's socket and run in the private launch tmux server.
    env: cleanEnv({ HOME: home, XDG_RUNTIME_DIR: "", PATH: `${bin}:${cleanEnv({}).PATH}`, TMUX_TMPDIR: state.launchTmuxDir, XTRM_AGENT_HOST_SOCKET: state.socket }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  host.stdout!.on("data", (b: Buffer) => appendFileSync(hostLog, b));
  host.stderr!.on("data", (b: Buffer) => appendFileSync(hostLog, b));
  host.unref();
  state.hostPid = host.pid!;
  const info = await until("xt host to listen", async () => (await hostGet<{ schema: string }>(state, "/v1/sessions")).schema === "xtrm.agent-host-api.v1");
  log(state, `xt host pid ${state.hostPid} listening (direct mode, ${FRONT_HOST}): ${info}`);
  await startFront(state);
  return state;
}

let front: Server | null = null;
let mock: Server | null = null;

/** The mock `retry-probe` provider: the first chat request is "overloaded" (503), every later one streams RETRY_REPLY. */
function startMockProvider(state: RealHostState): Promise<number> {
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      log(state, `mock provider ${req.method} ${req.url} request ${requests}`);
      if (requests === 1) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "The server is overloaded, please retry", type: "overloaded_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: Record<string, unknown>, finish: string | null, usage?: Record<string, number>) =>
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "probe", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
      res.write(chunk({ role: "assistant", content: RETRY_REPLY }, null));
      res.write(chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }));
      res.end("data: [DONE]\n\n");
    });
  });
  mock = server;
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
}

/** tmux of the host-launched sessions (private TMUX_TMPDIR server). */
export function launchTmux(state: Pick<RealHostState, "launchTmuxDir">, ...args: string[]): string {
  return execFileSync("tmux", ["-f", "/dev/null", ...args], { encoding: "utf8", env: cleanEnv({ TMUX_TMPDIR: state.launchTmuxDir }) });
}

/** The local front: a reverse proxy that marks every request as proxied, like `tailscale serve`. */
function startFront(state: RealHostState): Promise<void> {
  const server = createServer((req, res) => {
    const bearer = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
    const up = request(
      {
        host: "127.0.0.1",
        port: state.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: FRONT_HOST, "x-forwarded-for": req.socket.remoteAddress ?? "127.0.0.1", "x-forwarded-host": FRONT_HOST, "x-forwarded-proto": "https" },
      },
      (r) => {
        log(state, `front ${req.method} ${(req.url ?? "").replace(/\?.*$/, "")} ${r.statusCode} bearer=${bearer ? "yes" : "no"}`);
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
        // An upstream that closes early (a revoked device's stream) closes the client connection too.
        r.on("close", () => {
          if (!r.complete) res.destroy();
        });
      },
    );
    up.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  front = server;
  return new Promise((r, reject) => {
    server.once("error", reject);
    server.listen(state.frontPort, "127.0.0.1", () => {
      log(state, `front http://127.0.0.1:${state.frontPort} → 127.0.0.1:${state.port} as ${FRONT_HOST} (X-Forwarded-For)`);
      r();
    });
  });
}

export interface PiOptions {
  /** Role and bound work item, as `xt pi --role/--bead` passes them to the extension (XTMUX_AGENT_ROLE / _BEAD). */
  role?: string;
  bead?: string;
  model?: string;
  /** false: no xtrm-agent-host extension; the session never joins the live registry (history only). */
  hostExtension?: boolean;
}

/** Answers Pi's one-time "trust this folder" question with "this session only" (no trust written). */
export async function passTrust(capture: () => string, keys: (...k: string[]) => void, ready: (pane: string) => boolean) {
  await until(
    "pi to start",
    () => {
      const pane = capture();
      if (pane.includes("Trust project folder?")) {
        keys("Down", "Down", "Enter");
        return false;
      }
      return ready(pane);
    },
    60_000,
  );
}

/** Starts pi in its own tmux session; `extensions` are loaded after xtrm-agent-host (`pi -e`). */
export async function startPi(state: RealHostState, name = PI_NAME, extensions: string[] = [], cwd = state.work, opts: PiOptions = {}): Promise<string> {
  const ext = join(state.coreDir, "packages", "pi-extensions", "extensions", "xtrm-agent-host", "index.ts");
  const model = opts.model ?? MODEL;
  const piEnv = [
    `PI_CODING_AGENT_DIR=${state.agentDir}`,
    `PI_AGENT_DIR=${state.agentDir}`,
    `XTRM_AGENT_HOST_SOCKET=${state.socket}`,
    `XTRM_SESSION_NAME=${name}`,
    ...(opts.role ? [`XTMUX_AGENT_ROLE=${opts.role}`] : []),
    ...(opts.bead ? [`XTMUX_AGENT_BEAD=${opts.bead}`] : []),
  ];
  const loads = [...(opts.hostExtension === false ? [] : [ext]), ...extensions].flatMap((e) => ["-e", e]);
  tmux(state, "new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", cwd, "env", ...piEnv, "pi", ...loads, "--model", model);
  log(state, `pi started in tmux -L ${state.tmux} session ${name} (${model}; ${loads.length / 2} extensions${opts.role ? `; role ${opts.role}` : ""}${opts.bead ? `; bead ${opts.bead}` : ""})`);
  await passTrust(
    () => tmux(state, "capture-pane", "-p", "-t", name),
    (...k) => tmux(state, "send-keys", "-t", name, ...k),
    (pane) => pane.includes(model.split("/")[1]!),
  );
  if (opts.hostExtension === false) return "";
  const session = await until(
    "the pi session in the host registry",
    async () => (await hostGet<{ sessions: Array<{ sessionId: string; name?: string }> }>(state, "/v1/sessions")).sessions.find((s) => s.name === name),
    60_000,
  );
  log(state, `pi session ${session.sessionId} connected`);
  return session.sessionId;
}

/**
 * Starts a real `xt pi <name> --no-attach --json` from the host's xt (§36.11 criterion 3) in the work
 * dir, with the test HOME and agent dir. `pi` resolves to the harness wrapper (pi -e xtrm-agent-host)
 * and tmux to the private launch server. No `--bead`: it assigns the issue on the board. Returns the
 * session id once the extension reports, and the tmux session name xt chose.
 */
export async function startXtPi(state: RealHostState, name: string): Promise<{ sessionId: string; tmuxSession: string }> {
  const env = cleanEnv({
    HOME: state.home,
    XDG_RUNTIME_DIR: "",
    PATH: `${join(state.root, "bin")}:${cleanEnv({}).PATH}`,
    TMUX_TMPDIR: state.launchTmuxDir,
    PI_CODING_AGENT_DIR: state.agentDir,
    PI_AGENT_DIR: state.agentDir,
    XTRM_AGENT_HOST_SOCKET: state.socket,
    // xt pi may record the launch on a Substrate board: never the operator's (SUBSTRATE_DB is read-only for this run).
    SUBSTRATE_DB: join(state.root, "xt-pi-board.db"),
  });
  let out = "";
  try {
    out = execFileSync(...xt("pi", name, "--no-attach", "--json", "--model", MODEL), { cwd: state.work, encoding: "utf8", env, timeout: 120_000 });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    log(state, `xt pi failed: status ${err.status}; stdout ${String(err.stdout ?? "").trim()}; stderr ${String(err.stderr ?? "").trim()}`);
    throw new Error(`xt pi ${name} failed (status ${err.status}): ${String(err.stderr ?? err.stdout ?? "").trim().split("\n").slice(-3).join(" | ")}`);
  }
  log(state, `xt pi ${name}: ${out.trim().split("\n").pop()}`);
  const outcome = JSON.parse(out.trim().split("\n").pop()!) as { status: string; identity?: { session_name?: string } };
  if (outcome.status !== "ok" || !outcome.identity?.session_name) throw new Error(`xt pi ${name}: ${JSON.stringify(outcome)}`);
  const tmuxSession = outcome.identity.session_name;
  await passTrust(
    () => launchTmux(state, "capture-pane", "-p", "-t", tmuxSession),
    (...k) => launchTmux(state, "send-keys", "-t", tmuxSession, ...k),
    (pane) => pane.includes(MODEL.split("/")[1]!),
  );
  const session = await until(
    "the xt pi session in the host registry",
    async () => (await hostGet<{ sessions: Array<{ sessionId: string; name?: string; tmux?: { session: string } }> }>(state, "/v1/sessions")).sessions.find((s) => s.tmux?.session === tmuxSession || s.name === tmuxSession || s.name === name),
    60_000,
  );
  log(state, `xt pi session ${session.sessionId} connected (tmux ${tmuxSession})`);
  return { sessionId: session.sessionId, tmuxSession };
}

/** Type a prompt into the pi terminal, as an operator would. */
export function typeInTerminal(state: RealHostState, text: string, name = PI_NAME) {
  tmux(state, "send-keys", "-t", name, "-l", text);
  tmux(state, "send-keys", "-t", name, "Enter");
  log(state, `typed in terminal: ${text}`);
}

/**
 * Feed Claude Code hook payloads to the real hook reporter (.xtrm/hooks/agent-host-reporter.mjs).
 * Since core XTRM-592 the reporter is a module the hook dispatcher calls in-process
 * (`reportToAgentHost(input)`), so it is imported and called the same way; an older reporter that
 * runs as a script on import still works with the same stdin.
 */
const REPORT = `import { readFileSync } from "node:fs";
const m = await import(process.argv[1]);
if (typeof m.reportToAgentHost === "function") await m.reportToAgentHost(JSON.parse(readFileSync(0, "utf8")));`;

export function claudeHook(state: RealHostState, hook: Record<string, unknown>) {
  const reporter = pathToFileURL(join(state.coreDir, ".xtrm", "hooks", "agent-host-reporter.mjs")).href;
  const input = JSON.stringify({ session_id: CLAUDE_SESSION, cwd: state.work, ...hook });
  execFileSync("node", ["--input-type=module", "-e", REPORT, reporter], { input, env: cleanEnv({ XTRM_AGENT_HOST_SOCKET: state.socket, XTRM_SESSION_NAME: CLAUDE_NAME }), timeout: 10_000 });
  log(state, `claude hook ${String(hook.hook_event_name)}`);
}

/** Alive and not a zombie: the busy wait below blocks the event loop, so Node cannot reap the child. */
function running(pid: number): boolean {
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
}

export function stopRealHost(state: RealHostState) {
  if (front) {
    front.closeAllConnections();
    front.close();
    front = null;
    log(state, "front stopped");
  }
  if (mock) {
    mock.closeAllConnections();
    mock.close();
    mock = null;
  }
  try {
    tmux(state, "kill-server");
    log(state, `tmux -L ${state.tmux} stopped`);
  } catch {
    // already gone
  }
  try {
    launchTmux(state, "kill-server");
    log(state, `launch tmux (${state.launchTmuxDir}) stopped`);
  } catch {
    // never started
  }
  if (state.hostPid) {
    try {
      process.kill(-state.hostPid, "SIGTERM");
    } catch {
      try {
        process.kill(state.hostPid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    // The host writes its session index on shutdown: wait for it to exit before removing its HOME.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && running(state.hostPid)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    log(state, `xt host ${state.hostPid} ${running(state.hostPid) ? "still running after 10 s" : "stopped"}`);
  }
  try {
    appendFileSync(state.log, `--- host log ---\n${readFileSync(join(state.root, "host.log"), "utf8")}`);
  } catch {
    // no host log
  }
  rmSync(state.root, { recursive: true, force: true });
  rmSync(state.sockDir, { recursive: true, force: true });
  log(state, `removed ${state.root} and ${state.sockDir} (auth copy included)`);
}

/** Event payloads the host retained for one session, read from its replay buffer (Last-Event-ID 0). */
export async function hostPayloads(state: Pick<RealHostState, "port">, sessionId: string): Promise<Array<Record<string, unknown> & { type: string }>> {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 1_500);
  const out: Array<Record<string, unknown> & { type: string }> = [];
  let buf = "";
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/v1/events?sessionId=${encodeURIComponent(sessionId)}`, { headers: { "last-event-id": "0" }, signal: ctl.signal });
    const dec = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) buf += dec.decode(chunk, { stream: true });
  } catch {
    // aborted after the replay was written, or the host is unreachable
  }
  for (const line of buf.split("\n")) if (line.startsWith("data: ")) out.push((JSON.parse(line.slice(6)) as { frame: { payload: Record<string, unknown> & { type: string } } }).frame.payload);
  return out;
}
