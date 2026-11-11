// XTRM-671 / XTRM-724 A2: the advisory catalogue is the single authority for
// when a nudge is correct. Every test here is written to turn red when its rule
// is removed or its comparison inverted: the rule must fire AT its boundary and
// stay silent ONE STEP outside it. A happy-path assertion would survive either
// mutation, so the pair is the test.
//
// The rules take plain snapshots, so the catalogue is exercised without a
// database; `snapshotIssue` and `formatAdvisory` are covered once at the end
// against real services, which is the only place a service is involved.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type { Identity, IssueSnapshot } from "../src/presentation/advisories.ts";
import {
  ADVISORY_COOLDOWN_MIN,
  ADVISORY_TUNING,
  evaluateIssue,
  evaluateOperation,
  formatAdvisory,
  resolveIdentity,
  selectAdvisory,
  snapshotIssue,
} from "../src/presentation/advisories.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { contract, setup } from "./helpers.ts";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const MIN = 60_000;

const ME: Identity = { holder: "adopt-302", source: "env" };
const NOBODY: Identity = { holder: null, source: "none" };

function snap(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    ref: "XTRM-1",
    label: "XTRM-1",
    lifecycleState: "open",
    readinessState: "ready",
    claim: null,
    journalSeq: 0,
    lastCheckpointSeq: 0,
    latestKind: null,
    handoffsSinceClaim: 0,
    now: T0,
    ...overrides,
  };
}

/**
 * A live claim described by its TTL and the time left, so a boundary test states
 * `ttlMs`/`leftMs` directly instead of relying on acquired/expires arithmetic.
 */
function claimed(opts: { holder?: string; ttlMs?: number; leftMs?: number } = {}, overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  const ttlMs = opts.ttlMs ?? 2 * HOUR;
  const leftMs = opts.leftMs ?? HOUR;
  return snap({
    claim: {
      holder: opts.holder ?? "adopt-302",
      activationId: null,
      acquiredAt: T0 - (ttlMs - leftMs),
      expiresAt: T0 + leftMs,
    },
    ...overrides,
  });
}

const codes = (list: { code: string }[]): string[] => list.map((a) => a.code);

describe("advisories: identity is a diagnostic, never a holder source", () => {
  it("reads SUBSTRATE_HOLDER when present and nothing otherwise", () => {
    assert.deepEqual(resolveIdentity({ SUBSTRATE_HOLDER: "adopt-302" }), { holder: "adopt-302", source: "env" });
    assert.deepEqual(resolveIdentity({ SUBSTRATE_HOLDER: "  spaced  " }), { holder: "spaced", source: "env" });
    assert.deepEqual(resolveIdentity({}), { holder: null, source: "none" });
    // A blank variable is absent, not a holder named "".
    assert.deepEqual(resolveIdentity({ SUBSTRATE_HOLDER: "   " }), { holder: null, source: "none" });
  });

  it("does not derive a holder from a worktree path or the session name", () => {
    // The same worktree-shaped values the xt launcher exposes must stay inert:
    // worktree-slug derivation belongs to `xt attach` (CORE-2536), and one
    // tmux session name is shared by every pane in it.
    const env = { XTRM_SESSION_NAME: "xx", XTRM_SESSION_ID: "$1", SUBSTRATE_ISSUE_REF: "XTRM-737" };
    assert.deepEqual(resolveIdentity(env), { holder: null, source: "none" });
  });
});

