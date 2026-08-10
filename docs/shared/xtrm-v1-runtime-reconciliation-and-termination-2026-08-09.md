# XTRM v1 Runtime Reconciliation and Programme Termination Path

**Status:** accepted design amendment and cross-repository change packet  
**Date:** 2026-08-09, Europe/Rome  
**Scope:** `xtrm-dev/xtrm`, `xtrm-dev/core`, `xtrm-dev/specialists`, `Jaggerxtrm/xtmux` and the accepted XTRM target architecture  
**Execution truth:** repository-local Beads  
**Programme sequencing authority:** `docs/shared/xtrm-current-execution-plan.md`, as amended here for the explicitly named runtime/Channels/memory/recovery decisions  
**Sunset condition:** once every direct document patch in §9 is merged and the current execution plan/registry are refreshed, this file becomes a provenance/change record rather than a competing long-lived authority.

## 1. Purpose

The XTRM programme has reached the point where the remaining work is no longer mainly feature discovery. The missing seam is the deterministic transition from governed work contracts into durable, addressable, recoverable executions and then back into evidence-driven workflow state.

The existing XTRM corpus already contains mature design for Specialist execution, chain templates, Channels, Substrate, memory, command outcomes, adapters, Console/Agent Workspace and evaluation. Recent Hive Research against `PrimeIntellect-ai/prime-agent`, together with the current programme-wide audit in `mercuryintelligence/program` PR #75 / RESEARCH-008, provides a concrete same-ecosystem reference for runtime primitives that were previously described only partially across those documents.

This document does four things:

1. closes the architectural decisions that can now be closed without implementing Prime Agent or adding a new XTRM package;
2. defines the v1 runtime semantics that existing XTRM designs must absorb;
3. gives exact document-level patch instructions to a local agent;
4. establishes a finite programme termination sequence and explicit closure criteria so historical plans cannot expand indefinitely.

The operator direction for this reconciliation is: apply the useful Prime-derived discoveries to the v1 XTRM designs, preserve deterministic Specialist chains and existing authorities, and converge the remaining programme toward a complete terminal state rather than creating another exploratory branch of architecture.

## 2. Evidence and authority basis

This reconciliation is derived from the following current or accepted sources:

- `docs/shared/xtrm-current-execution-plan.md` on `xtrm-dev/xtrm/main`;
- `xtrm-dev/specialists/docs/design/roadmap/enhanced-prd.md` and `specialists-roadmap.md`;
- `xtrm-dev/specialists/docs/design/execution-protocol-design/specialist-execution-protocol.md`;
- canonical chain-template design and formula assets;
- `xtrm-dev/xtrm/docs/channels/channels.md`, `channels-upgrade.md` and the forensic/attention proposal;
- canonical Substrate rev12 design; current evidence identifies the Italian rev12 document as authoritative and the English companion as stale/non-canonical until reconciled;
- `xtrm-dev/core/docs/design/memory-system-r6g.md`, explicitly design/research rather than a plan of record;
- `docs/shared/xtrm-cli-actionable-outcomes-and-followups.md`;
- `docs/shared/xtrm-harness-native-adapters.md`;
- `docs/shared/xtrm-native-pi-tools-pi-extensible-workflows-integration-2026-07-30.md`;
- Specialists Pi v0.84.1 compatibility audit merged in PR #251;
- Hive Research / RESEARCH-008 in `mercuryintelligence/program` PR #75;
- the Prime Agent architecture, RLM, daemon, long-running-agent and RPC designs;
- the Prime Agent ↔ XTRM/Hive audit produced on 2026-08-09.

Draft `xtrm` PR #33 and PR #34 remain evidence inputs only. They are not `main` authority. Their unique still-valid content must be absorbed during reconciliation and the drafts then explicitly superseded or closed; neither should become a second master registry.

## 3. Closed architectural decisions

### D1 — Runtime supervision and workflow supervision are different layers

XTRM must make this separation explicit:

```text
runtime supervision
  processes · sessions · transport · leases · delivery
  replay · snapshots · recovery · scheduling mechanics

workflow supervision
  Bead contracts · ResolvedChain · gates · verdicts
  evidence reducer · fix loops · publication · promotion
```

Specialists remains the workflow/governance engine. A future Pi/AgentSession-based runtime may own more of the first layer, but it must not acquire authority to rewrite approved chains, skip gates, publish results or reinterpret task contracts.

### D2 — An execution is a durable runtime object, not a terminal pane

A terminal, tmux pane, TUI, web Console or Agent Workspace is a client/projection over an execution. Detaching a UI must not semantically terminate the work. Runtime identity and lifecycle must remain valid across attach/detach and, where recovery is supported, across process replacement.

### D3 — Execution identity is richer than `job_id`

The v1 design must distinguish at least:

```text
principal_id          external credentialed identity where applicable
actor_id              stable logical XTRM/Mercury actor
assignment_id         authoritative work assignment
participant_id        role/member inside a chain/node/container
execution_id          immutable activation attempt
attempt               bounded attempt ordinal
parent_execution_id   runtime lineage
job_id                 current Specialists compatibility/runtime identifier
runtime_session_id    Pi/runtime session identity
generation            runtime incarnation after recovery/restart
authority_ref         exact authority source
```

