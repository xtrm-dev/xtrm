// XTRM-976: a claim cannot outlive the issue it was taken on.
//
// Three measured facts drive this suite:
//   1. closing an issue left its claim row with `released_at NULL`, and only
//      the original holder could clear it — on a terminal issue `claim` refuses
//      as terminal and `release` refuses every other holder (anti-steal reads
//      the unreleased row, not liveness), so the row was unreclaimable and
//      unclearable at once;
//   2. every claim route on a terminal issue answered in a different shape.
//
// The third fact — a lapsed claim vanishing from every report — is the
// snapshot's, and its test lives in advisories.test.ts next to the rule.
//
// Liveness stays derived (`isLiveClaim`); no stored `live` column, no sweep.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { contract, setup } from "./helpers.ts";
import { ClosureService } from "../src/service/closure-service.ts";

const T0 = 1_786_000_000_000;
const MINUTE = 60_000;

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

function readyIssue(ctx: ReturnType<typeof setup>, times = 1) {
  return Array.from({ length: times }, (_, i) => {
    const issue = ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: `work ${i}`,
      kind: "task",
      contract: contract(),
      scrutiny: "HIGH",
    });
    ctx.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    return ctx.svc.getIssue(issue.id);
  });
}

describe("a claim cannot outlive the issue it was taken on (XTRM-976)", () => {
  let ctx: ReturnType<typeof setup>;
  let closures: ClosureService;

  beforeEach(() => {
    ctx = setup();
    closures = new ClosureService(ctx.db, ctx.svc);
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("closing releases the live claim, and the journal says the transition did it", () => {
    const [issue] = readyIssue(ctx);
    const claim = ctx.svc.claimIssue(issue!.id, "holder-a", { ttlMs: 60 * MINUTE, now: T0 });
    assert.equal(ctx.svc.getActiveClaim(issue.id, { now: T0 + MINUTE })?.id, claim.id);

    const closure = closures.closeIssue(issue.id, {
      outcome: "completed",
      reason: "shipped",
      actor: "holder-a",
      now: T0 + 2 * MINUTE,
    });

    assert.equal(ctx.svc.getActiveClaim(issue.id, { now: T0 + 3 * MINUTE }), null);
    assert.equal(ctx.svc.getUnreleasedClaim(issue.id), null);
    const row = ctx.svc.listClaims(issue.id).at(-1)!;
    assert.equal(row.releasedAt, T0 + 2 * MINUTE, "released at the close instant, not left open");

    const releaseEvent = ctx.svc.listEvents(issue.id).filter((e) => e.type === "claim.released").at(-1)!;
    const payload = releaseEvent.payload as Record<string, unknown>;
    assert.equal(payload["releasedBy"], "close", "the transition is named, not a phantom holder action");
    assert.equal(payload["closure"], closure.closureId);
    assert.equal(payload["holder"], "holder-a", "the holder is recorded for the reader, not invented as the actor");
  });

  it("a lapsed claim is released by the transition too, not stranded", () => {
    // XTRM-983 (a): this is the case XTRM-976 was filed for. Every other test in
    // this file claims with a 60-minute TTL, so the row is live at the moment the
    // transition runs; with a lapsed row the old code skipped it and left
    // released_at NULL. The lease here ends before the close does.
    const [issue] = readyIssue(ctx);
    ctx.svc.claimIssue(issue.id, "holder-a", { ttlMs: MINUTE, now: T0 });
    assert.equal(ctx.svc.getActiveClaim(issue.id, { now: T0 + 2 * MINUTE }), null, "the lease lapsed before the close");

    closures.closeIssue(issue.id, { outcome: "completed", reason: "shipped", actor: "holder-a", now: T0 + 5 * MINUTE });

    const row = ctx.svc.listClaims(issue.id).at(-1)!;
    assert.equal(row.releasedAt, T0 + 5 * MINUTE, "a lapsed row is still closed by the transition");
    assert.equal(ctx.svc.getUnreleasedClaim(issue.id), null);
    const payload = ctx.svc.listEvents(issue.id).filter((e) => e.type === "claim.released").at(-1)!.payload as Record<string, unknown>;
    assert.equal(payload["releasedBy"], "close");
    assert.equal(payload["holder"], "holder-a");
  });

  it("cancelling releases the claim too, and so does a terminal state change", () => {
    const [cancelled, archived] = readyIssue(ctx, 2);
    ctx.svc.claimIssue(cancelled!.id, "holder-a", { ttlMs: 60 * MINUTE, now: T0 });
    closures.cancelIssue(cancelled.id, { reason: "duplicate of XTRM-1", actor: "holder-a", now: T0 + MINUTE });
    assert.equal(ctx.svc.getUnreleasedClaim(cancelled.id), null);
    const cancelPayload = ctx.svc.listEvents(cancelled.id).filter((e) => e.type === "claim.released").at(-1)!.payload as Record<string, unknown>;
    // XTRM-983 (b): the cancel leg names itself. Only the archived leg asserted
    // its value, so `transition: "close"` for a cancel stayed green.
    assert.equal(cancelPayload["releasedBy"], "cancel");

    ctx.svc.claimIssue(archived!.id, "holder-b", { ttlMs: 60 * MINUTE, now: T0 });
    ctx.svc.setLifecycleState(archived.id, "archived", T0 + MINUTE);
    assert.equal(ctx.svc.getUnreleasedClaim(archived.id), null);
    const payload = ctx.svc.listEvents(archived.id).filter((e) => e.type === "claim.released").at(-1)!.payload as Record<string, unknown>;
    assert.equal(payload["releasedBy"], "archived");
  });

  it("every claim route on a terminal issue answers in one vocabulary", () => {
    const [issue] = readyIssue(ctx);
    ctx.svc.claimIssue(issue.id, "holder-a", { ttlMs: 60 * MINUTE, now: T0 });
    closures.closeIssue(issue.id, { outcome: "completed", reason: "shipped", actor: "holder-a", now: T0 + MINUTE });

    // XTRM-983 (d): the test used to pin two different sentences for one rule —
    // `not-claimable: … is terminal: lifecycle is terminal (done)` on the claim
    // route and `no-claim: … is terminal (done); a claim ends…` on renew. Both
    // routes now answer in the same words; only the verb differs, and that is
    // asserted as an equality rather than as two regexes that could drift apart.
    const claimRefusal = refusal(() => ctx.svc.claimIssue(issue.id, "holder-b", { now: T0 + 2 * MINUTE }));
    const renewRefusal = refusal(() => ctx.svc.renewClaim(issue.id, "holder-a", { now: T0 + 2 * MINUTE }));
    assert.match(claimRefusal, /^not-claimable: .* is terminal \(done\); a claim ends with the issue it was taken on, so there is nothing to claim$/);
    assert.equal(
      claimRefusal.replace(/to claim$/, "to <verb>"),
      renewRefusal.replace(/to renew$/, "to <verb>"),
      "one rule, one sentence: the routes differ only in the verb",
    );
    // release: no-op, because the transition already released the row. Failing
    // here would break `sb issue close … && sb issue release …`, which real
    // callers (and tests/skill-migration-gate.test.ts) drive.
    assert.equal(ctx.svc.releaseClaim(issue.id, "holder-b", { now: T0 + 2 * MINUTE }), null);
    assert.equal(ctx.svc.releaseClaim(issue.id, "holder-a", { now: T0 + 2 * MINUTE }), null);
  });

  it("an open issue keeps the anti-steal rule and the idempotent no-op", () => {
    const [issue] = readyIssue(ctx);
    ctx.svc.claimIssue(issue.id, "holder-a", { ttlMs: 60 * MINUTE, now: T0 });
    assert.throws(() => ctx.svc.releaseClaim(issue.id, "holder-b", { now: T0 + MINUTE }), /only the holder releases/);
    assert.notEqual(ctx.svc.releaseClaim(issue.id, "holder-a", { now: T0 + MINUTE }), null);
    assert.equal(ctx.svc.releaseClaim(issue.id, "holder-a", { now: T0 + 2 * MINUTE }), null);
    // XTRM-983 (f): a holder release carries the same payload shape as a
    // transition release, so one reader covers both and `releasedBy` always
    // names the route. The old payload was `{claim, generation}` only.
    const payload = ctx.svc.listEvents(issue.id).filter((e) => e.type === "claim.released").at(-1)!.payload as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["claim", "generation", "holder", "releasedBy"]);
    assert.equal(payload["releasedBy"], "holder");
    assert.equal(payload["holder"], "holder-a");
  });
});