describe("advisories: identity rules come first and read the claim", () => {
  it("identity_missing fires for a live claim when the session has no holder", () => {
    const list = evaluateIssue(claimed(), NOBODY);
    assert.equal(list[0]?.code, "identity_missing", "the identity diagnostic leads the list");
    assert.equal(list[0]?.severity, "warning");
    assert.match(list[0]?.message ?? "", /no SUBSTRATE_HOLDER/);
  });

  it("identity_missing stays silent when a holder is known or nothing is claimed", () => {
    assert.ok(!codes(evaluateIssue(claimed(), ME)).includes("identity_missing"), "a known holder needs no diagnostic");
    // Nothing is claimed, so there is nothing to attribute an edit to yet.
    assert.ok(!codes(evaluateIssue(snap({ readinessState: "draft" }), NOBODY)).includes("identity_missing"));
  });

  it("holder_mismatch names both holders and never rewrites the claim", () => {
    const s = claimed({ holder: "someone-else" });
    const list = evaluateIssue(s, ME);
    assert.equal(list[0]?.code, "holder_mismatch");
    assert.match(list[0]?.message ?? "", /claimed by someone-else, this session is adopt-302/);
    assert.match(list[0]?.instruction ?? "", /Do not edit under someone-else's claim/);
    assert.ok(!codes(evaluateIssue(claimed(), ME)).includes("holder_mismatch"), "the matching holder is silent");
  });

  it("the two identity diagnostics are exclusive: a mismatch is not also a missing holder", () => {
    const list = codes(evaluateIssue(claimed({ holder: "someone-else" }), ME));
    assert.deepEqual(list.filter((c) => c === "identity_missing" || c === "holder_mismatch"), ["holder_mismatch"]);
  });
});

describe("advisories: readiness rules", () => {
  it("attest_ready fires on an unclaimed draft and is silent on ready", () => {
    const draft = evaluateIssue(snap({ readinessState: "draft" }), ME);
    assert.deepEqual(codes(draft), ["attest_ready"]);
    assert.match(draft[0]?.instruction ?? "", /sb issue attest XTRM-1 --outcome ready/);
    assert.deepEqual(codes(evaluateIssue(snap({ readinessState: "ready" }), ME)), ["claim_start"]);
  });

  it("claim_start fires on unclaimed ready work and is silent when blocked", () => {
    assert.match(evaluateIssue(snap({ readinessState: "ready" }), ME)[0]?.instruction ?? "", /sb issue claim XTRM-1 --holder adopt-302/);
    assert.deepEqual(codes(evaluateIssue(snap({ readinessState: "blocked" }), ME)), [], "blocked work is not actionable");
  });
});

describe("advisories: claim rules sit on their boundaries", () => {
  it("claim_expired fires at expiry and not one millisecond before", () => {
    const expired = evaluateIssue(claimed({ leftMs: 0 }), ME);
    assert.equal(expired[0]?.code, "claim_expired");
    assert.match(expired[0]?.message ?? "", /expired 0 min ago/);
    const live = codes(evaluateIssue(claimed({ leftMs: 1 }), ME));
    assert.ok(!live.includes("claim_expired"), "a claim with any time left is not expired");
  });

  it("claim_renew fires below the larger of the floor and the TTL fraction", () => {
    // TTL 2h => 20% is 24 min, above the 5 min floor.
    const threshold = 24 * MIN;
    const atThreshold = codes(evaluateIssue(claimed({ ttlMs: 2 * HOUR, leftMs: threshold }), ME));
    assert.ok(!atThreshold.includes("claim_renew"), "exactly at the threshold is still comfortable");
    const insideThreshold = codes(evaluateIssue(claimed({ ttlMs: 2 * HOUR, leftMs: threshold - 1 }), ME));
    assert.ok(insideThreshold.includes("claim_renew"), "one millisecond inside the window renews");
  });

  it("claim_renew honours the floor when the TTL fraction is smaller", () => {
    // A 10 min TTL: 20% is 2 min, so the 5 min floor decides.
    const justAboveFloor = codes(evaluateIssue(claimed({ ttlMs: 10 * MIN, leftMs: 5 * MIN + 1 }), ME));
    assert.ok(!justAboveFloor.includes("claim_renew"));
    const justBelowFloor = codes(evaluateIssue(claimed({ ttlMs: 10 * MIN, leftMs: 5 * MIN - 1 }), ME));
    assert.ok(justBelowFloor.includes("claim_renew"));
  });

  it("an expired claim does not also ask for a renewal", () => {
    const list = codes(evaluateIssue(claimed({ ttlMs: 2 * HOUR, leftMs: -5 * MIN }), ME));
    assert.ok(list.includes("claim_expired"));
    assert.ok(!list.includes("claim_renew"), "expiry and renewal are alternatives, not a pair");
  });
});

describe("advisories: work-state rules", () => {
  it("close_due fires when the latest entry is a result", () => {
    const claimedAt = claimed({}, { journalSeq: 2, latestKind: "result" });
    assert.ok(codes(evaluateIssue(claimedAt, ME)).includes("close_due"));
    assert.ok(!codes(evaluateIssue(claimed({}, { journalSeq: 2, latestKind: "note" }), ME)).includes("close_due"));
  });

  it("revise_contract fires for a claimed draft revision", () => {
    assert.ok(codes(evaluateIssue(claimed({}, { readinessState: "draft" }), ME)).includes("revise_contract"));
    assert.ok(!codes(evaluateIssue(claimed({}, { readinessState: "ready" }), ME)).includes("revise_contract"));
  });

  it("checkpoint_due fires at eight entries since the last checkpoint", () => {
    const at = codes(evaluateIssue(claimed({}, { journalSeq: 8, lastCheckpointSeq: 0 }), ME));
    assert.ok(at.includes("checkpoint_due"), "eight entries with no checkpoint");
    const below = codes(evaluateIssue(claimed({}, { journalSeq: 9, lastCheckpointSeq: 2 }), ME));
    assert.ok(!below.includes("checkpoint_due"), "seven entries since the last checkpoint is below the bar");
    const exactly = codes(evaluateIssue(claimed({}, { journalSeq: 10, lastCheckpointSeq: 2 }), ME));
    assert.ok(exactly.includes("checkpoint_due"), "eight entries since the last checkpoint is the bar");
  });

  it("checkpoint_due waits for three entries when no checkpoint has ever been written", () => {
    assert.ok(!codes(evaluateIssue(claimed({}, { journalSeq: 2, lastCheckpointSeq: 0 }), ME)).includes("checkpoint_due"));
    assert.ok(codes(evaluateIssue(claimed({}, { journalSeq: ADVISORY_TUNING.firstCheckpointAfter, lastCheckpointSeq: 0 }), ME)).includes("checkpoint_due"));
  });

  it("handoff_due is a stop-phase rule with a thirty-minute threshold and no handoff", () => {
    // Acquired exactly thirty minutes ago, with plenty of TTL left.
    const thirtyMinAgo = { ttlMs: 4 * HOUR, leftMs: 4 * HOUR - ADVISORY_TUNING.handoffAfterMs };
    assert.ok(codes(evaluateIssue(claimed(thirtyMinAgo), ME, { phase: "stop" })).includes("handoff_due"), "at the threshold");
    assert.ok(!codes(evaluateIssue(claimed({ ttlMs: 4 * HOUR, leftMs: 4 * HOUR - ADVISORY_TUNING.handoffAfterMs + 1 }), ME, { phase: "stop" })).includes("handoff_due"), "one millisecond early");
    assert.ok(!codes(evaluateIssue(claimed(thirtyMinAgo), ME, { phase: "tool" })).includes("handoff_due"), "not during a tool call");
    assert.ok(!codes(evaluateIssue(claimed(thirtyMinAgo, { handoffsSinceClaim: 1 }), ME, { phase: "stop" })).includes("handoff_due"), "a handoff already exists");
  });

  it("terminal issues produce no advisories at all", () => {
    for (const lifecycleState of ["done", "cancelled", "archived"]) {
      assert.deepEqual(evaluateIssue(claimed({}, { lifecycleState }), NOBODY, { phase: "stop" }), [], `${lifecycleState} is terminal`);
    }
  });
});

describe("advisories: operation rules describe one write", () => {
  it("identity_missing fires when a write lands with no participant", () => {
    const list = evaluateOperation({ op: "journal_append", issueRef: "XTRM-1", kind: "finding", participantId: null });
    assert.deepEqual(codes(list), ["identity_missing"]);
    assert.match(list[0]?.message ?? "", /the finding entry was recorded with no author/);
    assert.deepEqual(evaluateOperation({ op: "journal_append", issueRef: "XTRM-1", kind: "finding", participantId: "adopt-302" }), []);
  });

  it("close_without_result fires for a completed closure with no reference", () => {
    const bare = evaluateOperation({ op: "issue_close", issueRef: "XTRM-1", outcome: "completed", resultRefs: 0, evidenceRefs: 0, participantId: "adopt-302" });
    assert.deepEqual(codes(bare), ["close_without_result"]);
    const withEvidence = evaluateOperation({ op: "issue_close", issueRef: "XTRM-1", outcome: "completed", resultRefs: 0, evidenceRefs: 1, participantId: "adopt-302" });
    assert.deepEqual(withEvidence, [], "one reference is enough");
    const cancelled = evaluateOperation({ op: "issue_close", issueRef: "XTRM-1", outcome: "cancelled", resultRefs: 0, evidenceRefs: 0, participantId: "adopt-302" });
    assert.deepEqual(cancelled, [], "a cancellation needs no result");
  });
});

describe("advisories: cooldowns are per code and per issue", () => {
  const list = [
    { code: "identity_missing" as const, severity: "warning" as const, issueRef: "XTRM-1", message: "m", instruction: "i" },
    { code: "claim_start" as const, severity: "info" as const, issueRef: "XTRM-1", message: "m", instruction: "i" },
  ];

  it("suppresses a repeat inside the window and allows it after", () => {
    const cooldowns: Record<string, number> = {};
    assert.equal(selectAdvisory(list, cooldowns, T0)?.code, "identity_missing");
    // The second code is not cooling down, so it surfaces while the first waits.
    assert.equal(selectAdvisory(list, cooldowns, T0 + MIN)?.code, "claim_start");
    assert.equal(selectAdvisory(list, cooldowns, T0 + 2 * MIN), null, "both are cooling down");
    const window = ADVISORY_COOLDOWN_MIN.identity_missing * MIN;
    assert.equal(selectAdvisory(list, cooldowns, T0 + window - 1), null, "one millisecond early is still suppressed");
    assert.equal(selectAdvisory(list, cooldowns, T0 + window)?.code, "identity_missing", "at the window it is reusable");
  });

  it("keeps the cooldown per issue, so another issue is unaffected", () => {
    const cooldowns: Record<string, number> = {};
    selectAdvisory(list, cooldowns, T0);
    const other = list.map((a) => ({ ...a, issueRef: "XTRM-2" }));
    assert.equal(selectAdvisory(other, cooldowns, T0)?.code, "identity_missing", "a different issue has its own cooldown");
  });

  it("every code has a cooldown entry, and an operation rule never cools down", () => {
    for (const code of Object.keys(ADVISORY_COOLDOWN_MIN)) {
      assert.equal(typeof ADVISORY_COOLDOWN_MIN[code as keyof typeof ADVISORY_COOLDOWN_MIN], "number");
    }
    assert.equal(ADVISORY_COOLDOWN_MIN.close_without_result, 0, "a closure finding describes that closure");
  });
});

describe("advisories: snapshot and formatting against real services", () => {
  it("snapshotIssue reports the claim, the journal position and the latest kind", () => {
    const ctx = setup();
    const journal = new JournalService(ctx.db, ctx.svc);
    try {
      const issue = ctx.svc.createIssue({
        projectId: "prj_xtrm",
        title: "snapshot",
        kind: "task",
        contract: contract(),
        scrutiny: "LOW",
        authoredBy: "tester",
      });
      ctx.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
      ctx.svc.claimIssue(issue.id, "adopt-302");
      journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "the first entry says what changed and why it matters" } });
      // The claim's real timestamps come from the clock, so the snapshot's
      // `now` must too; T0 is a synthetic boundary value used by the rule tests.
      const now = Date.now();
      const s = snapshotIssue(ctx.svc, journal, issue.id, now);
      assert.equal(s.ref, issue.humanRef);
      assert.equal(s.claim?.holder, "adopt-302");
      assert.equal(s.journalSeq, 1);
      assert.equal(s.lastCheckpointSeq, 0);
      assert.equal(s.latestKind, "note");
      assert.equal(s.now, now);
      // A draft-free, claimed issue yields exactly the work-state nudges.
      const list = codes(evaluateIssue(s, ME));
      assert.deepEqual(list, [], "nothing is due on a fresh claim");
    } finally {
      ctx.db.close();
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it("formatAdvisory keeps the operator line short and the agent line actionable", () => {
    const [a] = evaluateIssue(snap({ readinessState: "ready" }), ME);
    const formatted = formatAdvisory(a!);
    assert.match(formatted.user, /^Substrate · XTRM-1: work is happening without a claim$/);
    assert.match(formatted.agent, /^Substrate advisory \(claim_start\): .*`sb issue claim XTRM-1 --holder adopt-302/);
  });
});
