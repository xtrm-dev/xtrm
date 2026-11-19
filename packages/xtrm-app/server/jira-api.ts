// Read-only bridge to Jira Cloud for one repository's bound project (ADR-002 D4/D5, XTRM-815).
//
// Why a bridge: the Jira token lives in a file on the host (`jira_token_file`) and the browser
// must never hold it; Jira Cloud is also not a CORS peer of the app. This plugin follows the
// status-board bridge (`server/status-board-api.ts`): same-origin middleware on the UI port,
// binding resolution from the same project-management.json, a per-request credential read from
// the file, a bounded cache (30 s) keyed by the read, and generic failures that never echo the
// credential, the upstream URL, or a response body.
//
// Reads only. No write verb exists (creating, commenting, transitioning or labelling a Jira issue
// needs an explicit, separately authorised contract). The Jira identity of an Issue is durable in
// Substrate `external_bindings` (XTRM-814: `sb external list`), so `links` joins those rows instead
// of keeping a second mapping table; when Substrate cannot answer, the Jira read still succeeds
// and reports `bindingsAvailable: false` rather than inventing a sync state.
//
// No request string is concatenated into an upstream URL: a Jira key reaches the URL only after
// `JIRA_KEY_RE`, the project filter in the search URL comes from the binding, and the key list is
// built from validated keys.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defaultConfigPath, loadPmConfig, normaliseRepo, resolveBinding, type BoardBinding, type PmConfig } from "./status-board-api.ts";
import { resolveSbBin } from "./substrate-cli.ts";

const PREFIX = "/xtrm-api/jira";
const CACHE_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_KEYS = 50;
const MAX_RESULTS = 50;
/** `sb external list` reports at most this many rows in one page (500 is `sb`'s hard cap). */
export const EXTERNAL_LIST_LIMIT = 500;
const FIELDS = "summary,status,assignee";
const ISSUE_PATH = "/rest/api/3/issue";
/** Jira Cloud's current search endpoint; `/rest/api/3/search` is its deprecated predecessor. */
const SEARCH_PATH = "/rest/api/3/search/jql";

/** The key shape the contract pins: `PROJECT-123`, project key at least two characters. */
export const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * The shape a project key must have before it enters the JQL template. A configured value that
 * does not match would widen every search past the bound project (`MMD OR project = HR`), so it is
 * refused as a config error instead of being used.
 */
export const JIRA_PROJECT_RE = /^[A-Z][A-Z0-9_]+$/;

const str = (value: unknown, max = 400): string | null => (typeof value === "string" && value.length > 0 && value.length <= max ? value : null);

/**
 * A Jira site the bridge may send a credential to: an absolute `https:` URL. An `http:` site would
 * put the Authorization header on the wire in plaintext, so it is a config error, not a warning.
 */
export function httpsSiteOf(value: unknown): string | null {
  const site = str(value);
  if (!site) return null;
  try {
    return new URL(site).protocol === "https:" ? site : null;
  } catch {
    return null;
  }
}

/**
 * Why a Jira document carries no Substrate identity. `jira_invalid_config` is unusable operator
 * config (a malformed project key, a non-https site), reported as 503 before any upstream call;
 * the rest are honest "not bound" states.
 */
export type JiraMissingReason = "config_absent" | "repo_not_bound" | "jira_not_configured" | "jira_invalid_config";

/**
 * Why the Substrate join could not answer for a key. Absent (null) means the read was complete, so
 * a null `syncState` is a real "no binding" rather than an unknown one.
 */
export type JiraBindingsReason = "sb_project_missing" | "sb_unavailable" | "sb_truncated";

/** The binding as a caller may see it: paths and presence, never a credential value. */
export interface JiraBinding {
  repository: string;
  configured: boolean;
  reason: JiraMissingReason | null;
  resolvedBy: BoardBinding["resolvedBy"];
  pmProject: string | null;
  substrateProject: string | null;
  site: string | null;
  project: string | null;
  boardId: string | null;
  tokenFile: string | null;
  credentialPresent: boolean;
}

/** One Jira issue joined with its durable Substrate identity, when one exists. */
export interface JiraIssue {
  key: string;
  summary: string | null;
  status: string | null;
  assignee: string | null;
  url: string;
  /** Substrate `external_bindings.sync_state`; null when no binding (or no bindings read) exists. */
  syncState: string | null;
  /** The owning Substrate Issue reference, e.g. `XTRM-816`; null when unbound. */
  issueRef: string | null;
  /**
   * False when this row's Substrate identity is unknown (the join failed, or this key fell past a
   * truncated page): `syncState`/`issueRef` are then null because nobody could read them, never
   * because the issue is unbound.
   */
  bindingsAvailable: boolean;
}

