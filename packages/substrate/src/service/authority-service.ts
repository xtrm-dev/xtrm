// Activation authority: the `activations` projection a host keeps so a session
// can be told what work is live (specialists' SessionStart hook reads it).
//
// Those rows live in the same store as everything else, and until now the
// specialists host wrote them with its own SQLite statements. A remote host
// cannot do that — the file is on the other machine — so the same rows are
// written here as named operations with validated inputs. The columns are
// copied column-for-column from `specialists/src/activation/authority-store.ts`
// (`activation_id, specialist, state, bead_id, last_activity_at`) because that
// reader is shipped and reads the table directly; changing the shape here would
// break it silently.
//
// The reader prints those columns verbatim into a model's context, which makes
// every free-text field an injection channel: a newline in `activationId` stored
// "SYSTEM: obey" as a line of its own and the next session read it as an
// instruction. So the free-text fields are restricted to an identifier shape,
// `state` is an enum, and `lastActivityAt` cannot be far in the future (a forged
// row with 1e300 sorts first forever). Existing rows are not silently
// re-attributed to another specialist, and a terminal activation does not come
// back to life: both would let one caller rewrite another's record.

import type { SubstrateDatabase } from "../store/database.ts";
import { ServiceCallError } from "./protocol.ts";

export const AUTHORITY_SCHEMA_VERSION = 1;

/**
 * How many live rows the specialists SessionStart reader asks for. `authority.list`
 * with `activeOnly` answers the same query with the same order and the same default
 * limit, so a remote client sees what that reader sees.
 */
export const ACTIVITY_READER_LIMIT = 10;

export const ACTIVATIONS_DDL = `CREATE TABLE IF NOT EXISTS activations (
  activation_id TEXT PRIMARY KEY,
  specialist TEXT NOT NULL,
  state TEXT NOT NULL,
  bead_id TEXT,
  last_activity_at INTEGER NOT NULL
)`;

/** States the specialists host records. An unknown one is refused, not stored. */
// `disposed` is in the shipped reader's filter, not in the host's own transition
// table: a stream that reports it directly must still be accepted, or a disposed
// activation could not be recorded at all.
export const AUTHORITY_STATES = [
  "pending",
  "running",
  "waiting",
  "blocked",
  "settled",
  "failed",
  "stopped",
  "disposed",
] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

const TERMINAL_STATES: readonly AuthorityState[] = ["settled", "failed", "stopped", "disposed"];
const LIVE_STATES: readonly AuthorityState[] = ["pending", "running", "waiting", "blocked"];