`job_id` remains useful during the bridge but must not be asked to encode assignment, actor, lineage and runtime-incarnation semantics by itself.

Identity fields that grant authority or provenance are injected/validated by the dispatcher/runtime. Model-generated text cannot impersonate another participant, execution or actor.

### D4 — Leases are first-class execution semantics

Exclusive mutable ownership must have a lease or equivalent process-safe claim with owner, scope and recovery semantics. This applies where XTRM must prevent competing writers or duplicate runtime ownership.

A lease is not a generic lock on every read operation. It is an explicit ownership primitive for mutable execution/session/workspace resources. Existing Beads claim/lease and worktree ownership semantics must be reused where they already own the concern rather than shadowed.

### D5 — `uncertain` is a real mutation outcome

A mutation that was durably admitted and may have produced a side effect, but whose final result cannot be established after failure, is `uncertain`. It must not be blindly replayed.

Canonical conceptual progression:

```text
not_seen
  → received
      → completed
      → rejected / failed_safe
      → uncertain
```

`uncertain` requires reconciliation. Repeating a known-completed idempotency key returns the recorded result. A mutation with unknown side-effect state is never retried merely because the client timed out.

This semantic applies across XTRM command outcomes and adapters, including external Jira/GitHub mutations, PR creation/merge, releases, deployment, credential-sensitive actions, channel delivery when delivery itself has an authoritative external side effect, and any future automatically promoted memory/config mutation.

### D6 — Semantic replay and runtime replay use different cursors

Channels already has a correct durable message cursor: `channel_messages.id`. It remains the semantic ordering/delivery cursor for Channels.

Runtime event synchronization uses a separate identity:

```text
execution_id
generation
sequence
event_id
```

A client reconnects against the runtime event cursor. If incremental replay is unavailable or the generation changed, the runtime returns an authoritative coherent snapshot and the client resynchronizes. Runtime restart must not rewrite Channels message order.

### D7 — Channels owns semantic communication, not process delivery

The canonical Channels message remains an immutable semantic record. Runtime delivery is modeled separately:

```text
ChannelMessage
  → DeliveryIntent
      → DeliveryAttempt
          → ProcessingReceipt
```

A message saying `work.verdict: PARTIAL` does not change meaning because the target happens to be running, idle or detached. The scheduler/runtime chooses whether that message is injected immediately, queued, delivered as a follow-up or consumed by a later activation.

At minimum the delivery layer must be able to distinguish:

```text
pending
accepted
queued
delivered
processed
failed
uncertain
```

`delivered` is not `processed`. Read is observation; processing acknowledgement is effectful.

### D8 — Reducer, scheduler, runtime and Channels have non-overlapping responsibilities

The v1 boundary is:

```text
Reducer
  decides what should happen next from persisted evidence

Scheduler
  decides whether/when the intended work may run
  using authority, readiness, lease, budget and current runtime state

Runtime
  spawns, resumes, steers, stops and recovers executions

Channels
  carries typed semantic communication and attention
```

Channels must not become a second scheduler. The scheduler must not invent workflow semantics. The runtime must not decide chain topology.

### D9 — Direct agent messaging is a runtime primitive under Channels

Parent/child/sibling or peer messaging is useful, but it is not a replacement for the deterministic chain.

The runtime may expose direct addressable delivery. Canonical XTRM communication still passes through Channels semantics and authority. Runtime-derived sender identity must be preserved. A peer may notify, request evidence, propose work or steer only within explicit policy; it cannot grant itself authority.

### D10 — Scheduled work uses claim-before-delivery semantics

For persisted scheduled work the preferred crash-safe order is:

```text
due
→ claim
→ advance schedule
→ deliver
```

not `deliver → advance`. Missed recurring ticks should be coalesced according to policy rather than accumulated into an unbounded backlog. Recovery of an uncertain tick must not duplicate a side effect.

### D11 — Dynamic subagents are bounded runtime delegation, not chain topology

Prime-style recursive children are useful for research, exploration, advisory review and parallel evidence gathering. They may exist below a deterministic Specialist step.

They may not silently insert, remove or reorder canonical chain steps. Default dynamic children should be non-publishing and non-topology-mutating. Any write or publication authority must come from the parent assignment/profile and remain visible in lineage/evidence.

### D12 — Beads owns durable objectives; convergence is a separate policy

Do not recreate Prime persistent goals. The Bead/root contract already stores what must become true.

The runtime/chain policy stores how long the system may keep trying:

```yaml
max_attempts: <bounded>
max_fix_loops: <bounded>
max_tokens: <bounded or null>
max_wall_time: <bounded or null>
required_gates: [...]
terminal_states: [...]
```

Reaching a limit is never success. Passing a gate proves only the property tested by that gate. SCRUTINY selects structural defence; convergence policy bounds attempts.

### D13 — Continual learning produces governed candidates, not silent self-modification

Prime Agent's continual harness is useful as evidence that agents can discover reusable operating knowledge. XTRM must retain stronger governance:

```text
observation
→ proposed learning
→ evidence-backed candidate
→ deterministic checks / contradiction handling
→ review or promotion policy
→ versioned durable memory / skill / rule artifact
```

