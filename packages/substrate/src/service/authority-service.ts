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
// Exactly the states the specialists host writes (its `ActivationState` union,
// ~/dev/specialists/src/activation/types.ts at the commit recorded in
// tests/service-authority-states.test.ts). A state the host never writes would be
// an invention here; a state the host does write must not be refused, or the first
// record of every activation (`starting`) is rejected.
export const AUTHORITY_STATES = [
  "starting",
  "running",
  "waiting",
  "needs_reply",
  "escalated",
  "settled",
  "stopping",
  "stopped",
  "failed",
  "uncertain",
] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

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
  opts: { specialist?: string | null; expectState?: string | null } = {},
): { removed: boolean } {
  const id = identifier(activationId, "activationId");
  ensureAuthorityTable(db);
  // An expectation that is named is validated even when the row is already gone:
  // an unknown state must not silently act as "no expectation".
  const expected = opts.expectState === undefined || opts.expectState === null ? null : state(opts.expectState);
  const specialist = opts.specialist === undefined || opts.specialist === null ? null : identifier(opts.specialist, "specialist");
  const existing = readRow(db, id);
  if (!existing) return { removed: false };
  // Deletion is how the host forgets an activation it just stopped, and it asks by
  // id alone. A caller that names another specialist is refused here rather than
  // left to the writer's own re-attribution check.
  if (specialist !== null && specialist !== existing.specialist) {
    throw new ServiceCallError(
      "conflict",
      `activation "${id}" belongs to specialist "${existing.specialist}", not "${specialist}"; nothing was removed`,
    );
  }
  if (expected !== null && expected !== existing.state) {
    throw new ServiceCallError(
      "conflict",
      `activation "${id}" is ${existing.state}, not ${expected}; nothing was removed`,
    );
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
