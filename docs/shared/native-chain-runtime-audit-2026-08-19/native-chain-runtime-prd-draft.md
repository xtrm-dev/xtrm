# XTRM Native Chain Runtime — Product Requirements Document (Audit-Derived Draft)

**Status:** Draft for canonicalization and local source/runtime verification  
**Date:** 2026-08-19  
**Derived from:** XTRM programme canon, Specialists bridge PRD/protocol, Substrate rev12, Channels, Memory, Telemetry, Console, AgentSession experiments, Quant vertical, current Core/Specialists/xtmux implementation records, and referenced external workflow/RLM projects.  
**Intent:** converge the long-running XTRM/Specialists/Substrate/Channels work into one implementation direction without discarding mature machinery or creating competing authorities.

---

## 1. Product thesis

XTRM should become a governed multi-agent runtime in which:

1. a **Specialist** defines a role/cognition contract;
2. a **Chain** defines a workflow;
3. planning/composition produces an inspectable, versioned chain definition before execution;
4. approval freezes a deterministic `ResolvedChain`;
5. one durable `ChainRun` executes inside one lifecycle `Container(kind=chain)`;
6. a pure reducer derives legal progression from persisted authoritative evidence;
7. scheduler/effect machinery performs exact, idempotent runtime actions;
8. a physical Pi `AgentSession` is an activation of a logical participant, never workflow identity;
9. Channels carries typed cooperation without becoming a scheduler;
10. Beads remains the near-term durable work authority while the minimum Substrate runtime kernel is introduced;
11. memory is governed promoted knowledge, not arbitrary retained session state;
12. every important operation is reconstructable through durable evidence and `xtrm.forensic.v1`;
13. CLI, MCP, Pi extension, Claude/Codex integrations and Console call the same underlying services; no harness-only capability exists.

The product is **not** a rewrite of the last year of XTRM machinery. It is a consolidation and slimming pass that moves existing correct responsibilities into cleaner ownership boundaries.

---

## 2. Non-negotiable invariants

```text
SpecialistDefinition != ChainDefinition
ChainDefinition != ResolvedChain
ResolvedChain != ChainRun
Participant != Activation
participant_id != execution_id != pi_session_id
agent_end != step satisfied
requested capability != granted capability
message body != authority
visibility != action target
attention != authorization
read != processed acknowledgement
delivered != processed
pulse != evidence
command outcome != semantic verdict
work graph != execution lineage graph
dynamic/RLM topology != ResolvedChain topology
UI != scheduler
provider/terminal runtime != workflow authority
```

One mutable concern must have one authority.

---

## 3. Target object model

### 3.1 SpecialistDefinition

Authored role/cognition contract.

Conceptual fields:
- identity/version/description;
- system cognition and task prompt;
- skills/service knowledge/procedures;
- model/fallback/thinking preferences;
- requested capabilities;
- PREPARE requirements;
- output/result contract;
- FINALIZE requirements;
- execution preferences;
- provenance/fingerprint metadata.

A Specialist never owns workflow topology.

### 3.2 SpecialistActivationProfile

Resolved runtime projection of one effective Specialist for one target environment and policy context.

It contains:
- effective Specialist source and version;
- raw/effective definition digest;
- resolved cognition assets and digests;
- model/fallback/thinking;
- requested capability set;
- probe/prepare requirements;
- result/evidence contract;
- finalization requirements;
- runtime feature disposition: `native | adapted | deferred | rejected`.

Specialists' existing effective loader should remain the authoring-resolution authority. The native runtime compiles the returned effective definition rather than maintaining a competing long-term override engine.

### 3.3 ChainSource

Versioned provenance for a workflow definition.

Required variants:

```text
TemplateChainSource
JsonChainSource
AdHocChainSource
ImportedWorkflowSource
```

An ad-hoc chain is **not ephemeral prose**. It is persisted as a versioned/auditable source artifact before execution and can later be promoted to a reusable template/catalog entry.

### 3.4 ChainDefinition