An agent must not silently rewrite global prompts, mandatory rules, skills or memory policy because a single trajectory suggested a lesson.

### D14 — Persistent IPython is an execution profile, not the universal tool model

A persistent Python control environment is particularly useful for research, quantitative investigation and programmatic evidence work. It should be evaluated as a profile/capability, not used to collapse all explicit tool permissions into one unrestricted interpreter.

Production Specialists continue to benefit from auditable, role-bounded tool surfaces and worktree policy.

### D15 — Memory is promoted knowledge, not every form of persistence

The v1 memory design must distinguish:

```text
working state          transient execution scratch state
session continuity     resumable runtime context
transcript/history     chronological interaction record
evidence               durable citable semantic payload
forensics              factual audit/drilldown record
semantic memory        promoted reusable knowledge
policy/skill            governed operating capability
```

Only the semantic-memory class belongs in the memory retrieval/promotion system. A retained child context or persistent kernel variable is not automatically project memory.

### D16 — Channels produces memory candidates, not memory truth

A `work.finding` can later be falsified. It must not automatically become durable memory.

Preferred flow:

```text
Channel finding / execution observation
→ evidence
→ close-time distillation
→ memory candidate
→ dedupe / contradiction / supersession
→ promotion
```

Channels may carry a `work.proposal` with a future `proposal_class` such as `knowledge_promotion`; that proposal never mutates memory by itself.

### D17 — Keep the three canonical memory lenses; clarify their semantics

Do not invent a fourth user-facing lens merely because runtime lineage now exists.

Interpret the existing lenses as:

```text
herd        project/domain-wide reusable knowledge
workgroup   assignment/work-class or bounded collaborative context
identity    actor/role-specific reusable operating knowledge
```

Execution lineage is a provenance/retrieval axis, not a new memory store.

Retrieval ranking/filtering should be able to consider query, scope, role, current contract, recency/freshness, provenance quality and supersession state. Semantic similarity alone is insufficient.

### D18 — Substrate owns both durable work causality and execution lineage projections

Channels already feeds durable `work_graph_edge` derivation through `work_refs`. Runtime lineage is a separate graph:

```text
work graph
  issue/task/verdict/proposal causality

execution graph
  parent/child/resume/recovery/attempt lineage
```

Substrate/Console may compose both into one view, but storage and semantics must not conflate them.

### D19 — Console/Agent Workspace renders executions, not terminal ownership

The UI target becomes an execution tree with terminals as views/controllers. Each node may expose assignment, participant, execution ID, model/profile, lineage, lease state, worktree, current phase, channel attention, pending deliveries, evidence and controls such as attach, steer, resume, stop and inspect.

The product should expose four complementary projections:

```text
stream    temporal events/messages
graph     durable work causality
progress  compact workflow state
runtime   execution/session tree
```

A coherent snapshot plus generation-aware event replay is required before a UI may treat its local state as synchronized.

### D20 — RPC remediation first; direct `AgentSession` remains an ADR-quality follow-up

The Pi v0.84.1 audit establishes the immediate path: repair the current RPC bridge atomically before reopening the transport choice.

The later comparison must evaluate current RPC against direct Pi `AgentSession` hosting on lifecycle ownership, event fidelity, cancellation, restoration, extension hooks, child sessions, failure isolation, upgrade coupling and testability.

No migration is authorized merely because direct `AgentSession` is architecturally attractive. Conversely, the comparison must not be reduced to JSONL performance; it is a runtime-ownership decision.

### D21 — Prime Agent is a reference implementation, not an XTRM dependency or authority

Do not port Prime wholesale, replace the Specialists Supervisor wholesale, duplicate Beads goals, adopt automatic `/refine`, or create a Prime-specific XTRM package. Reuse concepts and evidence, then implement only the minimum primitives XTRM actually owns.

### D22 — The accepted target package count remains five

The target remains:

```text
core
substrate
channels
specialists
console
```

Do not create a sixth generic control-plane/runtime package from this reconciliation. A future extraction requires a demonstrated independent consumer and the existing architecture-review/freeze rules.

## 4. Target v1 layered architecture

```text
Mercury / operator authority
  external principals · approvals · portfolio policy
  provenance · break-glass · product decisions
        │
        ▼
XTRM/Hive authority and assignment boundary
  actor identity · assignment · authority_ref
  budgets · cross-actor collision policy
        │
        ▼
XTRM workflow plane
  Beads contracts
  ResolvedChain
  SCRUTINY and gates
  evidence projection
  pure reducer
  scheduler intents
        │
        ├──────────────────┐
        ▼                  ▼
Channels                Memory
semantic messages       promoted knowledge
audience/attention      provenance/supersession
proposals/evidence      pull-based retrieval
        │                  │
        └────────┬─────────┘
                 ▼
Agent runtime plane
  execution identity · leases
  Pi RPC / AgentSession boundary
  resident/managed lifecycle
  direct delivery · child lineage
  mutation journal · uncertain state
  replay · snapshots · recovery
        │
        ▼
Execution environment
  worktrees · explicit tools · shell · MCP
  optional persistent-IPython research profile
```

During the bridge, existing Core/Specialists/xtmux stores remain authoritative for the concerns they already own. The target Substrate/Channels migration must consume/export those authorities rather than creating a second simultaneous source of truth.

