# xtrm-app documentation map

Portfolio tracker: Jira `ISSUE-140`. Repository-local executable work belongs in Substrate.

## Canonical (read in this order)

1. `xtrm-gui-prd.md` — product PRD. §34 records the accepted Console v2 baseline (2026-09-16) and wins over earlier sections where they disagree.
2. `console-v2-shell-architecture.md` — canonical shell contract: global rail, contextual sidebar, search/command/options, Inspector Drawer, routes, typed adapters, implementation waves, first executable vertical (§13.1), visual standard and shared primitives (§15).
3. `console-v2-migration-plan.md` — migration principles, Console v1 preservation, sequencing, delivery phases (§14).
4. `adoption-audit.md` — adoption policy and dispositions. §15 lists accepted decisions and still-open adoption items.

## Pinned audit evidence

| file | source audited |
|---|---|
| `console-v2-audit-supernova.md` | `mattiacerutti/supernova` @ `d0fa686` — primary visual benchmark, session-local runtime, Frame contract inputs |
| `console-v2-audit-pichamber.md` | `RyderAsKing/PiChamber` @ `87fe511` — protocol/runtime engineering reference |
| `console-v2-audit-conar-ui.md` | `wannabespace/conar` @ `d50f1d1` — UI primitives and licensing (AGPL, reference-only) |
| `console-v2-audit-deepseek-harness.md` | `deepseek-ai/deepseek-harness` @ `c291e79` — Agent/observability architecture for the Agent/Frames tranche |
| `console-v2-audit-console-v1-preservation.md` | `Jaggerxtrm/console` @ `4b0d9f5` — preservation matrix, defect register, cutover hazards |
| `console-v2-audit-console-program-graph-drawer.md` | `Jaggerxtrm/console` @ `4b0d9f5` — Beads materializer, drawer shells, Program, Graph, Observability |
| `console-v2-audit-substrate-issues-contract.md` | `xtrm-dev/xtrm` @ `9263f91` — Substrate typed-service seam and read-API gaps (re-verified @ `fdf2951` in shell architecture §9.3) |

Audit evidence is historical at its pinned revision. When it conflicts with a canonical document, the canonical document wins.

## Historical

- `implementation-packet.md`, `local-worker-dispatch.md` — pre-Console-v2 implementation briefs that use the superseded `Episode` term. Read `Episode` as `Frame`. Do not dispatch work from them.
- `../prototype/` — static HTML mock. Reference only; Phase 2 replaces it with a real React application.
- Audit briefs used to produce the PR #170 audit pack (scope, dispatch, prompt, operator context) are kept in closed PR #170 history and are not reproduced here.
