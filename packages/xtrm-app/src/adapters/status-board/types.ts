import type { DataSource } from "../types.ts";

// Typed view models for the here.now status-board bridge (server/status-board-api.ts).
// UI components depend on these, never on the wire shapes in live.ts. ADR-002 §3 is the
// contract sketch; the bridge is the only reader of the store and the only holder of the key.

export type UnboundReason = "config_absent" | "repo_not_bound";
export type ResolvedBy = "explicit" | "env" | "repo_slug" | "repo_name" | "none";
export type UnitProbeReason = "unit_not_found" | "probe_timeout" | "non_user_session" | "probe_failed";

/** The board collections the bridge serves (server/status-board-api.ts `COLLECTIONS`). */
export const BOARD_COLLECTIONS = [
  "workers",
  "schedule",
  "questions",
  "answers",
  "followups",
  "archive",
  "lanes",
  "status",
  "board",
  "proposals",
] as const;

export type BoardCollection = (typeof BOARD_COLLECTIONS)[number];

/**
 * One repository's resolved Project integration binding (ADR-002 §D7). A credential never crosses
 * this boundary: the binding carries the configured file path and whether it is readable, no value.
 */
export interface ProjectBinding {
  repository: string;
  configured: boolean;
  /** Why this repository has no binding; null when configured. */
  reason: UnboundReason | null;
  resolvedBy: ResolvedBy;
  pmProject: string | null;
  substrateProject: string | null;
  statusBoard: {
    site: string | null;
    stateDir: string | null;
    timezone: string;
    keyFile: string | null;
    keyPresent: boolean;
  } | null;
  jira: { site: string | null; project: string | null } | null;
}

/**
 * Derived by the bridge, never trusted from the board (ADR-002 §D7/§4). Every unverified fact is
 * `null` with its own reason: `unitActive: null` is "not verified", never "the sync is down".
 */
export interface ProjectHealth {
  configured: boolean;
  reason: UnboundReason | null;
  lastSyncOkAt: string | null;
  driftCount: number | null;
  unitActive: boolean | null;
  unitActiveReason: UnitProbeReason | null;
  timerUnit: string | null;
  scheduleActive: boolean | null;
  scheduleActiveReason: UnitProbeReason | null;
  runInProgress: boolean | null;
  runInProgressReason: UnitProbeReason | null;
  stale: boolean;
  checkedAt: string;
}

/**
 * A board document with the store's own identity. `createdAt` is null because the bridge does not
 * return it; it is never invented. `id` is the store's record id, not a record field.
 */
export interface BoardRecord<T> {
  path: string;
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  doc: T;
}

/** An unknown enum value or an unusable document, kept as data instead of being coerced. */
export interface BoardGap {
  path: string;
  field: string;
  /** The value as the board carried it, stringified for display. */
  value: string;
}

export interface BoardPage<T> {
  records: BoardRecord<T>[];
  /** The bridge stopped at its page budget, so the list is not complete. */
  truncated: boolean;
  gaps: BoardGap[];
  /** When the upstream data was fetched (the bridge cache entry's time), never "now". */
  cachedAt: string | null;
}

/**
 * `workers/<name>` (ADR-002 §3). A field the board did not carry stays absent rather than becoming
 * `""`; `kind`/`status` are carried as strings because the board's vocabulary is not closed here.
 */
export interface Worker {
  name: string;
  kind?: string;
  where?: string;
  runtime?: string;
  issue?: string;
  task?: string;
  status?: string;
  milestone?: string;
  milestoneAt?: string;
  ctxPct?: number;
  claimUntil?: string;
  reportsTo?: string;
  note?: string;
}

/** The event kinds the Timeline knows (ADR-002 §D2); an unknown kind is preserved and flagged. */
export const SCHEDULE_EVENT_KINDS = ["window", "pr", "handover", "incident", "report"] as const;