## 5. Minimum v1 execution envelope

The direct `specialists.execution.v1` patch must carry or resolve the following semantic envelope. Exact field placement may vary between persisted protocol record and derived projection, but the information must be recoverable and versioned.

```yaml
schema_version: specialists.execution.v1
assignment_id: <authoritative work assignment>
actor_id: <stable logical actor>
participant_id: <chain/node participant>
execution_id: <immutable activation attempt>
attempt: <positive integer>
parent_execution_id: <nullable lineage parent>
job_id: <bridge/current runtime id>
runtime_session_id: <pi/runtime session identity>
runtime_generation: <integer>
authority_ref: <exact authority source>
lease:
  lease_id: <nullable>
  owner: <nullable>
  scope: <nullable>
model_profile: <versioned profile reference>
budget_profile: <versioned profile reference>
convergence_policy:
  max_attempts: <bounded>
  max_fix_loops: <bounded>
  max_tokens: <bounded-or-null>
  max_wall_time_ms: <bounded-or-null>
```

Do not require every external `principal_id` to be duplicated into every low-level runtime event; keep external principal provenance joinable through the authority/actor envelope. Do require any authority-bearing Channel or mutation action to resolve the real sender execution/actor from runtime state.

## 6. Minimum v1 mutation journal semantics

The runtime/adapters need a stable record comparable to:

```yaml
mutation_id: <immutable>
idempotency_key: <stable semantic key>
assignment_id: <...>
execution_id: <...>
authority_ref: <...>
operation_kind: <bounded enum>
target_ref: <redacted/stable target>
state: received|completed|rejected|failed_safe|uncertain|reconciled
result_ref: <nullable durable result/evidence pointer>
received_at: <timestamp>
completed_at: <nullable timestamp>
```

Rules:

1. journal admission occurs before dispatch of a non-trivial side effect;
2. completed idempotency keys return their durable result rather than redispatching;
3. `uncertain` blocks blind replay and creates a reconciliation intent;
4. reconciliation records the evidence that resolves `uncertain` into completed/failed-safe or a human/authority escalation;
5. no raw credential or sensitive payload is required in the journal;
6. command-outcome and adapter schemas may project this state rather than duplicating independent journals.

## 7. Channels v1 amendment

The local agent must preserve the current normative Channels ontology and make the following changes directly in `docs/channels/channels.md`.

### 7.1 Preserve what is already correct

Keep:

- `channel_messages.id` as the authoritative durable message/delivery cursor;
- `seq` as display ordinal only;
- typed `work.*`, `control.*`, `system.*`, `runtime.*` families;
- `audience` with visibility/action targets/suggested watchers/scope refs/urgency;
- hard routing/authority and soft attention separation;
- pointer-first evidence and forensic references;
- `participant_id` versus current `job_id` distinction;
- body-not-authority rule;
- progress projection separate from transcript;
- work-graph derivation from `work_refs`, never from arbitrary body text.

### 7.2 Add the delivery layer

Specify `DeliveryIntent`, `DeliveryAttempt` and `ProcessingReceipt` as runtime-owned or scheduler/runtime-derived records rather than overloading the message row.

The scheduler resolves `participant_id` to the current eligible `execution_id`/`job_id`, chooses the delivery mode and records the outcome. Delivery modes may map to current `steer`, immediate/idle delivery, follow-up or next activation, but the Channel message itself does not encode process-state-dependent meaning.

### 7.3 Add runtime-derived sender identity

A trusted Channel client/runtime adapter supplies author actor/participant/execution identity. A message body cannot claim another identity. Legacy bridge fields may remain readable, but authority uses resolved participant plus current execution/activation identity.

### 7.4 Add backpressure and loop bounds

Define bounded defaults or configuration for:

```text
maximum pending actionable deliveries per participant
maximum wakeups per epoch
maximum peer-originated actionable sends per epoch
maximum message bytes / summary bytes
duplicate-intent suppression
delivery retry ceiling
```

The intent is to prevent peer-wakeup feedback loops without weakening human/operator emergency control paths.

### 7.5 Add knowledge-promotion proposal semantics

Allow a typed proposal class for evidence-backed knowledge promotion. It creates a memory candidate request only. It never writes durable memory or policy directly.

### 7.6 Clarify Channels versus runtime replay

Channels durable cursor is `channel_messages.id` (stored by the subscription as `last_seen_id`). Runtime attach/reconnect uses `execution_id + generation + sequence`, and snapshot recovery cannot rewrite or renumber Channel messages.

## 8. Memory v1 amendment

The local agent must update the memory design without turning the research document into an execution authority by itself.

### 8.1 Preserve the current programme direction

Keep the existing PRD work packages `WP-M01` through `WP-M08`, especially pull-based retrieval, metadata/provenance, treatment control for eager injection, role doctrine, telemetry, A/B promotion, close-time candidate distillation and retention/pruning in shadow mode.

### 8.2 Add explicit memory-class boundaries

Document that session persistence, kernel state, child contexts, transcripts, evidence, forensic events and semantic memory are separate substrates. This prevents every durable artifact from entering the retrieval corpus.

### 8.3 Extend memory-candidate provenance

The target ontology should be able to represent:

