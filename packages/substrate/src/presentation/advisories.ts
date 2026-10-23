// Deterministic advisories (XTRM-671): one rule catalogue that the sb CLI,
// the Claude Code plugin hooks and the Pi extension all consume, so the same
// Substrate state yields the same nudge on every surface. Rules are pure
// functions over plain snapshots; reading services and persisting cooldowns
// happen in the thin helpers at the bottom, never inside a rule.
//
// Adapted from the Pi substrate-suggest deterministic stage
// (core/pi-extensions shared/suggest.ts evaluateDeterministic), minus the
// LLM stage: every advisory here is decidable from durable state.

import type { IssueService } from "../service/issue-service.ts";
import type { JournalService } from "../service/journal-service.ts";
import { SUBSTRATE_HOLDER_ENV } from "../domain/execution-context.ts";
import { displayRef } from "../domain/issue.ts";
import { TERMINAL_LIFECYCLE } from "../domain/readiness.ts";

export type AdvisoryCode =
  | "identity_missing"
  | "holder_mismatch"
  | "attest_ready"
  | "claim_start"
  | "claim_expired"
  | "claim_renew"
  | "close_due"
  | "revise_contract"
  | "checkpoint_due"
  | "handoff_due"
  | "close_without_result";

export interface Advisory {
  code: AdvisoryCode;
  severity: "info" | "warning";
  issueRef: string | null;
  // One line for the operator (systemMessage / notify).
  message: string;
  // Exact next step for the agent (additionalContext / tool-result append).
  instruction: string;
}

export type IdentitySource = "env" | "worktree" | "none";

export interface Identity {
  holder: string | null;
  source: IdentitySource;
}

export interface IssueSnapshot {
  ref: string;
  /** Human label (locator plus durable ref); messages only, never commands. */
  label?: string;
  lifecycleState: string;
  readinessState: string | null;
  claim: { holder: string; activationId: string | null; acquiredAt: number; expiresAt: number } | null;
  journalSeq: number;
  lastCheckpointSeq: number;
  latestKind: string | null;
  handoffsSinceClaim: number;
  now: number;
}

const TERMINAL = new Set<string>(TERMINAL_LIFECYCLE);

export const ADVISORY_TUNING = {
  // Renew when less than this fraction of the TTL is left, never below the floor.
  renewFraction: 0.2,
  renewFloorMs: 5 * 60 * 1000,
  entriesSinceCheckpoint: 8,
  // With no checkpoint ever, wait for a few entries before asking for one.
  firstCheckpointAfter: 3,
  // A claim this old without any handoff draws a handoff advisory at Stop.
  handoffAfterMs: 30 * 60 * 1000,
} as const;

// Minutes before the same advisory may repeat for the same issue.
export const ADVISORY_COOLDOWN_MIN: Record<AdvisoryCode, number> = {
  identity_missing: 30,
  holder_mismatch: 30,
  attest_ready: 30,
  claim_start: 30,
  claim_expired: 10,
  claim_renew: 10,
  close_due: 20,
  revise_contract: 30,
  checkpoint_due: 20,
  handoff_due: 60,
  close_without_result: 0,
};

// xt names each worktree `<repo>-xt-<runtime>-<name>`; the name is unique per
// worker, unlike XTRM_SESSION_NAME, which every pane of a tmux session shares.
const XT_WORKTREE = /\/\.xtrm\/worktrees\/[^/]*?-xt-(?:claude|pi|codex)-([A-Za-z0-9][\w.-]*)(?:\/|$)/;

/** Resolves who is acting: SUBSTRATE_HOLDER, else the xt worktree name, else nobody. */
export function resolveIdentity(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): Identity {
  const fromEnv = env[SUBSTRATE_HOLDER_ENV]?.trim();
  if (fromEnv) return { holder: fromEnv, source: "env" };
  const m = XT_WORKTREE.exec(cwd);
  if (m?.[1]) return { holder: m[1], source: "worktree" };
  return { holder: null, source: "none" };
}

function minutes(ms: number): number {
  return Math.round(ms / 60000);
}

function holderArg(identity: Identity, s: IssueSnapshot): string {
  return identity.holder ?? s.claim?.holder ?? "<name>";
}

/**
 * Issue-level rules, ordered by priority (callers usually surface the first
 * one that is not cooling down). `phase: "stop"` adds the end-of-turn rules.
 */