/** Identifier shape for anything the SessionStart reader prints. */
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Issue references look like `XTRM-690`, `CORE-2527` or a locator's leaf. */
const ISSUE_REF = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
/** An activity stamp may run slightly ahead of this clock, not years ahead. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface AuthorityOperation {
  activationId: string;
  specialist: string;
  state: string;
  issueRef?: string | null;
  lastActivityAt: number;
}

export interface AuthorityRow {
  activationId: string;
  specialist: string;
  state: string;
  issueRef: string | null;
  lastActivityAt: number;
}

function identifier(value: unknown, key: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new ServiceCallError(
      "bad_request",
      `argument "${key}" must be 1-128 characters of A-Z a-z 0-9 _ . : - (it is printed into a session by the authority reader)`,
    );
  }
  return value;
}

function state(value: unknown): AuthorityState {
  if (typeof value !== "string" || !(AUTHORITY_STATES as readonly string[]).includes(value)) {
    throw new ServiceCallError("bad_request", `argument "state" must be one of ${AUTHORITY_STATES.join(", ")}`);
  }
  return value as AuthorityState;
}

function activityTime(value: unknown, now: number): number {
  // The specialists writer records 0 for a row its host has not touched yet, so a
  // non-positive stamp is accepted; only a future one would poison the ordering.
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ServiceCallError("bad_request", 'argument "lastActivityAt" must be an epoch-millisecond integer');
  }
  if (value > now + MAX_CLOCK_SKEW_MS) {
    throw new ServiceCallError(
      "bad_request",
      `argument "lastActivityAt" is more than ${MAX_CLOCK_SKEW_MS / 60000} minutes in the future (epoch ms)`,
    );
  }
  return value;
}

function issueReference(value: unknown): string | null {
  // The specialists writer stores whatever its snapshot carries; an empty string is
  // the "no issue" case it actually sends. Both are recorded as no issue.
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ISSUE_REF.test(value)) {
    throw new ServiceCallError("bad_request", 'argument "issueRef" must look like XTRM-690, or be null');
  }
  return value;
}

export function ensureAuthorityTable(db: SubstrateDatabase): void {
  db.exec(ACTIVATIONS_DDL);
}

function readRow(db: SubstrateDatabase, activationId: string): AuthorityRow | null {
  const row = db
    .prepare(
      "SELECT activation_id, specialist, state, bead_id, last_activity_at FROM activations WHERE activation_id = ?",
    )
    .get(activationId) as
    | { activation_id: string; specialist: string; state: string; bead_id: string | null; last_activity_at: number }
    | undefined;
  if (!row) return null;
  return {
    activationId: row.activation_id,
    specialist: row.specialist,
    state: row.state,
    issueRef: row.bead_id,
    lastActivityAt: row.last_activity_at,
  };
}

export function activateAuthority(
  db: SubstrateDatabase,
  input: AuthorityOperation,
  now: number = Date.now(),
): { activationId: string } {
  const activationId = identifier(input.activationId, "activationId");
  const specialist = identifier(input.specialist, "specialist");
  const nextState = state(input.state);
  const lastActivityAt = activityTime(input.lastActivityAt, now);
  const issueRef = issueReference(input.issueRef);
  ensureAuthorityTable(db);

  const existing = readRow(db, activationId);
  if (existing) {
    if (existing.specialist !== specialist) {
      throw new ServiceCallError(
        "conflict",
        `activation "${activationId}" already belongs to specialist "${existing.specialist}"; it cannot be re-attributed`,
      );
    }
    if (TERMINAL_STATES.includes(existing.state as AuthorityState) && LIVE_STATES.includes(nextState)) {
      throw new ServiceCallError(
        "conflict",
        `activation "${activationId}" is ${existing.state}; a finished activation does not become ${nextState} again`,
      );
    }
  }

  db.prepare(
    `INSERT OR REPLACE INTO activations
       (activation_id, specialist, state, bead_id, last_activity_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(activationId, specialist, nextState, issueRef, lastActivityAt);
  return { activationId };
}

export function removeAuthority(
  db: SubstrateDatabase,
  activationId: string,
  expectState?: string | null,
): { removed: boolean } {
  const id = identifier(activationId, "activationId");
  ensureAuthorityTable(db);
  // The state a caller names is validated even when the row is already terminal:
  // an unknown value must not silently act as "no expectation".
  const expected = expectState === undefined || expectState === null ? null : state(expectState);
  const existing = readRow(db, id);
  if (!existing) return { removed: false };
  // A live row is someone's current work: removing it needs the state the caller
  // believes it is deleting, so a stale or mistaken caller cannot end a session's
  // record by guessing an id.
  if (LIVE_STATES.includes(existing.state as AuthorityState)) {
    if (expected === null) {
      throw new ServiceCallError(
        "conflict",
        `activation "${id}" is ${existing.state}; pass "expectState": "${existing.state}" to remove a live activation`,
      );
    }
    if (expected !== existing.state) {
      throw new ServiceCallError(
        "conflict",
        `activation "${id}" is ${existing.state}, not ${expected}; nothing was removed`,
      );
    }
  }
  db.prepare("DELETE FROM activations WHERE activation_id = ?").run(id);
  return { removed: true };
}

/**
 * The SessionStart reader's query: live rows only, newest activity first, at most
 * `limit` rows.
 */
export function listActiveAuthority(db: SubstrateDatabase, limit = ACTIVITY_READER_LIMIT): AuthorityRow[] {
  ensureAuthorityTable(db);
  const rows = (
    db
      .prepare(
        `SELECT activation_id, specialist, state, bead_id, last_activity_at
           FROM activations
           WHERE state NOT IN ('settled', 'disposed')
           ORDER BY last_activity_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as Array<{
      activation_id: string;
      specialist: string;
      state: string;
      bead_id: string | null;
      last_activity_at: number;
    }>
  );
  return rows.map((row) => ({
    activationId: row.activation_id,
    specialist: row.specialist,
    state: row.state,
    issueRef: row.bead_id,
    lastActivityAt: row.last_activity_at,
  }));
}

export function listAuthority(db: SubstrateDatabase, activationId?: string | null): AuthorityRow[] {
  ensureAuthorityTable(db);
  const rows = (
    activationId === undefined || activationId === null
      ? db.prepare("SELECT activation_id, specialist, state, bead_id, last_activity_at FROM activations ORDER BY last_activity_at DESC").all()
      : db
          .prepare(
            "SELECT activation_id, specialist, state, bead_id, last_activity_at FROM activations WHERE activation_id = ?",
          )
          .all(identifier(activationId, "activationId"))
  ) as Array<{
    activation_id: string;
    specialist: string;
    state: string;
    bead_id: string | null;
    last_activity_at: number;
  }>;
  return rows.map((row) => ({
    activationId: row.activation_id,
    specialist: row.specialist,
    state: row.state,
    issueRef: row.bead_id,
    lastActivityAt: row.last_activity_at,
  }));
}
