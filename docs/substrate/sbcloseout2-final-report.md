# sbcloseout2 final report (§57) — xtrm-6qu.10

Date: 2026-09-12. Coordinator-executed (lane sessions killed externally mid-acceptance; work completed solo in `xtrm-xt-pi-6qu10`).

## CURRENT HEADS

- xtrm main: `43715b9b2a902ef8ca39b9eb9d4851f59cacdeb2` (PR #180)
- Core main: `124dd0684544614c22d28c566bcdc852d5afe790` (PR #649)
- Specialists A7 candidate (private-compat proven): `8a5ff24c3b00fbc02f78de7bd0564165fa3bfc87`

## SUBSTRATE CLI

- `sb --help` lists groups issue/project/plan/journal/provenance/import/export; `--version` → `sb 0.1.0`; `sb doctor` healthy with exit 0, unhealthy with exit 1 and no silent state creation (fresh-HOME run: UNHEALTHY until `~/.xtrm` exists, then healthy).
- issue note/edit/state surfaces present with metadata/execution-bearing classification enforced.

## WORKFLOW

- Lifecycle: create → attest → validate (ready/dispatchable) → claim → note/checkpoint → resume → provenance → close/release — all exercised live on a fresh-HOME install (scratch `FH=/var/tmp/a10-fresh.O28Qm5`, literal PATH `sb`).
- Resume Capsule renders contract + checkpoint + blockers + claim from the ref alone (no chat reconstruction).
- `provenance dispatch` on a live-held issue without participant fails closed (anti-steal observed live).

## CORE

- Installer + enrollment: A8/A13 merged; fresh-HOME install via `npm ci --ignore-scripts` + global link verified live.
- Retired Beads-hook exception paths: none remaining unadjudicated (A10 §49 test enforces).
- Skills migrated: A4 (3 refs + gate) + A5 (3 refs + gate extension to 6 skills), installed copies regenerate via A8/A9.
- Hooks migrated: A6 gates (edit/stop/commit) + Pi `tool_call` holder+activation authority.
- A9 verifier (`cli/src/core/substrate-verify.ts` + tests, Core #649): additive-only, fail-closed; 58/58 suite + 20/20 live re-runs evidenced by lane.

## SPECIALISTS

- WorkItemStore neutral-port integration + Bun/SQLite seam merged (A7).
- Dispatch authority fenced by holder+activation inside the binding transaction (A7-auth).
- Pi parity: live scratch-DB chain (A5 gate 118/118 + full 372/372 suite).
- Claude parity: A7 merged evidence + public PR #335 full suite (2651 passed).
- `bead_id` creation path removed from production dispatch; no `BeadsClient`/`bd show`/`bd create` requirement remains in current Specialists code (A7 review evidence).

## FLEET MIGRATION

- Import pipeline (`sb import beads`): receipt `substrate-import-receipt/v1` with inputs census, inline-deps authority, 8-check verifier, FAIL exits nonzero with receipt attached (PR #180).
- Notes/comments → journal kind `note` with `beads-history` refs; bulk history surface in `export project` (additive; import ignores it).
- Array-form `notes` ingested with indexed keys; unhandled shapes counted skipped (A10 hardening + test).
- Live upgrade evidence (fresh-HOME scratch): dry-run no-mutation; apply PASS 8/8 checks; rerun 0 created / rows stable; legacy closed lands `done` with TBD contract; legacy comment present in journal.
- `skippedPresent` resolves via global aliases (rerun + cross-project idempotent by design; receipt states it).

## FRESH MACHINE (§50)

- Scratch HOME with no `~/.xtrm`, no `sb`: local-source install + `sb doctor` + project create/link + full issue lifecycle + resume + close/release — transcript `/var/tmp/a10-fresh.O28Qm5` (state.db retained there for audit).
- Observation: `sb doctor` reports `unable to open database file` until `~/.xtrm` exists; the `xt init` path creates it. Doctor error is accurate, not a bug.
- `bd`/`dolt`/`bv` absent throughout: harmless; no `.beads` created; no Beads hooks/skills installed.

## LEGACY UPGRADE (§51)

- Synthetic Beads fixture (open/closed/child, blocks edge, note, comment, close_reason) → dry-run → apply (PASS) → rerun (PASS, zero growth). See FLEET MIGRATION.
- Full-board live proof: .9.1 lane `/var/tmp/a9-proof` (278/384 rows, 8/8 checks, 120 journal rows) on record.

## TESTS

- `node --test tests/*.test.ts` in `packages/substrate`: **377 pass / 0 fail** (includes §49 cutover, skill-migration gate, migration/import, pi-tool-call authority, hook parity).
- `tsc --noEmit`: clean.
- PR CI: xtrm #178/#179/#180 all green (unit x2 + Socket x2); Core #649 all 8 checks green (incl. dist-freshness after rebuild).

## REMAINING LEGACY

- Historical documents, migration implementation/tests, passive importer, archived records only — enforced by `cutover.test.ts` (§49 patterns + manifest dependency check).
- Global `bd`/`dolt`/`bv` intentionally left installed (ADR §46: ownership unprovable).

## §54 HOOK DISPOSITIONS (operator-visible)

| Retired Beads hook | Substrate disposition | Location |
|---|---|---|
| beads-edit-gate | substrate-edit-gate (writer-lease fenced, fail-open exit 0) | integrations/claude-code/edit-gate.ts |
| beads-commit-gate | nudge-only commit-check; enforcement is ProvenanceService contract-hash/workspace binding recorded post-commit | integrations/claude-code/commit-check.ts |
| beads-claim-sync | native session/claim binding (claim = atomic lease) | issue-service claim verbs |
| beads-stop-gate | continuity/active-work gate; reads active claim (holder), writes mechanical checkpoint if none; never blocks exit (header corrected: no writer-lease enforcement here — that lives in tool_call/dispatch authority) | integrations/claude-code/stop-gate.ts |
| beads-compact-save | Journal mechanical checkpoint | precompact.ts / journal checkpoint |
| beads-compact-restore | Resume Capsule | `sb issue resume` |
| beads-status-cache | Substrate projection (retired as separate cache) | read surfaces |
| beads-memory-gate | retired; separate memory architecture (close-time ack only) | — |

No safety behavior disappeared: every retired hook has a named successor above; commit enforcement moved (not removed) into provenance binding.

## §56 NO-PREMATURE-COMPLETION CHECKLIST

Not declared complete on tests/MCP/plugin/sb-existence/importer-existence grounds. Completion claimed only on: fresh-machine lifecycle (§50 live), upgrade preservation (§51 live), resume-without-chat (§52 live), both-provider specialist path (A7 merged evidence + live chains), hook parity (§54 table + tests), docs (§55 five sources + help), and this report.

## §58 FINAL ARCHITECTURE

As drawn in the ADR; verified live: single `~/.xtrm/state.db` authority, `sb` + Pi extension + Claude plugin consumers, WorkItemStore → Specialists both runtimes.

## §59 DEFINITION OF COMPLETE — ASSESSMENT

1. Fresh machine never hearing of Beads can perform the full lifecycle: TRUE (§50 transcript).
2. Beads-era repo runs migration, preserves work/history, emerges clean: TRUE (§51 evidence + receipt design + §49 anti-regression).
3. Fresh worker resumes unfinished work without previous conversation: TRUE (§52 resume capsule live).

## OPEN BLOCKERS

None.