export function evaluateIssue(s: IssueSnapshot, identity: Identity, opts: { phase?: "tool" | "stop" } = {}): Advisory[] {
  if (TERMINAL.has(s.lifecycleState)) return [];
  const out: Advisory[] = [];
  const ref = s.ref;
  const tag = s.label ?? ref;
  const add = (code: AdvisoryCode, severity: Advisory["severity"], message: string, instruction: string) =>
    out.push({ code, severity, issueRef: ref, message, instruction });

  if (s.claim && identity.source === "none") {
    add(
      "identity_missing",
      "warning",
      `${tag}: no SUBSTRATE_HOLDER in this session; journal entries record no author and edits are refused`,
      `Set the holder before writing: \`export SUBSTRATE_HOLDER=${s.claim.holder}\` if you are ${s.claim.holder}.`,
    );
  } else if (s.claim && identity.holder && identity.holder !== s.claim.holder) {
    add(
      "holder_mismatch",
      "warning",
      `${tag}: claimed by ${s.claim.holder}, this session is ${identity.holder}`,
      `Do not edit under ${s.claim.holder}'s claim; coordinate with ${s.claim.holder} or claim your own issue.`,
    );
  }

  if (!s.claim) {
    if (s.readinessState === "draft") {
      add("attest_ready", "info", `${tag}: contract is draft, so it cannot be claimed`, `Repair the contract, then \`sb issue attest ${ref} --outcome ready --policy default --attested-by ${holderArg(identity, s)}\`.`);
    } else if (s.readinessState === "ready") {
      add("claim_start", "info", `${tag}: work is happening without a claim`, `\`sb issue claim ${ref} --holder ${holderArg(identity, s)} --ttl-ms <ms>\` before editing.`);
    }
    return out;
  }

  const left = s.claim.expiresAt - s.now;
  const ttl = s.claim.expiresAt - s.claim.acquiredAt;
  if (left <= 0) {
    add("claim_expired", "warning", `${tag}: claim by ${s.claim.holder} expired ${minutes(-left)} min ago`, `Re-claim now: \`sb issue claim ${ref} --holder ${s.claim.holder} --ttl-ms <ms>\`.`);
  } else if (left < Math.max(ADVISORY_TUNING.renewFloorMs, ttl * ADVISORY_TUNING.renewFraction)) {
    add("claim_renew", "warning", `${tag}: claim expires in ${minutes(left)} min`, `Renew: \`sb issue renew ${ref} --holder ${s.claim.holder} --ttl-ms <ms>\`.`);
  }

  if (s.latestKind === "result") {
    add("close_due", "info", `${tag}: a result is recorded; the issue is still open`, `If validation passed: \`sb issue close ${ref} --outcome completed --reason "<why>" --result <journal-id>\`.`);
  }
  if (s.readinessState === "draft") {
    add("revise_contract", "warning", `${tag}: claimed, but the current contract revision is draft`, `Re-attest the revision you are executing: \`sb issue validate ${ref}\` and attest, or repair the contract via /planning.`);
  }
  const sinceCheckpoint = s.journalSeq - s.lastCheckpointSeq;
  if (sinceCheckpoint >= ADVISORY_TUNING.entriesSinceCheckpoint || (s.lastCheckpointSeq === 0 && s.journalSeq >= ADVISORY_TUNING.firstCheckpointAfter)) {
    const since = s.lastCheckpointSeq === 0 ? "and no checkpoint yet" : "since the last checkpoint";
    add("checkpoint_due", "info", `${tag}: ${sinceCheckpoint} journal entries ${since}`,`\`sb journal checkpoint ${ref} --semantic '{"summary":"<state>","next":["<step>"]}'\`.`);
  }
  if (opts.phase === "stop" && s.handoffsSinceClaim === 0 && s.now - s.claim.acquiredAt >= ADVISORY_TUNING.handoffAfterMs) {
    add("handoff_due", "info", `${tag}: no handoff since the claim ${minutes(s.now - s.claim.acquiredAt)} min ago`, `\`sb journal append ${ref} --kind handoff --semantic '{"summary":"<state, evidence>","next":["<step>"]}'\`.`);
  }
  return out;
}

export type OperationFact =
  | { op: "journal_append"; issueRef: string; issueLabel?: string; kind: string; participantId: string | null }
  | { op: "issue_close"; issueRef: string; issueLabel?: string; outcome: string | null; resultRefs: number; evidenceRefs: number; participantId: string | null };

