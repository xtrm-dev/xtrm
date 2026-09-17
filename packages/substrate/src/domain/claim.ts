// Claims + workspace writer leases: durable work ownership vs mutation
// authority (PRD §§5, 13, 17, 18, 47). Pure policy + types only; IssueService
// wires DB rows through these so every caller shares one authority model.
//
// Lease policy (explicit, never wall-clock guessing):
// - Every claim/lease carries an explicit expiresAt (acquired/renewed + ttlMs).
// - Live means releasedAt is null AND now < expiresAt. Only the recorded
//   holder (+ activation when set) may renew or release a live lease;
//   anyone else is rejected (anti-steal).
// - Expired means releasedAt is null AND now >= expiresAt. An expired
//   claim/lease is reclaimable by anyone: the old row is closed and a new
//   generation opens. Renewing an expired lease is rejected; reclaim it.
// - `now` is injectable so tests control expiry without wall-clock coupling.
// - Crash restart honors stored rows as-is: a live lease survives (WAL
//   durability) and stays enforced; uncertainty is recorded, never guessed.
// - Claimed/in-progress is derived from a live claim row, never a stored
//   flag on the issue (§§5, 13).
//
// Claim and workspace lease are distinct authorities (§5): a claim answers
// "who owns this work", a writer lease answers "who may mutate this
// worktree now". Readers need no lease and always coexist; at most one
// live writer holds a workspace, coordinator included (fenced while a
// child writer owns it).

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

// Canonical exclusivity key: one live writer per normalized worktree path.
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
