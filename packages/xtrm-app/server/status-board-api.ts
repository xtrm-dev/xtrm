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
  /** The file this binding was resolved from, so an error names the file actually read. */
  configPath: string;
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
  opts: { explicit?: string | null; env?: NodeJS.ProcessEnv; configPath?: string } = {},
): BoardBinding {
  const env = opts.env ?? process.env;
  const configPath = opts.configPath ?? defaultConfigPath(env);
  const defaults = config?.defaults ?? {};
  const projects = config?.projects ?? {};
  const base = (pmProject: string | null, resolvedBy: BoardBinding["resolvedBy"]): BoardBinding => ({
    repository,
    configured: pmProject !== null,
    configPresent: config !== null,
    configPath,
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

  // A `projects` entry can be `null` or a non-object in a hand-edited file. Such an
  // entry must degrade its own repository, never throw: this runs inside a preview
  // middleware whose rejection would exit the process (see `serve`).
  const entries = Object.entries(projects as Record<string, Record<string, unknown> | null | undefined>).filter(
    (entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]) && typeof entry[1] === "object",
  );
  const wanted = repository.toLowerCase();
  for (const [name, project] of entries) {
    const slug = str(project.repo_slug);
    if (slug && slug.toLowerCase() === wanted) return base(name, "repo_slug");
  }
  for (const [name, project] of entries) {
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

export type BoardRecordLookup =
  | { outcome: "found"; record: BoardRecord }
  | { outcome: "absent" }
  | { outcome: "incomplete" };

export type BoardClient = {
  list(prefix: string, opts: { limit: number }): Promise<{ records: BoardRecord[]; truncated: boolean }>;
  record(path: string): Promise<BoardRecordLookup>;
};

/**
 * Minimal client over the documented Owner API. No URL is built from user input:
 * the host is fixed and every path is validated before it reaches the query.
 */
export const UPSTREAM_TIMEOUT_MS = 8_000;

export function createBoardClient(deps: {
  site: string;
  key: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): BoardClient {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const page = async (cursor: string | null): Promise<{ records: BoardRecord[]; next: string | null }> => {
    const url = new URL(`${UPSTREAM}/publishes/${encodeURIComponent(deps.site)}/data/docs`);
    url.searchParams.set("limit", String(UPSTREAM_PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    let res: Response;
    try {
      // A deadline is not optional here: the middleware holds the request open,
      // and the paging loop multiplies one slow answer by MAX_PAGES.
      res = await doFetch(url, {
        headers: { authorization: `Bearer ${deps.key()}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error(`status board read timed out after ${timeoutMs} ms`);
      }
      throw new Error("status board read failed");
    }
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
      // Exiting with a cursor still set means "I stopped looking", not "that is all".
      return { records: out, truncated: cursor !== null };
    },
    async record(path) {
      if (!allowedPath(path)) return { outcome: "absent" };
      let cursor: string | null = null;
      let pages = 0;
      do {
        const { records, next } = await page(cursor);
        const hit = records.find((r) => r.path === path);
        if (hit) return { outcome: "found", record: hit };
        cursor = next;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
      // Exhausting the page budget is inconclusive, never a definite "not found".
      return cursor ? { outcome: "incomplete" } : { outcome: "absent" };
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
    configPath: binding.configPresent ? undefined : binding.configPath,
  };
}

export type UnboundReason = "config_absent" | "repo_not_bound";

/**
 * Why the unit state is unknown. A tri-state `unitActive: null` is "not verified",
 * and publishing it as `false` beside a fresh `lastSyncOkAt` reads as "the sync is down".
 */
export type UnitProbeReason = "unit_not_found" | "probe_timeout" | "non_user_session" | "probe_failed";

export type UnitProbe = {
  /** true = running, false = not running, null = could not determine (see `reason`). */
  active: boolean | null;
  reason: UnitProbeReason | null;
};

/**
 * The sync is a `Type=oneshot` service started by a timer, so `unitActive` alone cannot
 * answer "is the sync alive": between ticks the service is `inactive`, during a run it is
 * `activating`. Health therefore reports the two facts separately and derives `unitActive`
 * from both. Every `null` carries a named reason; none of them means "down".
 */
export type SyncProbe = {
  /** The timer unit that was probed (`<unit>.timer`); null when no unit was configured. */
  timerUnit: string | null;
  /** true = the schedule is armed, false = the timer is inactive or failed, null = unverified. */
  scheduleActive: boolean | null;
  scheduleActiveReason: UnitProbeReason | null;
  /** true = a run is in progress now (a starting oneshot counts), false = not running, null = unverified. */
  runInProgress: boolean | null;
  runInProgressReason: UnitProbeReason | null;
  /** true = armed or running; false = only when the timer is not armed AND no run is in progress. */
  unitActive: boolean | null;
  unitActiveReason: UnitProbeReason | null;
};

/** No probe was run, so every fact is unverified rather than inactive. */
export const NOT_PROBED: SyncProbe = {
  timerUnit: null,
  scheduleActive: null,
  scheduleActiveReason: "probe_failed",
  runInProgress: null,
  runInProgressReason: "probe_failed",
  unitActive: null,
  unitActiveReason: "probe_failed",
};

export type BoardHealth = {
  configured: boolean;
  /** Why the surface has no data: the deployment, or this repository. */
  reason: UnboundReason | null;
  site: string | null;
  stateDir: string | null;
  /** The schedule (timer) is armed. For a timer-driven sync this, not the service, is the signal. */
  scheduleActive: boolean | null;
  /** Set only when `scheduleActive` is null: never "down", just not verified. */
  scheduleActiveReason: UnitProbeReason | null;
  /** A run of the oneshot service is in progress now; `activating` counts as running. */
  runInProgress: boolean | null;
  /** Set only when `runInProgress` is null: never "down", just not verified. */
  runInProgressReason: UnitProbeReason | null;
  /** The timer unit the schedule fact was read from, so a reader can see what was probed. */
  timerUnit: string | null;
  /** Armed or running; `false` only when the timer is not armed AND no run is in progress. */
  unitActive: boolean | null;
  /** Set only when `unitActive` is null: never "down", just not verified. */
  unitActiveReason: UnitProbeReason | null;
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
export function readHealth(binding: BoardBinding, now = Date.now(), probe: SyncProbe = NOT_PROBED): BoardHealth {
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
    scheduleActive: probe.scheduleActive,
    scheduleActiveReason: probe.scheduleActive === null ? (probe.scheduleActiveReason ?? "probe_failed") : null,
    runInProgress: probe.runInProgress,
    runInProgressReason: probe.runInProgress === null ? (probe.runInProgressReason ?? "probe_failed") : null,
    timerUnit: probe.timerUnit,
    unitActive: probe.unitActive,
    unitActiveReason: probe.unitActive === null ? (probe.unitActiveReason ?? "probe_failed") : null,
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

/** Injectable so the probe is testable without a live systemd user session. */
export type UnitProbeRun = (
  command: string,
  args: string[],
  options: { timeout: number },
  callback: (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => void,
) => unknown;

/** The systemd `is-active` answer kept raw: `activating` and `inactive` are different facts. */
type UnitState = { state: string | null; reason: UnitProbeReason | null };

/**
 * One `systemctl --user is-active` call. A missing systemctl, a non-user session, a timeout,
 * or a state we cannot read means "unverified" (a reason, no state), never "not running":
 * a workstation dev server must not report production as down.
 */
function probeState(unit: string | null, run: UnitProbeRun): Promise<UnitState> {
  if (!unit) return Promise.resolve({ state: null, reason: "unit_not_found" });
  return new Promise((resolve) => {
    run("systemctl", ["--user", "is-active", unit], { timeout: 2_000 }, (error, stdout, stderr) => {
      const state = stdout.trim();
      // `is-active` prints `inactive` and exits 4 for a unit that does not exist, with nothing on
      // stderr (verified: systemd 257 on the canonical host). Read the exit code before the state,
      // or a unit nobody installed answers "not armed" instead of "not verified".
      if ((error as { code?: number | string } | null)?.code === 4 || /could not be found|no such unit/i.test(stderr)) {
        return resolve({ state: null, reason: "unit_not_found" });
      }
      if (state === "active" || state === "reloading" || state === "activating" || state === "deactivating") {
        return resolve({ state, reason: null });
      }
      if (state === "inactive" || state === "failed") return resolve({ state, reason: null });
      if (error?.killed) return resolve({ state: null, reason: "probe_timeout" });
      const detail = `${stderr}\n${error?.message ?? ""}`;
      if (/not been booted with systemd|failed to connect to bus|no medium found/i.test(detail)) {
        return resolve({ state: null, reason: "non_user_session" });
      }
      if (/could not be found|no such file|not found/i.test(detail)) {
        return resolve({ state: null, reason: "unit_not_found" });
      }
      // An answer we cannot read as a run state ("unknown", "maintenance"): the
      // unit does not resolve, so it is not evidence that the sync is down.
      if (state) return resolve({ state: null, reason: "unit_not_found" });
      resolve({ state: null, reason: "probe_failed" });
    });
  });
}

/**
 * The service unit's own answer (XTRM-830): true only when systemd reports it running.
 * A starting or stopping unit is `false` here; ask `probeSync` for the run question.
 */
export function probeUnit(unit: string | null, run: UnitProbeRun = execFile): Promise<UnitProbe> {
  return probeState(unit, run).then(({ state, reason }) => {
    if (state === "active" || state === "reloading") return { active: true, reason: null };
    if (state) return { active: false, reason: null };
    return { active: null, reason };
  });
}

/** `status-board-sync.service` → `status-board-sync.timer`: same unit, timer instance. */
export function timerUnitFor(unit: string | null): string | null {
  return unit ? `${unit.replace(/\.[^.]+$/, "")}.timer` : null;
}

/**
 * Ask both questions the timer-driven sync needs: is the schedule armed, and is a run in
 * progress now. They are read separately because a healthy idle oneshot is `inactive` — the
 * state a dead sync also sits in.
 */
export function probeSync(unit: string | null, run: UnitProbeRun = execFile): Promise<SyncProbe> {
  const timerUnit = timerUnitFor(unit);
  return Promise.all([probeState(unit, run), probeState(timerUnit, run)]).then(([service, timer]) => {
    // A timer that is armed, starting or stopping is still scheduled; only inactive/failed is not.
    const scheduleActive = timer.state === null ? null : timer.state !== "inactive" && timer.state !== "failed";
    // `activating` is the oneshot mid-run — the live case where `/health` used to say false.
    const runInProgress =
      service.state === null
        ? null
        : service.state !== "inactive" && service.state !== "failed" && service.state !== "deactivating";
    const unitActive =
      scheduleActive === true || runInProgress === true
        ? true
        : scheduleActive === false && runInProgress === false
          ? false
          : null;
    // Name the fact that made the aggregate unverified: the schedule first, because a timer that
    // could not be read is what the old service-only probe could not tell from a dead sync.
    let unitActiveReason: UnitProbeReason | null = null;
    if (unitActive === null) {
      unitActiveReason =
        scheduleActive === null
          ? (timer.reason ?? service.reason ?? "probe_failed")
          : (service.reason ?? "probe_failed");
    }
    return {
      timerUnit,
      scheduleActive,
      scheduleActiveReason: scheduleActive === null ? (timer.reason ?? "probe_failed") : null,
      runInProgress,
      runInProgressReason: runInProgress === null ? (service.reason ?? "probe_failed") : null,
      unitActive,
      unitActiveReason,
    };
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

  /**
   * Reads are cached for CACHE_MS so a page of surfaces cannot multiply the
   * upstream load. A definite answer ages by up to 60 s (a just-created record
   * can still look absent); an *inconclusive* read is not an answer and must not
   * be cached, or a 502 would outlive the condition that caused it.
   */
  const cached = async <T>(
    key: string,
    load: () => Promise<T>,
    cacheable: (value: T) => boolean = () => true,
  ): Promise<{ value: T; at: number }> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { value: hit.value as T, at: hit.at };
    const value = await load();
    const at = Date.now();
    if (cacheable(value)) cache.set(key, { at, value });
    return { value, at };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "status board bridge is read-only" });
    const path = url.pathname.slice(prefix.length);
    const repository = normaliseRepo(url.searchParams.get("repo"));
    if (!repository) return json(res, 400, { ok: false, error: "expected ?repo=<owner>/<name>" });
    const binding = resolveBinding(config, repository, { explicit: url.searchParams.get("project"), configPath });
    if (!binding.configured) return json(res, 404, unboundBody(binding));

    if (path === "/binding") return json(res, 200, { ok: true, binding: publicBinding(binding, clientFor(binding).keyPresent) });
    if (path === "/health") {
      return json(res, 200, { ok: true, health: readHealth(binding, Date.now(), await probeSync(binding.unit)) });
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
        const { value: result, at } = await cached(key, () => client.list(`${collection}/`, { limit }));
        return json(res, 200, { ok: true, ...result, cachedAt: new Date(at).toISOString() });
      }
      const recordPath = url.searchParams.get("path") ?? "";
      const { value: lookup, at } = await cached(
        `record:${binding.site}:${recordPath}`,
        () => client.record(recordPath),
        (value) => value.outcome !== "incomplete",
      );
      if (lookup.outcome === "absent") return json(res, 404, { ok: false, error: "record not found" });
      if (lookup.outcome === "incomplete") {
        // The page budget ran out before the path could be ruled out: say so, never 404.
        return json(res, 502, {
          ok: false,
          reason: "inconclusive",
          error: "status board record lookup was inconclusive",
        });
      }
      return json(res, 200, { ok: true, record: lookup.record, cachedAt: new Date(at).toISOString() });
    } catch (error) {
      // Generic upstream failure: never echo the credential, the URL, or the body.
      return json(res, 502, { ok: false, error: error instanceof Error ? error.message : "status board read failed" });
    }
  };

  /**
   * Vite registers a middleware synchronously and cannot observe the handler's
   * promise, so a rejection here has no handler. Node's default policy
   * (`--unhandled-rejections=throw`) turns that into a process exit, which a
   * preview server presents as a restart loop. Every rejection is answered.
   */
  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    handle(req, res, next).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, 500, { ok: false, error: error instanceof Error ? error.message : "status board bridge failed" });
    });
  };

  return {
    name: "xtrm-status-board",
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  };
}
