import {
  SCHEDULE_EVENT_KINDS,
  StatusBoardError,
  type Answer,
  type BoardGap,
  type BoardNext,
  type BoardPage,
  type BoardRecord,
  type FollowUp,
  type ProjectBinding,
  type ProjectHealth,
  type Proposal,
  type Question,
  type ResolvedBy,
  type ScheduleEvent,
  type StatusBoardAdapter,
  type StatusRow,
  type UnitProbeReason,
  type UnboundReason,
  type Worker,
} from "./types.ts";

// Wire shapes of the status-board bridge (server/status-board-api.ts). Only the fields read here.
// No URL is built from user input: the bridge owns the upstream host and validates every path.

export interface WireBinding {
  repository: string;
  configured: boolean;
  reason: string | null;
  resolvedBy: string;
  pmProject: string | null;
  substrateProjectId: string | null;
  configPresent: boolean;
  site: string | null;
  stateDir: string | null;
  keyFile: string | null;
  keyPresent: boolean;
  unit: string | null;
  timezone: string;
  jira: { site: string | null; project: string | null; boardId: string | null; tokenFile: string | null };
}

export interface WireHealth {
  configured: boolean;
  reason: string | null;
  site: string | null;
  stateDir: string | null;
  scheduleActive: boolean | null;
  scheduleActiveReason: string | null;
  runInProgress: boolean | null;
  runInProgressReason: string | null;
  timerUnit: string | null;
  unitActive: boolean | null;
  unitActiveReason: string | null;
  lastSyncOkAt: string | null;
  driftCount: number | null;
  stale: boolean;
  checkedAt: string;
}

export interface WireRecord {
  path: string;
  id: string | null;
  updatedAt: string | null;
  doc: unknown;
}

export interface WireListBody {
  ok: boolean;
  records: WireRecord[];
  truncated: boolean;
  cachedAt: string | null;
}

export interface WireRecordBody {
  ok: boolean;
  record: WireRecord;
  cachedAt: string | null;
}

export type Mapped<T> = { value: T; gaps: BoardGap[] };

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value : undefined);

const numeric = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return items.length > 0 ? items : undefined;
};

const boolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/**
 * A declared field the board carried in an unusable type (a number where a status belongs). The
 * value is preserved nowhere it would be coerced into text, and the gap says so instead of the
 * field silently disappearing as "absent".
 */
const flagUnusable = (gaps: BoardGap[], path: string, source: Record<string, unknown> | null, fields: readonly string[]): void => {
  for (const field of fields) {
    const raw = source?.[field];
    if (raw === undefined || raw === null || typeof raw === "string") continue;
    gaps.push({ path, field, value: typeof raw === "object" ? JSON.stringify(raw) : String(raw) });
  }
};

/** The last path segment is the record's own name/key (`workers/<name>`, `answers/<qid>`). */
export const segment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const objectOf = (doc: unknown): Record<string, unknown> | null =>
  doc !== null && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;

const RESOLVED_BY: readonly ResolvedBy[] = ["explicit", "env", "repo_slug", "repo_name", "none"];
const UNBOUND_REASONS: readonly UnboundReason[] = ["config_absent", "repo_not_bound"];
const PROBE_REASONS: readonly UnitProbeReason[] = ["unit_not_found", "probe_timeout", "non_user_session", "probe_failed"];

const resolvedByOf = (value: unknown): ResolvedBy => (typeof value === "string" && (RESOLVED_BY as readonly string[]).includes(value) ? (value as ResolvedBy) : "none");
const unboundReasonOf = (value: unknown): UnboundReason | null => (typeof value === "string" && (UNBOUND_REASONS as readonly string[]).includes(value) ? (value as UnboundReason) : null);
const probeReasonOf = (value: unknown): UnitProbeReason | null => (typeof value === "string" && (PROBE_REASONS as readonly string[]).includes(value) ? (value as UnitProbeReason) : null);

/**
 * A board document's `doc` may arrive as an object or as a JSON string (the store's own shape). The
 * bridge normalises it; the adapter normalises again so a direct wire read, a fixture, or a future
 * bridge cannot leak a string where every component expects a record. Unparseable is a gap, never a
 * silent `{}` that reads like an empty record.
 */
