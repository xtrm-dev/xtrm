# XTRM Architecture Reconciliation — Decision Matrix & ADR Index

**Date:** 2026-08-19  
**Status:** audit-derived decisions; items marked `LOCAL GATE` require bounded source/runtime verification before canonical acceptance.

## 1. Decision matrix

| ID | Question | Decision / recommendation | State | Evidence-dependent remainder |
|---|---|---|---|---|
| D-01 | What is a chain? | First-class authored workflow: `ChainSource → ChainDefinition → ResolvedChain → ChainRun`. | RECOMMEND ACCEPT | Canon patch. |
| D-02 | Are templates still central? | Templates remain reusable known-good ChainSources, not the only authoring path. | RECOMMEND ACCEPT | Schema details. |
| D-03 | How do ad-hoc chains work? | Persist/version before execution; compile through same path; explicit promotion to template. | RECOMMEND ACCEPT | Storage/search path naming. |
| D-04 | `ChainProgram` entity? | Do not add one. Existing four-stage model is sufficient. | RECOMMEND ACCEPT | None. |
| D-05 | `ChainRun` vs Substrate `Container`? | 1:1 for chain containers: Container is generic lifecycle/resource envelope; ChainRun is chain-specific progression state. One terminal authority/transaction boundary. | RECOMMEND ACCEPT | Exact schema/storage mapping. |
| D-06 | Planner location? | Planning is governed pre-execution work, naturally represented as `seed`/planning context producing a ChainDefinition draft. | RECOMMEND ACCEPT | Exact Seed implementation timing. |
| D-07 | Beads vs Substrate now? | Keep Beads work authority during runway; introduce minimum Substrate-grade durability kernel early; no full Issue cutover yet. | RECOMMEND ACCEPT | Installed `bd` primitive audit. |
| D-08 | Daemon now? | No daemon-first rewrite. Prove contracts/file specimen and local runtime; introduce resident state engine only with measured need. | RECOMMEND ACCEPT | Performance/load evidence. |
| D-09 | Native AgentSession vs RPC? | Native AgentSession is preferred product target. Corrected RPC remains compatibility/migration/rollback/headless transport. | EVIDENCE-SUPPORTED | Production parity/upgrade gate. |
| D-10 | What owns physical activation lifecycle? | ActivationSupervisor; chain progression remains ChainReducer/Scheduler. | RECOMMEND ACCEPT | Full runner/supervisor mapping. |
| D-11 | Full Specialist JSON? | Upstream Specialists resolves effective definition; native runtime compiles to SpecialistActivationProfile. | EVIDENCE-SUPPORTED | Installed public export/package check. |
| D-12 | `skills.scripts`? | Legacy input only. Compile to typed Probe/Effect definitions; Skills remain cognition. | RECOMMEND ACCEPT | Backward-compat translation contract. |
| D-13 | Permission/tool mapping? | Specialist requests capabilities; runtime produces `ResolvedCapabilityGrant`; grant controls tools. | RECOMMEND ACCEPT | Capability namespace and sandbox implementation. |
| D-14 | Channels persistence? | Typed SQLite/state engine for concurrent operational truth; files/JSONL for fixtures, replay/export/audit bundles. | RECOMMEND ACCEPT | Exact package/store implementation. |
| D-15 | Free-form agent cooperation? | Yes, bounded by typed Channels: routing hard, attention soft, authority hard. | ALREADY SUPPORTED BY CANON | Production transport integration. |
| D-16 | Message delivery? | `ChannelMessage → DeliveryIntent → DeliveryAttempt → ProcessingReceipt`. | ALREADY ACCEPTED | Runtime adapter implementation. |
| D-17 | xtmux role? | Runtime delivery/observation/reconciliation; evolve V2 into provider/backend supervisor incrementally; never workflow authority. | RECOMMEND ACCEPT | Shipped-vs-new disposition audit. |
| D-18 | Whole-chain cleanup? | Container terminalization must release/kill all container-owned transient resources and preserve final durable audit. | RECOMMEND ACCEPT | Resource inventory/cleanup test. |
| D-19 | Observability model? | Reuse/extend `xtrm.forensic.v1`; do not create new event envelope. | RECOMMEND ACCEPT | Add Container/Activation/Intent/Probe events. |
| D-20 | Memory? | Three existing lenses; semantic memory only after evidence-backed candidate promotion. | RECOMMEND ACCEPT | Storage/retrieval implementation. |
| D-21 | Eval system? | Extend existing Eval Core to Specialist, compiler, ChainRun/Container and E2E subjects. | RECOMMEND ACCEPT | Schema migrations/graders. |
| D-22 | RLM? | Bounded cognitive topology below one governed step/Activation; never chain/work authority. | RECOMMEND ACCEPT | Native child primitive evaluation. |
| D-23 | Dynamic workflow? | Two allowed uses: authoring a typed ChainSource, or bounded execution-local cognition. Never a second durable workflow engine. | RECOMMEND ACCEPT | DSL contract. |
| D-24 | Persistent IPython? | Execution-profile capability for suitable roles (research/quant), not universal production tool authority. | ALREADY SUPPORTED DIRECTION | Capability/security evaluation. |
| D-25 | CLI vs harness? | Same services/runtime. CLI remains complete, scriptable compatibility boundary; no harness-only capability. | ALREADY REQUIRED | Final command naming. |
| D-26 | MCP? | Another client of typed application services, not orchestration by shell composition. | RECOMMEND ACCEPT | Tool/schema design. |
| D-27 | Pi/Claude/Codex integrations? | Extensions/plugins expose governed tools/context and provider events; no local scheduler/store. | RECOMMEND ACCEPT | Per-provider capability matrix. |
| D-28 | SRE architecture? | SRE becomes Chain data + ordinary Specialist definitions. Generic runtime contains zero SRE topology. | RECOMMEND ACCEPT | First migration fixture. |
| D-29 | Quant architecture? | Complex reference vertical after generic runtime baseline; retain domain validators/promotion authority. | ALREADY DESIGNED | Select concrete bounded fixture. |
| D-30 | Monorepo timing? | Prefer implementing new-generation contracts in final package boundaries; decide exact first placement after local dependency audit. No sixth package. | LOCAL GATE | Import/circular/release analysis. |
| D-31 | Worktree ownership? | Chain/root owns logical workspace; explicit writer leases; concurrent writers require separate worktrees/integration topology. | ALREADY ACCEPTED | Core API implementation. |
| D-32 | Automatic Bead creation? | Composition/materialization may automatically create root/step Beads idempotently; atomic one-step convenience must lower to same machinery. | ALREADY ACCEPTED / ADAPT | Installed `bd` support. |
| D-33 | Automatic titles? | Keep deterministic titles as projection only; never identity. | ALREADY ACCEPTED | Final formatting convention. |
| D-34 | Live topology mutation after approval? | Prohibited; structural change creates reviewed successor/revision ResolvedChain. | RECOMMEND ACCEPT | Revision schema. |
| D-35 | File-based full design smoke? | Yes. Build deterministic reference specimen before large production kernel implementation. | RECOMMEND ACCEPT | Local execution. |