Normalized authored workflow AST before policy expansion/approval.

Contains:
- schema/version;
- metadata/name/description;
- root objective/contract reference;
- step IDs;
- step classes;
- Specialist or deterministic executor references;
- dependency graph;
- gate/verdict routing;
- bounded loops;
- chain-level constraints;
- policy/scrutiny inputs;
- requested capability profiles;
- result/evidence requirements;
- explicit human/operator gates;
- source provenance.

No physical job/session IDs belong here.

### 3.5 ResolvedChain

Approved immutable compiler output.

Contains:
- stable chain/revision identity;
- ChainSource digest;
- effective policy/SCRUTINY;
- stable steps and dependencies;
- resolved Specialist bindings;
- frozen Specialist/cognition fingerprints;
- effective execution/result contracts;
- capability profile references;
- gate/verdict routing;
- bounded remediation budgets;
- worktree/lease requirements;
- materialization plan;
- approval/freeze metadata and content hash.

Runtime execution may update attempts/results/evidence but may not silently mutate topology. Structural change requires a new reviewed revision.

### 3.6 Container

Substrate-compatible generic lifecycle/resource envelope.

Kinds remain conceptually:

```text
seed | chain | epic | wave | node
```

For this programme the critical early kinds are `seed` and `chain`.

A planning session may execute within a `seed` Container and produce a ChainDefinition candidate.

A chain execution owns a `Container(kind=chain)`.

### 3.7 ChainRun

Chain-specific durable execution record bound 1:1 to a `Container(kind=chain)`.

Container owns generic lifecycle/resource membership/teardown. ChainRun owns workflow execution semantics:
- ResolvedChain identity;
- per-step state;
- Participants;
- attempts/Activations;
- evidence satisfaction;
- reducer state;
- scheduler intents/receipts;
- gate state;
- convergence state;
- terminal workflow outcome.

**Constraint:** Container and ChainRun must not maintain independent contradictory terminal state machines.

### 3.8 Participant

Stable logical role instance in one ChainRun.

Retries preserve `participant_id`.

### 3.9 Activation

One physical attempt to execute a Participant.

Contains:
- `execution_id`;
- attempt ordinal;
- runtime/provider/session identity;
- generation;
- capability grant;
- activation status;
- start/end/settlement;
- PREPARE/FINALIZE receipts.

Direct Pi `AgentSession` is the preferred Pi activation host.

### 3.10 SchedulerIntent / EffectReceipt

The reducer emits exact idempotent intents. An executor performs them and records receipts.

Examples:
- dispatch activation;
- retry activation;
- deliver message;
- run probe;
- request operator input;
- materialize/reconcile work;
- stop/cleanup;
- terminalize.

The reducer performs no I/O.

---

## 4. Product lifecycle

```text
Objective / root work contract
        ↓
Planner in seed/planning context
        ↓
ChainSource persisted
        ↓
ChainLoader
        ↓
ChainDefinition draft
        ↓
review / edit / challenge
        ↓
pure compiler
        ↓
ResolvedChain draft
        ↓
approve + freeze hash
        ↓
materialize:
  Chain Container
  ChainRun
  Beads Epic + children + readiness edges
  chain-owned workspace
  participant bindings
        ↓
reduce authoritative state
        ↓
SchedulerIntent[]
        ↓
ready Activations only
        ↓
PREPARE
        ↓
AgentSession / deterministic executor
        ↓
FINALIZE
        ↓
evidence + Channels + Beads reconciliation
        ↓
reduce again
        ↓
PASS / remediation / escalation / human gate
        ↓
terminal ChainRun
        ↓
Container teardown
        ↓
final snapshot + evidence bundle + eval
```

Logical topology is ahead-of-time; physical processes are lazy.

---

## 5. Planning and composition

### 5.1 Reuse current planning machinery

