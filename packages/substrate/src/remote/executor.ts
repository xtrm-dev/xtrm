// Forwarding: every `sb` invocation in remote mode runs on the server with the
// same argv, stdin, stdout, stderr and exit code (ADR-008). This is the only
// place that decides local versus remote, and it decides before the local store
// is opened, so the stale local database can never be touched in remote mode.

import { existsSync, readFileSync } from "node:fs";
import { RemoteError, type RemoteUpload } from "./spec.ts";
import { clientRepositoryKey, openRemoteSession, resolveMapping, runRemote, storedMapping, type RemoteSession } from "./session.ts";
import type { RemoteTransport } from "./ssh.ts";

export interface ForwardDeps {
  transport?: RemoteTransport;
  env?: NodeJS.ProcessEnv;
  schema?: string;
  // Reads the client's stdin for an argument that names it (`--file -`).
  // Injected so a test never depends on the runner's own fd 0.
  readStdin?: () => string;
  // The caller already decided this invocation is local (an embedded caller's
  // dbPath, for instance). A string states the reason; null means "decide".
  localStore?: string | null;
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

// Flags whose value is a client-side document, per command. Scoping matters:
// `--result` is a `<file|json>` document on `journal append` and an `<a,b>` ref
// list on `issue close`, so one global set would upload a ref list and hand the
// server a temp path in place of a ref. Every entry here is one the CLI reads
// with readJsonArg, and every value is materialised on the server: a file is
// uploaded, inline JSON is uploaded as its own bytes, and a bare path is
// refused (the server would resolve a same-named file of its own).
const EMPTY_FLAGS: ReadonlySet<string> = new Set();
const DOCUMENT_FLAGS: Record<string, ReadonlySet<string>> = {
  "issue.create": new Set(["contract"]),
  "issue.edit": new Set(["contract", "ownership", "context-refs"]),
  "journal.append": new Set(["mechanical", "semantic", "result", "refs"]),
  "journal.checkpoint": new Set(["mechanical", "semantic"]),
};

// Flags whose value is always a path the server must read.
const FILE_FLAGS = new Set(["file", "edges-file"]);

// An output path is not an input: `sb export project --file` writes the
// snapshot where the command runs, so in remote mode it would land on the
// server while the client reports success with no file. Refused, not dropped.
const OUTPUT_FLAGS: Record<string, ReadonlySet<string>> = { export: new Set(["file"]) };

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

// An explicit local store is a deliberate local invocation, and it wins over
// every remote setting: `sb --db X` and `SUBSTRATE_DB=X` mean "this store, on
// this machine". Hooks and doctor ask the same question through this function,
// so a hook with SUBSTRATE_DB set can never write to the server.
export function localStoreRequested(argv: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = (env["SUBSTRATE_DB"] ?? "").trim();
  if (fromEnv !== "") return "SUBSTRATE_DB=" + fromEnv;
  const flagged = flagValue(argv, "db");
  if (flagged !== null) return "--db " + flagged;
  return null;
}

export function shouldForward(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (localStoreRequested(argv, env) !== null) return false;
  if (argv.includes("--help") || argv.includes("--version")) return false;
  const { group } = parseArgv(argv);
  if (group === null) return false;
  return !NEVER_FORWARDED.has(group);
}

export interface PreparedFiles {
  argv: string[];
  uploads: RemoteUpload[];
  // True when an argument names stdin; the caller forwards the client's stdin.
  wantsStdin: boolean;
}

// A local path that the server must read is uploaded; anything else is refused
// with the flag and the file named (ADR-008: silent substitution is a defect).
//
// `--flag=value` is rewritten to `--flag value` before uploads are numbered so
// the substitution replaces the value alone: replacing the whole token would
// send the temp path in place of the flag and drop the flag name from the
// server's argv.
export function prepareFiles(argv: string[]): PreparedFiles {
  const { group, command } = commandOf(argv);
  const documents = DOCUMENT_FLAGS[command] ?? EMPTY_FLAGS;
  const outputs = (group === null ? EMPTY_FLAGS : OUTPUT_FLAGS[group]) ?? EMPTY_FLAGS;
  const uploads: RemoteUpload[] = [];
  const rewritten: string[] = [];
  let wantsStdin = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const flagName = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const value = eq === -1 ? (argv[index + 1] ?? "") : token.slice(eq + 1);
      if (outputs.has(flagName)) {
        throw new RemoteError(
          "unsupported",
          "--" + flagName + " " + JSON.stringify(value) + " is an output path: the file would be written on the server, not on this machine. " +
            "Omit --" + flagName + " and read the result from stdout (add --json), or run the command where the server store is local",
        );
      }
      if (documents.has(flagName) || FILE_FLAGS.has(flagName)) {
        rewritten.push("--" + flagName);
        if (eq === -1) index += 1;
        if (value === "-") {
          wantsStdin = true;
          rewritten.push(value);
          continue;
        }
        const argvIndex = rewritten.length;
        const content = documentBytes(flagName, value, documents.has(flagName));
        rewritten.push(value);
        uploads.push({ argvIndex, content });
        continue;
      }
    }
    rewritten.push(token);
  }
  return { argv: rewritten, uploads, wantsStdin };
}