```yaml
memory_id: <stable id>
memory_kind: <bounded taxonomy>
scope: <repo/domain/workgroup/identity scope>
statement: <promoted knowledge>
source_assignment_id: <...>
source_execution_id: <...>
source_evidence_refs: [...]
source_channel_message_ids: [...]
created_at: <...>
valid_from: <...>
confidence: <...>
supersedes: [...]
contradicts: [...]
derived_from: [...]
promotion_state: candidate|shadow|promoted|retired
promotion_policy_version: <...>
```

The first implementation may use a strict subset. The design must reserve provenance/supersession semantics rather than requiring future destructive migration from typeless prose.

### 8.4 Findings are candidate sources only

`node_memory` or future materialized memory views must not treat every high-confidence Channel finding as promoted truth. Findings feed the candidate/distillation pipeline; close-time validation and contradiction handling decide promotion.

### 8.5 Clarify the three lenses

Keep `herd`, `workgroup`, `identity`. Add execution lineage as provenance/filter context. Do not create a fourth store or lens merely to represent parent/child runtime history.

## 9. Required direct document patches

The following edits are mandatory before this reconciliation can be considered fully absorbed. Local agents must update the actual canonical documents; they must not simply cite this file forever.

| ID | Repository / path | Required change | Acceptance |
|---|---|---|---|
| SP-PRD-01 | `xtrm-dev/specialists/docs/design/roadmap/enhanced-prd.md` | add this runtime-semantics amendment to the modernization programme; absorb execution identity, mutation `uncertain`, runtime/workflow split, bounded convergence, Channels delivery split and governed memory promotion into existing WPs rather than creating a parallel WP family | existing WP IDs preserved; dependencies/status refreshed against current source; no Prime dependency |
| SP-RMAP-01 | `xtrm-dev/specialists/docs/design/roadmap/specialists-roadmap.md` | add runtime-supervisor vs workflow-supervisor boundary; update Opportunities/sequence so resident execution/recovery and Channels migration use the new semantics; retain deterministic chain as authority | roadmap remains architecture-level SSOT and does not copy PRD tables |
| SP-EXEC-01 | `xtrm-dev/specialists/docs/design/execution-protocol-design/specialist-execution-protocol.md` | add execution envelope, lease/recovery fields, mutation journal/`uncertain`, generation/snapshot semantics, bounded convergence and runtime-derived parent notification identity | PREPARE/FINALIZE remain deterministic shell; replay rules are explicit |
| SP-CHAIN-01 | `xtrm-dev/specialists/docs/design/roadmap/chain-templates/README.md` plus canonical chain semantics | state that dynamic subagents are bounded descendants inside a step and never mutate approved topology; add convergence ceilings/failure terminalization requirements to resolved execution semantics | canonical writer→gates→review pipeline remains unchanged unless separately reviewed |
| SP-EVAL-01 | `xtrm-dev/specialists/docs/design/roadmap/chains-prompt-evals.md` | add runtime-quality metrics: uncertain mutation rate, recovery success, duplicate delivery, wake amplification, replay divergence, context dereference and memory-promotion precision | metrics are evaluation inputs, not Prometheus high-cardinality labels |
| SP-PI-01 | `xtrm-dev/specialists/docs/pi-rpc-boundary.md` and Pi compatibility follow-up | keep RPC remediation as immediate path; create later ADR-quality direct-AgentSession comparison; identify which responsibilities move if direct hosting is ever selected | no implementation-first SDK migration |
| CORE-MEM-01 | `xtrm-dev/core/docs/design/memory-system-r6g.md` | add memory-class boundaries, governed candidate promotion, provenance/supersession target ontology and Channels-as-candidate-source rule | document remains design/research, not plan of record; PRD M01-M08 remain execution source |
| XTRM-CHAN-01 | `xtrm-dev/xtrm/docs/channels/channels.md` | apply §7 directly | semantic message and runtime delivery are distinct; current cursor model preserved |
| XTRM-CHAN-02 | `channels-upgrade.md` and forensic/attention proposal | record the delivery/runtime rationale and mark any conflicting older delivery assumptions superseded by canonical `channels.md` | rationale docs cannot overrule normative Channels |
| XTRM-SUB-01 | canonical Substrate rev12 + EN companion | add execution-lineage graph alongside work graph/provenance projections; reconcile EN against IT rev12 before restoring parity | no new mutable lifecycle authority; EN cannot overrule rev12 while stale |
| XTRM-OUT-01 | `docs/shared/xtrm-cli-actionable-outcomes-and-followups.md` | extend outcome semantics so mutation surfaces can report/reconcile `uncertain`; distinguish safe failure from unknown side-effect state | stable reason codes and next actions include reconciliation |
| XTRM-ADAPT-01 | `docs/shared/xtrm-harness-native-adapters.md` | require runtime-derived actor/execution identity, idempotency, uncertain reconciliation and no private durable authority in adapters | adapters remain thin |
| XTRM-PI-01 | `docs/shared/xtrm-native-pi-tools-pi-extensible-workflows-integration-2026-07-30.md` | compare current RPC, direct AgentSession hosting, Prime-like runtime primitives and pi-extensible-workflows; record exact ownership of identity/lease/recovery/journal | external workflow framework cannot become XTRM authority |
| XTRM-HARNESS-01 | `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` | preserve the exploration as non-normative input; execute R1.6 as a bounded direct AgentSession parity spike and ADR, with a governed one-child RLM spike only if the direct path remains viable | one terminal ADR outcome; no implementation-first migration, daemon-first build, Prime dependency, sixth package or deterministic-chain bypass |
| XTRM-PLAN-01 | `docs/shared/xtrm-current-execution-plan.md` + JSON graph | refresh source/release baseline; insert R1 runtime-semantics closure between minimum execution-shell design and promotion of terminal/idempotent runtime/scheduler work; adopt the final sequence in §10 | one sequencing authority remains; this amendment sunsets after absorption |
| XTRM-UI-01 | Console/Agent Workspace product and observability docs | model execution tree and coherent snapshot/replay; retain stream/graph/progress and add runtime view; terminal panes are projections | UI has no hidden scheduler or source-of-truth DB |
| XTRM-REG-01 | programme completion registry | reconcile against RESEARCH-008/PR #75 and current local evidence delta; preserve separate source/release/deployment/promotion/design dimensions | exactly one master programme ledger remains |
| XTRM-DRAFT-01 | draft PR #33 | absorb unique chain/Substrate/Channels/pulse reconciliation into canonical docs/new ledger, then close/supersede | no stale implementation snapshot remains presented as current |
| XTRM-DRAFT-02 | draft PR #34 | absorb unique registry items into the final programme ledger after RESEARCH-008/local delta, then close/supersede; do not merge unchanged | no competing master registry |