The current Core planning skill contains valuable operational doctrine:
- create/resolve Epic first;
- native parent/child hierarchy;
- add dependency edges only after IDs exist;
- self-contained work contracts;
- explicit files/functions/spec anchors;
- acceptance criteria;
- separate test-planning;
- warn and hand off after planning.

This becomes an input to the future governed planner/composer, not a discarded skill.

### 5.2 Planner output

The planner must produce:
- root objective summary;
- assumptions and unresolved decisions;
- candidate step graph;
- work contracts;
- Specialist/deterministic role needs;
- validation/evidence needs;
- capability needs;
- integration/release consequences;
- candidate ChainDefinition;
- planning evidence.

The coordinator/operator may edit the draft before approval.

### 5.3 Materialization timing

The root work contract may pre-exist.

Known step Beads are materialized **after ChainDefinition/ResolvedChain approval and before first production dispatch**.

Materialization is atomic/idempotent where possible and must expose dry-run/preview.

Hierarchy and readiness remain separate.

### 5.4 Automatic titles

Keep deterministic operator-facing titles, but never use them as identity.

Identity uses:
- root work id;
- resolved chain id;
- step id;
- participant id;
- contract hash;
- execution id.

---

## 6. Chain JSON

The product must support user-authored JSON as a first-class ChainSource.

Illustrative shape:

```json
{
  "schema_version": "xtrm.chain.v1",
  "metadata": {
    "name": "sre-triage",
    "version": "1.0.0"
  },
  "policy": {
    "scrutiny": "standard",
    "capability_profile": "sre-readonly",
    "max_remediation_loops": 2
  },
  "steps": [
    {
      "id": "host",
      "class": "advisor",
      "specialist": "sre-host-forensics",
      "needs": ["entry"]
    },
    {
      "id": "observability",
      "class": "advisor",
      "specialist": "sre-observability-forensics",
      "needs": ["entry"]
    },
    {
      "id": "diagnosis",
      "class": "step",
      "specialist": "sre-change-forensics",
      "needs": ["host", "observability"]
    },
    {
      "id": "review",
      "class": "gate",
      "specialist": "reviewer",
      "needs": ["diagnosis"],
      "verdicts": {
        "PASS": "close",
        "PARTIAL": "diagnosis",
        "FAIL": "escalate"
      }
    }
  ]
}
```

The canonical schema still requires an ADR/design pass covering:
- JSON vs JSONC/YAML;
- repo/user/global discovery paths;
- inheritance/import policy;
- template references;
- extension fields;
- schema evolution;
- diagnostics;
- signature/trust for external sources.

### 6.1 Ad-hoc durability and promotion

A generated ad-hoc source is persisted before approval, e.g. conceptually:

```text
.xtrm/chains/ad-hoc/<source-id>.chain.json
```

or in the runtime state/export store.

Successful repeated shapes can be promoted:

```text
ad-hoc
→ reviewed repeated pattern
→ canonical reusable template
```

Promotion is explicit and versioned.

---

## 7. Specialist execution protocol

Target participant lifecycle remains:

```text
PREPARE
→ agentic PLAN
→ agentic EXECUTE
→ FINALIZE
```

### 7.1 PREPARE owns deterministic admission

PREPARE must resolve/validate:
- root/chain/step/participant identity;
- effective SpecialistDefinition;
- SpecialistActivationProfile;
- mandatory rules;
- cognition/skill assets;
- upstream evidence/context pointers;
- capability requests and actual grants;
- workspace/worktree/lease state;
- required probes;
- model/provider availability;
- retry/convergence budget;
- exact task/result contract.

If a required contract cannot be established, activation does not start.

### 7.2 Agentic PLAN/EXECUTE

The model reasons and performs allowed semantic work using host-provided tools.

It does **not**:
- schedule successors;
- own wait loops;
- mutate ResolvedChain;
- grant itself capabilities;
- mark its own result authoritative;
- bypass deterministic gates.

### 7.3 FINALIZE

