// Bounded board read model (XTRM-393). This is the projection contract shared
// by the sb CLI, the MCP server, the Pi integration and xtrm-app: the row
// shape, the cursor codec and the page constants. No database access lives
// here, so the cursor tuple and the row shape are unit-testable without a
// store.
//
// Two constraints are encoded in this file and must not be relaxed:
//   1. A row carries board fields only. Contract text, provenance, journal
//      entries and readiness reasons are NOT here; opening a drawer is the
//      boundary where the full single-issue read happens.
//   2. The cursor carries the complete deterministic ordering tuple (every
//      sort key plus the unique tiebreaker). A cursor holding only the issue
//      id silently skips or repeats rows as soon as a sort key has duplicate
//      values.

import { createHash } from "node:crypto";
import type { IssueKind, LifecycleState } from "./issue.ts";
import type { OperationalState } from "./readiness.ts";

/** Exactly the fields a board row carries, in a stable order. The projection
 * payload test asserts this key set, so adding a field here is a deliberate
 * widening of the board contract. */
export const BOARD_ROW_FIELDS = [
  "id",
  "humanRef",
  "locator",
  "title",
  "kind",
  "lifecycleState",
  "priority",
  "scrutiny",
  "revision",
  "readinessState",
  "dispatchable",
  "claimState",
  "parentRef",
  "parentLocator",
  "childCount",
  "childrenTerminal",
  "blockedBy",
  "createdAt",
  "updatedAt",
] as const;

export type BoardClaimState = "none" | "claimed";

export interface IssueBoardRow {
  id: string;
  humanRef: string;
  locator: string;
  title: string;
  kind: IssueKind;
  lifecycleState: LifecycleState;
  priority: number;
  scrutiny: string;
  revision: number;
  /** Derived operational state (PRD §13), never stored. */
  readinessState: OperationalState;
  dispatchable: boolean;
  claimState: BoardClaimState;
  parentRef: string | null;
  parentLocator: string | null;
  childCount: number;
  /** Children in a terminal lifecycle state (done/cancelled/archived). */
  childrenTerminal: number;
  /** Refs of blockers that are still unsatisfied. A cancelled prerequisite
   * stays unsatisfied (fail-closed, PRD §13), matching readinessState. */
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
}

export interface IssueBoardPage {
  rows: IssueBoardRow[];
  /** Ordering key to resume after the last emitted row, or null when the walk
   * is exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
  /** Candidate rows loaded to fill this page. */
  scanned: number;
  /** True when a derived-predicate scan hit its cap before the page filled. */
  truncated: boolean;
}

export interface IssueQuery {
  /** Project id (not prefix). */
  project: string;
  lifecycle?: readonly LifecycleState[] | null;
  kind?: readonly IssueKind[] | null;
  /** Derived predicate: filtered after derivation, so it scans in chunks. */
  readiness?: readonly OperationalState[] | null;
  /** Parent issue id; `null` selects project roots only. */
  parent?: string | null;
  /** Case-insensitive substring match on the title. */
  search?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

export const DEFAULT_PAGE_LIMIT = 200;
export const MAX_PAGE_LIMIT = 500;

/** Candidate rows per statement batch. The unfiltered board path fetches only
 * `limit` rows, so it never pays for this. */
export const SCAN_CHUNK = 500;

/** Caps how many candidates a derived readiness predicate derives in one call,
 * so a filter matching nothing cannot walk an unbounded project. */
export const MAX_DERIVED_SCAN = 10_000;

export const CURSOR_VERSION = 1;

/** The complete deterministic ordering tuple: the sort key plus the unique
 * tiebreaker. */
export type BoardOrderKey = readonly [number, string];

export interface BoardCursor {
  v: number;
  project: string;
  /** Fingerprint of the filter set this walk was opened under. */
  filter: string;
  key: [number, string];
}

/** Fingerprint of everything that changes which rows a walk visits. Changing a
 * filter mid-walk must not silently skip rows, so a cursor is refused instead. */
export function queryFilterFingerprint(query: IssueQuery): string {
  const normalized = {
    project: query.project,
    lifecycle: [...(query.lifecycle ?? [])].sort(),
    kind: [...(query.kind ?? [])].sort(),
    readiness: [...(query.readiness ?? [])].sort(),
    parent: query.parent ?? null,
    search: (query.search ?? "").trim().toLowerCase(),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function encodeCursor(cursor: BoardCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Fail closed on an unreadable, foreign, stale-shape or filter-mismatched
 * cursor: resuming a walk against different filters is a correctness bug, not
 * a degraded read. */
export function decodeCursor(raw: string, expected: { project: string; filter: string }): BoardCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid board cursor");
  }
  const cursor = parsed as Partial<BoardCursor> | null;
  if (!cursor || typeof cursor !== "object") throw new Error("invalid board cursor");
  if (cursor.v !== CURSOR_VERSION) throw new Error(`fail-closed: unsupported board cursor version ${String(cursor.v)}`);
  if (cursor.project !== expected.project) throw new Error("fail-closed: board cursor belongs to a different project");
  if (cursor.filter !== expected.filter) throw new Error("fail-closed: board cursor was issued for different filters");
  const key = cursor.key;
  if (!Array.isArray(key) || key.length !== 2 || typeof key[0] !== "number" || typeof key[1] !== "string") {
    throw new Error("fail-closed: board cursor is missing its ordering tuple");
  }
  return { v: CURSOR_VERSION, project: cursor.project, filter: cursor.filter, key: [key[0], key[1]] };
}

export function clampPageLimit(limit?: number | null): number {
  if (limit == null) return DEFAULT_PAGE_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) throw new Error(`invalid limit: ${String(limit)}`);
  return Math.min(Math.floor(limit), MAX_PAGE_LIMIT);
}
