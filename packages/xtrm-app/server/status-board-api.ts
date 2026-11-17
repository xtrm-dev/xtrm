// Dev/preview bridge to the here.now status-board document store.
//
// Why a bridge: the store is private (bearer in `~/.herenow/credentials`) and the
// browser must not hold that credential, and here.now is not a CORS peer of the
// app. The Substrate bridge in this folder solves the same class of problem; this
// file follows its shape (same-origin plugin on the UI port, per-request TTL cache).
//
// Reads only. The board's ownership matrix allows an integrating app to write at
// most `answers/<qid>`, and that write is a later, separately authorised tranche
// (XTRM-811.10). Nothing here reads `~/.xtrm/state.db` or the board's state
// directory contents: health is a small server-derived object.
//
// Binding resolution uses the same file the mechanical sync reads
// (`~/.config/xtrm/project-management.json`), so the board the app reads and the
// board the sync writes cannot diverge by configuration. Each project entry
// carries `repo_slug`, `repo_name`, `sb_project_id`, `status_board_site`,
// `status_board_state_dir`, `status_board_key_file`, `status_board_unit`,
// `jira_project`, `jira_board_id`; `defaults` carries `jira_site`,
// `jira_token_file`, `timezone`, `operator_handle`.

import { readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";

const PREFIX = "/xtrm-api/status-board";
const UPSTREAM = "https://here.now/api/v1";
const CACHE_MS = 60_000;
const UPSTREAM_PAGE = 100;
const MAX_PAGES = 12;
const MAX_RECORDS = 200;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const COLLECTIONS = ["workers", "schedule", "questions", "answers", "followups", "archive", "lanes", "status", "board", "proposals"];
const PATH_RE = new RegExp(`^(${COLLECTIONS.join("|")})/[A-Za-z0-9._-]{1,160}$`);

export type PmConfig = {
  defaults?: Record<string, unknown>;
  projects?: Record<string, Record<string, unknown>>;
};

export type BoardBinding = {
  repository: string;
  configured: boolean;
  /** False when the deployment has no project-management.json at all. */
  configPresent: boolean;
  resolvedBy: "explicit" | "env" | "repo_slug" | "repo_name" | "none";
  pmProject: string | null;
  substrateProjectId: string | null;
  site: string | null;
  stateDir: string | null;
  keyFile: string | null;
  unit: string | null;
  timezone: string;
  jira: { site: string | null; project: string | null; boardId: string | null; tokenFile: string | null };
};

const str = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.XTRM_PM_CONFIG ?? join(homedir(), ".config", "xtrm", "project-management.json");
}

export function loadPmConfig(path: string): PmConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const config = parsed as PmConfig;
    return config.projects && typeof config.projects === "object" ? config : null;
  } catch {
    return null;
  }
}