FINALIZE validates:
- expected output schema/keys;
- required evidence;
- evidence freshness/source;
- scope compliance;
- Git/worktree state where applicable;
- mutation policy;
- result classification;
- Beads reconciliation;
- Channels terminal communication;
- forensic/metric projection;
- cleanup/idempotency.

`agent_end` is only an activation event. A step becomes satisfied only after FINALIZE and chain evidence reduction agree.

---

## 8. Runtime supervision

Do not port the existing Specialists Supervisor as the chain supervisor.

### Chain runtime owns

- ChainSource/Definition/compiler;
- ResolvedChain;
- approval/freeze;
- materialization;
- ChainRun;
- reducer;
- scheduler;
- convergence;
- gate routing;
- chain-level recovery;
- Channels semantics;
- terminal chain outcome.

### ActivationSupervisor owns

- one physical activation lifecycle;
- start/settlement;
- provider/session identity;
- heartbeat/progress;
- tool/probe activity;
- timeout/stall;
- retry eligibility signal;
- cancellation/abort;
- provider failure;
- session disposal;
- activation metrics.

It never decides which chain node is next.

### xtmux RuntimeSupervisor boundary

Current xtmux V2 is already a strong runtime substrate.

Evolve it incrementally toward:
- runtime instance registry;
- provider adapters;
- terminal backends;
- event-driven observation;
- delivery attempts/receipts;
- waits/interrupts;
- runtime reconciliation.

Do not create another xtmux database or message ontology.

Provider/backend selection must never alter Chain or Channels semantics.

---

## 9. Capabilities and tools

### 9.1 Requested capabilities

Specialist definitions request semantics, not raw tool enablement.

Example categories:
- `repo.read`
- `repo.write`
- `git.inspect`
- `git.mutate`
- `process.inspect`
- `container.inspect`
- `container.mutate`
- `observability.query`
- `network.query`
- `beads.read`
- `beads.mutate`
- `channels.read`
- `channels.send`
- `memory.read`
- `memory.propose`
- `exec.command`

### 9.2 Grant resolution

```text
Specialist request
+ Chain/step policy
+ operator policy
+ runtime/sandbox availability
        ↓
ResolvedCapabilityGrant
```

Only the grant controls tools.

Pi built-in bash/read/write are not enabled merely because a Specialist asks for `bash` or `read`.

### 9.3 Participant tool surface

Every participant should receive a clear, documented tool surface appropriate to its grant, e.g.:
- `chain_context`
- `chain_progress`
- `evidence_get`
- `evidence_publish`
- `channel_read`
- `channel_post`
- `channel_ack`
- `memory_search`
- `memory_propose`
- governed repo/Git/observability tools
- bounded command/probe tools.

Identity is injected by host binding. Agent-supplied author/role fields are rejected.

Pi extensions and Claude/Codex plugins should expose these tools/descriptions and runtime context; they are clients/adapters, not authorities.

---

## 10. Skills, scripts and typed probes

Skills are cognition.

Legacy `skills.scripts` is a compatibility input, not the target conceptual model.

Compile scripts/effect declarations to typed definitions:

```json
{
  "schema_version": "xtrm.probe.v1",
  "id": "sre-baseline",
  "phase": "prepare",
  "kind": "command",
  "effect_class": "read_only",
  "capability_profile": "sre-readonly",
  "timeout_ms": 30000,
  "max_output_bytes": 100000,
  "produces": "sre.baseline.v1",
  "delivery": "evidence"
}
```

Probe requirements:
- versioned identity;
- explicit phase;
- declared capabilities;
- bounded cwd/scope;
- argv-first command model where possible;
- timeout and output limits;
- deterministic exit/status contract;
- result schema/content type;
- evidence identity;
- retry policy;
- side-effect/idempotency class;
- forensic receipt;
- redaction.

Arbitrary shell snippets from role JSON must not automatically execute with user privileges.

---

## 11. Channels and cooperation

### 11.1 Semantic contract

Channels owns typed operational communication.