export function normaliseDoc(path: string, raw: unknown): { doc: unknown; gap: BoardGap | null } {
  if (typeof raw !== "string") return { doc: raw, gap: null };
  try {
    return { doc: JSON.parse(raw), gap: null };
  } catch {
    return { doc: {}, gap: { path, field: "doc", value: "unparseable json" } };
  }
}

export function mapBinding(wire: WireBinding): ProjectBinding {
  return {
    repository: wire.repository,
    configured: wire.configured,
    reason: wire.configured ? null : unboundReasonOf(wire.reason),
    resolvedBy: resolvedByOf(wire.resolvedBy),
    pmProject: text(wire.pmProject) ?? null,
    substrateProject: text(wire.substrateProjectId) ?? null,
    statusBoard: wire.configured
      ? {
          site: text(wire.site) ?? null,
          stateDir: text(wire.stateDir) ?? null,
          timezone: text(wire.timezone) ?? "UTC",
          keyFile: text(wire.keyFile) ?? null,
          keyPresent: wire.keyPresent === true,
        }
      : null,
    jira: wire.jira && (text(wire.jira.site) || text(wire.jira.project)) ? { site: text(wire.jira.site) ?? null, project: text(wire.jira.project) ?? null } : null,
  };
}

export function mapHealth(wire: WireHealth): ProjectHealth {
  return {
    configured: wire.configured,
    reason: wire.configured ? null : unboundReasonOf(wire.reason),
    lastSyncOkAt: text(wire.lastSyncOkAt) ?? null,
    driftCount: numeric(wire.driftCount) ?? null,
    unitActive: boolean(wire.unitActive),
    unitActiveReason: wire.unitActive === null ? probeReasonOf(wire.unitActiveReason) : null,
    timerUnit: text(wire.timerUnit) ?? null,
    scheduleActive: boolean(wire.scheduleActive),
    scheduleActiveReason: wire.scheduleActive === null ? probeReasonOf(wire.scheduleActiveReason) : null,
    runInProgress: boolean(wire.runInProgress),
    runInProgressReason: wire.runInProgress === null ? probeReasonOf(wire.runInProgressReason) : null,
    stale: wire.stale === true,
    checkedAt: wire.checkedAt,
  };
}

export const recordOf = <T>(wire: WireRecord, doc: T): BoardRecord<T> => ({
  path: wire.path,
  id: text(wire.id) ?? null,
  // The bridge does not return the store's created time; it is never invented.
  createdAt: null,
  updatedAt: text(wire.updatedAt) ?? null,
  doc,
});

/** `workers/<name>`: the name is the record's path segment when the document omits it. */
export function mapWorker(wire: WireRecord): Mapped<Worker> {
  const { doc, gap } = normaliseDoc(wire.path, wire.doc);
  const source = objectOf(doc);
  const gaps: BoardGap[] = gap ? [gap] : [];
  // The contract declares no closed worker status vocabulary, so a status string is preserved and
  // never flagged; only a value that is not a string is a gap.
  flagUnusable(gaps, wire.path, source, ["name", "kind", "status"]);
  const worker: Worker = { name: text(source?.["name"]) ?? segment(wire.path) };
  const kind = text(source?.["kind"]);
  if (kind) worker.kind = kind;
  for (const field of ["where", "runtime", "issue", "task", "status", "milestone", "milestoneAt", "claimUntil", "reportsTo", "note"] as const) {
    const value = text(source?.[field]);
    if (value) worker[field] = value;
  }
  const ctxPct = numeric(source?.["ctxPct"]);
  if (ctxPct !== undefined) worker.ctxPct = ctxPct;
  return { value: worker, gaps };
}

/**
 * `schedule/<day>`: the document is a day (an array of events, or `{ events: [...] }`), or a single
 * event. Each event keeps the day it came from, and an unknown `kind` is preserved and flagged
 * rather than mapped to a known one.
 */
