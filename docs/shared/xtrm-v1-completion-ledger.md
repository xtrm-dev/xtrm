# XTRM v1 Final Completion Ledger

Status: canonical programme completion ledger
Reconciled: 2026-08-10, Europe/Rome
Authority: repository-local Beads for executable work; GitHub default branches and released artifacts for source/release truth; this ledger is the single cross-repository disposition index.
Design basis: docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md.
Important: this ledger records disposition, not completion by assertion. Runtime, release, deployment and promotion states remain separate.

## 1. Terminal disposition vocabulary

- DELIVERED_RELEASED — implemented, released and evidenced at the operator boundary.
- DELIVERED_SOURCE_ONLY — merged source exists, but release/deployment evidence is absent.
- GENUINE_V1_RESIDUAL — accepted v1 capability not yet delivered; it must map to an existing repository-local Bead.
- DEFERRED_BY_EXPLICIT_GATE — intentionally blocked by a named accepted gate.
- SUPERSEDED — replaced by a newer canonical decision or ledger.
- REJECTED — considered and rejected with an explicit rationale.
- RETIRED — historical item no longer active.

No row marked residual, source-only or deferred is complete.

## 2. Canonical reconciliation packets

| ID | Authority | Disposition | Required result |
|---|---|---|---|
| SP-PRD-01 | Specialists enhanced-prd.md | GENUINE_V1_RESIDUAL | Absorb execution identity, runtime/workflow supervision, uncertain mutation, bounded convergence, Channels delivery split and governed memory promotion into existing WPs. |
| SP-RMAP-01 | Specialists specialists-roadmap.md | GENUINE_V1_RESIDUAL | Clarify runtime supervisor versus workflow supervisor, resident recovery and deterministic chain authority. |
| SP-EXEC-01 | Specialists execution protocol | GENUINE_V1_RESIDUAL | Add execution envelope, leases, journal/uncertain, generation-aware replay, snapshots, convergence and runtime-derived identity. |
| SP-CHAIN-01 | Specialists chain canon/formula docs | GENUINE_V1_RESIDUAL | Bound dynamic children below a step; freeze approved topology; define convergence and terminal-limit failure. |
| SP-EVAL-01 | Specialists evaluation canon | GENUINE_V1_RESIDUAL | Add system/runtime dimensions without high-cardinality telemetry labels. |
| SP-PI-01 | Specialists Pi boundary | GENUINE_V1_RESIDUAL | Keep RPC remediation immediate; record direct AgentSession as a later ADR-quality comparison. |
| CORE-MEM-01 | Core memory-system-r6g.md | GENUINE_V1_RESIDUAL | Clarify memory classes, candidate promotion, provenance, supersession/contradiction, Channels candidates and three lenses. Document remains design/research. |
| XTRM-CHAN-01 | xtrm docs/channels/channels.md | GENUINE_V1_RESIDUAL | Canonicalize ChannelMessage → DeliveryIntent → DeliveryAttempt → ProcessingReceipt and runtime identity/backpressure/replay boundaries. |
| XTRM-CHAN-02 | Channels upgrade and forensic/attention rationale | GENUINE_V1_RESIDUAL | Align rationale with canonical Channels semantics; supersede conflicting historical assumptions. |
| XTRM-SUB-01 | Substrate rev12 design and stale EN companion | GENUINE_V1_RESIDUAL | Represent work causality and execution lineage separately; reconcile EN against canonical IT rev12. No Substrate runtime implementation. |
| XTRM-OUT-01 | xtrm command outcomes | GENUINE_V1_RESIDUAL | Add uncertain/reconciliation semantics and stable next actions. |
| XTRM-ADAPT-01 | xtrm harness/native adapters | GENUINE_V1_RESIDUAL | Require runtime-derived identity, idempotency and uncertain reconciliation; no adapter-private authority. |
| XTRM-PI-01 | xtrm native Pi tools/workflows design | GENUINE_V1_RESIDUAL | Record ownership boundaries for RPC, AgentSession, identity, leases, recovery and journal. |
| XTRM-PLAN-01 | current execution plan and JSON graph | DELIVERED_SOURCE_ONLY | This patch refreshes the sequence and baseline; implementation/release evidence remains separate. |
| XTRM-UI-01 | Console/Agent Workspace design | GENUINE_V1_RESIDUAL | Model runtime execution tree and coherent snapshot/replay; terminal panes remain projections. |
| XTRM-REG-01 | programme registry | DELIVERED_SOURCE_ONLY | This ledger absorbs the valid registry content and keeps source/release/deployment/promotion/design dimensions distinct. |
| XTRM-DRAFT-01 | draft PR #33 | SUPERSEDED | Unique valid architecture is absorbed into canonical documents; stale implementation snapshot is not merged. |
| XTRM-DRAFT-02 | draft PR #34 | SUPERSEDED | Valid registry items are absorbed here; PR #34 is not a competing master ledger and is not merged unchanged. |

