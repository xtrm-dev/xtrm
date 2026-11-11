// Close gate for issue-to-PR links (design note 11-11, XTRM-729).
//
// The gate is a join, not a sentence: errors and links are read from rows,
// never from prose. Manual close accepts T1 (live artifact) or T2 (trailered
// commits) while the PR is open; auto mode adds the merged/default-branch,
// other-open-PR and live-claim conjunctions. Unknown never passes.

import { execFileSync } from "node:child_process";
import type { DatabaseSync } from "../store/database.ts";
import { JournalService } from "./journal-service.ts";
import type { IssueService } from "./issue-service.ts";

export type GateMode = "warn" | "enforce" | "off";
export type GateVerdict = "pass" | "refuse" | "fail";

export const GATE_CODES = {
  orphan: "gate_orphan_link",
  mentioned: "gate_mentioned_only",
  noEvidence: "gate_no_evidence",
  notMerged: "gate_pr_not_merged",
  defaultBranch: "gate_default_branch_unknown",
  otherOpenPr: "gate_other_open_pr",
  liveClaim: "gate_live_claim",
  deployWindow: "gate_deploy_window",
  unreachable: "gate_github_unreachable",
} as const;

/** Codes an operator override may bypass: evidence and transport, never the
 * auto-close conjunctions (other open PR, live claim, deploy window). */
const OVERRIDABLE = new Set<string>([
  GATE_CODES.orphan,
  GATE_CODES.mentioned,
  GATE_CODES.noEvidence,
  GATE_CODES.unreachable,
  GATE_CODES.defaultBranch,
]);

export interface PullRequestStateReader {
  state(repository: string, number: number): { state: string; baseRef: string | null } | null;
  defaultBranch(repository: string): string | null;
}

export interface GateEvaluation {
  issueId: string;
  mode: "manual" | "auto";
  verdict: GateVerdict;
  codes: string[];
  links: Array<{ repository: string; number: number; relation: string; sources: string[]; artifact: boolean; commits: number }>;
}

export interface GateEnforcement {
  mode: GateMode;
  codes: string[];
  warned: boolean;
  overridden: boolean;
}

interface LinkRow {
  repository: string;
  number: number;
  relation: string;
  source: string;
}

const GATE_MODES: readonly GateMode[] = ["warn", "enforce", "off"];

/** Explicit flag, then the env, then `warn`. A present but unknown value is
 * an error: a typo must never silently strengthen the gate to enforce. */
export function gateModeFromEnv(explicit?: string | null): GateMode {
  if (explicit !== undefined && explicit !== null) {
    if ((GATE_MODES as readonly string[]).includes(explicit)) return explicit as GateMode;
    throw new Error(`unknown gate mode: ${explicit} (want warn|enforce|off)`);
  }
  const env = process.env["XTRM_LINK_GATE"];
  if (env === undefined) return "warn";
  if ((GATE_MODES as readonly string[]).includes(env)) return env as GateMode;
  throw new Error(`unknown XTRM_LINK_GATE: ${env} (want warn|enforce|off)`);
}