## 2. Required ADR set

Not every decision needs an independent ADR. The recommended set is deliberately smaller than the number of questions.

### ADR-01 — Chain Authoring, Compilation and Immutable Execution Topology

Owns:
- ChainSource variants;
- ChainDefinition;
- template/ad-hoc/imported convergence;
- review/approve/freeze;
- topology revision;
- Chain JSON;
- planner boundary;
- Beads materialization semantics.

Supersedes template-only assumptions without rejecting templates.

### ADR-02 — ChainRun and Substrate Container Relationship

Owns:
- `Container(kind=chain)` vs ChainRun;
- lifecycle and terminal authority;
- resource membership/cleanup;
- generic Container projection vs chain-specific reducer state;
- early Substrate runtime kernel vs deferred full migration.

This ADR must prevent two durable lifecycle engines.

### ADR-03 — Native Participant Runtime on Pi AgentSession

Owns:
- native AgentSession as preferred hosting target;
- RPC compatibility role;
- Participant vs Activation identity;
- ActivationSupervisor;
- PREPARE/FINALIZE;
- provider adaptation and upgrade gate.

Input evidence includes AgentSession SRE vertical slice and Pi compatibility audit.

### ADR-04 — Specialist Definition Compilation, Capabilities and Typed Probes

Owns:
- upstream Specialist effective resolution;
- SpecialistActivationProfile;
- source/cognition fingerprinting;
- requested capability → grant;
- Skills vs Probe/Effect split;
- legacy script translation;
- output/result contract.

