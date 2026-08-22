# Canonicalization Report — Runtime Architecture Documentation Programme

> Evidence artifact, not a source of architecture truth. Date: 2026-08-22 · Bead `xtrm-cn8`

## 1. Repos / SHAs audited

| Repo | HEAD at audit | End state |
|---|---|---|
| xtrm-dev/xtrm | main `4f6ac48c4e0b` (lanes E/F observed later vault commit `01a1b647298c`) | programme committed via vault-daemon commits + `10e5187` review repairs; 13 unpushed ahead of origin/main |
| xtrm-dev/specialists | master `0253e3e4b823` | `5ec19cd6` docs(runtime) reconciliation commit |
| xtrm-dev/core | main `ba3515330b17` | read-only (residuals filed: xtrm-cn8.6) |
| Jaggerxtrm/xtmux | main `aebb885f4296` | read-only |
| Jaggerxtrm/console | main `eb9a1ad2cd3f` | read-only (C-3 residual: xtrm-cn8.6) |
| worktree pr71-loader | `818da6553a21` | evidence only |

## 2–3. Corpus & register

**140 registered rows / 138 assets; 137 fully read** (first byte to last byte), 0 partial, 0 unread, 0 unclassified. Three justified generated residuals (`chain_templates.html`, `channels.html`, premortem fan-out outputs). Register: [source-register.json](source-register.json); lane evidence: [lanes/](lanes/) — 9 lanes (A programme, B specialists canon + WP continuity, C chain authoring + 15 formulas + terminology map, D harness/experiments + proven-bridge-target matrix, E channels contract (25 invariants), F substrate kernel split, G supervision boundary, H core/planning, I observability/eval extension map, J reference graph 437 nodes / 1,322 edges / 165 broken-link misses).

## 4–9. Disposition outcomes

- **Kept**: 51 · **Updated in place**: ~32 · **Absorb→archive**: 21 (packet PRD/ADR-index/register absorbed into `docs/runtime/**`; formulas → future ChainDefinition corpus) · **Evidence-retained**: 13 (incl. pr71 experiment trio pending PR #71 lineage) · **Archived**: 9+ · **Moved**: harness-adapters, quant doc (residual batch) · **Pointers**: execution-protocol duplicate (body similarity 1.000 across repos), agentops-suite duplicate (0.994 + corruption), stale harness twin (blob `1d98420b` vs superset `5bec00a3`), empty audit-reconcile stub, console architecture copies (pending cn8.6)
- **Duplicates eliminated**: 3 cross-repo prose duplicates pointerized; native-harness two-blob divergence resolved objectively by SHA
- **Authority conflicts resolved**: native-vs-RPC gate (Q7), template-only C1 (Q1), coarse Substrate deferral vs kernel (Q22/Q23), console host ownership (Q21/C-3), dual execution-protocol claimants, chain-template dead canon pointer, supervisor decomposition (SP-RMAP-01 closed conceptually)

## 10–12. Canonical runtime model & ADRs

Model: ChainSource → ChainDefinition → ResolvedChain → ChainRun over SpecialistDefinition → ActivationProfile → ResolvedCapabilityGrant → Activation → AgentSession; reducer/SchedulerIntent/effect-executor progression; Channels semantics; Beads work/evidence authority; supervision triad. System invariant: *Pi owns the model session. XTRM owns what that session means inside a governed workflow.*

ADRs: 001 authoring/compilation · 002 durability/recovery/minimal-kernel · 003 native participant runtime (RPC = compatibility) · 004 activation/capabilities/probes · 005 Channels cooperation · 006 supervision boundaries. Decision matrix: 30 questions with evidence, 8 non-blocking open questions.

## 13. Programme plan changes

Execution plan md/json: additive 2026-08-22 amendment — R1/GATE-HARNESS-ADR reframed to production-parity of adopted native path; C1 restated four-stage; A1/pi-extensible-workflows reclassified bounded integration; eval lane extended (17 whole-chain subjects, Prometheus low-cardinality preserved); ledger kernel exception aligned to ADR-002's 8 items; last_reconciled drift fixed. No completion state invented.

## 14. Open implementation questions

See decision matrix "Still-open": runtime.* vocabulary home, eval event naming (blocks V1.2 emitters), MCP-emitter liveness code-check, forbidden-label single source, WP-id enforcement duty, skills vendor-drift root cause, agent.ready coverage, r6g operator answers.

## 15. No-code-change confirmation

Zero source files modified in any repo (only `docs/**`, plus deletion of generated `channels.html`). Verified via diff review by independent reviewer (finding 3: zero unsanctioned deletions).

## 16. Commits

- specialists `5ec19cd6` — full W3/W4 reconciliation
- xtrm `10e5187` — review repairs + W6 cleanup; earlier programme files landed as vault-daemon auto-commits (`562e0de…23ed6ef`, contents verified = this programme's files only); 13 commits unpushed on local main
- PR strategy: push `docs/runtime-canon` branches rather than rewriting daemon history; PR A (xtrm runtime canon) + PR B (specialists reconciliation)

## 17. Validation

Freeze-gate re-run post-mutation: PASS (138 rows, 135 complete + 3 justified residuals, UNREAD=0, UNCLASSIFIED=0, AUTHORITY_CONFLICTS=0). JSON parse checks pass (plan, ledger, wp-continuity, registers). Formula count 15 ✓. Independent reviewer link-scan over new/edited files: repaired to zero known breakage (PRD depth fix, ADR-005 label).

## 18. Independent reviewer verdict

Initial: **PARTIAL** (8 findings). All findings repaired or explicitly dispositioned: HIGH identity-envelope gap → PRD section added + matrix wording corrected; MEDIUM link fixes applied; declared-not-applied rows routed to beads with owner IDs; kernel enumerations aligned; uncommitted state committed. Residual verdict basis recorded here; re-review recommended at PR time.

## 19. Remaining implementation milestone

**Make the SRE chain the first completely data-defined XTRM chain** (documented in runtime README; order: ChainSource/Definition → loader → compiler → migrate SRE topology TS → parity → profile/PREPARE/capability-resolver/probes/ActivationSupervisor/FINALIZE → receipts/recovery hardening). Follow-up documentation beads: xtrm-cn8.5 (Specialists PRD consolidation), xtrm-cn8.6 (console/core pointers + channels/substrate correction pass).
