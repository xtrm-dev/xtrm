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

import type { SubstrateDatabase } from "../store/database.ts";
import { ServiceCallError } from "./protocol.ts";

export const AUTHORITY_SCHEMA_VERSION = 1;

export const ACTIVATIONS_DDL = `CREATE TABLE IF NOT EXISTS activations (
  activation_id TEXT PRIMARY KEY,
  specialist TEXT NOT NULL,
  state TEXT NOT NULL,
  bead_id TEXT,
  last_activity_at INTEGER NOT NULL
)`;

export interface AuthorityOperation {
  activationId: string;
  specialist: string;
  state: string;
  issueRef?: string | null;
  lastActivityAt: number;
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ServiceCallError("bad_request", `argument "${key}" must be a non-empty string`);
  }
  return value;
}

export function ensureAuthorityTable(db: SubstrateDatabase): void {
  db.exec(ACTIVATIONS_DDL);
}

export function activateAuthority(db: SubstrateDatabase, input: AuthorityOperation): { activationId: string } {
  const activationId = requiredString(input.activationId, "activationId");
  const specialist = requiredString(input.specialist, "specialist");
  const state = requiredString(input.state, "state");
  const lastActivityAt = input.lastActivityAt;
  if (typeof lastActivityAt !== "number" || !Number.isInteger(lastActivityAt) || lastActivityAt <= 0) {
    throw new ServiceCallError("bad_request", 'argument "lastActivityAt" must be a positive integer (epoch ms)');
  }
  const issueRef = input.issueRef ?? null;
  if (issueRef !== null && (typeof issueRef !== "string" || issueRef.trim() === "")) {
    throw new ServiceCallError("bad_request", 'argument "issueRef" must be a non-empty string or null');
  }
  ensureAuthorityTable(db);
  db.prepare(
    `INSERT OR REPLACE INTO activations
       (activation_id, specialist, state, bead_id, last_activity_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(activationId, specialist, state, issueRef, lastActivityAt);
  return { activationId };
}

export function removeAuthority(db: SubstrateDatabase, activationId: string): { removed: boolean } {
  if (typeof activationId !== "string" || activationId.trim() === "") {
    throw new ServiceCallError("bad_request", 'argument "activationId" must be a non-empty string');
  }
  ensureAuthorityTable(db);
  const result = db.prepare("DELETE FROM activations WHERE activation_id = ?").run(activationId) as {
    changes?: number;
  };
  return { removed: (result.changes ?? 0) > 0 };
}

export function listAuthority(
  db: SubstrateDatabase,
  activationId?: string | null,
): Array<{ activationId: string; specialist: string; state: string; issueRef: string | null; lastActivityAt: number }> {
  ensureAuthorityTable(db);
  const rows = (
    activationId
      ? db.prepare(
          "SELECT activation_id, specialist, state, bead_id, last_activity_at FROM activations WHERE activation_id = ?",
        ).all(activationId)
      : db.prepare(
          "SELECT activation_id, specialist, state, bead_id, last_activity_at FROM activations ORDER BY last_activity_at DESC",
        ).all()
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    activationId: String(row["activation_id"]),
    specialist: String(row["specialist"]),
    state: String(row["state"]),
    issueRef: row["bead_id"] === null || row["bead_id"] === undefined ? null : String(row["bead_id"]),
    lastActivityAt: Number(row["last_activity_at"]),
  }));
}
