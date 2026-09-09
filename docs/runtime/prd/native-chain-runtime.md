# PRD — Native Chain Runtime (Integrated)

> Status: CANONICAL / NORMATIVE (absorbs `docs/shared/native-chain-runtime-audit-2026-08-19/native-chain-runtime-prd-draft.md`; draft archived after absorption)
> Owner: xtrm-dev/xtrm · Date: 2026-08-22 · Bead `xtrm-cn8`
> Scope rule: this PRD defines the **integrated model and its requirements**. Subsystem internals stay with their owners (see [README authority map](../README.md)).

## 1. Product thesis

XTRM governs multi-agent work as deterministic, auditable chains over Pi-hosted model sessions. The runtime treats agent output as unvalidated until evidence validates it, treats communication as carrying no authority, and treats every external effect as an idempotent, journaled operation. Architecture direction is settled by experiment evidence (SRE vertical slice, 2026-08): native Pi AgentSession hosting is the product target; RPC remains compatibility transport.

## 2. Object model (normative names)

| Concept | Object | Owner repo (semantics) |
|---|---|---|
| Role definition | `SpecialistDefinition` | specialists |
| Authored workflow | `ChainSource` — variants: TemplateChainSource, JsonChainSource, AdHocChainSource, ImportedWorkflowSource | xtrm (this PRD + ADR-001) |
| Normalized authored form | `ChainDefinition` | xtrm |
| Approved/frozen form | `ResolvedChain` | xtrm |
| Durable execution | `ChainRun`, bound 1:1 to `Container(kind=chain)` | xtrm (ADR-002) |
| Participant runtime profile | `SpecialistActivationProfile` | specialists |
| Physical invocation | `Activation → attempt → AgentSession` | xtrm (ADR-003) |

Identity rules: `participant_id` stable per `(scope, role)`; `job_id` new per activation; `pi_session_id` owned by Pi. `participant ≠ activation ≠ session`. Five-layer identity taxonomy: telemetry contract §identity.

### Execution identity envelope (absorbed from the v1 reconciliation amendment)

Every execution carries an explicit identity envelope: `principal, actor, assignment, participant, execution, attempt, parent, job, runtime_session, generation, authority_ref`, plus lease and convergence policy fields. Rules: admission precedes effect; a completed idempotency key returns the durable result; an `uncertain` outcome blocks blind replay; reconciliation records its resolving evidence. Channel delivery is modeled as `ChannelMessage → DeliveryIntent → DeliveryAttempt → ProcessingReceipt` with dual cursors — `channel_messages.id` stays the semantic cursor; runtime replay uses `execution_id + generation + sequence`; snapshot recovery never renumbers channel messages.

Invariants (full list in [README](../README.md)); the load-bearing ones: agent finished ≠ protocol completed; result exists ≠ result validated; job completed ≠ chain step satisfied; message body ≠ authority; attention ≠ authorization; requested capability ≠ granted capability; ChainDefinition ≠ ChainRun; template is one ChainSource variant, not the ontology.

## 3. Requirements

### R1 — Authoring & compilation
1. One `ChainLoader` accepts all ChainSource variants; ad-hoc composition is persisted as a versioned source artifact before execution (never ephemeral prose).
2. One pure compiler emits a persisted `ResolvedChain`: no shelling, no work-store mutation, no tmux, no model calls during compile.
3. Structural change after freeze requires a new reviewed revision.
4. Templates remain supported compatibility sources; user JSON, agent-composed chains, and imported formulas converge through the same loader/compiler.
5. Substrate materialization happens only after freeze; the materializer must not invent a second dependency graph.

### R2 — Durability & recovery
6. Every external effect carries an idempotency key; receipts are append-only.
7. Mutation outcomes: completed / failed / **uncertain**; uncertain blocks blind replay; reconciliation records resolving evidence.
8. Reducer derives transitions from persisted evidence only; scheduler intents are exact and idempotent.
9. Recovery never destroys work; failed runs preserve evidence; replay-safe via journal + effect receipts.
10. Minimal durability kernel adopted now (stable IDs, run/container identity, lineage, receipts, projections, explicit uncertain state) without gating on full Substrate Stage-0 (ADR-002).