Required conceptual fields:
- channel/message identity;
- trusted author identity;
- kind;
- visibility;
- action targets;
- suggested watchers/attention;
- work refs;
- evidence refs;
- forensic refs;
- urgency/scope;
- creation time.

### 11.2 Free-flow cooperation is allowed

Agents are not assumed to be dumb sequential workers.

Participants may:
- share findings;
- request evidence;
- challenge hypotheses;
- propose remediation;
- ask targeted questions;
- steer within granted authority;
- observe selected ambient context.

But:
- routing is hard;
- attention is soft;
- authority is hard;
- body prose never grants authority;
- participant messaging never rewrites topology.

### 11.3 Delivery split

```text
ChannelMessage
→ DeliveryIntent
→ DeliveryAttempt
→ ProcessingReceipt
```

A provider-native send, tmux write or xtmux delivery is transport evidence, not semantic processing.

### 11.4 Storage decision

Operational concurrent state should follow the current typed SQLite/state-engine direction.

File-based forms remain first-class for:
- fixtures;
- portable run exports;
- audit bundles;
- replay tests;
- deterministic smoke specimens;
- offline inspection.

Do not use Git as the concurrent message bus.

---

## 12. Beads and Substrate runway

### 12.1 Near-term authority

Beads remains durable work authority for:
- root contracts;
- Epic/step hierarchy;
- dependencies/readiness;
- claims;
- acceptance;
- durable operator work state.

No shadow dependency engine should replace it during the runway.

### 12.2 Early Substrate kernel

Implement Substrate-grade runtime durability before full migration:
- execution identity + generation;
- Container/ChainRun registry;
- append event/mutation journal;
- leases;
- idempotency keys;
- `uncertain` + reconciliation;
- scheduler intent journal;
- effect/delivery receipts;
- coherent snapshots;
- replay/recovery;
- durable projections.

This is the minimum kernel required by the native harness.

### 12.3 Deferred migration

Do not require, as a prerequisite:
- full Beads → Substrate Issues cutover;
- full Seed/Epic/Wave/Node migration;
- daemon-first rewrite;
- multi-host scheduler;
- complete memory-domain migration;
- immediate bridge retirement.

### 12.4 Container cleanup contract

A terminal Container must reconcile every **container-owned** resource:
- child activations;
- RLM/dynamic children;
- timers;
- monitors;
- leases;
- runtime sessions;
- extension/plugin contexts;
- command subprocesses;
- worktrees/branches according to retention policy;
- open delivery attempts;
- Channels drain/terminal state;
- final evidence/snapshot/eval.

Borrowed persistent operator sessions are released/detached, not blindly killed.

Successful termination means:
1. durable final state persisted;
2. all owned transient resources terminated/released;
3. no orphan lease/process/session remains;
4. audit state remains inspectable.

---

## 13. Memory

Adopt the existing distinction:

```text
working state
session continuity
transcript/history
evidence
forensics
semantic memory
policy/skill
```

Only promoted reusable knowledge is semantic memory.

Preserve the three lenses:
- `herd` — project/domain reusable knowledge;
- `workgroup` — work-class/bounded collaborative context;
- `identity` — actor/role reusable operating knowledge.

Execution lineage is provenance, not a fourth store.

Promotion flow:

```text
execution observation / Channel finding
→ evidence
→ memory candidate
→ dedupe / contradiction / supersession
→ review/policy
→ versioned promoted memory
```

A model cannot silently rewrite global memory, skills or mandatory rules.

---

## 14. RLM, dynamic workflows and extensible workflows

### 14.1 RLM

RLM is an activation-level cognitive capability.

```text
ResolvedChain step
  → Participant Activation
      → bounded RLM tree
          ├── child
          ├── child
          └── child
      → parent synthesis
```

RLM children:
- are bounded;
- inherit only allowed tools/capabilities;
- cannot become work/Chain authority;
- cannot pass gates directly;
- cannot own publication/merge;
- cannot create persistent scheduler authority;
- must be cleaned with the activation/container.

### 14.2 Dynamic workflow as authoring