// The bytes to send for a document flag: the file when the value names one, the
// inline JSON itself otherwise. Inline JSON travels as an uploaded file too, so
// it never appears in the server's process list and reaches the server byte for
// byte. A bare path that is not a file here is refused, never forwarded.
function documentBytes(flagName: string, value: string, inlineAllowed: boolean): Buffer {
  if (value !== "" && existsSync(value)) return readFileSync(value);
  if (inlineAllowed && /^\s*[[{]/.test(value)) return Buffer.from(value);
  throw new RemoteError(
    "unsupported",
    inlineAllowed
      ? "--" + flagName + " " + JSON.stringify(value) + ": not a file on this machine and not inline JSON. sb remote uploads the document from here"
      : "--" + flagName + " " + JSON.stringify(value) + ": file not found on this machine (sb remote does not accept a server-side path)",
  );
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.some((token) => token === "--" + name || token.startsWith("--" + name + "="));
}

// Both spellings of a value flag, so `--db=X` is not mistaken for an ordinary
// token the way `argv.includes("--db")` mistook it.
function flagValue(argv: string[], name: string): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--" + name) return argv[index + 1] ?? "";
    if (token.startsWith("--" + name + "=")) return token.slice(name.length + 3);
  }
  return null;
}

function commandOf(argv: string[]): { group: string | null; command: string } {
  const { group, verb } = parseArgv(argv);
  if (group === null) return { group, command: "" };
  return { group, command: verb === null ? group : group + "." + verb };
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
  const localStore = deps.localStore === undefined ? localStoreRequested(argv, env) : deps.localStore;
  if (localStore !== null) return null;
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
    const prepared = prepareFiles(argv);
    // An explicit --project names the project itself, so it needs no checkout
    // here to resolve one: the server checkout is then only a working
    // directory, and not being inside one is not a mapping failure.
    const explicitProject = hasFlag(prepared.argv, "project");
    const repositoryKey = clientRepositoryKey();
    let cwd: string | null = null;
    let projectId: string | null = null;
    if (repositoryKey !== null) {
      try {
        const mapping = resolveMapping(session, repositoryKey);
        cwd = mapping.root;
        projectId = mapping.projectId;
      } catch (err) {
        if (!explicitProject) throw err;
        cwd = storedMapping(session, repositoryKey)?.root ?? null;
      }
    } else if (!explicitProject) {
      throw new RemoteError(
        "mapping",
        "substrate.remote=" + session.config.remote + ": not inside a Git checkout, so no server checkout can be verified. " +
          "Run sb from a checkout of the repository, pass --project to name the project explicitly, or run it on " + session.spec.host,
      );
    }
    const result = runRemote(session, prepared.argv, {
      cwd,
      env: forwardedEnv(env, prepared.argv, projectId),
      uploads: prepared.uploads,
      stdin: prepared.wantsStdin ? (deps.readStdin ?? (() => readFileSync(0, "utf8")))() : null,
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