/** Project part of a key (`MMD-12` -> `MMD`). The key is already validated by `JIRA_KEY_RE`. */
export const keyProject = (key: string): string => key.slice(0, key.lastIndexOf("-"));

/**
 * `keys=a,b,c` for `links`. Returns null for any malformed list, so the handler can answer 400
 * before an upstream call. Duplicates collapse, order is kept, and the list is bounded.
 */
export function parseKeys(raw: string | null): string[] | null {
  if (raw === null) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > MAX_KEYS) return null;
  const keys: string[] = [];
  for (const part of parts) {
    if (!JIRA_KEY_RE.test(part)) return null;
    if (!keys.includes(part)) keys.push(part);
  }
  return keys;
}

/** The fixed template plus the bound project key; no caller text reaches it. */
export const projectJql = (project: string): string => `project = ${project} ORDER BY updated DESC`;

/** The fixed template plus the validated key list; each key is `JIRA_KEY_RE`-checked upstream of this. */
export const keysJql = (keys: string[]): string => `key in (${keys.join(", ")}) ORDER BY updated DESC`;

/**
 * `search?jql=` is a guard, not a query: the caller may omit it or restate the bound project
 * filter (`project = MMD`). Free JQL is deliberately unsupported — the request string is never
 * forwarded, and the upstream JQL is built from the template above and the binding's project.
 */
export function acceptsJqlGuard(raw: string | null, project: string): boolean {
  if (raw === null || raw.trim() === "") return true;
  const normalised = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*=\s*/g, " = ")
    .toUpperCase();
  return normalised === `PROJECT = ${project.toUpperCase()}`;
}

export const browseUrl = (site: string, key: string): string => `${site.replace(/\/+$/, "")}/browse/${key}`;

/** `<site-host>:<projectKey>`, the scope XTRM-814 records on a Jira binding. */
export function remoteScope(site: string, project: string): string | null {
  try {
    return `${new URL(site).host}:${project}`;
  } catch {
    return null;
  }
}

/**
 * The `Authorization` header for one request, read from the file the binding names. Supported
 * shapes: a ready `Bearer …`/`Basic …` value, a JSON object `{ email, token }` (Jira Cloud API
 * token -> Basic), `{ token }` (Bearer), or a plain token string. A plain token is paired with
 * `operatorEmail` as Jira Cloud's `Basic base64(email:token)`; without an email it stays Bearer,
 * the shape a Jira Server/DC personal access token needs. Absent or unreadable means "no
 * credential", never a guess.
 */
