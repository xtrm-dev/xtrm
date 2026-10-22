// Claims: durable per-issue work ownership (PRD §§5, 13, 17, 47). Pure
// policy + types only; IssueService wires DB rows through these so every
// caller shares one authority model.
//
// Substrate provides no workspace-exclusion guarantee (XTRM-414): the
// workspace writer lease (former PRD §18) was withdrawn, and per-issue
// claim fencing is the only mutation authority here. Workspace exclusion
// is owned by the specialists activation layer.
//
// Claim policy (explicit, never wall-clock guessing):
// - Every claim carries an explicit expiresAt (acquired/renewed + ttlMs).
// - Live means releasedAt is null AND now < expiresAt. Only the recorded
//   holder (+ activation when set) may renew or release a live claim;
//   anyone else is rejected (anti-steal).
// - Expired means releasedAt is null AND now >= expiresAt. An expired
//   claim is reclaimable by anyone: the old row is closed and a new
//   generation opens.
// - `now` is injectable so tests control expiry without wall-clock coupling.
// - Crash restart honors stored rows as-is: a live claim survives (WAL
//   durability) and stays enforced; uncertainty is recorded, never guessed.
// - Claimed/in-progress is derived from a live claim row, never a stored
//   flag on the issue (§§5, 13).
//
// A claim answers "who owns this work". Readers always coexist; a live
// claim fences mutation to its holder (+ activation when set).

export interface IssueClaim {
  id: number;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  holder: string;
  activationId: string | null;
  acquiredAt: number;
  expiresAt: number;
  releasedAt: number | null;
  generation: number;
}

export interface WorkspaceIdentity {
  repositoryRoot: string;
  gitCommonDir?: string;
  worktreePath: string;
  branch?: string;
}

export const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;

export function isLiveClaim(c: Pick<IssueClaim, "expiresAt" | "releasedAt">, now: number): boolean {
  return c.releasedAt === null && c.expiresAt > now;
}

// Human-readable instant for errors and confirmations: ISO-8601 UTC without
// milliseconds, never raw epoch ms.
export function isoTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Canonical workspace key: a normalized worktree path. Key derivation only —
// Substrate attaches no exclusion to this key (XTRM-414).
export function normalizeWorkspace(input: string | WorkspaceIdentity): string {
  const raw = typeof input === "string" ? input : (input.worktreePath ?? "");
  const key = raw.trim().replace(/\/+$/, "");
  if (!key) throw new Error("workspace must be a non-empty path");
  return key;
}

// Holder identity is holder + activation: the same holder under a different
// activation is a different execution and must not silently inherit the lease.
export function sameHolder(
  row: { holder: string; activationId: string | null },
  holder: string,
  activationId?: string | null,
): boolean {
  if (row.holder !== holder) return false;
  const want = activationId ?? null;
  if (row.activationId === null || want === null) return row.activationId === want;
  return row.activationId === want;
}
