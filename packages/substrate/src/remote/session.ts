// Session: server `sb` resolution, remote execution, and repository-key
// mapping. Everything here is 0.2.2-compatible (ADR-008 amendment §1): the
// client resolves the project and passes it, and the server-side capability
// gaps are reported by doctor instead of being assumed away.

import { isAbsolute } from "node:path";
import { discoverRepository } from "../domain/repository-discovery.ts";
import { RemoteError, buildRemoteCommand, shellQuote, type RemoteSpec, type RemoteUpload } from "./spec.ts";
import { mappingKey, selectRemote, writeRemoteConfig, type CheckoutMapping, type RemoteConfig } from "./config.ts";
import { firstLine, sshTransport, type RemoteRunResult, type RemoteTransport } from "./ssh.ts";

export interface RemoteDeps {
  transport?: RemoteTransport;
  env?: NodeJS.ProcessEnv;
  // Absolute epoch milliseconds after which the whole invocation gives up,
  // discovery included. A hook uses this instead of a per-call timeout: three
  // 15 s calls with a cold session are 45 s of `git commit`.
  deadlineMs?: number | null;
}

export interface RemoteSession {
  spec: RemoteSpec;
  config: RemoteConfig;
  configPath: string;
  sbPath: string;
  transport: RemoteTransport;
  env: NodeJS.ProcessEnv;
  envOverride: boolean;
  deadlineMs?: number | null;
}

export interface RemoteRunOptions {
  cwd?: string | null;
  env?: Record<string, string | undefined>;
  stdin?: string | null;
  uploads?: RemoteUpload[];
  timeoutMs?: number;
}

// Local mode (no config, no env override) is null, never an error.
export function openRemoteSession(deps: RemoteDeps = {}): RemoteSession | null {
  const env = deps.env ?? process.env;
  const selection = selectRemote(env);
  if (selection === null) return null;
  const session: RemoteSession = {
    spec: selection.spec,
    config: selection.config,
    configPath: selection.configPath,
    sbPath: selection.config.remoteSb ?? "",
    transport: deps.transport ?? sshTransport,
    env,
    envOverride: selection.envOverride,
    deadlineMs: deps.deadlineMs ?? null,
  };
  if (session.sbPath === "") session.sbPath = resolveServerSb(session);
  return session;
}

// A host chosen by SUBSTRATE_REMOTE for one invocation stays in that
// invocation: writing it back would turn a shell variable into durable state
// that outlives the shell (review M2). Cache writes are best effort elsewhere
// too, so a read-only config dir never blocks a command.
function persist(session: RemoteSession): void {
  if (session.envOverride) return;
  writeRemoteConfig(session.config, session.env);
}

// Milliseconds left in the session's budget, or null when the session has none.
// A caller that passes an explicit timeout still gets the smaller of the two.
function remaining(session: RemoteSession): number | null {
  if (session.deadlineMs === undefined || session.deadlineMs === null) return null;
  return session.deadlineMs - Date.now();
}

function timeoutFor(session: RemoteSession, requested?: number): number | undefined {
  const left = remaining(session);
  if (left === null) return requested;
  if (left <= 0) {
    throw new RemoteError(
      "unreachable",
      "substrate.remote=" + session.config.remote + ": the invocation budget expired before the command could be sent; nothing ran on " + session.spec.host,
    );
  }
  return requested === undefined ? left : Math.min(requested, left);
}

// Discovery only: a login shell is required to find `sb` (it lives on an
// nvm/fnm PATH that non-interactive ssh does not get), and it is paid once,
// then cached, so steady state runs the absolute path through the login shell.
const DISCOVERY_SHELLS = ["zsh -lic", "bash -lc", "sh -lc"];