/** Normalise `owner/name`; reject anything that is not a plain repository slug. */
export function normaliseRepo(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return REPO_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Which `projects.<name>` entry describes this repository. The entry is the
 * authority the sync timer reads, so a match here is a match everywhere.
 * Order: explicit request parameter, env override, `repo_slug`, `repo_name`.
 */
export function resolveBinding(
  config: PmConfig | null,
  repository: string,
  opts: { explicit?: string | null; env?: NodeJS.ProcessEnv } = {},
): BoardBinding {
  const env = opts.env ?? process.env;
  const defaults = config?.defaults ?? {};
  const projects = config?.projects ?? {};
  const base = (pmProject: string | null, resolvedBy: BoardBinding["resolvedBy"]): BoardBinding => ({
    repository,
    configured: pmProject !== null,
    configPresent: config !== null,
    resolvedBy,
    pmProject,
    substrateProjectId: pmProject ? str(projects[pmProject]?.sb_project_id) : null,
    site: pmProject ? str(projects[pmProject]?.status_board_site) : null,
    stateDir: pmProject ? str(projects[pmProject]?.status_board_state_dir, 400) : null,
    keyFile: pmProject ? str(projects[pmProject]?.status_board_key_file, 400) : null,
    unit: pmProject ? str(projects[pmProject]?.status_board_unit) : null,
    timezone: str(projects[pmProject ?? ""]?.timezone) ?? str(defaults.timezone) ?? "UTC",
    jira: {
      site: str(projects[pmProject ?? ""]?.jira_site) ?? str(defaults.jira_site),
      project: str(projects[pmProject ?? ""]?.jira_project),
      boardId: str(projects[pmProject ?? ""]?.jira_board_id),
      tokenFile: str(projects[pmProject ?? ""]?.jira_token_file, 400) ?? str(defaults.jira_token_file, 400),
    },
  });

  const explicit = str(opts.explicit);
  if (explicit && projects[explicit]) return base(explicit, "explicit");
  const fromEnv = str(env.XTRM_PM_PROJECT);
  if (fromEnv && projects[fromEnv]) return base(fromEnv, "env");

  const wanted = repository.toLowerCase();
  for (const [name, project] of Object.entries(projects)) {
    const slug = str(project.repo_slug);
    if (slug && slug.toLowerCase() === wanted) return base(name, "repo_slug");
  }
  for (const [name, project] of Object.entries(projects)) {
    const nameOnly = str(project.repo_name);
    if (nameOnly && `${repository.split("/")[0]}/${nameOnly}`.toLowerCase() === wanted) return base(name, "repo_name");
  }
  return base(null, "none");
}

/** Only the documented collections, only a single flat path segment. */
export function allowedPath(path: string): boolean {
  return PATH_RE.test(path) && !path.includes("..") && !path.includes("//");
}

/** A board document's `doc` arrives as an object or a JSON string; normalise once. */
export function normaliseDoc(doc: unknown): unknown {
  if (typeof doc !== "string") return doc;
  try {
    return JSON.parse(doc);
  } catch {
    return doc;
  }
}

export type BoardRecord = { path: string; id: string | null; updatedAt: string | null; doc: unknown };

type WireRecord = { id?: unknown; data?: { path?: unknown; doc?: unknown }; updatedAt?: unknown };

function toRecord(wire: WireRecord): BoardRecord | null {
  const path = str(wire.data?.path, 200);
  if (!path || !allowedPath(path)) return null;
  return {
    path,
    id: str(wire.id, 120),
    updatedAt: str(wire.updatedAt, 60),
    doc: normaliseDoc(wire.data?.doc),
  };
}

export type BoardClient = {
  list(prefix: string, opts: { limit: number }): Promise<{ records: BoardRecord[]; truncated: boolean }>;
  record(path: string): Promise<BoardRecord | null>;
};

/**
 * Minimal client over the documented Owner API. No URL is built from user input:
 * the host is fixed and every path is validated before it reaches the query.
 */
export function createBoardClient(deps: {
  site: string;
  key: () => string;
  fetchImpl?: typeof fetch;
}): BoardClient {
  const doFetch = deps.fetchImpl ?? fetch;
  const page = async (cursor: string | null): Promise<{ records: BoardRecord[]; next: string | null }> => {
    const url = new URL(`${UPSTREAM}/publishes/${encodeURIComponent(deps.site)}/data/docs`);
    url.searchParams.set("limit", String(UPSTREAM_PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await doFetch(url, { headers: { authorization: `Bearer ${deps.key()}` } });
    if (!res.ok) throw new Error(`status board read failed (${res.status})`);
    const body = (await res.json()) as { data?: unknown; records?: unknown; nextCursor?: unknown };
    const raw = Array.isArray(body.records) ? body.records : Array.isArray(body.data) ? body.data : [];
    const records = raw.map((r) => toRecord(r as WireRecord)).filter((r): r is BoardRecord => r !== null);
    return { records, next: str(body.nextCursor, 400) };
  };

  return {
    async list(prefix, { limit }) {
      const cap = Math.min(Math.max(limit, 1), MAX_RECORDS);
      const out: BoardRecord[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const { records, next } = await page(cursor);
        for (const record of records) {
          if (record.path.startsWith(prefix)) out.push(record);
          if (out.length >= cap) return { records: out.slice(0, cap), truncated: true };
        }
        cursor = next;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
      return { records: out, truncated: false };
    },
    async record(path) {
      if (!allowedPath(path)) return null;
      let cursor: string | null = null;
      let pages = 0;
      do {
        const { records, next } = await page(cursor);
        const hit = records.find((r) => r.path === path);
        if (hit) return hit;
        cursor = next;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
      return null;
    },
  };
}

/** The 404 body. `reason` separates a deployment with no config from a repo with no entry. */
export function unboundBody(binding: BoardBinding) {
  return {
    ok: false,
    configured: false,
    reason: (binding.configPresent ? "repo_not_bound" : "config_absent") as UnboundReason,
    repository: binding.repository,
    resolvedBy: binding.resolvedBy,
    configPath: binding.configPresent ? undefined : defaultConfigPath(),
  };
}

export type UnboundReason = "config_absent" | "repo_not_bound";

export type BoardHealth = {
  configured: boolean;
  /** Why the surface has no data: the deployment, or this repository. */
  reason: UnboundReason | null;
  site: string | null;
  stateDir: string | null;
  unitActive: boolean | null;
  lastSyncOkAt: string | null;
  driftCount: number | null;
  stale: boolean;
  checkedAt: string;
};

/**
 * Health is derived, never trusted from the board. `state.json` mtime is the last
 * successful sync marker the sync itself writes; `drift.jsonl` line count is the
 * open drift set. Missing files mean "unknown", not "zero".
 */
export function readHealth(binding: BoardBinding, now = Date.now(), unitActive: boolean | null = null): BoardHealth {
  let lastSyncOkAt: string | null = null;
  let driftCount: number | null = null;
  if (binding.stateDir) {
    try {
      lastSyncOkAt = new Date(statSync(join(binding.stateDir, "state.json")).mtimeMs).toISOString();
    } catch {
      lastSyncOkAt = null;
    }
    try {
      const lines = readFileSync(join(binding.stateDir, "drift.jsonl"), "utf8").split("\n").filter((l) => l.trim().length > 0);
      driftCount = lines.length;
    } catch {
      driftCount = null;
    }
  }
  const ageMs = lastSyncOkAt ? now - Date.parse(lastSyncOkAt) : Number.POSITIVE_INFINITY;
  return {
    configured: binding.configured,
    reason: binding.configured ? null : binding.configPresent ? "repo_not_bound" : "config_absent",
    site: binding.site,
    stateDir: binding.stateDir,
    unitActive,
    lastSyncOkAt,
    driftCount,
    stale: binding.configured ? ageMs > 60 * 60_000 : false,
    checkedAt: new Date(now).toISOString(),
  };
}

function readKey(path: string | null): string | null {
  if (!path) return null;
  try {
    const value = readFileSync(path, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Public view of a binding: identity and file *paths*, never credential values. */
export function publicBinding(binding: BoardBinding, keyPresent: boolean) {
  return {
    repository: binding.repository,
    configured: binding.configured,
    resolvedBy: binding.resolvedBy,
    pmProject: binding.pmProject,
    substrateProjectId: binding.substrateProjectId,
    configPresent: binding.configPresent,
    site: binding.site,
    stateDir: binding.stateDir,
    keyFile: binding.keyFile,
    keyPresent,
    unit: binding.unit,
    timezone: binding.timezone,
    jira: binding.jira,
  };
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * The sync is a systemd user unit on the host that runs the app. A missing
 * systemctl, a non-user session, or a timeout means "unknown" (null), never
 * "inactive": a workstation dev server must not report production as down.
 */
export function probeUnit(unit: string | null): Promise<boolean | null> {
  if (!unit) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("systemctl", ["--user", "is-active", unit], { timeout: 2_000 }, (error, stdout) => {
      const state = stdout.trim();
      if (state === "active") return resolve(true);
      if (state === "inactive" || state === "failed" || state === "activating") return resolve(false);
      resolve(error && !state ? null : state ? false : null);
    });
  });
}

export function statusBoardApi(opts: { configPath?: string; prefix?: string; fetchImpl?: typeof fetch } = {}): Plugin {
  const prefix = opts.prefix ?? PREFIX;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = loadPmConfig(configPath);
  if (!config) console.log(`[status-board bridge] no project-management config at ${configPath}: every repository is unconfigured`);
  const clients = new Map<string, { key: string; client: BoardClient }>();
  const cache = new Map<string, { at: number; value: unknown }>();

  const clientFor = (binding: BoardBinding): { client: BoardClient | null; keyPresent: boolean } => {
    if (!binding.site) return { client: null, keyPresent: false };
    const key = readKey(binding.keyFile);
    if (!key) return { client: null, keyPresent: false };
    const existing = clients.get(binding.site);
    if (existing && existing.key === key) return { client: existing.client, keyPresent: true };
    const client = createBoardClient({ site: binding.site, key: () => key, fetchImpl: opts.fetchImpl });
    clients.set(binding.site, { key, client });
    return { client, keyPresent: true };
  };

  const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "status board bridge is read-only" });
    const path = url.pathname.slice(prefix.length);
    const repository = normaliseRepo(url.searchParams.get("repo"));
    if (!repository) return json(res, 400, { ok: false, error: "expected ?repo=<owner>/<name>" });
    const binding = resolveBinding(config, repository, { explicit: url.searchParams.get("project") });
    if (!binding.configured) return json(res, 404, unboundBody(binding));

    if (path === "/binding") return json(res, 200, { ok: true, binding: publicBinding(binding, clientFor(binding).keyPresent) });
    if (path === "/health") {
      return json(res, 200, { ok: true, health: readHealth(binding, Date.now(), await probeUnit(binding.unit)) });
    }

    // Validate the request shape before the credential check: a malformed path
    // must not learn whether a credential exists, and must never reach upstream.
    if (path === "/list") {
      const collection = (url.searchParams.get("prefix") ?? "").replace(/\/$/, "");
      if (!COLLECTIONS.includes(collection)) return json(res, 400, { ok: false, error: "unknown collection" });
      const limit = Number(url.searchParams.get("limit") ?? 200);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS) return json(res, 400, { ok: false, error: "limit must be 1..200" });
    } else if (path === "/record") {
      const recordPath = url.searchParams.get("path") ?? "";
      if (!allowedPath(recordPath)) return json(res, 400, { ok: false, error: "unsupported record path" });
    } else {
      return json(res, 400, { ok: false, error: "unsupported status board read" });
    }

    const { client } = clientFor(binding);
    if (!client) return json(res, 503, { ok: false, error: "status board credential unavailable", binding: publicBinding(binding, false) });

    try {
      if (path === "/list") {
        const collection = (url.searchParams.get("prefix") ?? "").replace(/\/$/, "");
        const limit = Number(url.searchParams.get("limit") ?? 200);
        const key = `list:${binding.site}:${collection}:${limit}`;
        const result = await cached(key, () => client.list(`${collection}/`, { limit }));
        return json(res, 200, { ok: true, ...result, cachedAt: new Date().toISOString() });
      }
      const recordPath = url.searchParams.get("path") ?? "";
      const record = await cached(`record:${binding.site}:${recordPath}`, () => client.record(recordPath));
      if (!record) return json(res, 404, { ok: false, error: "record not found" });
      return json(res, 200, { ok: true, record, cachedAt: new Date().toISOString() });
    } catch (error) {
      // Generic upstream failure: never echo the credential, the URL, or the body.
      return json(res, 502, { ok: false, error: error instanceof Error ? error.message : "status board read failed" });
    }
  };

  return {
    name: "xtrm-status-board",
    configureServer: (server) => void server.middlewares.use((req, res, next) => void handle(req, res, next)),
    configurePreviewServer: (server) => void server.middlewares.use((req, res, next) => void handle(req, res, next)),
  };
}