## 3. Implementation and release dispositions

| Area | Disposition | Required evidence |
|---|---|---|
| Pi v0.84.1 compatibility | GENUINE_V1_RESIDUAL | Atomic RPC compatibility patch, fault-injected settlement/retry/compaction/recovery tests, supported-version CI and real RPC smoke. |
| KAN-127 K5/K6 | GENUINE_V1_RESIDUAL | Cross-repository parity matrix, published compatible releases and clean-install trio smoke. |
| specialists.execution.v1 | GENUINE_V1_RESIDUAL | Envelope, PREPARE/FINALIZE, idempotency, leases, uncertain reconciliation, replay/snapshot/recovery and bounded convergence fixtures. |
| ChainTemplate compiler / ResolvedChain | GENUINE_V1_RESIDUAL | Pure packaged compiler, persisted schema, manual composition and Beads materializer with no hidden mutation. |
| D1 reducer/scheduler/delivery | GENUINE_V1_RESIDUAL | Pure evidence reducer, scheduler intents, runtime delivery, duplicate suppression and crash/recovery matrix. |
| Quant/math vertical | GENUINE_V1_RESIDUAL | End-to-end deterministic-validator fixture through independent gate/review. |
| Eval Core/context/prompts | GENUINE_V1_RESIDUAL | Telemetry integrity, system metrics, deterministic context and measured prompt/output-contract promotion. |
| Memory WP-M01..M08 | GENUINE_V1_RESIDUAL | Pull retrieval, three lenses, candidate provenance, dedupe, contradiction/supersession, measured promotion and retention tests. |
| Channels v1 bridge | GENUINE_V1_RESIDUAL | Delivery/processing split, identity, backpressure, replay separation, reviewer/executor and human-steer paths with failure/recovery tests. |
| Pulse/attention/projections | GENUINE_V1_RESIDUAL | Pulse/emitter compatibility, attention/backpressure/recovery and separate work/execution lineage projections. |
| Substrate runtime/migration | DEFERRED_BY_EXPLICIT_GATE | Target runtime and migration are explicitly excluded from this campaign; bridge compatibility design remains mandatory. |
| Service Knowledge | GENUINE_V1_RESIDUAL | Audit source, publication/deployment and canary enablement; map residual work to repository-local Beads. |\n| Console / Gitboard evidence | GENUINE_V1_RESIDUAL | Identify the owning service and bind product work to versioned DTO/event contracts. |\n| DevOps / platform engineering | GENUINE_V1_RESIDUAL | Reconcile the living DevOps PRD with deployment freshness and runtime-daemon responsibilities. |\n| Release / CI | GENUINE_V1_RESIDUAL | Prove supported published-package installation and release compatibility. |\n| Native adapters | GENUINE_V1_RESIDUAL | Reconcile adapter seams against command outcomes, identity and idempotency authorities. |\n| MCP-facing seams | GENUINE_V1_RESIDUAL | Audit the MCP-facing contract and record an evidence-backed disposition. |\n| Five-package monorepo migration | DEFERRED_BY_EXPLICIT_GATE | Accepted later readiness/migration gate; not a prerequisite for current runtime correctness. |

## 4. Gates

| Gate | State after this documentation patch | Exit evidence |
|---|---|---|
| GATE-R0 | DOCUMENTS_PATCHED_PENDING_REVIEW | Every §9 patch merged or explicitly rejected; one ledger; contradiction review; local Beads delta mapped. |
| GATE-PI84 | PENDING | Pi compatibility and fault-injected E2E green. |
| K5 | PENDING | Released cross-repository Codex parity. |
| K6 | PENDING | Ordered published-package releases and clean-install smoke. |
| GATE-COMPOSE | PENDING | Pure compiler, persisted topology, manual approve/materialize E2E. |
| GATE-DO0 | PENDING | Reducer/scheduler/runtime delivery with crash, idempotency and bounded-retry evidence. |
| GATE-AUTH | PENDING | Accepted evaluation thresholds and reproducible promotion report. |
| FINAL | PENDING | Published-artifact full-system E2E, deployment freshness, Beads/Jira/GitHub reconciliation. |

## 5. Required next local packet

The local implementation coordinator must cold-start from current repositories, releases, Beads, worktrees, installed identities and Jira checkpoints. It must map each genuine residual to an existing repository-local Bead before creating any new leaf. It must not claim GATE-R0 from this document patch alone.

The campaign terminates only when every row has a terminal disposition and every accepted residual has release, runtime and operator evidence where applicable.