## 10. Revised finite programme sequence

The current programme should converge through the following sequence. Parallel work is permitted where dependencies allow, but promotion across a named boundary is not.

### Phase 0 — bounded local evidence delta and final ledger reconciliation

Do not repeat the completed web/source audit. Refresh only evidence unavailable to RESEARCH-008:

```text
live Jira / Confluence
repository-local Beads
unpushed branches/worktrees/local artifacts
installed package identities
operator checkout ancestry/deployment truth
live tmux/xtmux only for runtime claims
actual Console/Gitboard owning repo/service
monorepo worktree-drain/readiness facts
```

Compile `enhanced-prd.md` and `specialists-roadmap.md` against current code, RESEARCH-008, this amendment and local evidence. Every retained WP/Opportunity/design receives a disposition: delivered, source-only, superseded/absorbed, deferred by named dependency, rejected/retired, or genuinely residual.

### Phase 1 — current runtime/release critical path

```text
Pi 0.84.1 atomic RPC remediation
→ verify remediation against current upstream Pi
→ KAN-127 K5 promotion evidence
→ K6 ordered compatibility releases
→ released-trio Codex smoke
→ operator checkout/deployment freshness proof
```

The Pi remediation is atomic across current package identity/version, `agent_settled` session-terminal semantics, current JSON event shape and compaction lifecycle parsing. The RPC-vs-SDK question does not block this repair.

### Phase 2 — deterministic Specialist foundation

Development may overlap with Phase 1 where safe, but promotion follows current interfaces.

```text
E1.1 execution-profile schema
→ E1.2 PREPARE reducer
→ E1.3 FINALIZE reducer
→ R1.1 execution identity + R1.2 supervision boundary contracts
→ R1.6 native-harness-on-Pi spike
→ GATE-HARNESS-ADR
→ R1.3/R1.4/R1.5 runtime-semantics closure
→ E1.4 terminal actions / idempotency / recovery semantics
```

`R1` is not a new product family. It is the design closure recorded by the direct patches above. Common identity, authority, PREPARE/FINALIZE and supervision contracts remain transport-independent. R1.6 is the bounded decision packet that prevents later runtime work from freezing an accidental RPC-specific ownership split. Its accepted ADR must select either the corrected RPC-compatible runtime or a native XTRM harness on public Pi APIs; native adoption is not presumed. Pure C1 compiler/schema work does not wait for this decision.

### Phase 3 — chain composition and first vertical fixture

```text
C1 packaged catalog
→ pure compiler
→ persisted ResolvedChain
→ thin Beads materializer
→ GATE-IFACE
→ manual review/insert/approve/show
→ GATE-COMPOSE
→ quant/math vertical fixture
```

The quant fixture remains preferred because deterministic validators remain mathematical truth while Specialists own semantic/spec/test/advisory work.

Dynamic children may gather evidence within a step; they cannot modify the approved ResolvedChain.

### Phase 4 — deterministic orchestration

```text
authoritative evidence projection
→ pure reducer
→ scheduler intents
→ execution delivery / lease / uncertain-reconciliation integration
→ recovery/idempotency/crash fixtures
→ released-trio end-to-end run
→ GATE-DO0
```

A typical flow is:

```text
reviewer emits PARTIAL via Channels
→ reducer derives remediation requirement
→ scheduler checks authority/readiness/budget/lease/current execution
→ runtime chooses steer/resume/new execution
→ validated result/evidence returns to reducer
```

### Phase 5 — coordinator, Eval Core, context, prompts and memory

```text
coordinator shadow
+ telemetry-integrity closure
→ Eval Core/historical baseline
→ deterministic chain context/handoffs
→ prompt/output-contract experiments
→ pull-based three-lens memory treatment
→ close-time candidate distillation
→ promotion/retention only after measured precision
→ GATE-AUTH for selected automatic authority
```

