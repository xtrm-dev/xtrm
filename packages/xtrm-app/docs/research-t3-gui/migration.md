# Migration plan (sequenced, Option B + C)

Conventions: each milestone lists deliverables, acceptance, tests, risks, rollback.
Short-term reuse first; architectural changes later. No milestone breaks XTRM-601 green.

## M0 — Contract hardening (foundation, no UI)

- Deliverables: decide canonical Pi contract version (resolve `^1.0.0` vs `0.84.2`);
  locate/contract the host-side `subscribe → xtrm.agent-event.v1` emitter (open Q1);
  assign journal-gap owners (Q: `XTRM_SESSION_NAME`, GUI ingress, `sourceInfo`,
  `parentToolCallId`); delete or demote `host/providers/*` sketch to non-importable docs.
- Acceptance: emitter path documented with file/symbol/test; version assertion in CI.
- Tests: installed-Pi-version gate test.
- Rollback: docs-only; nothing to roll back.

## M1 — Shared service layer

- Deliverables: new `packages/agent-host-client` (`api/ssh/auth/references`; home repo
  decided: core vs xtrm); absorb `server/agent-host-{live,direct,ssh}.ts` fetch logic +
  `live.ts` transport half; `parity-matrix.json` + `server/parity-matrix.test.ts` +
  `e2e/parity/matrix.spec.ts` (fixture) enforcing the matrix; `unverified` rows closed.
- Acceptance: every `both` row renders through the real adapter; GUI writes still pass
  the bridge allowlist; host API major-bump still rejects.
- Tests: `npm test; npm run test:e2e` green; matrix gate in CI.
- Risks: home-repo versioning vs `@xtrm/contracts` major-reject rule.
- Rollback: bridge code paths kept behind flag until gate green.

## M2 — First vendored components (highest value, lowest coupling)

Order: diff viewer (DEPEND `@pierre/diffs`, license verified) → tool/command cards →
approval panels (restyled, authority-gated) → streaming markdown/code →
virtualized timeline → composer (de-chatted to Frame ingress + `@`-refs).
Each lands behind the adapter seam (Frame/activity contracts), with light/dark
screenshots and zero-layout-shift streaming checks per ADR-001 §7.

- Open product decisions (from evidence): bridge-or-document XTS approval transport;
  thinking-block projection (privacy/cost vs parity); `custom`/`session_info` payload fate;
  branch/fork canonical representation (flattened `kind:message` + placeholder tree tab today).
- Acceptance per component: XTRM-601 suite green; side-by-side screenshots; no duplicated
  business logic (reviewer checks imports, not just pixels).
- Rollback: per-component revert; previous surface restored in one commit.

## M3 — Topology consumer + Sessions navigator

- Deliverables: `GET /v1/topology/events` consumer (snapshot+diff merge, revision
  handling) feeding the XTRM-630 tmux-first, attention-ordered navigator; depends on
  XTRM-628 design decision + XTRM-631 lineage (`parent_pane_id`, transition timestamps).
- Acceptance: 555-session host renders live-first without jumps; rows move only on state
  transitions; history in fleet view; keyboard-reachable actions.
- Rollback: sidebar fallback retained.

## M4 — Pattern ports + interface adoptions

- Deliverables: snapshot+`afterSequence` lazy hydration for Frame/Tree (§28);
  settlement-grace detector review; SSH owns-vs-discovers + learned-route requirements;
  launcher reserved-arg hygiene (T3 `mcpInjection` list adapted); ACP-shape
  `initialize`/capability negotiation at the host Frame edge; Happy-style relay semantics
  for remote Frame projection (design only until a relay exists).
- Acceptance: each port names the replaced XTRM behavior and its before/after test.
- Rollback: pattern-level; each port independently revertible.

## M5 — Parity hardening + release

- Deliverables: real-host acceptance extended to vendored surfaces; the four §36.13
  deviations re-triaged (Tree tab, gh-adapter live backend, real specialist dispatch
  scoping, fleet promotion path); `multi-host: unsupported` row added if still non-goal.
- Acceptance: operator 30-minute working-session verdict per ADR-001 (experience bar).

## §8 Prototype and test results (this package)

No full prototypes were built — deliberately. Evidence showed the highest-risk question
(attach) is answered **no** at code level, which obviates the T3-shell-against-XTRM-backend
spike in its fork form. Prescribed spikes (each ≤ days, isolated branch/worktree,
fixtures only, never against live sessions):

1. **Adapter-seam spike**: render one T3 tool card (`ShellCommandBlock`) against a
   canned `xtrm.agent-event.v1` frame. Code paths: `apps/web/.../ShellCommandBlock.tsx`
   → `src/adapters/agent/types.ts` Activity. Proves M2's seam.
2. **Snapshot-replay spike**: replay a recorded SSE stream from `Last-Event-ID` into
   `AgentProjector` after a forced disconnect. Proves recovery §7 handling.
3. **Registry-push spike**: hand-start `pi` with the extension in an isolated tmux server;
   assert appearance in `GET /v1/sessions` without GUI launch. Proves cases 1–2 stay
   native under M1 (regression guard for the whole strategy).
4. **Parity-gate spike**: one `matrix.spec.ts` row end-to-end (launch-form fields =
   `xt pi --help` options). Proves the M1 gate pattern.
5. **Composer de-chat spike**: T3 composer state machine driving Frame ingress +
   `@`-ref budgets against `POST /v1/references/resolve`. Proves M2's riskiest component.

Existing suites reused, not duplicated: vitest `server/*.test.ts` + `adapters/**`,
fixture e2e (port 5199), real-host (port 5299, XTRM-572), acceptance XTRM-601
(`scripts/real-host-acceptance.sh`, 45 tests).

## Backlog (check Substrate before filing; no speculative tickets)

1. Canonical Pi contract version decision (+ CI version gate). 2. Emitter location/contract.
3. Journal-gap ownership. 4. `host/providers/*` disposition. 5. `agent-host-client` home repo.
6. `parity-matrix.json` + gates (M1). 7.–12. Component vendoring per M2 order (one issue each,
   created at milestone start, not now). 13. Topology consumer (XTRM-630 dependency chain).
14. XTS approval transport decision. 15. Thinking-block decision. 16. `custom`/`session_info`
   fate. 17. OpenCode source re-pin. 18. ACP/OpenHands license verification before vendoring.
19. tmux manpage/source follow-up for pane identity primitives. 20. Two-client command-race
   semantics (beyond `commandId` dup-rejection) if multi-operator becomes a goal.