### ADR-05 — Channels, Runtime Delivery and Cooperative Agent Semantics

Owns:
- Channel semantic authority;
- typed cooperation;
- audience/action target/attention;
- read/ack;
- delivery attempt/processing receipt;
- operational SQLite vs portable file export;
- provider/xtmux delivery boundary.

Should reference rather than rewrite existing Channels canon.

### ADR-06 — Runtime Supervision and xtmux Provider/Terminal Adapters

Owns:
- evolution of current xtmux V2;
- runtime instance identity;
- provider adapters;
- terminal backends;
- waits/interrupts/delivery receipts;
- event-driven reconciliation;
- no workflow authority.

The proposed RuntimeSupervisor ADR can be reconciled into this.

### ADR-07 — Durability Kernel, Mutation Journal and Recovery

Owns:
- generation;
- journal;
- leases;
- idempotency;
- `uncertain`;
- intent/effect receipts;
- coherent snapshots;
- crash/replay;
- file-based reference specimen;
- when/if resident state engine is justified.

Can be combined with ADR-02 if review prefers fewer documents.

### ADR-08 — Memory and Learning Governance

Owns:
- semantic-memory definition;
- herd/workgroup/identity lenses;
- candidate flow;
- Channel/evidence provenance;
- contradiction/supersession;
- no silent self-modification.

Should elevate valid concepts from Core research rather than invent a fourth memory store.

### ADR-09 — Evaluation and Promotion of Specialists, Chains and Runtime Authority

Owns:
- extension of Eval Core;
- evaluation subjects;
- chain/container graders;
- deterministic vs model graders;
- promotion gates;
- SRE and Quant reference fixtures.

### ADR-10 — Public Surfaces and Package Ownership

Owns:
- application service boundary;
- `sp`, `xt`, MCP, plugins/extensions, Console parity;
- no harness-only capability;
- five-package target;
- staged monorepo placement decision.

Package placement remains conditional on local dependency evidence.

## 3. Decisions that should remain product requirements, not ADRs

These do not need independent architectural decision records:

- deterministic operator-facing titles;
- pointer-first evidence;
- CLI JSON/dry-run;
- exact argv next actions;
- one writer lease per mutable workspace;
- read-only agents may cooperate freely within authority;
- no large transcript dumps by default;
- metrics remain low-cardinality;
- terminal cleanup must be observable;
- SRE is first data-defined migration fixture;
- Quant is the complex deterministic reference fixture.

## 4. Immediate canon changes after local verification

1. Repair missing Specialists chain-template canon target.
2. Generalize C1 from Template → ResolvedChain to ChainSource → ChainDefinition → ResolvedChain.
3. Reframe R1.6/GATE-HARNESS-ADR around native production parity, retaining RPC compatibility.
4. Introduce Container/ChainRun 1:1 relation and early durability kernel.
5. Move minimum Channels seam ahead of automatic reducer promotion.
6. Add whole-chain Eval Core acceptance.
7. Map §2.6 CLI/materialization/idempotency semantics into new model.
8. Reconcile `skills.scripts` with typed probes.
9. Add full Container cleanup contract.
10. Update machine-readable execution plan/ledger consistently.

## 5. Implementation sequencing after ADR/PRD acceptance

```text
A. contracts and schemas
   ChainSource
   ChainDefinition
   SpecialistActivationProfile
   Container/ChainRun identity
   ProbeDefinition
   CapabilityGrant

B. reference file specimen
   planner
   full lifecycle
   Channels
   memory candidate
   recovery
   cleanup

C. generic chain compiler/materializer
   SRE migration from code to data

D. participant runtime
   PREPARE
   capabilities/probes
   ActivationSupervisor
   FINALIZE

E. durability + delivery hardening
   journal
   uncertain
   receipts
   snapshots/recovery
   xtmux/runtime adapters

F. complex verticals + Eval Core
   SRE live
   Quant
   fault injection
   promotion

G. public surfaces/package migration
   CLI/MCP/plugins/Console
   monorepo staging
   bridge retirement
```
