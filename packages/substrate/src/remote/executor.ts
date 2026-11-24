// Forwarding: every `sb` invocation in remote mode runs on the server with the
// same argv, stdin, stdout, stderr and exit code (ADR-008). This is the only
// place that decides local versus remote, and it decides before the local store
// is opened, so the stale local database can never be touched in remote mode.

import { lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { flag, flagList, parseArgs } from "../domain/argv.ts";
import { COMMIT_EVIDENCE_FLAG, readLocalCommitEvidence } from "./commit-evidence.ts";
import { resolveClaimHolder } from "../domain/claim.ts";
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
  // Absolute epoch milliseconds for the whole invocation (hooks pass this).
  deadlineMs?: number | null;
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

const EMPTY_FLAGS: ReadonlySet<string> = new Set();

// Flags whose value is a client-side document, per command. Scoping matters:
// `--result` is a `<file|json>` document on `journal append` and an `<a,b>` ref
// list on `issue close`, so one global set would upload a ref list and hand the
// server a temp path in place of a ref. Every entry here is one the CLI reads
// with readJsonArg, and every value is materialised on the server: a file is
// uploaded, inline JSON is uploaded as its own bytes, and a bare path is
// refused (the server would resolve a same-named file of its own).
const DOCUMENT_FLAGS: Record<string, ReadonlySet<string>> = {
  "issue.create": new Set(["contract"]),
  "issue.edit": new Set(["contract", "ownership", "context-refs"]),
  // CORE-2787: `issue link pr` reads its T2 evidence from the repository it runs
  // in. In remote mode that is the server's checkout, where a PR pushed from
  // this machine a moment ago does not exist yet, so the caller reads the
  // evidence here and sends it as a document.
  "issue.link": new Set([COMMIT_EVIDENCE_FLAG]),
  "issue.note": new Set(["result"]),
  "journal.append": new Set(["mechanical", "semantic", "result", "refs"]),
  "journal.checkpoint": new Set(["mechanical", "semantic", "refs"]),
};

// Flags whose value is plain text the CLI reads here and the server then reads
// from its own disk (the uploaded temp file). Scoped the same way and for the
// same reason: `--file` exists only where the server documents it, and an
// unlisted command may not pull a local file into the shared store (review H1).
// The class also exists because a text file has no inline form: unlike a
// document, a value that is not a file here is an error, never JSON to upload.
//
// `--summary-file` is the journal case (XTRM-751): the CLI reads it with
// readFileSync in semanticArg, not readJsonArg, so it never qualified as a
// document — and while it was unlisted the caller's path crossed ssh verbatim
// and the server answered "--summary-file not found: <caller path>" for a file
// that existed here, or "is empty" for "-" because no stdin was forwarded.
const INPUT_FILE_FLAGS: Record<string, ReadonlySet<string>> = {
  "issue.note": new Set(["file"]),
  "plan.check": new Set(["file"]),
  "plan.apply": new Set(["file"]),
  "import.beads": new Set(["file", "edges-file"]),
  "journal.append": new Set(["summary-file"]),
};

// An output path is not an input: `sb export project --file` writes the
// snapshot where the command runs, so in remote mode it would land on the
// server while the client reports success with no file. Refused, not dropped.
const OUTPUT_FLAGS: Record<string, ReadonlySet<string>> = {
  export: new Set(["file"]),
  "export.project": new Set(["file"]),
};

// Handled locally by design: help/version never open a store, doctor reports
// this machine's mode, and `remote` configures it.
const NEVER_FORWARDED = new Set(["help", "version", "doctor", "remote", "serve"]);

// One document, one bound. Large enough for a real contract or Journal result,
// small enough that a forwarded invocation is not a bulk copy.
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

// Directories whose contents are secrets or kernel state, never documents: an
// ssh key or a credentials file must not become a Journal entry because a caller
// passed its path (review H1).
const DENIED_SUFFIXES = [".ssh", ".secrets", ".gnupg", ".aws", ".docker", ".kube", join(".config", "gh")];
const DENIED_FILES = [".netrc", ".npmrc"];
const DENIED_ABSOLUTE = ["/proc", "/sys", "/dev"];

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Resolved at check time, not at import time: `$HOME` may itself be a symlink,
// and an unresolved root would let `~/link-to-secrets/key` through. This is a
// guard against accidents, not a security boundary (ADR-008).
function deniedRoots(): string[] {
  const home = realpathSafe(homedir());
  return [
    ...DENIED_SUFFIXES.map((suffix) => join(home, suffix)),
    ...DENIED_FILES.map((name) => join(home, name)),
    ...DENIED_ABSOLUTE,
  ];
}

export interface ParsedArgv {
  group: string | null;
  verb: string | null;
  positionals: string[];
}

// The command a forwarded invocation names, from the parser the CLI itself
// uses. Scanning for the first two non-flag tokens (the old approach) read a
// flag's value as the command: `--project X export project --file out` looked
// like `export.project` and skipped the write-direction refusal (review M5).
export function parseArgv(argv: string[]): ParsedArgv {
  const { positionals } = parseArgs(argv);
  return { group: positionals[0] ?? null, verb: positionals[1] ?? null, positionals };
}

function commandOf(argv: string[]): { group: string | null; command: string } {
  const { group, verb } = parseArgv(argv);
  if (group === null) return { group, command: "" };
  return { group, command: verb === null ? group : group + "." + verb };
}

// An explicit local store is a deliberate local invocation, and it wins over
// every remote setting: `sb --db X` and `SUBSTRATE_DB=X` mean "this store, on
// this machine". Hooks and doctor ask the same question through this function,
// so a hook with SUBSTRATE_DB set can never write to the server.
export function localStoreRequested(argv: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  // The service client reads both names (SUBSTRATE_DB and SUBSTRATE_LOCAL_DB); the
  // forwarder read only the first, so a worker configured with the second got its
  // writes sent to the server while it believed it was local.
  const fromEnv = (env["SUBSTRATE_DB"] ?? env["SUBSTRATE_LOCAL_DB"] ?? "").trim();
  if (fromEnv !== "") return "SUBSTRATE_DB=" + fromEnv;
  const flagged = flag(parseArgs(argv).flags, "db");
  if (flagged !== undefined) return "--db " + flagged;
  // The parser does not split `=` (the server's does not either), but a
  // `--db=<path>` still names a store, and treating it as remote would write to
  // the server while the caller asked for a file on this machine.
  const equals = argv.find((token) => token.startsWith("--db="));
  if (equals !== undefined) return "--db " + equals.slice("--db=".length);
  return null;
}

export function shouldForward(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (localStoreRequested(argv, env) !== null) return false;
  if (argv.includes("--help") || argv.includes("--version")) return false;
  const { group } = parseArgv(argv);
  if (group === null) return false;
  return !NEVER_FORWARDED.has(group);
}

// The server answers an unknown flag with `unknown flag --commit-evidence`. A
// server older than this client is not a failed link: the evidence rides along
// only when the far side can take it, so the invocation is retried once with
// the original argv and the caller keeps the old behaviour.
const UNKNOWN_EVIDENCE_FLAG = /unknown flag --commit-evidence/i;

// CORE-2787: read the T2 evidence from the caller's own repository and append it
// as the document the server reads instead of git. Nothing is done when the
// caller already supplied evidence, or when it asked for a plain mention.
function withLocalCommitEvidence(argv: string[], repoRoot: string): { argv: string[]; evidencePath: string | null } {
  const { group, verb } = parseArgv(argv);
  if (group !== "issue" || verb !== "link") return { argv, evidencePath: null };
  const flags = parseArgs(argv).flags;
  if (flag(flags, COMMIT_EVIDENCE_FLAG) !== undefined) return { argv, evidencePath: null };
  const range = flag(flags, "commits-range");
  const commits = flagList(flags, "commit") ?? [];
  if (range === undefined && commits.length === 0) return { argv, evidencePath: null };
  const evidence = readLocalCommitEvidence({ range, commits }, repoRoot);
  // A file, not an argv value: the document channel exists for exactly this,
  // and a PR's worth of commit messages can outgrow a command line.
  const path = join(tmpdir(), "sb-" + COMMIT_EVIDENCE_FLAG + "-" + process.pid + "-" + Date.now() + ".json");
  writeFileSync(path, JSON.stringify(evidence), { mode: 0o600 });
  return { argv: [...argv, "--" + COMMIT_EVIDENCE_FLAG, path], evidencePath: path };
}

export interface PreparedFiles {
  argv: string[];
  uploads: RemoteUpload[];
  // True when an argument names stdin; the caller forwards the client's stdin.
  wantsStdin: boolean;
}

function unsupported(message: string): RemoteError {
  return new RemoteError("unsupported", message);
}

// Uploads are numbered by their argv index so the server-side substitution
// replaces the value alone. `--flag=value` is refused for these flags rather
// than split: the server's own parser does not split it, so splitting would ask
// the server for something it never accepts (review H1).
export function prepareFiles(argv: string[]): PreparedFiles {
  const { command } = commandOf(argv);
  const documents = DOCUMENT_FLAGS[command] ?? EMPTY_FLAGS;
  const inputFiles = INPUT_FILE_FLAGS[command] ?? EMPTY_FLAGS;
  const outputs = OUTPUT_FLAGS[command] ?? EMPTY_FLAGS;
  const uploads: RemoteUpload[] = [];
  const rewritten: string[] = [];
  let wantsStdin = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      rewritten.push(token);
      continue;
    }
    const bare = token.slice(2);
    const eq = bare.indexOf("=");
    if (eq !== -1) {
      const name = bare.slice(0, eq);
      if (outputs.has(name) || documents.has(name) || inputFiles.has(name)) {
        throw unsupported(
          "--" + name + "=" + JSON.stringify(bare.slice(eq + 1)) + " is not accepted in remote mode: use `--" + name + " <value>` " +
            "(sb does not split --flag=value for this flag, so the token would reach the server unchanged)",
        );
      }
      rewritten.push(token);
      continue;
    }
    if (outputs.has(bare)) {
      throw unsupported(
        "--" + bare + " " + JSON.stringify(argv[index + 1] ?? "") + " is an output path: the file would be written on the server, not on this machine. " +
          "Omit --" + bare + " and read the result from stdout (add --json), or run the command where the server store is local",
      );
    }
    if (documents.has(bare) || inputFiles.has(bare)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw unsupported("--" + bare + " needs a value in remote mode: the document or file is read on this machine and uploaded");
      }
      index += 1;
      if (value === "-") {
        wantsStdin = true;
        rewritten.push("--" + bare, "-");
        continue;
      }
      const content = inputFiles.has(bare) ? readInputFile(bare, value) : documentBytes(bare, value, documents.has(bare));
      rewritten.push("--" + bare, value);
      uploads.push({ argvIndex: rewritten.length - 1, content });
      continue;
    }
    rewritten.push(token);
  }
  return { argv: rewritten, uploads, wantsStdin };
}