export function mapScheduleDay(wire: WireRecord): Mapped<ScheduleEvent[]> {
  const { doc, gap } = normaliseDoc(wire.path, wire.doc);
  const day = segment(wire.path);
  // An unparseable document yields no events: a fabricated empty event would read as a real row.
  if (gap) return { value: [], gaps: [gap] };
  const source = objectOf(doc);
  const rawEvents: unknown[] = Array.isArray(doc) ? doc : Array.isArray(source?.["events"]) ? (source["events"] as unknown[]) : source ? [source] : [];
  const gaps: BoardGap[] = [];
  const events: ScheduleEvent[] = [];
  rawEvents.forEach((raw, index) => {
    const event = objectOf(raw);
    if (!event) {
      gaps.push({ path: wire.path, field: "events", value: `event ${index} is not an object` });
      return;
    }
    const rawKind = event["kind"];
    const kind = text(rawKind);
    if (kind === undefined) {
      gaps.push({ path: wire.path, field: "kind", value: rawKind === undefined || rawKind === null ? "<absent>" : String(rawKind) });
    } else if (!(SCHEDULE_EVENT_KINDS as readonly string[]).includes(kind)) {
      gaps.push({ path: wire.path, field: "kind", value: kind });
    }
    const assembled: ScheduleEvent = { id: text(event["id"]) ?? `${day}#${index}`, day };
    if (kind !== undefined) assembled.kind = kind;
    for (const field of ["at", "end", "ref", "label", "status", "note", "noteSrc", "url", "createdBy"] as const) {
      const value = text(event[field]);
      if (value) assembled[field] = value;
    }
    events.push(assembled);
  });
  return { value: events, gaps };
}

/**
 * Shared document → typed row mapping for the simple collections: identity comes from the record's
 * path segment, string fields stay absent when absent, and declared string-list fields keep only
 * the strings the board carried.
 */
function mapDoc<T extends object>(
  wire: WireRecord,
  build: () => T,
  textFields: readonly string[],
  listFields: readonly string[] = [],
  enumFields: readonly string[] = [],
): Mapped<T> {
  const { doc, gap } = normaliseDoc(wire.path, wire.doc);
  const source = objectOf(doc);
  const gaps: BoardGap[] = gap ? [gap] : [];
  flagUnusable(gaps, wire.path, source, enumFields);
  const value = build();
  const bag = value as Record<string, unknown>;
  for (const field of textFields) {
    const found = text(source?.[field]);
    if (found !== undefined) bag[field] = found;
  }
  for (const field of listFields) {
    const found = stringList(source?.[field]);
    if (found !== undefined) bag[field] = found;
  }
  return { value, gaps };
}

export function mapQuestion(wire: WireRecord): Mapped<Question> {
  return mapDoc(wire, () => ({ id: segment(wire.path) }), ["ref", "by", "q", "rec", "why", "at", "owner"]);
}

export function mapAnswer(wire: WireRecord): Mapped<Answer> {
  return mapDoc(wire, () => ({ qid: segment(wire.path) }), ["answer", "comment", "at", "by"]);
}

export function mapFollowUp(wire: WireRecord): Mapped<FollowUp> {
  return mapDoc(wire, () => ({ ref: segment(wire.path) }), ["title", "plain", "status", "priority", "area", "owner", "when"], ["refs"], ["status", "priority"]);
}

export function mapStatusRow(wire: WireRecord): Mapped<StatusRow> {
  return mapDoc(wire, () => ({ session: segment(wire.path) }), ["at", "state", "status", "note", "issue"], [], ["state", "status"]);
}

export function mapProposal(wire: WireRecord): Mapped<Proposal> {
  return mapDoc(wire, () => ({ id: segment(wire.path) }), ["at", "title", "status", "owner", "note"], ["refs"], ["status"]);
}

export function mapBoardNext(wire: WireRecord): Mapped<BoardNext> {
  return mapDoc(wire, () => ({}) as BoardNext, ["title", "at", "owner", "ref", "note"]);
}