A model-generated JS/DSL workflow may produce a ChainSource.

```text
model
→ restricted composition DSL
→ persisted ChainSource
→ ChainLoader
→ ChainDefinition
→ review/freeze
```

### 14.3 Dynamic workflow inside a step

A dynamic workflow may also be used as bounded local cognition inside one approved step, provided its output returns to the parent Participant and does not create independent durable workflow authority.

### 14.4 Do not create competing run engines

External projects with journals, budgets, worktrees and resume are references. XTRM should not nest a second durable `WorkflowRun` authority alongside ChainRun.

---

## 15. Workspace, writer leases and Git

A chain/root owns the logical production workspace.

Core/runtime provisions the workspace before the first writer.

Rules:
- read-only participants may inspect according to snapshot/isolation policy;
- one mutable workspace has one writer lease;
- multiple planned writers may operate sequentially via lease handoff;
- simultaneous writers require separate worktrees and explicit integration topology;
- retry does not create a new logical Participant;
- Git events (`commit`, `merge`, branch/worktree changes) emit forensic facts/evidence;
- topology cannot be changed implicitly because an implementation participant wants a different sequence.

---

## 16. Observability

Use `xtrm.forensic.v1` as the durable forensic envelope.

Add event families/fields required by the new runtime rather than creating a second event model.

Required observable layers:

```text
Container
├── ChainRun transitions
├── scheduler intents
├── effect receipts
├── Participant / Activation
│   ├── PREPARE
│   ├── model/session lifecycle
│   ├── tool/capability/probe activity
│   └── FINALIZE
├── Channels
├── evidence
├── Beads/Substrate reconciliation
├── Git/worktree/process facts
├── recovery/replay
├── cleanup
└── operator intervention
```

Metrics remain low-cardinality projections. High-cardinality identity stays in forensic/evidence stores and Console drilldown.

From the next experiment onward, there must be one easy inspector/view that can answer:
- what is the chain doing now?
- which Participants are active?
- which evidence exists?
- which messages are actionable?
- which resources belong to the Container?
- which Git/runtime mutations occurred?
- what is blocked and why?
- what will the reducer do next?
- what cleanup remains?

---

## 17. Eval Core extension

Do not create a second eval subsystem.

Extend current Eval Core subjects.

### 17.1 Evaluation layers

1. **SpecialistDefinition / ActivationProfile**
   - prompt/rule/skill quality;
   - tool/capability compliance;
   - structured result quality.

2. **ChainDefinition / compiler**
   - deterministic composition;
   - correct mandatory gates;
   - stable IDs/fingerprints;
   - policy expansion;
   - invalid topology rejection.

3. **ChainRun / Container**
   - task outcome;
   - evidence correctness;
   - communication/cooperation quality;
   - recovery/replay;
   - duplicate side-effect rate;
   - remediation convergence;
   - resource cleanup;
   - authority violations;
   - human intervention;
   - token/cost/wall time;
   - outcome per resource consumed.

4. **End-to-end promotion**
   - released/deployed behavior;
   - regression fixtures;
   - model/provider/runtime changes.

### 17.2 Whole-chain graders

Add deterministic graders where possible:
- topology equivalence;
- no unauthorized transitions;
- no duplicate authoritative activation;
- no evidence-less satisfaction;
- no leaked resources;
- recovery state equivalence;
- message/ack consistency;
- Beads/runtime consistency;
- reproducible output/artifact digest.

Model graders remain advisory unless measured/promoted.

---

## 18. CLI, MCP and harness parity

There is one runtime/service model and multiple clients.

```text
CLI
MCP
Pi extension
Claude/Codex plugin
Console
headless automation
        ↓
common application services
        ↓
Chain / Participant / Channels / runtime kernel
```

### 18.1 CLI responsibilities

Preserve the useful §2.6 semantics.

Conceptually:

```text
sp run <specialist> --bead <id>
sp run <specialist> --create-bead ...

sp chain compose ...
sp chain review ...
sp chain approve ...
sp chain start ...
sp chain run ...
sp chain status ...
```