export function resolveServerSb(session: RemoteSession): string {
  const failures: string[] = [];
  for (const shell of DISCOVERY_SHELLS) {
    const command = shell + " " + shellQuote("command -v sb");
    const result = session.transport.run({ host: session.spec.host, command, timeoutMs: timeoutFor(session, 30_000) });
    if (result.code === 255) {
      throw new RemoteError("unreachable", unreachable(session.spec.host, result.stderr));
    }
    const candidates = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && isAbsolute(line));
    if (result.code === 0 && candidates.length === 1) {
      session.config.remoteSb = candidates[0]!;
      session.sbPath = candidates[0]!;
      try {
        persist(session);
      } catch {
        // A read-only config dir must not block the invocation itself.
      }
      return candidates[0]!;
    }
    failures.push(shell + ": " + (firstLine(result.stderr) || "no absolute path on stdout"));
  }
  throw new RemoteError(
    "config",
    "cannot resolve sb on " + session.spec.host + " (" + failures.join("; ") + "). Install sb there, or set remoteSb in " + session.configPath,
  );
}

export function unreachable(host: string, stderr: string): string {
  const detail = firstLine(stderr);
  return "substrate.remote=ssh:" + host + ": cannot reach " + host + (detail === "" ? "" : ": " + detail);
}

export function runRemote(session: RemoteSession, argv: string[], options: RemoteRunOptions = {}): RemoteRunResult {
  const plan = buildRemoteCommand({
    sbPath: session.sbPath,
    argv,
    cwd: options.cwd ?? null,
    env: options.env,
    uploads: options.uploads,
    remoteLabel: "ssh:" + session.spec.host,
  });
  // One stdin, one consumer: a large upload already rides stdin, so a command
  // that also names stdin cannot be forwarded faithfully.
  if (options.stdin != null && plan.stdin !== null) {
    throw new RemoteError(
      "unsupported",
      "sb " + argv.join(" ") + " needs stdin twice (an uploaded file and a '-' argument): pass the document as a file path instead",
    );
  }
  const result = session.transport.run({
    host: session.spec.host,
    command: plan.command,
    stdin: options.stdin ?? plan.stdin,
    timeoutMs: timeoutFor(session, options.timeoutMs),
  });
  if (result.code === 255) throw new RemoteError("unreachable", unreachable(session.spec.host, result.stderr));
  return result;
}