### R3 — Native participant runtime
11. Direct Pi AgentSession hosting is the product path; corrected RPC = compatibility/migration/rollback/headless transport.
12. ActivationSupervisor owns exactly one activation lifecycle and never decides chain progression.
13. PREPARE/FINALIZE are runtime-owned phases; PLAN/EXECUTE are typed agent phases.
14. RLM/dynamic children may research/inspect/compute/critique within an approved step; they may not mutate ResolvedChain, self-grant capabilities, create canonical steps, bypass gates, decide acceptance, or act as a second scheduler. Child lineage records parent participant/activation, budget, grant, evidence.

### R4 — Capabilities, skills, probes
15. `ResolvedCapabilityGrant = f(specialist request, chain/step policy, operator policy, runtime/sandbox capabilities)`. Request ≠ permission.
16. `required_tools` expresses requirement; it must not expose unrestricted generic Pi built-ins (current adapter behavior: `noTools:"builtin"` + allowlist).
17. Taxonomy: cognition (skills/prompt/procedures) · activation policy (model/timeout/retry) · prepare probes/validators/context resolvers · result contract (schema/evidence requirements) · finalize validators/projections/effects. Legacy `skills.scripts` compiles into typed ProbeDefinition for compatibility; shell scripts are never a privileged implicit preflight API.

### R5 — Cooperation over Channels
18. Participants communicate only through the canonical Channels contract ([`docs/channels/channels.md`](../../channels/channels.md)): routing hard / attention soft / authority hard; read ≠ ack; delivered ≠ processed; body ≠ authority; scheduler indirection; single-scheduler invariant.
19. Evidence travels pointer-first; work refs are opaque; no direct resume bypass.

### R6 — Work/evidence authority
20. Substrate Issues are the authoritative work/acceptance surface and durable external projection of ChainRuns; root Epic = native parent; step issues children; blocks edges between steps only; cross-DB refs stay opaque (Phase 11 cutover; Beads IDs resolve as aliases).
21. Git is integration truth. Evidence validation gates chain satisfaction; self-report never satisfies a step.

### R7 — Supervision boundaries
22. Three distinct supervisors: ActivationSupervisor (one direct activation), xtmux RuntimeSupervisor (external/interactive runtimes via terminal backends; evolve V2, no second store, no workflow authority), ChainReducer/Scheduler (workflow progression). tmux is an optional operational/UI backend for native activations, never their correctness boundary (ADR-006).

### R8 — Observability & evaluation
23. Forensics (`xtrm.forensic.v1`) carry exact identity; Prometheus stays low-cardinality; exact IDs never become metric labels.
24. Eval Core extends its subject set (compiler determinism, ResolvedChain freeze integrity, ChainRun replay equivalence, duplicate-effect rate, recovery, leaks, authority violations, cooperation, end-to-end outcome) using existing entities; no second eval subsystem.

### R9 — Memory promotion discipline

Memory surfaces stay distinct: durable `bd` memory, synthesized project memory, harness auto-memory, and close-time-distilled container memories. Promotion is evidence-gated (Archival → Recall → Core tiers); findings are candidates, not truth; no silent self-modification; automatic memory writes are prohibited before measured precision (GATE-AUTH / R1.8). Three lenses only (herd/workgroup/identity); execution lineage is provenance, never a fourth store.

## 4. Non-goals

No runtime code in documentation programme. No Substrate daemon/state-store prerequisite. No second messaging ontology. No SRE-specific runtime topology. Console stays read-model; it never becomes authority.

## 5. Acceptance (programme-level)

The architecture is accepted when the next milestone lands: the SRE chain runs fully data-defined through the generic loader/compiler/reducer/runtime with zero topology-specific code ([README §milestone](../README.md)). Detailed gate ladder lives in the execution plan; delivery truth lives in the ledger/snapshot.