Memory candidate promotion, prompt changes and coordinator authority remain evidence-gated. “Implemented” is not promotion evidence.

### Phase 6 — Channels/pulse/Substrate-compatible bridge

Once D1 runtime and delivery semantics are stable:

```text
Channels 0.1 canonical message + delivery integration
→ reviewer/executor and human steer paths
→ attention/backpressure/recovery fixtures
→ pulse/emitter compatibility
→ work-graph + execution-lineage projections
→ later Channels 0.2/self-managed node behavior only after measured need
```

Current xtmux messaging/obligation/monitor authorities remain bridge sources until an explicit migration/export cutover.

### Phase 7 — adapters and product surfaces

```text
transport-specific adapters for the accepted R1.6 ADR outcome
→ Console/Agent Workspace read-only runtime view
→ controlled actions consuming command outcomes/authority
→ Operational Knowledge System where accepted
```

`xt control` / future `xt work` product direction remains a separate operator product decision. If accepted, it must consume the canonical authorities above and must not introduce a sixth package or another mutable work ledger.

### Phase 8 — target architecture migration and programme closure

Only after the bridge runtime is measured and stable:

```text
Substrate/Channels target runtime migration
→ five-package monorepo readiness gate
→ package/repository migration
→ bridge retirement/export
→ documentation/source/release/deployment reconciliation
→ final programme completion audit
```

Monorepo migration is not a prerequisite for earlier correctness.

## 11. Independent/non-blocking lanes that still require terminal dispositions

The programme is not “complete” merely because C1/D1 are delivered. The final registry must also close or explicitly defer the following lanes without allowing them to block the core path unnecessarily.

### Service Knowledge

Current source is substantial v0.7 capability. Treat source, publication/deployment and canary enablement separately. The canary remains disabled by design until its acceptance conditions and explicit operator enablement are met. Service Knowledge is not the XTRM memory system.

### Console / Gitboard evidence

Do not infer an `apps/console` implementation from design prose. Locate the actual owning repository/service, classify delivered state, then bind it to versioned upstream DTO/event contracts. If no delivered Console exists, keep product work residual rather than rewriting runtime foundations around an assumed UI.

### DevOps/platform engineering

Reconcile the living DevOps PRD against current service-knowledge, release, deployment-freshness and future runtime-daemon responsibilities. Production SRE/automation principals remain governed by explicit authority/provenance contracts.

### Documentation freshness

Old README architecture PRs and stale EN design companions must be refreshed or retired. A stale open documentation PR is not an acceptable permanent programme state.

### Five-package monorepo

Retain as accepted target migration. Before execution prove writer lease, package write scope, root merge-slot serialization, daemon/socket/schema namespace isolation per worktree, cache isolation, reverse-dependency CI and worktree drain.

## 12. Local Beads decomposition instructions

The local agent must not create a new cross-repository mega-epic if equivalent roots already exist. It must first query current Beads and map this document's symbolic packets onto the existing repository-owned roots.

Use these symbolic residual packets only where a matching executable leaf does not already exist:

```text
R1.1 execution identity/envelope
R1.2 runtime/workflow supervision boundary
R1.3 lease + mutation journal + uncertain reconciliation
R1.4 runtime replay/snapshot/recovery contract
R1.5 bounded convergence policy
R1.6 bounded native-harness-on-Pi AgentSession parity spike and ADR
R1.7 Channels delivery amendment
R1.8 memory promotion/provenance amendment
R1.9 Substrate execution-lineage projection
R1.10 Console runtime-tree projection
```

R1.6 cold-starts only after Pi v0.84.1 RPC compatibility is proven and the minimum execution contracts exist. The first spike runs one existing Specialist through a directly hosted public Pi `AgentSession` boundary and compares it with the corrected RPC path for prompt/context equivalence, tools, canonical events, terminality, cancellation, retry, compaction, evidence/forensics, cleanup and recovery. If that path remains viable, a second bounded spike may add exactly one governed research/advisor child under the current Specialist step and must prove lineage, budgets, reduced authority, tool/workspace boundaries, evidence capture and inability to mutate the approved `ResolvedChain`.

The resulting ADR has exactly two acceptable outcomes: retain the corrected RPC-compatible runtime, or select a native XTRM harness on public Pi runtime APIs. Native selection additionally requires evidence that it reduces duplicate lifecycle/session authority and does not introduce a second Channels/Beads authority, a sixth package, a Prime Agent dependency, a daemon-first programme or Substrate runtime implementation. Either outcome leaves ResolvedChain, reducer, scheduler and Channels semantics unchanged.

Repository ownership remains local. Cross-repository relations are recorded as links/dependencies and release gates; do not fabricate a single Beads parent-child hierarchy across stores.

For every implementation leaf record:

```text
source design/change ID
owning repository
authoritative contract
current released/source baseline
exact dependency/gate
acceptance fixture
rollback/compatibility rule
```

## 13. Evaluation additions

Eval Core should measure runtime/system quality in addition to model-answer quality. Candidate metrics include:

