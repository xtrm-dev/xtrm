// Forwarding: every `sb` invocation in remote mode runs on the server with the
// same argv, stdin, stdout, stderr and exit code (ADR-008). This is the only
// place that decides local versus remote, and it decides before the local store
// is opened, so the stale local database can never be touched in remote mode.

import { existsSync, readFileSync } from "node:fs";
import { RemoteError, type RemoteUpload } from "./spec.ts";
import { clientRepositoryKey, openRemoteSession, resolveMapping, runRemote, type RemoteSession } from "./session.ts";
import type { RemoteTransport } from "./ssh.ts";

export interface ForwardDeps {
  transport?: RemoteTransport;
  env?: NodeJS.ProcessEnv;
  schema?: string;
}

export interface CliOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

// The environment an ssh invocation does not carry for free. SUBSTRATE_DB is
// deliberately absent: it means "local store" and is handled as local mode.
const FORWARDED_ENV = [
  "SUBSTRATE_HOLDER",
  "SUBSTRATE_ISSUE_REF",
  "SUBSTRATE_ISSUE",
  "SUBSTRATE_ACTIVATION_ID",
  "XTRM_SESSION_ID",
  "XTRM_SESSION_NAME",
  "LANG",
  "TZ",
];

// Flags whose value is a client-side path. They are uploaded to a server temp
// path rather than silently read as a different file on the server.
const LOCAL_FILE_FLAGS = new Set(["contract", "file", "edges-file"]);

// Handled locally by design: help/version never open a store, doctor reports
// this machine's mode, and `remote` configures it.
const NEVER_FORWARDED = new Set(["help", "version", "doctor", "remote"]);

const VALUE_FLAGS = new Set(["db"]);

export interface ParsedArgv {
  group: string | null;
  verb: string | null;
  positionals: string[];
}

export function parseArgv(argv: string[]): ParsedArgv {
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (token.startsWith("--") && VALUE_FLAGS.has(token.slice(2))) index += 1;
  }
  return { group: positionals[0] ?? null, verb: positionals[1] ?? null, positionals };
}

export function shouldForward(argv: string[], env: NodeJS.ProcessEnv): boolean {
  // An explicit local store is a deliberate local invocation.
  if ((env["SUBSTRATE_DB"] ?? "") !== "") return false;
  if (argv.includes("--db")) return false;
  if (argv.includes("--help") || argv.includes("--version")) return false;
  const { group } = parseArgv(argv);
  if (group === null) return false;
  return !NEVER_FORWARDED.has(group);
}

export interface PreparedFiles {
  argv: string[];
  uploads: RemoteUpload[];
}

// A local path that the server must read is uploaded; anything else is refused
// with the flag and the file named (ADR-008: silent substitution is a defect).
//
// `--flag=value` is rewritten to `--flag value` before uploads are numbered so
// the substitution replaces the value alone: replacing the whole token would
// send the temp path in place of the flag and drop the flag name from the
// server's argv.
export function prepareFiles(argv: string[]): PreparedFiles {
  const uploads: RemoteUpload[] = [];
  const rewritten: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const flagName = eq === -1 ? token.slice(2) : token.slice(2, eq);
      if (LOCAL_FILE_FLAGS.has(flagName)) {
        const value = eq === -1 ? (argv[index + 1] ?? "") : token.slice(eq + 1);
        rewritten.push("--" + flagName);
        if (eq === -1) index += 1;
        const argvIndex = rewritten.length;
        rewritten.push(value);
        uploads.push({ argvIndex, content: readLocalFile(flagName, value) });
        continue;
      }
    }
    rewritten.push(token);
  }
  return { argv: rewritten, uploads };
}

function readLocalFile(flagName: string, value: string): Buffer {
  if (value === "-" || value === "") {
    throw new RemoteError(
      "unsupported",
      "--" + flagName + " " + JSON.stringify(value) + " is not supported in remote mode: pass a file path",
    );
  }
  if (!existsSync(value)) {
    throw new RemoteError("unsupported", "--" + flagName + " " + JSON.stringify(value) + ": file not found on this machine");
  }
  return readFileSync(value);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.some((token) => token === "--" + name || token.startsWith("--" + name + "="));
}

function forwardedEnv(env: NodeJS.ProcessEnv, argv: string[], projectId: string | null): Record<string, string | undefined> {
  const forwarded: Record<string, string | undefined> = {};
  for (const name of FORWARDED_ENV) {
    const value = env[name];
    if (value !== undefined && value !== "") forwarded[name] = value;
  }
  // The client resolves the project and passes it: on 0.2.2 this env is
  // precedence 2, identical to --project, and cwd on the server is then only a
  // convenience, never the authority. An explicit `--project`, in either form,
  // still wins.
  if (projectId !== null && !hasFlag(argv, "project")) forwarded["SUBSTRATE_PROJECT"] = projectId;
  return forwarded;
}

export function forwardCli(argv: string[], deps: ForwardDeps = {}): CliOutcome | null {
  const env = deps.env ?? process.env;
  if (!shouldForward(argv, env)) return null;
  const schema = deps.schema ?? "substrate-cli/v1";
  let session: RemoteSession | null;
  try {
    session = openRemoteSession({ transport: deps.transport, env });
  } catch (err) {
    return failure(argv, err, schema);
  }
  if (session === null) return null;
  try {
    const repositoryKey = clientRepositoryKey();
    if (repositoryKey === null) {
      throw new RemoteError(
        "mapping",
        "substrate.remote=" + session.config.remote + ": not inside a Git checkout, so no server checkout can be verified. " +
          "Run sb from a checkout of the repository, or run it on " + session.spec.host,
      );
    }
    const mapping = resolveMapping(session, repositoryKey);
    const prepared = prepareFiles(argv);
    const result = runRemote(session, prepared.argv, {
      cwd: mapping.root,
      env: forwardedEnv(env, prepared.argv, mapping.projectId),
      uploads: prepared.uploads,
    });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    return failure(argv, err, schema);
  }
}

// A transport or mapping failure is an error envelope in --json mode, not a
// local fallback.
function failure(argv: string[], err: unknown, schema: string): CliOutcome {
  const message = err instanceof Error ? err.message : String(err);
  if (!argv.includes("--json")) return { code: 1, stdout: "", stderr: message + "\n" };
  const { group, verb } = parseArgv(argv);
  const command = group === null ? "" : verb === null ? group : group + "." + verb;
  return { code: 1, stdout: JSON.stringify({ schema, command, ok: false, error: message }) + "\n", stderr: "" };
}

// Hooks that need structured data (post-commit's receipt lookup,
// prepare-commit-msg's trailers) use the same session and the same transport.
export function hookSession(env: NodeJS.ProcessEnv = process.env, deps: ForwardDeps = {}): RemoteSession | null {
  return openRemoteSession({ transport: deps.transport, env });
}

export function hookMapping(session: RemoteSession, repositoryKey: string) {
  return resolveMapping(session, repositoryKey);
}