/** Rules on the result of one write; they describe that write, so they never cool down. */
export function evaluateOperation(fact: OperationFact): Advisory[] {
  const out: Advisory[] = [];
  if (fact.participantId === null) {
    out.push({
      code: "identity_missing",
      severity: "warning",
      issueRef: fact.issueRef,
      message: `${fact.issueLabel ?? fact.issueRef}: the ${fact.op === "issue_close" ? "closure" : `${fact.kind} entry`} was recorded with no author`,
      instruction: "Set `export SUBSTRATE_HOLDER=<your name>` (xt claude|pi|codex <name> sets it) so later writes are attributed.",
    });
  }
  if (fact.op === "issue_close" && fact.outcome === "completed" && fact.resultRefs + fact.evidenceRefs === 0) {
    out.push({
      code: "close_without_result",
      severity: "warning",
      issueRef: fact.issueRef,
      message: `${fact.issueLabel ?? fact.issueRef}: closed as completed with no result or evidence reference`,
      instruction: `Record what was achieved: \`sb journal append ${fact.issueRef} --kind result --result '{"summary":"…","validation":["…"]}'\`.`,
    });
  }
  return out;
}

// ── Cooldowns ───────────────────────────────────────────────────────────────

export type AdvisoryCooldowns = Record<string, number>; // `${tag}:${code}` -> epoch ms when reusable

/** First advisory not cooling down; records its cooldown in `cooldowns`. */
export function selectAdvisory(list: Advisory[], cooldowns: AdvisoryCooldowns, now: number): Advisory | null {
  for (const a of list) {
    const key = `${a.issueRef ?? "-"}:${a.code}`;
    const until = cooldowns[key];
    if (until !== undefined && now < until) continue;
    cooldowns[key] = now + ADVISORY_COOLDOWN_MIN[a.code] * 60 * 1000;
    return a;
  }
  return null;
}

/** Hooks run as separate processes; cooldowns persist per session in a small JSON file. */
export function loadCooldowns(file: string): AdvisoryCooldowns {
  try {
    const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AdvisoryCooldowns) : {};
  } catch {
    return {};
  }
}

export function saveCooldowns(file: string, cooldowns: AdvisoryCooldowns): void {
  try {
    const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
    fs.writeFileSync(file, JSON.stringify(cooldowns));
  } catch {
    // best-effort: a lost cooldown only repeats one advisory
  }
}

export function cooldownFile(sessionId: string, dir?: string): string {
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  return path.join(dir ?? os.tmpdir(), `substrate-advisories-${sessionId.replace(/[^\w.-]/g, "_")}.json`);
}

// ── Snapshot from live services ─────────────────────────────────────────────

export function snapshotIssue(issues: IssueService, journal: JournalService, issueId: string, now: number = Date.now()): IssueSnapshot {
  const issue = issues.getIssue(issueId);
  const claim = issues.getActiveClaim(issueId);
  const readiness = issues.getReadiness(issueId);
  const entries = journal.listEntries(issueId);
  const latest = entries.reduce<(typeof entries)[number] | null>((a, e) => (a === null || e.sequence > a.sequence ? e : a), null);
  let lastCheckpointSeq = 0;
  let handoffsSinceClaim = 0;
  for (const e of entries) {
    if ((e.kind === "checkpoint" || e.kind === "compaction") && e.sequence > lastCheckpointSeq) lastCheckpointSeq = e.sequence;
    if (claim && e.kind === "handoff" && e.createdAt >= claim.acquiredAt) handoffsSinceClaim++;
  }
  return {
    ref: issue.humanRef,
    label: displayRef(issue.locator, issue.humanRef),
    lifecycleState: issue.lifecycleState,
    readinessState: readiness.state,
    claim: claim ? { holder: claim.holder, activationId: claim.activationId, acquiredAt: claim.acquiredAt, expiresAt: claim.expiresAt } : null,
    journalSeq: latest?.sequence ?? 0,
    lastCheckpointSeq,
    latestKind: latest?.kind ?? null,
    handoffsSinceClaim,
    now,
  };
}

/** `Substrate · <message>` for the operator; the instruction rides along for the agent. */
export function formatAdvisory(a: Advisory): { user: string; agent: string } {
  return { user: `Substrate · ${a.message}`, agent: `Substrate advisory (${a.code}): ${a.message}. ${a.instruction}` };
}