/** Assemble one bridge page of single-record documents into typed records plus their gaps. */
export function assemblePage<T>(wire: WireListBody, map: (record: WireRecord) => Mapped<T>): BoardPage<T> {
  const records: BoardRecord<T>[] = [];
  const gaps: BoardGap[] = [];
  for (const raw of Array.isArray(wire.records) ? wire.records : []) {
    if (!raw || typeof raw.path !== "string") {
      gaps.push({ path: "<unknown>", field: "record", value: "record without a path" });
      continue;
    }
    const mapped = map(raw);
    records.push(recordOf(raw, mapped.value));
    gaps.push(...mapped.gaps);
  }
  return { records, truncated: wire.truncated === true, gaps, cachedAt: text(wire.cachedAt) ?? null };
}

/** Assemble one bridge page of `schedule/<day>` documents into a flat, day-tagged event list. */
export function assembleSchedulePage(wire: WireListBody): BoardPage<ScheduleEvent> {
  const records: BoardRecord<ScheduleEvent>[] = [];
  const gaps: BoardGap[] = [];
  for (const raw of Array.isArray(wire.records) ? wire.records : []) {
    if (!raw || typeof raw.path !== "string") {
      gaps.push({ path: "<unknown>", field: "record", value: "record without a path" });
      continue;
    }
    const mapped = mapScheduleDay(raw);
    for (const event of mapped.value) records.push(recordOf(raw, event));
    gaps.push(...mapped.gaps);
  }
  return { records, truncated: wire.truncated === true, gaps, cachedAt: text(wire.cachedAt) ?? null };
}

export const STATUS_BOARD_BASE = "/xtrm-api/status-board";
/** The bridge caches upstream for 60 s; the adapter keeps a shorter read window per record path. */
export const RECORD_CACHE_MS = 30_000;
/** The bridge serves at most 200 records per request and reports `truncated` rather than paging. */
export const MAX_PAGE = 200;

const clampLimit = (limit: number | undefined): number => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return MAX_PAGE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
};

/** Drop entries whose TTL has run out, so the path-keyed cache cannot grow for the process's life. */
function evictExpired<T>(cache: Map<string, { at: number; value: T }>, now: number, cacheMs: number): void {
  for (const [key, entry] of cache) if (now - entry.at >= cacheMs) cache.delete(key);
}

export interface LiveStatusBoardOptions {
  fetchImpl?: typeof fetch;
  basePath?: string;
  cacheMs?: number;
  now?: () => number;
}

/**
 * Live adapter: reads only through the bridge (same origin, no credential here). Every failure is a
 * typed `StatusBoardError`; no message carries a credential, an upstream URL, or a response body.
 */