export function readJiraAuth(
  path: string | null,
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
  operatorEmail: string | null = null,
): { header: string } | null {
  if (!path) return null;
  let raw: string;
  try {
    raw = read(path).trim();
  } catch {
    return null;
  }
  if (raw.length === 0) return null;
  if (/^(Bearer|Basic)\s+\S+$/i.test(raw)) return { header: raw };
  const pairedEmail = str(typeof operatorEmail === "string" ? operatorEmail.trim() : null, 320);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const object = parsed as Record<string, unknown>;
      const token = str(object["token"], 4000) ?? str(object["api_token"], 4000);
      const email = str(object["email"], 320);
      if (!token) return null;
      return { header: email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}` };
    }
  } catch {
    // A plain token file is the normal shape; the whole value is the token.
  }
  return pairedEmail ? { header: `Basic ${Buffer.from(`${pairedEmail}:${raw}`).toString("base64")}` } : { header: `Bearer ${raw}` };
}

/**
 * The email a plain Jira Cloud API token is paired with, from the project-management config the
 * binding already reads: `projects.<name>.operator_email` overrides `defaults.operator_email`,
 * exactly as the pack's `pm_config` merges a project entry over `defaults`. Null when the config
 * names none, so the caller keeps the Bearer shape instead of pairing the token with an invented
 * identity.
 */
export function operatorEmailOf(config: PmConfig | null, pmProject: string | null): string | null {
  const projects = config?.projects ?? {};
  const defaults = config?.defaults ?? {};
  return str(projects[pmProject ?? ""]?.["operator_email"], 320) ?? str(defaults["operator_email"], 320);
}

/** Map a configured repository binding onto the Jira facts a caller may see. */
export function jiraBindingOf(binding: BoardBinding, credentialPresent: boolean): JiraBinding {
  const rawSite = str(binding.jira.site);
  const rawProject = str(binding.jira.project);
  // Both values reach the upstream call, so both are checked here: the site must be https (a
  // credential must never travel in plaintext) and the project must be one token (it lands in the
  // JQL template). Present-but-unusable is a config error, absent is "not configured".
  const site = httpsSiteOf(rawSite);
  const project = rawProject !== null && JIRA_PROJECT_RE.test(rawProject) ? rawProject : null;
  const reason: JiraMissingReason | null = !binding.configured
    ? binding.configPresent
      ? "repo_not_bound"
      : "config_absent"
    : rawSite === null || rawProject === null
      ? "jira_not_configured"
      : site === null || project === null
        ? "jira_invalid_config"
        : null;
  return {
    repository: binding.repository,
    configured: reason === null,
    reason,
    resolvedBy: binding.resolvedBy,
    pmProject: binding.pmProject,
    substrateProject: binding.substrateProjectId,
    site: reason === null ? site : null,
    project: reason === null ? project : null,
    boardId: str(binding.jira.boardId),
    tokenFile: str(binding.jira.tokenFile),
    credentialPresent: reason === null && credentialPresent,
  };
}

export interface JiraBindingJoin {
  issueRef: string;
  syncState: string | null;
  url: string | null;
}

/** One `sb external list` page: the rows it carried and whether it stopped at a limit. */
export interface ExternalBindingsPage {
  rows: Map<string, JiraBindingJoin>;
  /** `sb` said the answer was cut short: a key absent from `rows` is unknown, not unbound. */
  truncated: boolean;
}

/**
 * `sb external list --json` envelope -> `remoteKey -> binding` plus its truncation flag. Returns
 * null when the envelope is not a successful substrate-cli/v1 answer, so the caller can say
 * "bindings unavailable" instead of "unbound": a failed read is not evidence that no Jira link
 * exists.
 */
export function parseExternalBindings(raw: string): ExternalBindingsPage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope["schema"] !== "substrate-cli/v1" || envelope["ok"] !== true) return null;
  const data = envelope["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rows = (data as Record<string, unknown>)["bindings"];
  if (!Array.isArray(rows)) return null;
  const out = new Map<string, JiraBindingJoin>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const remoteKey = str(record["remoteKey"], 100);
    const issueRef = str(record["issue"], 100);
    if (!remoteKey || !issueRef || !JIRA_KEY_RE.test(remoteKey)) continue;
    out.set(remoteKey, { issueRef, syncState: str(record["syncState"], 40), url: str(record["url"], 400) });
  }
  return { rows: out, truncated: (data as Record<string, unknown>)["truncated"] === true };
}

/** One upstream Jira issue row -> the typed view, before the Substrate join. */
export interface JiraIssueFields {
  key: string;
  summary: string | null;
  status: string | null;
  assignee: string | null;
}

export function parseIssueRow(raw: unknown): JiraIssueFields | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const key = str(row["key"], 100);
  if (!key || !JIRA_KEY_RE.test(key)) return null;
  const fields = row["fields"] && typeof row["fields"] === "object" && !Array.isArray(row["fields"]) ? (row["fields"] as Record<string, unknown>) : {};
  const status = fields["status"] && typeof fields["status"] === "object" ? str((fields["status"] as Record<string, unknown>)["name"], 120) : null;
  const assigneeRow = fields["assignee"] && typeof fields["assignee"] === "object" ? (fields["assignee"] as Record<string, unknown>) : null;
  const assignee = assigneeRow ? (str(assigneeRow["displayName"], 200) ?? str(assigneeRow["emailAddress"], 200) ?? str(assigneeRow["accountId"], 200)) : null;
  return { key, summary: str(fields["summary"], 2000), status, assignee };
}

/** A Jira search answer -> issue rows. `isLast`/`nextPageToken` decide the truncation flag. */
export function parseSearch(raw: unknown): { rows: JiraIssueFields[]; truncated: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body["issues"])) return null;
  const rows: JiraIssueFields[] = [];
  for (const item of body["issues"]) {
    const row = parseIssueRow(item);
    if (row) rows.push(row);
  }
  const isLast = body["isLast"];
  const truncated = typeof isLast === "boolean" ? !isLast : Boolean(str(body["nextPageToken"], 400));
  return { rows, truncated };
}

/** `sb external list` for one bound scope. Injected so a test needs no sb binary. */
export type ExternalListRun = (argv: string[]) => Promise<{ status: number; body: string }>;

/** Runs one binary and reports its stdout; injected so a test needs no real `sb`. */
export type SbExec = (bin: string, argv: string[], done: (error: Error | null, stdout: string) => void) => void;

const defaultExec: SbExec = (bin, argv, done) => {
  execFile(bin, argv, { timeout: UPSTREAM_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => done(error, stdout ?? ""));
};

/**
 * `sb`'s own global flags, exactly as `substrateCliApi` builds them (`server/substrate-cli.ts`):
 * `--db` before the subcommand, then `--json`. Without this the join would read the default
 * database while the rest of the console reads `XTRM_SB_DB`, and the two would disagree.
 */
export const externalListArgv = (argv: string[], db: string | undefined): string[] => [...(db ? ["--db", db] : []), "--json", ...argv];

/**
 * The `sb` binary and database the binding join uses. Resolved like `substrateCliApi`: explicit
 * option, then `XTRM_SB_BIN`/`XTRM_SB_DB`, then PATH. A deployed console therefore joins with the
 * same `sb` and database its other panels read.
 */
export function resolveSbJoin(
  opts: { sbBin?: string; sbDb?: string },
  env: NodeJS.ProcessEnv = process.env,
): { bin: string; db: string | undefined } {
  return { bin: resolveSbBin(opts.sbBin ?? env.XTRM_SB_BIN ?? "sb"), db: opts.sbDb ?? (env.XTRM_SB_DB || undefined) };
}

function defaultRunExternal(bin: string, db: string | undefined, exec: SbExec): ExternalListRun {
  return (argv) =>
    new Promise((resolve) => {
      exec(bin, externalListArgv(argv, db), (_error, stdout) => {
        const body = (stdout ?? "").trim();
        if (body.startsWith("{")) return resolve({ status: 200, body });
        resolve({ status: 502, body: "" });
      });
    });
}

export interface JiraApiOptions {
  configPath?: string;
  prefix?: string;
  fetchImpl?: typeof fetch;
  /** The `sb` binary the binding join uses; defaults to `XTRM_SB_BIN`, resolved like the substrate bridge. */
  sbBin?: string;
  /** The `sb` database the binding join reads; defaults to `XTRM_SB_DB`, as the substrate bridge does. */
  sbDb?: string;
  runExternal?: ExternalListRun;
  /** The process runner behind the default `runExternal`; injected so a test can see the real argv. */
  execSb?: SbExec;
  now?: () => number;
  readFile?: (path: string) => string;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const unboundBody = (binding: JiraBinding) => ({
  ok: false,
  configured: false,
  reason: binding.reason,
  repository: binding.repository,
  resolvedBy: binding.resolvedBy,
});

/** An internal answer carrying the bridge status and its generic message. */
class JiraStatus extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JiraStatus";
    this.status = status;
  }
}

/** What the binding join knows: the rows it resolved, and whether it answered for every key. */
interface JoinState {
  rows: Map<string, JiraBindingJoin>;
  complete: boolean;
  reason: JiraBindingsReason | null;
}

export function jiraApi(opts: JiraApiOptions = {}): Plugin {
  const prefix = opts.prefix ?? PREFIX;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = loadPmConfig(configPath);
  if (!config) console.log(`[jira bridge] no project-management config at ${configPath}: every repository is unconfigured`);
  const doFetch = opts.fetchImpl ?? fetch;
  const sbJoin = resolveSbJoin(opts);
  const runExternal = opts.runExternal ?? defaultRunExternal(sbJoin.bin, sbJoin.db, opts.execSb ?? defaultExec);
  const now = opts.now ?? Date.now;
  const readFile = opts.readFile;

  // A read is answered from here for at most CACHE_MS. Only successes are stored: a failure is
  // the condition most likely to be fixed next, so caching it would outlive its cause.
  const cache = new Map<string, { at: number; value: unknown }>();
  const cached = async <T>(key: string, load: () => Promise<T>, cacheable: (value: T) => boolean = () => true): Promise<{ value: T; cachedAt: string }> => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return { value: hit.value as T, cachedAt: new Date(hit.at).toISOString() };
    if (hit) cache.delete(key);
    const value = await load();
    const at = now();
    if (!cacheable(value)) return { value, cachedAt: new Date(at).toISOString() };
    for (const [entry, row] of cache) if (at - row.at >= CACHE_MS) cache.delete(entry);
    cache.set(key, { at, value });
    return { value, cachedAt: new Date(at).toISOString() };
  };

  const bindingFor = (repository: string): JiraBinding => {
    const binding = resolveBinding(config, repository, { configPath });
    const credential = readJiraAuth(binding.jira.tokenFile, readFile, operatorEmailOf(config, binding.pmProject));
    return jiraBindingOf(binding, credential !== null);
  };

  // The email is an identity, not a credential the caller may see: it reaches the header builder
  // only, never `JiraBinding`, a response, or a log line.
  const authFor = (binding: JiraBinding): { header: string } | null =>
    binding.tokenFile ? readJiraAuth(binding.tokenFile, readFile, operatorEmailOf(config, binding.pmProject)) : null;

  /** GET one Jira URL with the per-request credential. Never logs or returns the header. */
  const upstream = async (url: URL, auth: { header: string }): Promise<{ status: number; body: unknown }> => {
    let response: Response;
    try {
      response = await doFetch(url, { headers: { authorization: auth.header, accept: "application/json" }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch {
      throw new Error("jira read failed");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  };

  /**
   * The join with Substrate bindings (XTRM-814). `complete: false` means "could not answer for every
   * key", never "no links": a truncated page, a failed read and a missing Substrate Project all
   * leave a key's state unknown, and an unknown state is not reported as unbound.
   */
  const bindingsFor = async (binding: JiraBinding): Promise<JoinState> => {
    const unavailable = (reason: JiraBindingsReason): JoinState => ({ rows: new Map(), complete: false, reason });
    const site = binding.site;
    const project = binding.project;
    const substrateProject = binding.substrateProject;
    if (!site || !project) return unavailable("sb_project_missing");
    // Without the bound Substrate Project the read would answer from the ambient one (the Vite
    // process's git root or SUBSTRATE_PROJECT), i.e. from another Project's bindings: that is
    // unknown data, not an unbound answer, so the list is not run at all.
    if (!substrateProject) return unavailable("sb_project_missing");
    const scope = remoteScope(site, project);
    if (!scope) return unavailable("sb_unavailable");
    const key = `bindings:${scope}:${substrateProject}`;
    try {
      const { value } = await cached(
        key,
        async () => {
          const argv = [
            "external",
            "list",
            "--provider",
            "jira",
            "--scope",
            scope,
            "--project",
            substrateProject,
            "--limit",
            String(EXTERNAL_LIST_LIMIT),
          ] satisfies string[];
          const result = await runExternal(argv);
          if (result.status !== 200) return unavailable("sb_unavailable");
          const page = parseExternalBindings(result.body);
          if (!page) return unavailable("sb_unavailable");
          // A truncated page cannot answer for the keys it did not carry: those stay unknown.
          if (page.truncated) return { rows: page.rows, complete: false, reason: "sb_truncated" } satisfies JoinState;
          return { rows: page.rows, complete: true, reason: null } satisfies JoinState;
        },
        // An incomplete answer is the condition most likely to be fixed next; it is not cached.
        (value) => value.reason === null,
      );
      return value;
    } catch {
      return unavailable("sb_unavailable");
    }
  };

  const withJoin = (row: JiraIssueFields, binding: JiraBinding, join: JoinState): JiraIssue => {
    const linked = join.rows.get(row.key) ?? null;
    return {
      key: row.key,
      summary: row.summary,
      status: row.status,
      assignee: row.assignee,
      url: browseUrl(binding.site ?? "", row.key),
      syncState: linked?.syncState ?? null,
      issueRef: linked?.issueRef ?? null,
      // Known when the read was complete (an absent binding is a real "unbound") or when this key
      // came back; unknown otherwise, so a null state never reads as "unbound".
      bindingsAvailable: linked !== null || join.complete,
    };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "jira bridge is read-only" });
    const path = url.pathname.slice(prefix.length);
    const repository = normaliseRepo(url.searchParams.get("repo"));
    if (!repository) return json(res, 400, { ok: false, error: "expected ?repo=<owner>/<name>" });

    const binding = bindingFor(repository);
    // Unusable config is a deployment fault, not an unbound repository: 503 before any upstream
    // call, so an invalid project key never reaches the JQL template or a credential a request.
    if (binding.reason === "jira_invalid_config") {
      return json(res, 503, { ok: false, configured: false, reason: binding.reason, error: "jira binding config is unusable", repository, resolvedBy: binding.resolvedBy });
    }
    if (!binding.configured) return json(res, 404, unboundBody(binding));
    if (path === "/binding") return json(res, 200, { ok: true, binding });

    // Route shapes first: a malformed request must not learn whether a credential exists.
    const key = url.searchParams.get("key");
    const keys = parseKeys(url.searchParams.get("keys"));
    if (path === "/issue" && (!key || !JIRA_KEY_RE.test(key))) return json(res, 400, { ok: false, error: "expected ?key=PROJECT-123" });
    if (path === "/links" && keys === null) return json(res, 400, { ok: false, error: `expected ?keys=PROJECT-1,... (max ${MAX_KEYS})` });
    if (path === "/search" && !acceptsJqlGuard(url.searchParams.get("jql"), binding.project ?? "")) {
      return json(res, 400, { ok: false, error: "jql is not supported: the search is always restricted to the bound project" });
    }
    if (path !== "/issue" && path !== "/links" && path !== "/search") return json(res, 404, { ok: false, error: "unsupported jira read" });

    // A key from another project is not this binding's data: refuse before any upstream call.
    const outside = (candidate: string): boolean => keyProject(candidate) !== binding.project;
    if (path === "/issue" && outside(key!)) return json(res, 403, { ok: false, error: "issue key is outside the bound jira project" });
    if (path === "/links" && keys!.some(outside)) return json(res, 403, { ok: false, error: "every key must belong to the bound jira project" });

    const auth = authFor(binding);
    if (!auth) return json(res, 503, { ok: false, error: "jira credential unavailable", binding });

    const site = binding.site!;
    const cacheKey = path === "/issue" ? `issue:${site}:${key}` : path === "/links" ? `links:${site}:${keys!.join(",")}` : `search:${site}:${binding.project}`;
    try {
      const { value, cachedAt } = await cached(cacheKey, async () => {
        if (path === "/issue") {
          const target = new URL(`${ISSUE_PATH}/${key}`, site);
          target.searchParams.set("fields", FIELDS);
          const answer = await upstream(target, auth);
          if (answer.status === 404) throw new JiraStatus(404, "jira issue not found");
          if (answer.status === 401 || answer.status === 403) throw new JiraStatus(502, "jira rejected the credential");
          if (answer.status < 200 || answer.status >= 300) throw new JiraStatus(502, "jira read failed");
          const row = parseIssueRow(answer.body);
          if (!row) throw new JiraStatus(502, "jira returned an unexpected issue");
          return { rows: [row], truncated: false };
        }
        const target = new URL(SEARCH_PATH, site);
        target.searchParams.set("jql", path === "/links" ? keysJql(keys!) : projectJql(binding.project!));
        target.searchParams.set("fields", FIELDS);
        target.searchParams.set("maxResults", String(path === "/links" ? Math.min(keys!.length, MAX_RESULTS) : MAX_RESULTS));
        const answer = await upstream(target, auth);
        if (answer.status === 401 || answer.status === 403) throw new JiraStatus(502, "jira rejected the credential");
        if (answer.status < 200 || answer.status >= 300) throw new JiraStatus(502, "jira read failed");
        const parsed = parseSearch(answer.body);
        if (!parsed) throw new JiraStatus(502, "jira returned an unexpected search answer");
        return parsed;
      });
      const join = await bindingsFor(binding);
      const issues = value.rows.map((row) => withJoin(row, binding, join));
      if (path === "/issue") return json(res, 200, { ok: true, issue: issues[0], bindingsAvailable: join.complete, bindingsReason: join.reason, cachedAt });
      if (path === "/links") return json(res, 200, { ok: true, links: issues, bindingsAvailable: join.complete, bindingsReason: join.reason, cachedAt });
      return json(res, 200, { ok: true, issues, truncated: value.truncated, bindingsAvailable: join.complete, bindingsReason: join.reason, cachedAt });
    } catch (error) {
      if (error instanceof JiraStatus) return json(res, error.status, { ok: false, error: error.message });
      return json(res, 502, { ok: false, error: "jira read failed" });
    }
  };

  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    handle(req, res, next).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, 500, { ok: false, error: error instanceof Error ? "jira bridge failed" : "jira bridge failed" });
    });
  };

  return {
    name: "xtrm-jira",
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  };
}
