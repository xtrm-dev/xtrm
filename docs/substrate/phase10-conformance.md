# Phase 9 — WorkItemStore conformance + gate behavior (frozen)

**Bead:** `xtrm-7wc.10` · **Base:** origin/main at P8 (`c1e4cba`) · **Date:** 2026-09-09
**Evidence:** `npm test` 105/105 in `packages/substrate` (`tests/workitems.test.ts` owns this phase), `tsc --noEmit` clean.

## D-35 conformance table

`S` = SubstrateIssueStore (canonical) · `B` = BeadsWorkItemStore (temporary
read-only compatibility over the passive JSONL export).

| Method | S | B | Parity note |
|---|---|---|---|
| get | pass | pass | B: export projection only; `dispatchable:false` with the import reason |
| search | pass | pass | B: substring over export; project arg accepted, ignored |
| ready | pass | pass(empty) | B returns `[]`: an export row is never dispatchable |
| validate | pass | pass | B: structural shape of the export view, not readiness |
| resolveContext | pass | fail | B: no context inheritance in Beads; explicit compat error |
| claim | pass | fail | B: no write path by design (no dual-write, §42) |
| claimReady | pass | fail | B: same; attestation lives in Substrate only |
| renew | pass | fail | B: same |
| release | pass | fail | B: same |
| update | pass | fail | B: same; revisions are Substrate-only |
| addEdge | pass | fail | B: same (`parent_child` routes via setParent on S) |
| addJournal | pass | fail | B: same; journal is Issue-scoped continuity |
| checkpoint | pass | fail | B: same |
| close | pass | fail | B: same |
| changesSince | pass | fail | B: same; event feed is Substrate-only |

Actor/trust-class: holder, attestedBy, and authoredBy pass through verbatim
on S (test asserts `human:worker` / `human:reviewer` / `human:op` survive);
manual-override identity is an explicit string, never a separate channel.

## Adversarial checklist (all in `tests/workitems.test.ts`)

- [x] Draft + rich requestedScope → refused (`is draft`; scope cannot cure ambiguity — no prompt smuggling).
- [x] Attest → edit → dispatch → refused (stale attestation invalidated).
- [x] Narrow scope `["a"]` allowed; `["a","zzz"]` reports `["zzz"]`; dispatch with `["zzz"]` rejected (§39.1).
- [x] Claim → dispatch binds the live claim; wrong claimId rejected (`not the live claim`).
- [x] Edit → re-attest → dispatch binds revision 2; revision-1 binding unchanged (immutability).
- [x] Journal-vs-memory: seam surface contains no remember/recall/promote/memory member; journal reads return entries with kind/sequence (continuity, not authority, §43).
- [x] Beads writes (claim/update/checkpoint/close/…) refuse with the compat error naming the Substrate equivalent; missing export fails with the `bd export` hint.

## Spec reconciliation boundary

`docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md` dispatch-authority
sections updated to the §39 diff (delegate `issue:` key, `ActivationRequest.issueId`,
shared-readiness gate, `sourceIssueRevision` + `sourceContractHash`, `ActivationResult.issueId`).
Guidance prose, skill/hook wiring, and runtime migration stay Phase 11 territory —
untouched here. `handoff-schema.md` still absent (stub at build, per .1 finding).

## Upstream reports (not worked around)

None from this lane: claim/lease, readiness, and provenance services behaved
per contract. The claim→dispatch pipeline needed the gate to accept `claimed`
state (mirroring `provenance.dispatch`); that is recorded in
`dispatch-gate.ts`, not papered over in tests.
