// Git provenance adapter for the Claude integration (PRD §38).
// Read-only git inspection for mechanical checkpoints: branch, head commit,
// changed files. No mutation, no receipt authority (Phase 8 owns receipts;
// this only feeds host-visible fields that JournalService cannot derive).

import { execFileSync } from "node:child_process";

export interface GitContext {
  workspace: string | null;
  branch: string | null;
  baseCommit: string | null;
  headCommit: string | null;
  changedFiles: string[];
  commitsSincePrevious: string[];
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// SIMPLIFIED: merge-base against HEAD~50 as baseCommit heuristic.
// Upgrade when Phase 8 provenance defines the binding base.
export function collectGitContext(cwd: string): GitContext {
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  const headCommit = git(cwd, "rev-parse", "HEAD");
  const status = git(cwd, "status", "--porcelain");
  const changedFiles = status
    ? status
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter((f) => f !== "")
        .slice(0, 100)
    : [];
  // Commits since previous checkpoint are unknown to git alone; the caller
  // passes the previous head so this stays a pure function of (cwd, since).
  return { workspace: cwd, branch, baseCommit: null, headCommit, changedFiles, commitsSincePrevious: [] };
}

export function commitsSince(cwd: string, sinceRef: string | null): string[] {
  if (!sinceRef) return [];
  const out = git(cwd, "rev-list", "--oneline", `${sinceRef}..HEAD`);
  if (!out) return [];
  return out.split("\n").filter((l) => l.trim() !== "").slice(0, 50);
}