export type ScheduleEventKind = (typeof SCHEDULE_EVENT_KINDS)[number];

/** One event assembled from a `schedule/<day>` document (ADR-002 §D2 timeline). */
export interface ScheduleEvent {
  id: string;
  /** The `schedule/<day>` record this event came from. */
  day: string;
  /** ISO instant the event starts at, when the record carries one. */
  at?: string;
  end?: string;
  ref?: string;
  label?: string;
  status?: string;
  note?: string;
  noteSrc?: string;
  url?: string;
  /** A known kind, or an unknown one preserved as carried (see `BoardGap`); absent when unreadable. */
  kind?: string;
  createdBy?: string;
}

/** `questions/<owner>` (ADR-002 §3); `q`, `rec`, `why` are the board's own question shape. */
export interface Question {
  id: string;
  ref?: string;
  by?: string;
  q?: string;
  rec?: string;
  why?: string;
  at?: string;
  owner?: string;
}

/** `answers/<qid>` (ADR-002 §3). */
export interface Answer {
  qid: string;
  answer?: string;
  comment?: string;
  at?: string;
  by?: string;
}

/** `followups/<ref>` (ADR-002 §3). */
export interface FollowUp {
  ref: string;
  title?: string;
  plain?: string;
  status?: string;
  priority?: string;
  area?: string;
  owner?: string;
  when?: string;
  refs?: string[];
}

/** `status/<session>` — the board's per-session status row (read by Overview only, §D2). */
export interface StatusRow {
  session: string;
  at?: string;
  state?: string;
  status?: string;
  note?: string;
  issue?: string;
}

/** `proposals/<date>` — the board's proposals (read by Overview only, §D2). */
export interface Proposal {
  id: string;
  at?: string;
  title?: string;
  status?: string;
  owner?: string;
  refs?: string[];
  note?: string;
}

/** `board/next` — the board's own "what is next" pointer (Overview only, §D2). */
export interface BoardNext {
  title?: string;
  at?: string;
  owner?: string;
  ref?: string;
  note?: string;
}

export type StatusBoardErrorKind = "bad_request" | "unbound" | "credential" | "upstream" | "malformed";

/** A typed bridge failure. The message never carries a credential, an upstream URL, or a body. */
export class StatusBoardError extends Error {
  readonly kind: StatusBoardErrorKind;
  readonly status: number | null;

  constructor(kind: StatusBoardErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "StatusBoardError";
    this.kind = kind;
    this.status = status;
  }
}

export interface StatusBoardAdapter {
  readonly source: DataSource;
  /** The resolved binding for one repository. An unbound repository is reported, not thrown. */
  binding(repository: string): Promise<ProjectBinding>;
  /** Derived integration health. Unbound reports `configured: false` and never a fabricated fact. */
  health(repository: string): Promise<ProjectHealth>;
  /** One document by its board path (`collection/name`); `null` when the board has no such record. */
  record<T = unknown>(repository: string, path: string): Promise<BoardRecord<T> | null>;
  listWorkers(repository: string, opts?: { limit?: number }): Promise<BoardPage<Worker>>;
  /** Every `schedule/<day>` document, assembled into one event list. */
  listSchedule(repository: string, opts?: { limit?: number }): Promise<BoardPage<ScheduleEvent>>;
  listQuestions(repository: string, opts?: { limit?: number }): Promise<BoardPage<Question>>;
  listAnswers(repository: string, opts?: { limit?: number }): Promise<BoardPage<Answer>>;
  listFollowUps(repository: string, opts?: { limit?: number }): Promise<BoardPage<FollowUp>>;
  listStatus(repository: string, opts?: { limit?: number }): Promise<BoardPage<StatusRow>>;
  listProposals(repository: string, opts?: { limit?: number }): Promise<BoardPage<Proposal>>;
  /** `board/next`; `null` when the board has no such record. */
  boardNext(repository: string): Promise<BoardRecord<BoardNext> | null>;
}
