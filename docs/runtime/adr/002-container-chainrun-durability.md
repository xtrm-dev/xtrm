# ADR-002 — ChainRun, Container, durability and recovery

> Status: ACCEPTED · Date: 2026-08-22 · Absorbs: v1 reconciliation D5–D7 (uncertain/journal, delivery split); packet C-04 minimum-kernel; state-store-options §10.2 rollback predicate
> Evidence: decision matrix Q4/Q5/Q22/Q23/Q28/Q29; lane F.

## Decision

1. **No separate ChainProgram entity.** `Container` is the generic execution envelope; `ChainRun` is the chain-specific progression bound 1:1 to `Container(kind=chain)`. The pair must never hold contradictory terminal states; cleanup is whole-container, including borrowed-session release-not-kill.
2. **Effect receipts.** Every external effect carries an idempotency key (Channels key list; pulse-dedup pattern). Receipts are append-only. Admission precedes effect; a completed key returns the durable result.
3. **Uncertain state.** Mutation outcomes are completed / failed / uncertain. Uncertain blocks blind replay; reconciliation records the resolving evidence as a first-class outcome.
4. **Reducer discipline.** The reducer derives transitions from persisted evidence only — never wall-clock ticks, never live stream text. SchedulerIntents are exact and idempotent; keys are persisted before dispatch; dispatch may run in parallel (proven in the SRE vertical slice).
5. **Recovery.** Never destroy work on failure; preserve evidence on failed close; journal-with-gap-detection for any long-running actor; replay-safe recovery via receipts + journal. Storage-kernel rollback predicate (WAL checkpoint backup + integrity_check + operator-approved restore + forensic rollback event) applies to any future state store.
6. **Minimal Substrate kernel now** (without Stage-0 daemon prerequisite): stable colon-IDs; ChainRun/Container identity with parent/provenance/ownership axes; participant/activation lineage; append-only effect receipts; execution lineage (`evidence_json` dual-write); recomputable projections (truth-is-stream); explicit uncertain state; replay-safe recovery. Everything else of Substrate stays deferred behind the existing gates (R2/R9 receipt discipline).

## Consequences

- Ledger's coarse "Substrate DEFERRED" row gains a kernel exception annotation.
- Replay-equivalence and duplicate-effect grading become possible once receipts/journal land (Eval Core subjects).

## Rejected alternatives

- Gating all runtime work on full Substrate Stage-0 (reintroduces daemon-first sequencing disproven by AgentSession evidence).
- Treating "deferred" as "nothing borrowed" (loses recoverable/attributable-work invariants available now).