// The bytes to send for a document flag: the file when the value names one, the
// inline JSON itself otherwise. Both travel as one framed stream on stdin, so
// the document is never an argv element and never visible in a process list on
// either side. Base64 inside the argv would not have achieved that — a command
// line stays readable in /proc below the kernel's argument limit (review M7).
function documentBytes(flagName: string, value: string, inlineAllowed: boolean): Buffer {
  if (looksLikePath(value)) return readInputFile(flagName, value);
  if (inlineAllowed && /^\s*[[{]/.test(value)) {
    const bytes = Buffer.from(value);
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw unsupported("--" + flagName + " inline document is " + bytes.length + " bytes, above the " + MAX_DOCUMENT_BYTES + "-byte limit");
    }
    return bytes;
  }
  throw unsupported(
    inlineAllowed
      ? "--" + flagName + " " + JSON.stringify(value) + ": not a file on this machine and not inline JSON. sb remote uploads the document from here"
      : "--" + flagName + " " + JSON.stringify(value) + ": file not found on this machine (sb remote does not accept a server-side path)",
  );
}

// A value is a path when the file exists here. Existence, not shape: a JSON
// document can start with "[" and a path can contain none of the JSON
// punctuation, and `existsSync` is what the CLI's own readJsonArg checks first.
function looksLikePath(value: string): boolean {
  try {
    lstatSync(value);
    return true;
  } catch {
    return false;
  }
}

// A local file the server will read. Refused when it is not a regular file, a
// symlink, inside a secret directory, or larger than the document bound (review
// H1): a path that exists is not by itself a document. A "-" value never
// reaches here: prepareFiles marks the invocation as wanting the caller's
// stdin, which the server reads as the flag's value.
function readInputFile(flagName: string, value: string): Buffer {
  const absolute = resolve(value);
  let info;
  try {
    info = lstatSync(absolute);
  } catch (err) {
    throw unsupported(
      "--" + flagName + " " + JSON.stringify(value) + ": not a readable file on this machine (" +
        (err instanceof Error ? err.message : String(err)) + ")",
    );
  }
  if (info.isSymbolicLink()) throw unsupported("--" + flagName + " " + JSON.stringify(value) + ": refusing a symlink; pass the file it points at");
  if (!info.isFile()) throw unsupported("--" + flagName + " " + JSON.stringify(value) + ": not a regular file");
  // A hard link to a key passes every path check, because the link lives
  // elsewhere. Refusing extra links closes the accidental form; a link made by
  // an adversary is outside what a denylist can promise (ADR-008).
  if (info.nlink > 1) {
    throw unsupported(
      "--" + flagName + " " + JSON.stringify(value) + ": has " + info.nlink + " hard links; pass a file with a single link",
    );
  }
  if (info.size > MAX_DOCUMENT_BYTES) {
    throw unsupported(
      "--" + flagName + " " + JSON.stringify(value) + ": " + info.size + " bytes, above the " + MAX_DOCUMENT_BYTES + "-byte limit",
    );
  }
  const real = realpathSync(absolute);
  for (const denied of deniedRoots()) {
    const root = realpathSafe(denied);
    if (real === root || real.startsWith(root + sep)) {
      throw unsupported("--" + flagName + " " + JSON.stringify(value) + ": " + denied + " holds secrets or kernel state, never a Substrate document");
    }
  }
  return readFileSync(real);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.some((token) => token === "--" + name || token.startsWith("--" + name + "="));
}

// The verbs whose holder the client must resolve before forwarding (XTRM-722).
function isClaimVerb(argv: string[]): boolean {
  const { group, verb } = parseArgv(argv);
  return group === "issue" && (verb === "claim" || verb === "release");
}

function forwardedEnv(
  env: NodeJS.ProcessEnv,
  argv: string[],
  projectId: string | null,
): Record<string, string | undefined> {
  const forwarded: Record<string, string | undefined> = {};
  for (const name of FORWARDED_ENV) {
    const value = env[name];
    if (value !== undefined && value !== "") forwarded[name] = value;
  }
  const clientProject = (env["SUBSTRATE_PROJECT"] ?? "").trim();
  // The client resolves the project and passes it: on 0.2.2 this env is
  // precedence 2, identical to --project, and cwd on the server is then only a
  // convenience, never the authority. An explicit `--project`, in either form,
  // still wins.
  if (hasFlag(argv, "project")) {
    if (clientProject !== "") forwarded["SUBSTRATE_PROJECT"] = clientProject;
    return forwarded;
  }
  if (clientProject === "") {
    if (projectId !== null) forwarded["SUBSTRATE_PROJECT"] = projectId;
    return forwarded;
  }
  // A client project that disagrees with the verified checkout is a mistake in
  // one of the two, and choosing silently would write to the wrong project.
  if (projectId !== null && clientProject !== projectId) {
    throw new RemoteError(
      "config",
      "SUBSTRATE_PROJECT=" + clientProject + " contradicts the server checkout's project " + projectId +
        ". Pass --project to choose deliberately, or unset SUBSTRATE_PROJECT",
    );
  }
  forwarded["SUBSTRATE_PROJECT"] = clientProject;
  return forwarded;
}

export function forwardCli(argv: string[], deps: ForwardDeps = {}): CliOutcome | null {
  const env = deps.env ?? process.env;
  const localStore = deps.localStore === undefined ? localStoreRequested(argv, env) : deps.localStore;
  if (localStore !== null) return null;
  if (!shouldForward(argv, env)) return null;
  const schema = deps.schema ?? "substrate-cli/v1";
  // XTRM-722: a forwarded claim resolves its holder on the CLIENT. The client
  // refuses here when neither its flag nor its own environment supplies one, so
  // nothing is sent. Every forwarded claim that does leave therefore carries
  // either the explicit flag (which wins on the server) or the client's own
  // SUBSTRATE_HOLDER (which overrides the server's), so a server-side holder can
  // never decide the outcome of a reachable claim.
  if (isClaimVerb(argv)) {
    try {
      resolveClaimHolder(flag(parseArgs(argv).flags, "holder"), env);
    } catch (err) {
      return failure(argv, err, schema);
    }
  }
  let session: RemoteSession | null;
  try {
    session = openRemoteSession({ transport: deps.transport, env, deadlineMs: deps.deadlineMs ?? null });
  } catch (err) {
    return failure(argv, err, schema);
  }
  if (session === null) return null;
  // CORE-2787: evidence for `issue link pr` is read here, before anything is
  // sent, and rides as a document. A caller whose own repository cannot produce
  // it learns that here rather than from the far side's object store.
  let linked: { argv: string[]; evidencePath: string | null };
  try {
    linked = withLocalCommitEvidence(argv, process.cwd());
  } catch (err) {
    return failure(argv, err, schema);
  }
  try {
    const prepared = prepareFiles(linked.argv);
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
    let result = runRemote(session, prepared.argv, {
      cwd,
      env: forwardedEnv(env, prepared.argv, projectId),
      uploads: prepared.uploads,
      stdin: prepared.wantsStdin ? (deps.readStdin ?? (() => readFileSync(0, "utf8")))() : null,
    });
    // A server that predates --commit-evidence refuses it as an unknown flag. The
    // link then runs as it did before: one retry, original argv, no document.
    if (result.code !== 0 && linked.evidencePath !== null && UNKNOWN_EVIDENCE_FLAG.test(result.stderr + result.stdout)) {
      const retried = prepareFiles(argv);
      result = runRemote(session, retried.argv, {
        cwd,
        env: forwardedEnv(env, retried.argv, projectId),
        uploads: retried.uploads,
        stdin: retried.wantsStdin ? (deps.readStdin ?? (() => readFileSync(0, "utf8")))() : null,
      });
    }
    // Exits 70-73 come from the generated prologue (cd refused, frame ended
    // early, decode failed, wrong size). They are the transport's own failures,
    // so --json callers get an error envelope rather than an empty success.
    if (result.code >= 70 && result.code <= 73 && prepared.argv.includes("--json")) {
      const { group, verb } = parseArgv(prepared.argv);
      const command = group === null ? "" : verb === null ? group : group + "." + verb;
      const message = result.stderr.trim() || result.stdout.trim() || `the remote run exited ${result.code} on ${session.spec.host}`;
      return { code: result.code, stdout: JSON.stringify({ schema, command, ok: false, error: message }) + "\n", stderr: "" };
    }
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    return failure(argv, err, schema);
  } finally {
    if (linked.evidencePath !== null) rmSync(linked.evidencePath, { force: true });
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
  return openRemoteSession({ transport: deps.transport, env, deadlineMs: deps.deadlineMs ?? null });
}

// The identity a hook carries, and nothing else: a hook has no argv to derive a
// project from, and forwarding the whole environment would hand the server
// whatever the operator happened to export.
export function ambientEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const forwarded: Record<string, string | undefined> = {};
  for (const name of FORWARDED_ENV) {
    const value = env[name];
    if (value !== undefined && value !== "") forwarded[name] = value;
  }
  return forwarded;
}

// Hooks never pay for discovery. Enumerating the server's candidate checkouts
// costs one round trip each (23 on the reference server), which is what turned
// a commit into a 24 s stall (review M8). A hook uses a mapping that setup
// already verified, and otherwise reports the miss and writes nothing.
export function hookMapping(session: RemoteSession, repositoryKey: string) {
  return storedMapping(session, repositoryKey);
}