export interface RemoteEnvelope {
  schema?: string;
  command?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function parseEnvelope(stdout: string): RemoteEnvelope | null {
  const text = stdout.trim();
  if (text === "" || !text.startsWith("{")) return null;
  try {
    return JSON.parse(text) as RemoteEnvelope;
  } catch {
    return null;
  }
}

// Machine output stays machine output: a remote failure surfaces as the
// server's own error string, never as a rewritten payload.
export function runRemoteJson(session: RemoteSession, argv: string[], options: RemoteRunOptions = {}): unknown {
  const result = runRemote(session, argv, options);
  const envelope = parseEnvelope(result.stdout);
  if (envelope === null) {
    throw new RemoteError(
      "remote-failed",
      "sb " + argv.join(" ") + " on " + session.spec.host + " returned no JSON envelope" +
        (result.stderr.trim() === "" ? "" : ": " + firstLine(result.stderr)),
    );
  }
  if (!envelope.ok) {
    throw new RemoteError("remote-failed", envelope.error ?? "remote command failed without an error message");
  }
  return envelope.data;
}

export function serverVersion(session: RemoteSession): string {
  const result = runRemote(session, ["--version"], { timeoutMs: 30_000 });
  const match = /(?:^|\s)(\d+\.\d+\.\d+\S*)/.exec(result.stdout.trim());
  if (result.code !== 0 || match === null) {
    throw new RemoteError("remote-failed", "sb --version on " + session.spec.host + " failed: " + (firstLine(result.stderr) || result.stdout.trim()));
  }
  session.config.serverVersion = match[1]!;
  try {
    persist(session);
  } catch {
    // cache only
  }
  return match[1]!;
}

export function measureLatency(session: RemoteSession): number {
  const started = performance.now();
  runRemote(session, ["--version"], { timeoutMs: 30_000 });
  return Math.round(performance.now() - started);
}

export function clientRepositoryKey(): string | null {
  const repository = discoverRepository();
  return repository.identity?.repositoryKey ?? null;
}

// Candidate server checkouts: the server's own linked git roots. Available on
// 0.2.2 (project links), so setup needs no newer server.
export function serverRoots(session: RemoteSession): string[] {
  const data = runRemoteJson(session, ["project", "links", "--json"]);
  const links = (data as { links?: Array<{ gitRoot?: unknown }> }).links ?? [];
  const roots = links
    .map((link) => link.gitRoot)
    .filter((root): root is string => typeof root === "string" && root !== "");
  return [...new Set(roots)].sort();
}

export interface ServerCheckout {
  root: string;
  repositoryKey: string | null;
  projectId: string | null;
}

// Verification, not path guessing: the server reports its own repository key
// for a checkout, and the client compares it to its own.
export function inspectServerCheckout(session: RemoteSession, root: string): ServerCheckout {
  const data = (runRemoteJson(session, ["doctor", "--json"], { cwd: root })) as {
    repository?: { repositoryKey?: unknown };
    project?: { id?: unknown } | null;
  };
  const key = data.repository?.repositoryKey;
  const projectId = data.project?.id;
  return {
    root,
    repositoryKey: typeof key === "string" && key !== "" ? key : null,
    projectId: typeof projectId === "string" && projectId !== "" ? projectId : null,
  };
}

// A candidate checkout the server is not actually holding (stale link row, moved
// directory, no Git identity) is skipped, not fatal: one broken link must not
// hide a healthy checkout next to it. A transport failure stays fatal.
function probeCandidate(session: RemoteSession, root: string): ServerCheckout | null {
  try {
    const checkout = inspectServerCheckout(session, root);
    return checkout.repositoryKey === null ? null : checkout;
  } catch (err) {
    if (err instanceof RemoteError && err.kind === "unreachable") throw err;
    return null;
  }
}

function describeCandidates(checkouts: ServerCheckout[]): string {
  return checkouts.map((checkout) => checkout.root).join(", ");
}

export interface ResolveMappingOptions {
  serverRoot?: string | null;
  refresh?: boolean;
}

// Fail closed when the mapping is absent or ambiguous: a bash-identical path
// guess is the one thing this must never do.
export function resolveMapping(session: RemoteSession, repositoryKey: string, options: ResolveMappingOptions = {}): CheckoutMapping {
  const cached = session.config.checkouts[mappingKey(session.spec.host, repositoryKey)];
  if (cached !== undefined && options.refresh !== true && (options.serverRoot ?? null) === null) return cached;

  if (options.serverRoot !== undefined && options.serverRoot !== null) {
    const checkout = inspectServerCheckout(session, options.serverRoot);
    if (checkout.repositoryKey !== repositoryKey) {
      throw new RemoteError(
        "mapping",
        "server checkout " + options.serverRoot + " on " + session.spec.host + " reports repository " +
          (checkout.repositoryKey ?? "(none)") + ", not " + repositoryKey,
      );
    }
    return remember(session, repositoryKey, checkout);
  }

  const roots = serverRoots(session);
  const checkouts: ServerCheckout[] = [];
  for (const root of roots) {
    const checkout = probeCandidate(session, root);
    if (checkout !== null) checkouts.push(checkout);
  }
  const matches = checkouts.filter((checkout) => checkout.repositoryKey === repositoryKey);
  if (matches.length === 1) return remember(session, repositoryKey, matches[0]!);
  if (matches.length === 0) {
    throw new RemoteError(
      "mapping",
      "no server checkout of " + repositoryKey + " on " + session.spec.host +
        " (candidates: " + (roots.length === 0 ? "none" : describeCandidates(checkouts) || "none usable") + "). " +
        "Clone the repository there and run `sb init`, then `sb remote setup " + session.config.remote + "`",
    );
  }
  throw new RemoteError(
    "mapping",
    "ambiguous server checkout for " + repositoryKey + " on " + session.spec.host + ": " +
      describeCandidates(matches) + ". Pick one with `sb remote setup " + session.config.remote + " --server-root <path>`",
  );
}

function remember(session: RemoteSession, repositoryKey: string, checkout: ServerCheckout): CheckoutMapping {
  const mapping: CheckoutMapping = { root: checkout.root, projectId: checkout.projectId, verifiedAt: Date.now() };
  session.config.checkouts[mappingKey(session.spec.host, repositoryKey)] = mapping;
  try {
    persist(session);
  } catch {
    // cache only
  }
  return mapping;
}

export function storedMapping(session: RemoteSession, repositoryKey: string): CheckoutMapping | null {
  return session.config.checkouts[mappingKey(session.spec.host, repositoryKey)] ?? null;
}
