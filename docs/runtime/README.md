# XTRM Runtime — Map of Content

> Status: CANONICAL / NORMATIVE — cross-domain integration MOC for the governed runtime.
> Owner: xtrm-dev/xtrm · Established: 2026-08-22 (`xtrm-cn8`)
> Programme evidence: [`reconciliation/`](reconciliation/)

## Authority hierarchy

1. **Released code + Substrate/Git evidence** — what actually shipped. `current-release-snapshot.md` (specialists) classifies delivery state; nothing here claims implementation ahead of it.
2. **This directory** — integrated runtime model: what the pieces *are* and how they compose.
3. **Domain authorities** (not copied here, only referenced):
   - Channels contract: [`../channels/channels.md`](../channels/channels.md)
   - Substrate target architecture: [`../substrate/substrate_design_it.md`](../substrate/substrate_design_it.md) (rev12 canon; EN stale)
   - Chain-template semantic canon: [`../substrate/chain_templates.md`](../substrate/chain_templates.md)
   - Telemetry: [`../telemetry/forensic-event-contract.md`](../telemetry/forensic-event-contract.md), [`../telemetry/prometheus-projection-contract.md`](../telemetry/prometheus-projection-contract.md)
   - Specialists role/runtime semantics + executable chain assets: `xtrm-dev/specialists/docs/design/**`
   - Core install/launch/CLI infrastructure: `xtrm-dev/core/docs/**`
   - xtmux terminal/external-runtime substrate: `Jaggerxtrm/xtmux/docs/**`
4. **Programme sequencing**: [`../shared/xtrm-current-execution-plan.md`](../shared/xtrm-current-execution-plan.md) (+ `.json`). Ledger: [`../shared/xtrm-v1-completion-ledger.md`](../shared/xtrm-v1-completion-ledger.md).
5. **Experiments/evidence**: [`../harness/`](../harness/) · Research: [`../research/`](../research/) · Historical: `docs/archive/`, specialists `history/`, banners.

## System invariant

> **Pi owns the model session. XTRM owns what that session means inside a governed workflow.**

## Conceptual model

```
Role definition            SpecialistDefinition
Workflow authored form     ChainSource   (template | JSON | ad-hoc typed | imported workflow)
Normalized authored form   ChainDefinition
Approved/frozen form       ResolvedChain
Durable execution          ChainRun  (bound 1:1 to Container(kind=chain))
Participant runtime profile SpecialistActivationProfile
Physical invocation        Activation → attempt → AgentSession
Communication              Channels
Work/evidence authority    Substrate Issues + Evidence        Integration truth: Git
Deterministic progression  pure reducer → SchedulerIntent[] → effect executor → reducer
```

Lifecycle: `ChainSource → ChainLoader → ChainDefinition → compiler/policy/capability binding → ResolvedChain → ChainRun → reducer → SchedulerIntent[] → effect executor → participant activation → evidence → reducer`.

Participant lifecycle: `PREPARE → typed PLAN → typed EXECUTE → FINALIZE` (runtime-owned prepare/finalize, typed agent phases).

Non-negotiable invariants: agent finished ≠ protocol completed · result exists ≠ validated · job completed ≠ step satisfied · participant identity ≠ AgentSession identity · message body ≠ authority · attention ≠ authorization · runtime activation ≠ workflow topology · requested capability ≠ granted capability · schema-valid ≠ validated evidence · template ≠ only possible ChainSource.

## Documents here

| Path | Role |
|---|---|
| [`prd/native-chain-runtime.md`](prd/native-chain-runtime.md) | Integrated runtime PRD |
| [`adr/001-chain-authoring-compilation.md`](adr/001-chain-authoring-compilation.md) | ChainSource→ResolvedChain authoring/compile/freeze/materialization |
| [`adr/002-container-chainrun-durability.md`](adr/002-container-chainrun-durability.md) | ChainRun/Container durability, effect receipts, recovery, minimal kernel |
| [`adr/003-native-participant-runtime.md`](adr/003-native-participant-runtime.md) | Pi AgentSession direct hosting; RPC compatibility role |
| [`adr/004-specialist-activation-capabilities-probes.md`](adr/004-specialist-activation-capabilities-probes.md) | Definitions/profiles/grants/skills/probes/effects |
| [`adr/005-channels-cooperative-runtime.md`](adr/005-channels-cooperative-runtime.md) | How ChainRun participants consume Channels (references canon) |
| [`adr/006-runtime-supervision-boundary.md`](adr/006-runtime-supervision-boundary.md) | ActivationSupervisor vs xtmux RuntimeSupervisor vs Scheduler |
| [`reconciliation/asset-absorption-matrix.md`](reconciliation/asset-absorption-matrix.md) | Corpus dispositions |
| [`reconciliation/runtime-decision-matrix.md`](reconciliation/runtime-decision-matrix.md) | 30 architectural decisions with evidence |
| [`reconciliation/source-register.{md,json}`](reconciliation/source-register.md) | Corpus freeze gate |

## Next implementation milestone (documented, not started)

**Make the SRE chain the first completely data-defined XTRM chain:** real Specialist definitions + user/data-authored ChainDefinition + generic loader/compiler + ResolvedChain + proven reducer/scheduler + native participant runtime = same SRE workflow with zero SRE-specific runtime topology code. Likely order: ChainSource/Definition → ChainLoader → pure compiler → migrate SRE topology TS → data → parity proof → SpecialistActivationProfile → PREPARE → capability resolver + probes → ActivationSupervisor → FINALIZE → Channels/receipts/recovery hardening.

## Classifying a new architecture document

Ask: does it define cross-domain runtime semantics? → here (PRD section or new ADR). One domain only? → that domain's owner. Delivery status? → snapshot/ledger, never prose. Superseded? → banner + successor pointer, keep history honest. Never add flat documents to `docs/shared/`.
