# Post-mortem — where the pq1 work landed

**Session:** 2026-08-19 · **Author:** jaggerxtrm (Opus 4.7 1M) · **Governing epic:** xtrm-pq1 (CLOSED)

This bundle preserves the entire real-infra AgentSession smoke that proved the chain runtime end-to-end. Read `BRIEF.md` first for the full narrative. This post-mortem lists **where each fix ultimately landed** — some overlap between what the smoke identified locally and what the web agent had already merged upstream. Reconciling that here so nothing looks "missing".

## Merged before this session started

- **PR #71** (`cef3cf8`) — full Specialist JSON loader (the campaign's Phase 1 foundation).

## Merged concurrently (web agent, discovered post-smoke)

- **PR #84** (`cfc2f50`, `fix(agentsession-sre): unify model resolution + emit sre-triage-runs bundle [xtrm-pq1.1, xtrm-pq1.2, xtrm-cq2]`) — landed the two P1 defects the smoke also identified:
  - **xtrm-pq1.1** — coordinator dispatches evidence_publish reliably (scheduler MUST-DO blocks equivalent).
  - **xtrm-pq1.2** — `src/agents/model-resolver.ts` unified resolver for `~/.pi/agent/models.json` custom providers; `src/chain/topology.ts` default flipped to `commandcode/deepseek/deepseek-v4-flash`.
  - Also introduces `src/chain/finalize.ts` (+344) with a `sre-triage-runs` bundle emitter and its test (+218).
  - The uncommitted diagnostic patches this session's smoke ran against were duplicates of #84's content — they are **not** re-submitted; #84 is the canonical version. `patches/uncommitted-src.diff` in this bundle is preserved as the archaeological record of what the local smoke ran against, but is superseded upstream.

## Landed this session

- **PR #85** — `fix(agentsession-sre): silence virtual-bead spam + emit LIVE MESSAGES dump on happy path [xtrm-pq1.4, xtrm-pq1.5]`. Two small follow-up fixes on top of #84:
  - **xtrm-pq1.4** — `src/adapters/beads.ts` `noteBead`/`closeBead` short-circuit on `vsvs-` virtual step ids. Eliminates dispatch.log spam when `bd init` refuses inside the run-dir.
  - **xtrm-pq1.5** — `src/agents/bridge.ts` + `src/agents/specialist-bridge.ts` LIVE MESSAGES dump moved from `catch{}` to `finally{}` so it fires on the happy path (previously silent — 0/2163 forensics events were `activation.msg.<role>`).

## Landed out-of-repo (documented but not committable here)

- **xtrm-pq1.3** — `/home/dawid/.xtrm/skills/default/sre-triage/SKILL.md` gained a 9-line "Fallback when `.mcpq.json` is not in ancestors" paragraph documenting the `mcpq --config <target-infra>/.mcpq.json` workaround for scratchpad mirrors. Both `sre-coordinator` and `sre-observability-forensics` specialists route through this shared skill.
  - The current post-fix SKILL.md is snapshotted at `patches/out-of-repo/sre-triage-SKILL.md`.
  - The proposed diff is at `patches/out-of-repo/pq1_3-mcpq-fallback.patch`.
  - Rationale/test plan at `patches/out-of-repo/pq1_3-mcpq-fallback.notes.md`.
  - Note: this edit invalidates any frozen `sre-triage` SHA256 fingerprints captured by pre-fix runs; that is the drift guard working correctly.

## Deferred (not implemented)

- **xtrm-pq1.6** — scheduler MUST-DO blocks + reviewer verdict routing: closed as **deferred design decision**. The blocks proved themselves in the smoke (reviewer PASS after 2 remediation loops with correct routing), but the generic Chain contract layer doesn't yet exist in production — hoisting them now would encode experiment-specific role names into a runtime with no other consumer. Revisit when the production ChainLoader begins.

## What this bundle contains

- `BRIEF.md` — the original 12.5 KB brief (read first; sections §1–§10)
- `POST-MORTEM.md` — this file
- `notes/DRIFT-EVIDENCE.md` — SHA256 proof of the concurrent-fork skill mutation that blocked coordinator-close
- `run/` — verbatim run state (chain/, evidence/, channels/, forensics/, projections/, report-log.json, dispatch.log, design-inputs.json)
- `patches/` — DIFF-STAT, uncommitted-src.diff, current-src/ full file snapshots (archaeological; superseded by PRs #84 and #85 as noted above)
- `patches/out-of-repo/` — pq1.3 skill snapshot + proposed diff + notes

## Handoff status

- xtrm-pq1 epic: ✓ CLOSED (all 6 children closed).
- Local git: clean; `main` includes #84; branch `fix/agentsession-sre-pq1-4-5-…` open as PR #85.
- Beads memory saved: `xtrm-pq1-epic-fully-closed-2026-08-19`, `chain-vertical-slice-xtrm-pq1-phase-3-proven`.

Coordinator/planner: this bundle plus PRs #84 and #85 constitute the entire ground truth for xtrm-pq1 Phase 3.
