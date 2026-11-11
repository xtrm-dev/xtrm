// Deterministic advisories (XTRM-671, XTRM-724 A2): one rule catalogue that the
// `sb` CLI, the Claude Code plugin hooks and the Pi extension can all consume, so
// the same Substrate state yields the same nudge on every surface.
//
// Catalogue only. Rules are pure functions over plain snapshots: reading
// services happens in `snapshotIssue`, and cooldown bookkeeping happens in
// `selectAdvisory`, never inside a rule. No hook, extension or plugin imports
// this module yet — wiring it up is step-12 work on the shared tool surface.
//
// Adapted from the Pi substrate-suggest deterministic stage
// (core/pi-extensions shared/suggest.ts evaluateDeterministic), minus the LLM
// stage: every advisory here is decidable from durable state.

import type { IssueService } from "../service/issue-service.ts";
import type { JournalService } from "../service/journal-service.ts";
import { SUBSTRATE_HOLDER_ENV } from "../domain/execution-context.ts";
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

export type IdentitySource = "env" | "none";

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

/**
 * Resolves who is acting: `SUBSTRATE_HOLDER` when the launcher exported it
 * (`xt claude|pi|codex <name>` does), else nobody.
 *
 * This is a diagnostic input, never a holder source. `resolveClaimHolder`
 * (XTRM-722) is the only thing that decides a holder, and it resolves a flag,
 * then the same environment variable, then fails closed. The xt worktree name
 * is deliberately NOT consulted here: worktree-slug derivation belongs to
 * `xt attach` (CORE-2536), and `XTRM_SESSION_NAME` is never used because every
 * pane of a tmux session shares it.
 */
export function resolveIdentity(env: Record<string, string | undefined> = process.env): Identity {
  const fromEnv = env[SUBSTRATE_HOLDER_ENV]?.trim();
  if (fromEnv) return { holder: fromEnv, source: "env" };
  return { holder: null, source: "none" };
}

function minutes(ms: number): number {
  return Math.round(ms / 60000);
}

// The holder an instruction may name: the ambient one, or a placeholder for the
// operator to fill in. It is never the holder named on the claim (XTRM-724 A2
// non-goal): telling a session to act as someone else's name is the failure the
// identity rules exist to prevent.
function holderArg(identity: Identity): string {
  return identity.holder ?? "<your name>";
}

/**
 * A claim/renew command for the operator, or null when none may be emitted.
 *
 * - with no ambient holder the command carries no `--holder` at all;
 * - with an ambient holder it names that holder;
 * - when the claim belongs to someone else there is no command: re-claiming or
 *   renewing under another holder's lease contradicts holder_mismatch.
 */
function claimCommand(identity: Identity, s: IssueSnapshot, verb: "claim" | "renew"): string | null {
  const claimHolder = s.claim?.holder;
  if (claimHolder && identity.holder && identity.holder !== claimHolder) return null;
  const holderFlag = identity.holder ? ` --holder ${identity.holder}` : "";
  return `sb issue ${verb} ${s.ref}${holderFlag} --ttl-ms <ms>`;
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
      // The session sets its OWN name. Naming the claim holder here would invite
      // it to impersonate whoever owns the lease.
      `Set the holder this session acts as before writing: \`export SUBSTRATE_HOLDER=${holderArg(identity)}\`.`,
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
      add("attest_ready", "info", `${tag}: contract is draft, so it cannot be claimed`, `Repair the contract, then \`sb issue attest ${ref} --outcome ready --policy default --attested-by ${holderArg(identity)}\`.`);
    } else if (s.readinessState === "ready") {
      add("claim_start", "info", `${tag}: work is happening without a claim`, `\`sb issue claim ${ref}${identity.holder ? ` --holder ${identity.holder}` : ""} --ttl-ms <ms>\` before editing.`);
    }
    return out;
  }

  const left = s.claim.expiresAt - s.now;
  const ttl = s.claim.expiresAt - s.claim.acquiredAt;
  if (left <= 0) {
    const cmd = claimCommand(identity, s, "claim");
    add(
      "claim_expired",
      "warning",
      `${tag}: claim by ${s.claim.holder} expired ${minutes(-left)} min ago`,
      cmd === null
        ? `Do not re-claim under ${s.claim.holder}'s lease: coordinate with ${s.claim.holder}, or claim work of your own.`
        : `Re-claim now: \`${cmd}\`.`,
    );
  } else if (left < Math.max(ADVISORY_TUNING.renewFloorMs, ttl * ADVISORY_TUNING.renewFraction)) {
    const cmd = claimCommand(identity, s, "renew");
    add(
      "claim_renew",
      "warning",
      `${tag}: claim expires in ${minutes(left)} min`,
      cmd === null
        ? `Do not renew ${s.claim.holder}'s lease: coordinate with ${s.claim.holder}.`
        : `Renew: \`${cmd}\`.`,
    );
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
    add("checkpoint_due", "info", `${tag}: ${sinceCheckpoint} journal entries ${since}`, `\`sb journal checkpoint ${ref} --semantic '{"summary":"<state>","next":["<step>"]}'\`.`);
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

/**
 * First advisory not cooling down; records its cooldown in `cooldowns`.
 * The clock is injected so a rule set can be tested without waiting, and the
 * map is plain data so the consuming surface decides where it persists.
 */
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
    // Locator first, durable ref in parentheses, one value for a root issue —
    // the same shape the human surfaces use (`XTRM-668.9 (XTRM-677)`).
    label: issue.locator === issue.humanRef ? issue.humanRef : `${issue.locator} (${issue.humanRef})`,
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