Final names must follow current product conventions.

`xt` remains the primary XTRM operator/runtime façade:
- launch/attach/resume/stop;
- topology/status;
- doctor/repair;
- workspace;
- provider/runtime control;
- optionally forwarding high-level chain actions.

No capability may exist only through GUI/private in-process APIs.

### 18.2 MCP

MCP should expose the same typed application services rather than shelling together ad-hoc command sequences.

Likely domains:
- chain inspect/compose/start/status;
- Participant/runtime status;
- evidence;
- Channels;
- Beads/work view;
- memory read/propose;
- operator controls subject to policy.

### 18.3 Extensions/plugins

Pi extension / Claude plugin / Codex integration:
- register governed tools;
- inject participant/chain identity and current context;
- expose Channels/evidence/memory/runtime capabilities;
- observe lifecycle/provider events;
- never create a second state store or scheduler.

---

## 19. Packaging / monorepo

Target package count remains five:

```text
core
substrate
channels
specialists
console
```

Do not add a generic sixth harness package merely because the native runtime is new.

Before the next implementation begins, run a local package/dependency audit answering:
- can the new Chain/runtime contracts be implemented directly inside target `xtrm/packages/*` boundaries?
- which current Specialists/Core/xtmux modules must remain external during staged migration?
- what circular dependencies would be introduced?
- what CLI/package release compatibility must remain?
- what source can be migrated rather than rewritten?

Default recommendation: **implement new-generation contracts in their eventual package ownership when safe**, instead of building a large vNext in the old layout and migrating it immediately afterward.

This is a local gate, not a reason to reopen the five-package product architecture.

---

## 20. Reference verticals / smoke programme

### 20.1 File-based architecture specimen

Before large production implementation, build one deterministic filesystem specimen implementing the contracts with the simplest possible persistence.

Purpose: prove semantic coherence, not production performance.

The specimen must execute:

```text
objective
→ planning seed
→ ChainSource
→ ChainDefinition
→ approval/frozen ResolvedChain
→ Container(kind=chain)
→ Beads-like/Issue projection
→ Participant activations
→ Channels cooperation
→ evidence
→ Git/forensic events
→ remediation/review
→ memory candidate
→ terminalization
→ complete resource teardown
→ durable audit bundle
```

It must support kill/restart/replay.

### 20.2 SRE live fixture

Make SRE the first data-defined native chain:
- no `sre-team.ts`;
- no SRE topology in generic runtime;
- real current Specialist definitions;
- read-only Mercury/infra;
- native AgentSession;
- real Channels/tool surface;
- cleanup/forensics.

### 20.3 Quant vertical

Use the deterministic Quant pipeline as the first complex acceptance vertical after generic chain execution exists.

It must prove:
- agentic + deterministic step mixture;
- reproducible command/evidence gates;
- bounded RLM if enabled;
- remediation;
- independent review;
- human promotion;
- recovery;
- Eval Core chain metrics.

---

## 21. Product phases

### Phase A — canonical convergence

- adopt this object model;
- repair broken chain-template canon authority;
- update execution plan/graph;
- turn native harness gate into production-parity gate;
- define Chain JSON;
- define Container/ChainRun relation;
- define Probe and CapabilityGrant contracts;
- update Eval Core subjects;
- map old §2.6 requirements.

### Phase B — proof specimen

- file-based full architecture specimen;
- recovery/cleanup;
- monitoring;
- planner;
- Channels;
- memory candidate;
- deterministic audit bundle.

### Phase C — generic runtime foundation

- ChainSource/Definition loader/compiler;
- minimum Substrate durability kernel;
- ChainRun/Container binding;
- materialization;
- reducer/scheduler/effect receipts;
- participant PREPARE/FINALIZE;
- ActivationSupervisor;
- capability/probe engine.

### Phase D — first real chains