```text
uncertain mutation incidence
uncertain reconciliation latency
recovery success rate
stale/exclusive lease violation rate
duplicate delivery rate
delivery-without-processing rate
wake amplification / peer-loop rate
replay divergence after reconnect
snapshot resynchronization success
fix-loop count and terminal-limit rate
unnecessary evidence/context dereference
memory candidate promotion precision
memory contradiction/supersession escape rate
```

High-cardinality identifiers remain forensic/eval dimensions, not Prometheus labels.

## 14. Explicit non-adoptions

This reconciliation does **not** authorize:

- replacing Specialists with Prime Agent;
- replacing the Specialists Supervisor wholesale before responsibilities are separated and measured;
- using dynamic subagents to bypass deterministic chains;
- duplicating Beads with a persistent-goal store;
- silent automatic `/refine`-style prompt/rule/skill mutation;
- making persistent IPython the universal production tool boundary;
- immediate direct-AgentSession migration before RPC remediation and an ADR-quality comparison;
- making Channels the job lifecycle/result store;
- making the scheduler a workflow reducer;
- making Console a source of truth;
- creating a sixth generic control-plane/runtime package;
- making monorepo migration a prerequisite for current runtime correctness.

## 15. Draft PR #33 and #34 disposition

PR #33 remains useful for its focused chain/Substrate/Channels/pulse reconciliation, but its implementation snapshot is stale. The local reconciliation agent must diff its unique architectural content against current canonical docs and this amendment. Copy only still-valid unique decisions, then close/supersede the draft rather than merging stale current-state claims.

PR #34 should not be merged unchanged. RESEARCH-008 / the current capability ledger is newer and corrects several states. Reconcile unique registry items from #34 against RESEARCH-008 plus the local evidence delta, produce one final programme ledger, then close/supersede #34.

The programme must end with exactly one master completion ledger, not two competing registry documents.

## 16. Definition of v1 design reconciliation complete

The design-reconciliation work is complete only when all of the following are true:

1. every direct patch in §9 is merged or explicitly rejected with rationale;
2. `specialists.execution.v1` contains the execution/identity/recovery/idempotency semantics needed by C1/D1;
3. Channels canonicalizes semantic-message versus runtime-delivery separation while preserving its existing durable cursor and authority model;
4. memory canonicalizes promoted knowledge versus session/history/evidence and preserves governed candidate promotion;
5. Substrate can represent execution lineage separately from work causality;
6. command outcomes/adapters can represent `uncertain` and reconciliation;
7. RPC remediation is complete and the optional AgentSession comparison is recorded separately;
8. current execution plan/JSON graph are refreshed to the final sequence;
9. PR #33/#34 are absorbed and no longer competing open authorities;
10. the final programme ledger is reconciled against local Beads/Jira/releases/deployment truth.

## 17. Definition of the XTRM programme terminal state

A meaningful programme item may end as delivered, superseded, rejected, retired or deferred behind an explicitly named external/product decision. No meaningful item may remain merely “somewhere in an old document”.

The programme reaches terminal closure when:

```text
all accepted requirements/design items have explicit dispositions
+ all genuinely residual implementation exists in repository-local Beads
+ no stale duplicate authority/registry remains
+ source/release/deployment/promotion truth is reconciled
+ Pi/runtime interfaces are current and released
+ deterministic execution + ResolvedChain + reducer/scheduler are delivered
+ recovery/idempotency/uncertain semantics are proven
+ Eval Core has measured the promoted autonomy path
+ Channels/Memory/Substrate migrations have either completed or have explicit accepted deferred states
+ product surfaces have delivered/rejected/deferred dispositions
+ five-package migration has delivered or an explicit accepted later gate
+ bridge artifacts have named retirement conditions
+ final released/deployed smoke evidence exists for the supported operator path
```

This deliberately allows the programme to terminate without implementing every historical idea. Completion is explicit disposition plus accepted evidence, not maximal feature count.

## 18. Local-agent execution directive

A local reconciliation agent consuming this file should perform the work in this order:

```text
1. refresh local evidence delta only
2. reconcile PRD + roadmap + RESEARCH-008 + current plan
3. patch canonical v1 design docs listed in §9
4. review the patch set for cross-document contradictions
5. update current execution plan and JSON graph
6. reconcile one final programme completion ledger
7. map only genuine residuals onto existing repository-local Beads
8. close/supersede duplicate/stale draft planning PRs
9. begin implementation from the Phase 1/2 critical path, not from later product lanes
10. refresh the ledger after every coordinated release wave until §17 is satisfied
```

The local agent may propose a smaller implementation than an old design if the requirement is already absorbed by current code. It may not delete a requirement merely because it is inconvenient. Every subtraction must have evidence and a terminal disposition.

## 19. Final invariant

The target architecture can be summarized as:

> Beads describes the work. ResolvedChain describes the governed workflow. The reducer decides the next semantic state. The scheduler authorizes the next execution. Channels communicates semantics and attention. Memory preserves promoted reusable knowledge. The runtime owns durable executions and delivery. Substrate materializes durable entities/graphs/projections. Console observes and controls through those contracts. Git/release/deployment evidence decides what actually shipped.

Prime Agent is valuable because it demonstrates mature runtime solutions below this boundary. XTRM remains responsible for its own deterministic workflow, authority and evidence semantics.