export class LinkGateService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;
  private readonly reader: PullRequestStateReader;

  constructor(db: DatabaseSync, issues: IssueService, reader?: PullRequestStateReader) {
    this.db = db;
    this.issues = issues;
    this.reader = reader ?? new GhPullRequestStateReader();
  }

  evaluate(issueId: string, opts: { mode?: "manual" | "auto"; now?: number } = {}): GateEvaluation {
    const mode = opts.mode ?? "manual";
    const now = opts.now ?? Date.now();
    const issue = this.issues.getIssue(issueId);
    const rows = this.db
      .prepare(
        `SELECT repository, number, relation, source, url FROM issue_pull_requests
          WHERE issue_id = ? AND superseded_at IS NULL ORDER BY created_at, rowid`,
      )
      .all(issueId) as unknown as LinkRow[];
    const links = rows.map((row) => {
      const canonical = `${row.repository}#${row.number}`;
      const commits = this.db
        .prepare("SELECT COUNT(*) AS n FROM issue_pr_commits WHERE issue_id = ? AND repository = ? AND number = ?")
        .get(issueId, row.repository, row.number) as { n: number };
      return {
        repository: row.repository,
        number: row.number,
        relation: row.relation,
        sources: [row.source],
        artifact: this.hasLiveArtifact(issueId, canonical),
        commits: commits.n,
      };
    });
    const created = links.filter((l) => l.relation === "created_from");
    const codes: string[] = [];
    // An orphaned provenance row is a failure even when another link passes.
    if (created.some((l) => l.sources.includes("provenance") && !l.artifact)) codes.push(GATE_CODES.orphan);
    const qualifying = created.filter(
      (l) => (l.sources.includes("provenance") && l.artifact) || (l.sources.includes("trailer") && l.commits > 0),
    );
    if (codes.length === 0) {
      if (qualifying.length === 0) {
        codes.push(links.length > 0 ? GATE_CODES.mentioned : GATE_CODES.noEvidence);
      } else if (mode === "auto") {
        this.autoCodes(issueId, issue.projectId, qualifying, codes, now);
      }
    }
    const verdict: GateVerdict = codes.includes(GATE_CODES.orphan) || codes.includes(GATE_CODES.unreachable)
      ? "fail"
      : codes.length > 0
        ? "refuse"
        : "pass";
    return { issueId, mode, verdict, codes, links };
  }

  /** Enforce per mode. Warn appends the event and proceeds; enforce throws
   * unless the override covers every code. */
  enforce(
    issueId: string,
    opts: { mode?: GateMode; override?: string | null; actor: string; now?: number } = { actor: "sb-cli" },
  ): GateEnforcement {
    const mode = gateModeFromEnv(opts.mode ?? null);
    if (mode === "off") return { mode, codes: [], warned: false, overridden: false };
    const now = opts.now ?? Date.now();
    const evaluation = this.evaluate(issueId, { mode: "manual", now });
    if (evaluation.codes.length === 0) return { mode, codes: [], warned: false, overridden: false };
    const issues = this.issues;
    const reason = opts.override?.trim() ?? "";
    const overridable = reason !== "" && evaluation.codes.every((code) => OVERRIDABLE.has(code));
    if (mode === "warn") {
      issues.appendEvent(issueId, "provenance.link_gate_warned", {
        codes: evaluation.codes,
        mode: "warn",
        actor: opts.actor,
      }, now);
      // An override given in warn mode is still an operator decision.
      if (overridable) this.recordOverride(issueId, evaluation.codes, reason, opts.actor);
      return { mode, codes: evaluation.codes, warned: true, overridden: overridable };
    }
    if (overridable) {
      this.recordOverride(issueId, evaluation.codes, reason, opts.actor);
      return { mode, codes: evaluation.codes, warned: false, overridden: true };
    }
    throw new Error(`close gate refused: ${evaluation.codes.join(", ")}`);
  }

  private recordOverride(issueId: string, codes: string[], reason: string, actor: string): void {
    new JournalService(this.db, this.issues).appendEntry(issueId, {
      kind: "decision",
      participantId: actor,
      semantic: { summary: `close-gate override: ${codes.join(", ")} — ${reason}` },
    });
  }

  private autoCodes(
    issueId: string,
    projectId: string,
    qualifying: GateEvaluation["links"],
    codes: string[],
    now: number,
  ): void {
    // Default branch per repository; unknown is fail-closed.
    const defaults = new Map<string, string | null>();
    for (const link of qualifying) {
      if (defaults.has(link.repository)) continue;
      defaults.set(link.repository, this.defaultBranch(link.repository, projectId, codes, now));
    }
    for (const link of qualifying) {
      let state: { state: string; baseRef: string | null } | null;
      try {
        state = this.prState(link.repository, link.number, now);
      } catch {
        if (!codes.includes(GATE_CODES.unreachable)) codes.push(GATE_CODES.unreachable);
        continue;
      }
      const base = defaults.get(link.repository) ?? null;
      if (state === null || state.state !== "merged" || (base !== null && state.baseRef !== base)) {
        if (!codes.includes(GATE_CODES.notMerged)) codes.push(GATE_CODES.notMerged);
      }
    }
    // Any other created_from PR still open blocks the auto close.
    const others = (this.db
      .prepare(
        `SELECT DISTINCT repository, number FROM issue_pull_requests
          WHERE issue_id = ? AND relation = 'created_from' AND superseded_at IS NULL`,
      )
      .all(issueId) as Array<{ repository: string; number: number }>)
      .filter((row) => !qualifying.some((q) => q.repository === row.repository && q.number === row.number));
    for (const other of others) {
      try {
        const state = this.prState(other.repository, other.number, now);
        if (state === null || state.state === "open") codes.push(GATE_CODES.otherOpenPr);
      } catch {
        if (!codes.includes(GATE_CODES.unreachable)) codes.push(GATE_CODES.unreachable);
      }
    }
    if (this.issues.getActiveClaim(issueId, { now }) !== null) codes.push(GATE_CODES.liveClaim);
    // gate_deploy_window is reserved: the model has no deploy-window fact yet.
  }

  private hasLiveArtifact(issueId: string, canonical: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM artifact_bindings a JOIN work_receipts r ON r.id = a.receipt_id
          WHERE r.issue_id = ? AND a.kind = 'pr' AND a.value = ? AND a.superseded_at IS NULL LIMIT 1`,
      )
      .get(issueId, canonical);
    return row !== undefined;
  }

  private defaultBranch(repository: string, projectId: string, codes: string[], _now: number): string | null {
    const binding = this.db
      .prepare(
        `SELECT base_branch FROM repository_bindings
          WHERE project_id = ? AND canonical_remote = ? LIMIT 1`,
      )
      .get(projectId, `github.com/${repository}`) as { base_branch: string | null } | undefined;
    if (binding?.base_branch) return binding.base_branch;
    try {
      const live = this.reader.defaultBranch(repository);
      if (live === null && !codes.includes(GATE_CODES.defaultBranch)) codes.push(GATE_CODES.defaultBranch);
      return live;
    } catch {
      if (!codes.includes(GATE_CODES.unreachable)) codes.push(GATE_CODES.unreachable);
      return null;
    }
  }

  private prState(repository: string, number: number, now: number): { state: string; baseRef: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT state, base_ref, last_synced_at FROM pull_requests WHERE repository = ? AND number = ?`,
      )
      .get(repository, number) as { state: string; base_ref: string | null; last_synced_at: number } | undefined;
    // Trust a row synced in the last 24h; otherwise read live.
    if (row !== undefined && now - row.last_synced_at < 24 * 60 * 60 * 1000) {
      return { state: row.state, baseRef: row.base_ref };
    }
    return this.reader.state(repository, number);
  }
}

export class GhPullRequestStateReader implements PullRequestStateReader {
  state(repository: string, number: number): { state: string; baseRef: string | null } | null {
    const raw = execFileSync("gh", ["api", `repos/${repository}/pulls/${number}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const body = JSON.parse(raw) as { state?: string; merged_at?: string | null; base?: { ref?: string } };
    return {
      state: body.merged_at ? "merged" : body.state === "closed" ? "closed" : "open",
      baseRef: body.base?.ref ?? null,
    };
  }

  defaultBranch(repository: string): string | null {
    const raw = execFileSync("gh", ["api", `repos/${repository}`, "--jq", ".default_branch"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return raw.trim() || null;
  }
}
