// Readiness attestations for Phase 2 (PRD §§12, 44). Append-only; never edit
// 001_baseline.ts after landing. Attestations bind to exact revision +
// contract hash; any contract edit bumps both, invalidating priors.

export const version = 3;
export const name = "readiness-attestations";

export const sql = `
CREATE TABLE readiness_attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  issue_revision INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  policy TEXT NOT NULL,
  attested_by TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  blocking_gaps_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_attest_issue ON readiness_attestations (issue_id, id);
`;