export function createStatusBoardLiveAdapter(opts: LiveStatusBoardOptions = {}): StatusBoardAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.basePath ?? STATUS_BOARD_BASE;
  const cacheMs = opts.cacheMs ?? RECORD_CACHE_MS;
  const now = opts.now ?? Date.now;
  const recordCache = new Map<string, { at: number; value: BoardRecord<unknown> | null }>();

  const get = async (route: string, params: Record<string, string | number>): Promise<{ status: number; body: Record<string, unknown> }> => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    let response: Response;
    try {
      response = await doFetch(`${base}${route}?${query.toString()}`);
    } catch {
      throw new StatusBoardError("upstream", "status board bridge unreachable");
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new StatusBoardError("malformed", "status board bridge returned a non-JSON body", response.status);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new StatusBoardError("malformed", "status board bridge returned an unexpected body", response.status);
    }
    return { status: response.status, body: parsed as Record<string, unknown> };
  };

  /** One typed error per bridge status. The message never echoes the body or the credential. */
  const fail = (status: number, body: Record<string, unknown>): StatusBoardError => {
    if (status === 400) return new StatusBoardError("bad_request", "status board request rejected", status);
    if (status === 404 && body["configured"] === false) return new StatusBoardError("unbound", "repository has no status board binding", status);
    if (status === 503) return new StatusBoardError("credential", "status board credential unavailable", status);
    if (body["reason"] === "inconclusive") return new StatusBoardError("upstream", "status board record lookup was inconclusive", status);
    return new StatusBoardError("upstream", "status board read failed", status);
  };

  const list = async <T>(repository: string, collection: string, limit: number | undefined, map: (record: WireRecord) => Mapped<T>): Promise<BoardPage<T>> => {
    const { status, body } = await get("/list", { repo: repository, prefix: collection, limit: clampLimit(limit) });
    if (status !== 200) throw fail(status, body);
    return assemblePage(body as unknown as WireListBody, map);
  };

  const unboundHealth = (reason: UnboundReason | null, checkedAt: string): ProjectHealth => ({
    configured: false,
    reason,
    lastSyncOkAt: null,
    driftCount: null,
    unitActive: null,
    unitActiveReason: null,
    timerUnit: null,
    scheduleActive: null,
    scheduleActiveReason: null,
    runInProgress: null,
    runInProgressReason: null,
    stale: false,
    checkedAt,
  });

  const readRecord = async <T = unknown>(repository: string, path: string): Promise<BoardRecord<T> | null> => {
    const key = `${repository}:${path}`;
    const hit = recordCache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.value as BoardRecord<T> | null;
    if (hit) recordCache.delete(key);
    const { status, body } = await get("/record", { repo: repository, path });
    let value: BoardRecord<T> | null;
    if (status === 200) {
      const wire = body["record"] as WireRecord;
      if (!wire || typeof wire.path !== "string") throw new StatusBoardError("malformed", "status board bridge returned an unexpected record", status);
      const { doc } = normaliseDoc(wire.path, wire.doc);
      value = recordOf(wire, doc as T);
    } else if (status === 404 && body["configured"] !== false) {
      // The record is absent; the repository is not unbound.
      value = null;
    } else {
      throw fail(status, body);
    }
    evictExpired(recordCache, now(), cacheMs);
    recordCache.set(key, { at: now(), value: value as BoardRecord<unknown> | null });
    return value;
  };

  const adapter: StatusBoardAdapter = {
    source: "live",

    async binding(repository) {
      const { status, body } = await get("/binding", { repo: repository });
      if (status === 200) return mapBinding(body["binding"] as WireBinding);
      if (status === 404 && body["configured"] === false) {
        return {
          repository,
          configured: false,
          reason: unboundReasonOf(body["reason"]),
          resolvedBy: resolvedByOf(body["resolvedBy"]),
          pmProject: null,
          substrateProject: null,
          statusBoard: null,
          jira: null,
        };
      }
      throw fail(status, body);
    },

    async health(repository) {
      const { status, body } = await get("/health", { repo: repository });
      if (status === 200) return mapHealth(body["health"] as WireHealth);
      if (status === 404 && body["configured"] === false) return unboundHealth(unboundReasonOf(body["reason"]), new Date(now()).toISOString());
      throw fail(status, body);
    },

    record: readRecord,

    listWorkers: (repository, opts) => list(repository, "workers", opts?.limit, mapWorker),

    async listSchedule(repository, opts) {
      const { status, body } = await get("/list", { repo: repository, prefix: "schedule", limit: clampLimit(opts?.limit) });
      if (status !== 200) throw fail(status, body);
      return assembleSchedulePage(body as unknown as WireListBody);
    },

    listQuestions: (repository, opts) => list(repository, "questions", opts?.limit, mapQuestion),
    listAnswers: (repository, opts) => list(repository, "answers", opts?.limit, mapAnswer),
    listFollowUps: (repository, opts) => list(repository, "followups", opts?.limit, mapFollowUp),
    listStatus: (repository, opts) => list(repository, "status", opts?.limit, mapStatusRow),
    listProposals: (repository, opts) => list(repository, "proposals", opts?.limit, mapProposal),

    async boardNext(repository) {
      const record = await readRecord<unknown>(repository, "board/next");
      if (!record) return null;
      const mapped = mapBoardNext({ path: record.path, id: record.id, updatedAt: record.updatedAt, doc: record.doc });
      return { ...record, doc: mapped.value };
    },
  };
  return adapter;
}

export const liveStatusBoard: StatusBoardAdapter = createStatusBoardLiveAdapter();
