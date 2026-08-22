# ADR-005 — Cooperative runtime over Channels

> Status: ACCEPTED · Date: 2026-08-22
> Relationship: **references** the canonical Channels contract; duplicates nothing.
> Canonical contract: [`../../../channels/channels.md`](../../channels/channels.md) (normative spec)

## Decision

ChainRun participants cooperate exclusively through the canonical Channels contract. This ADR records only how the runtime consumes it:

1. **Delivery vs authority.** The runtime uses the canonical split — routing decisions hard, attention soft, authority hard. Message bodies never grant authority; work refs are opaque pointers; evidence travels pointer-first and is dereferenced through the evidence system, not trusted from prose.
2. **Scheduler indirection.** Participant self-activation requests and wakes route through the single scheduler; there is no direct resume bypass. One scheduler per chain run (single-scheduler invariant).
3. **Receipt semantics.** read ≠ ack ≠ processed. Runtime replay uses execution identity cursors (`execution_id + generation + sequence`); `channel_messages.id` stays the semantic delivery cursor and is never renumbered by recovery.
4. **Typed communication.** Envelope/audience/action_targets/suggested_watchers/visibility per canon §5. Progress cards and coordinator projections follow channels-upgrade.md's sanctioned rich shapes without altering the normative schema.
5. **Mechanical failure kinds.** The `runtime.*` failure vocabulary and `chain.incident.opened/resolved` wake kinds (detect-in-reducer → deterministic recovery → coordinator wake) are absorbed into channels.md §5.3 by the W6 pass; until then plain_it §7 + substrate IT §4.3 role 5 are their recorded source.

## Non-goals

No second messaging ontology. No new message kinds defined here.

## Rejected alternatives

- Direct participant-to-participant transport bypassing Channels (loses receipts, authority boundary, forensic dual-write).
- Letting xtmux messaging become workflow authority (ADR-006).
