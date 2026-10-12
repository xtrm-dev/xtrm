# ADR proposal: GUI modernization via selective T3 reuse (Option B + C)

**Status:** PROPOSED (not accepted) · **Date:** 2026-10-12
**Series:** xtrm-app ADR (next number after ADR-001) — separate from runtime ADR 001–006.
**Context:** mission "Deep Architecture Research & GUI Modernization from T3 Code";
evidence package `docs/research-t3-gui/`.

## Decision

Keep the XTRM agent host as the canonical control plane. Modernize the GUI by vendoring
T3 Code presentation components behind Frame/activity adapter seams, porting proven
patterns, and converging incrementally behind parity gates. Do not fork T3 as the
application. Full rationale, scores, and risk register: `research-t3-gui/decision.md`.

## Drivers (ranked)

1. Existing-session adoption without duplicate processes (first-class, non-negotiable).
2. CLI/GUI parity as measurable contract (matrix + gates exist; extend, don't rebuild).
3. Remote-first over long-running tmux (transports accepted; keep them).
4. Time to mature UI (component reuse, not runtime replacement).
5. Controlled upstream divergence (pinned fork, adapter seams, per-milestone sync review).

## Alternatives rejected (with reason)

- **A — T3-derived application:** T3 owns every agent process (spawn/kill, reserved args,
  unsolicited-activity terminate) and has no attach primitive; adoption would require
  deleting the orchestrator, settlement, and transcript truth — the fork keeps only the UI
  while paying permanent divergence. Evidence: `reuse-inventory.md`, `decision.md` §1.
- **D — alternative architecture:** none surfaced that beats B on the ranked drivers;
  ACP/Happy/OpenHands contributions folded into B as interface adoptions/pattern ports.

## Consequences

- M0–M5 per `migration.md`; XTRM-601 stays green throughout; Phase 0 visuals still decided
  by XTRM-628 (this ADR does not pre-empt ADR-001's open direction).
- Vendored components carry T3 MIT notices + transitive license verification
  (`@pierre/diffs`, ghostty pins, agent-device shims) before each M2 landing.
- New core capabilities from GUI work are CLI-exposed or explicitly exempted (parity matrix
  is the enforcement point).

## Open until acceptance

Emitter location/contract, Pi canonical version, journal-gap ownership,
`agent-host-client` home repo — all M0/M1, none blocking this ADR's acceptance.