- migrate SRE to data-defined chain;
- live read-only acceptance;
- Quant vertical;
- eval gates.

### Phase E — integrations and migration

- mature CLI/MCP/extensions/Console;
- xtmux adapter/supervisor consolidation;
- package/monorepo migration according to verified dependency plan;
- progressively retire duplicate bridge surfaces.

### Phase F — authority promotion

- measured Eval Core;
- selected automation;
- GATE-AUTH equivalent;
- full migration/bridge retirement only with parity evidence.

---

## 22. Explicit non-goals

Do not:
- copy Prime Agent;
- adopt an external workflow engine as lifecycle authority;
- copy current runner/supervisor wholesale;
- make SRE a runtime concept;
- make RLM a second Chain topology;
- make Channels a scheduler;
- make xtmux a workflow authority;
- let Console own state transitions;
- implement a daemon first;
- migrate Beads authority before replacement parity exists;
- turn Git files into the live multi-writer Channels DB;
- enable arbitrary Pi built-in tools from Specialist permission prose;
- let an LLM waive deterministic gates;
- treat session persistence as semantic memory;
- create a sixth generic runtime package.

---

## 23. Acceptance criteria for the target baseline

The architecture baseline is ready for broad implementation when:

1. every ChainSource compiles through one ChainDefinition/ResolvedChain pipeline;
2. ad-hoc chain source is versioned before execution;
3. topology is immutable after approval except explicit revision;
4. planning is inspectable/editable before freeze;
5. known step Beads materialize before first production dispatch;
6. only ready steps activate;
7. Participant identity survives Activation replacement;
8. PREPARE/FINALIZE are deterministic host boundaries;
9. capability requests resolve to explicit grants;
10. legacy scripts are bounded typed probes/effects or explicitly unsupported;
11. Channels author/routing/attention/ack authority is host-enforced;
12. `ChainRun` and chain Container cannot diverge;
13. scheduler effects are journaled/idempotent/recoverable;
14. `uncertain` is reconciled before replay;
15. crash/restart does not rerun satisfied work;
16. no authoritative side effect duplicates;
17. terminal Container cleanup leaves no owned orphan resources;
18. final audit state remains inspectable;
19. whole-chain Eval Core produces a reproducible result;
20. the SRE chain contains zero SRE-specific generic runtime code;
21. Quant can run as a domain specialization without a second runtime;
22. CLI/MCP/extensions/Console use the same underlying runtime contracts;
23. existing mature XTRM machinery is migrated/reused where semantically correct;
24. no new mutable authority duplicates an existing one.

---

## 24. Decisions that still require bounded local evidence before canonical acceptance

These are not broad design questions; they are verification gates:

1. exact package placement for the first implementation wave;
2. exact current Beads primitives/API for atomic graph materialization;
3. actual current `sp`/`xt` command surface and naming compatibility;
4. current local Pi/AgentSession public API/version;
5. PR #71 local test/typecheck/lockfile/live smoke status;
6. xtmux V2 current deployed version and provider-hook behavior;
7. current SpecialistLoader public export/consumer packaging in installed artifact;
8. actual local memory/skills/config search paths;
9. whether a resident state engine is already justified by measured runtime load;
10. exact Jira projection changes required.

None of these should restart the architecture discussion unless evidence falsifies a stated invariant.

---

## 25. Final target statement

```text
Agents reason and cooperate.
Specialists define governed cognition.
Chains define governed workflow.
ResolvedChain freezes what is allowed to happen.
ChainRun records what is happening.
Container owns the lifecycle and transient resources.
The reducer decides what should happen next.
The scheduler/effect executor makes exact authorized actions happen.
AgentSession runs one physical activation.
Channels carries semantic cooperation.
Evidence proves transitions.
Beads owns durable work during the runway.
Substrate supplies the durable runtime kernel and eventual unified domain model.
Memory stores only promoted reusable knowledge.
Forensics makes the whole system reconstructable.
CLI, MCP, plugins and Console are surfaces over the same runtime.
```
