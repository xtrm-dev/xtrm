# XTRM Current Execution Plan

**Status:** canonical current execution plan  
**Last reconciled:** 2026-08-02, Europe/Rome  
**Programme:** XTRM  
**Repositories:** `xtrm-dev/core`, `xtrm-dev/specialists`, `Jaggerxtrm/xtmux`, `xtrm-dev/xtrm`  
**Jira projection:** project `KAN`  
**Execution truth:** repository-local Beads graphs  

## 1. Document role

This document is the current sequencing and dispatch authority for the pre-Substrate XTRM programme.

It does not replace:

- `xtrm-dev/specialists/docs/design/roadmap/enhanced-prd.md`, which remains the accepted requirements and success-criteria canon;
- `specialist-execution-protocol.md`, which defines the lifecycle of one managed Specialist activation;
- the chain-template canon, which defines collaboration topology;
- repository code, released packages, Beads or Git evidence.

It exists because a large PRD must not simultaneously serve as requirements catalogue, release ledger, implementation sequence, operational manual and Jira board.

The authority order for current-state and execution decisions is:

```text
released package and current repository code
→ executable contracts and tests
→ this current execution plan
→ canonical PRD and semantic design documents
→ Jira portfolio projection
→ historical plans and chat artifacts
```

Jira identifies and communicates programme work. Beads remains the implementation source of truth for executable tasks, dependencies, claims, acceptance and completion evidence.

## 2. Released baseline

The supported trio verified for this reconciliation is:

| Repository | Released package | Release cut |
|---|---:|---|
| Core | `xtrm-tools 0.11.4` | PR `xtrm-dev/core#535`, commit `9b823f80` |
| Specialists | `@jaggerxtrm/specialists 3.21.2` | PR `xtrm-dev/specialists#240`, commit `c1e660ab` |
| xtmux | `@jaggerxtrm/xtmux 0.2.3` | PR `Jaggerxtrm/xtmux#89`, commit `12d6709e` |

Default-branch drift after these cuts:

- Core: none.
- xtmux: none.
- Specialists: one non-runtime release-maintenance commit adding `CHANGELOG.md` to future npm tarballs and compacting changelog rendering.

Any implementation agent must refresh these versions and heads before dispatch. A source-only capability is not a released capability.

## 3. Closed architectural decisions

### 3.1 Separate the four layers

```text
programme planning
  PRD/specification → epics, root tasks and dependency graph

execution composition
  one approved root task → participant roles, gates and chain steps

activation execution
  one selected Specialist → PREPARE / PLAN / EXECUTE / FINALIZE

operator interaction
  commands, messages, monitors, results and exact next actions
```

The following surfaces operate at different layers and must not become competing workflow engines:

| Surface | Responsibility |
|---|---|
| `/spec-dispatch` | conversational routing, release/recent-work check, scope and sprint shaping |
| `xt spec` | durable specification lifecycle, validation, apply, reconciliation and archive |
| `/planning` | programme work graph in Beads |
| chain templates | topology for executing one root task |
| `specialists.execution.v1` | deterministic shell around one participant activation |
| xtmux | durable local attention, messages, obligations, monitors, wakes and runtime identity |
| coordinator | bounded semantic judgment over deterministic reducer output |

### 3.2 The PRD is not the implementation sequence

The broad Specialists PRD remains canonical for outcomes and acceptance. It does not authorize starting all work packages concurrently.

The critical path is:

```text
released-trio truth and authority freeze
→ deterministic outcomes for existing public commands
→ minimum specialists.execution.v1 runtime shell
→ chain-template compiler and persisted ResolvedChain
→ pure evidence-driven reducer and exact scheduler intents
→ bounded coordinator in shadow mode
→ evaluation, prompt and memory promotion
→ harness-native adapters and workflow runtimes
→ Console and Agent Workspace action surfaces
```

### 3.3 No duplicate authority

| Concern | Authority |
|---|---|
| Programme and task contracts | Beads |
| Specialist job lifecycle, progress and result | Specialists |
| Messages, obligations, monitors, wakes and pane identity | xtmux |
| Interactive launch, installation and managed configuration | Core |
| Branch, commit and merge truth | Git |
| Chain topology | canonical template compiled to a persisted `ResolvedChain` |
| Next transition | pure chain reducer consuming persisted evidence |
| Semantic exceptions | coordinator or operator within explicit authority |
| Product/Jira visibility | Jira and Console materializations |

No work package may introduce a second store, scheduler, message registry, job lifecycle or merge authority for any row above.

## 4. Delivered capability ledger

### 4.1 Core 0.11.4

Delivered:

- `xt spec draft|validate|doctor|apply|status|archive`;
- XML `<change-contract>` generation and spec apply/reconciliation state;
- `/spec-dispatch`, `/planning` and `/test-planning`;
- interactive `xt pi` and `xt claude` role/subordinate launch contracts;
- runtime-origin and coordinator lineage;
- read-only `xt topology` projection and views;
- shared `@xtrm/contracts` schemas;
- release, install, skill, hook and runtime-compatibility hardening;
- unified native Pi tool rendering.

Not delivered:

- `xtrm.command-outcome.v1`;
- `xt codex`;
- a canonical chain compiler or reducer;
- native XTRM coordination/Specialist Pi tools;
- `pi-extensible-workflows` integration.

### 4.2 Specialists 3.21.2

Delivered:

- structured `sp run --json` and `sp feed --json` progress;
- deterministic replay ordering;
- `sp result`, `feed`, `status`, `integration record/list`, `render-task`, `render-bead`;
- runtime-origin and coordinator ancestry;
- terminal parent notifications for `done`, `error` and `cancelled`;
- interactive `chain-coordinator` bridge persona;
- forensic and Prometheus foundations;
- background/help/release audit closure work.

Not delivered:

- executable `specialists.execution.v1` profiles and reducer;
- `sp chain review|approve|insert|wire-edges`;
- persisted `ResolvedChain`;
- pure chain reducer and scheduler intents;
- logical-session schema and recovery classifier;
- Eval Core and `sp eval`;
- three-lens memory.

The current coordinator contains an explicit resolver TODO and manually describes the role sequence. It is a bridge persona, not the completed coordinator runtime.

### 4.3 xtmux 0.2.3

Delivered:

- SQLite V2 durable messages, obligations, monitors, wakes and delivery evidence;
- exact `message-get` and `agent-last` retrieval;
- runtime/session/pane/role/branch/worktree/parent identity;
- canonical Beads lifecycle streaming;
- Pi, Claude and Codex lifecycle hooks;
- bounded capture, monitor projection and orphan cleanup;
- reply/FYI, receipt and fulfilment semantics.

Not delivered:

- common command outcome schema with stable reason codes and executable next actions;
- native XTRM harness adapters;
- graphical Agent Workspace;
- Core-owned `xt codex` launch, despite xtmux Codex observation support.

## 5. `xt spec` disposition

`xt spec` is a shipped v0 planning front end and must not be planned again as net-new work.

Current flow:

```text
spec.yaml
→ validate and readiness probe
→ XML change contract
→ create one planner bead
→ dispatch planner Specialist
→ persist apply sidecar
→ reconcile produced epic/children
→ hand off to `sp chain review`
```

Residual work:

- replace the current raw planner-bead boundary only where verified Beads primitives provide a better atomic operation;
- connect the produced root tasks to the canonical chain compiler;
- ensure `sp chain review` exists before advertising the handoff as operational;
- retain `xt spec` as programme planning, not execution topology.

Jira disposition:

- close the shipped child `KAN-85` after an installed-release smoke;
- close or mark delivered the v0 portion of `KAN-84`;
- move compiler/composition residual into `KAN-119`;
- do not create another independent `xt spec` programme.

## 6. Chain-template disposition

Fifteen `.formula.json` source assets exist. They are not yet a released orchestration product.

Current gaps:

- templates are stored under the roadmap/design tree rather than a supported package/install path;
- the released Specialists CLI has no `chain` command;
- `review`, `approve`, `insert` and semantic-edge wiring remain planned;
- no persisted `ResolvedChain` exists;
- template selection remains guidance rather than one authoritative compiler;
- the minimum participant execution protocol is not enforced.

Templates may be developed as pure source assets now. They may not be promoted as production-default orchestration until the promotion gate in Section 10 passes.

## 7. Workstream graph

Symbolic IDs below are stable planning IDs. Repository-local planning agents map them to real Beads IDs and record that mapping in this document or a generated companion index.

### R0 — release and authority reconciliation

**Owner:** `xtrm-dev/xtrm`, with evidence from all three runtime repositories.  
**Purpose:** establish one current execution ledger and remove stale projections before implementation dispatch.

| ID | Deliverable |
|---|---|
| R0.1 | Merge this current execution plan and machine-readable graph |
| R0.2 | Refresh PRD release snapshot and landed-capability ledger |
| R0.3 | Reconcile Jira `KAN-84/85`, `KAN-110`, `KAN-115–125` |
| R0.4 | Publish Jira↔Beads↔GitHub traceability mapping |
| R0.5 | Mark historical/superseded plans explicitly |

R0.1 is sufficient to start the independent Wave 1 audit lanes. R0.2–R0.5 must close before production promotion of the chain runtime.

### I1 — deterministic command outcomes

**Primary owner:** xtmux.  
**Companion owners:** Specialists and Core.  
**Source design:** `xtrm-cli-actionable-outcomes-and-followups.md`.

#### I1.1 Verification and inventory

Evidence-only pass across released commands:

```text
repository
command
mutation_or_query
human output
JSON output
stdout/stderr contract
exit codes
stable IDs
current follow-up semantics
known consumers
compatibility risk
candidate disposition
```

No production schema change before this inventory and compatibility ADR.

#### I1.2 xtmux first vertical slice

Commands:

```text
message-send
message-reply
message-ack
message-cancel
monitor-agent
wait-agent
message-get
obligations list
```

Target outcome:

```json
{
  "_outcome": {
    "schema_version": "xtrm.command-outcome.v1",
    "status": "ok|degraded|noop|rejected|failed",
    "reason_code": "stable_machine_code",
    "authoritative_mutation": { "completed": true, "kind": "..." },
    "side_effects": [],
    "next_actions": [
      { "kind": "wait|read|repair|verify", "required": true, "argv": ["..."] }
    ]
  }
}
```

#### I1.3 Specialists adoption

Initial commands:

```text
run/dispatch
feed
result
resume
stop
integration record/list
```

#### I1.4 Core adoption and launcher contract

Initial commands:

```text
pi/claude launcher result
topology
merge/integration handoff
future codex launcher
```

### E1 — minimum `specialists.execution.v1`

**Owner:** Specialists.

Do not begin with the entire PRD. Implement the smallest deterministic shell that every later chain requires.

#### E1.1 Execution profile schema

A Specialist selects a versioned profile declaring:

- phase applicability;
- permission posture;
- contract requirements;
- evidence requirements;
- output schema;
- commit policy;
- allowed overrides.

#### E1.2 PREPARE reducer

Runtime-owned:

- context and identity resolution;
- contract/readiness validation;
- mandatory-rule resolution and receipt;
- capability validation;
- execution-profile selection;
- explicit blocked/waiting states.

#### E1.3 FINALIZE reducer

Runtime-owned:

- output-schema validation;
- required-evidence presence and freshness;
- scope and Git-state validation;
- commit policy;
- result persistence.

#### E1.4 Terminal actions and idempotency

- append Bead handoff;
- send typed parent notification;
- emit forensic events;
- release only resources owned by the activation;
- make replay safe and duplicate terminal processing harmless.

Memory experiments, prompt redesign and semantic grading are not prerequisites for E1.

### C1 — chain compiler and durable spine

**Primary owner:** Specialists.  
**Dependency:** schema work may start in parallel; production promotion depends on I1 and E1.

#### C1.1 Package and validate template catalog

- move or generate the canonical catalog into a supported package/install path;
- validate formulas and catalog membership in CI;
- make version/build identity explicit;
- preserve per-repo extension search paths.

#### C1.2 Pure compiler

Input:

```text
root contract
+ scrutiny
+ scope/surface classification
+ selected template or explicit override
+ installed catalog version
```

Output:

```text
ResolvedChain draft
```

The compiler is pure. It performs no shelling, Beads mutation, tmux work or model call.

#### C1.3 Persisted `ResolvedChain`

Minimum shape:

```json
{
  "schema_version": "specialists.resolved-chain.v1",
  "chain_id": "...",
  "root_bead_id": "...",
  "template": { "name": "code-standard", "version": 1 },
  "state": "draft|approved|running|terminal",
  "effective_scrutiny": "medium",
  "steps": [
    {
      "step_id": "executor",
      "class": "step|gate",
      "role": "executor",
      "dependencies": [],
      "mandatory": false,
      "status": "pending",
      "job_id": null,
      "bead_id": null
    }
  ]
}
```

#### C1.4 Thin Beads materializer

```text
approved ResolvedChain
→ molecule/root/step/gate operations
→ stable Beads IDs
→ persisted links back into ResolvedChain
```

The materializer uses verified installed Beads capabilities. It does not invent a parallel dependency graph.

#### C1.5 Composition CLI

```text
sp chain review <root>
sp chain insert <root> ...
sp chain approve <root>
sp chain show <root> [--json]
```

Review writes a draft. Insert mutates only a draft. Approve freezes topology. Per-step execution updates status and evidence pointers but never silently rewrites the approved shape.

### D1 — reducer and scheduler intents

**Owner:** Specialists.

#### D1.1 Evidence projection

Normalize only authoritative facts:

- validated job result;
- gate verdict;
- Beads readiness and status;
- Git/integration evidence;
- pending human gate;
- retry/incident state.

#### D1.2 Pure chain reducer

```text
ResolvedChain
+ authoritative evidence projection
→ next chain state
+ zero or more scheduler intents
```

The reducer performs no side effects.

#### D1.3 Exact scheduler intents

Examples:

```json
{
  "kind": "dispatch_specialist",
  "role": "reviewer",
  "bead_id": "...",
  "arguments": {},
  "idempotency_key": "chain:<id>/step:<id>/attempt:<n>"
}
```

Other intents include wait, request-input, retry, restitch, escalate, record-integration and terminalize.

#### D1.4 Coordinator shadow mode

Update `chain-coordinator` to consume reducer output rather than carrying the workflow in prompt prose.

The coordinator may:

- make bounded semantic judgments;
- propose permitted step insertion;
- escalate ambiguity;
- explain deterministic decisions.

It may not:

- invent a new scheduler;
- skip mandatory gates;
- infer completion from terminal output;
- mutate an approved chain outside explicit authority.

Close/release authority remains shadow-only until Eval Core supports promotion.

### V1 — telemetry, evaluation, context, prompts and memory

#### V1.1 Telemetry integrity closure

Complete and prove `telemetry-integrity-v1` against raw forensic evidence.

#### V1.2 Eval Core

- eval storage;
- candidate fingerprints;
- deterministic and model grader interfaces;
- historical backfill and completeness markers;
- compare/promotion reports;
- observe-only initial operation.

#### V1.3 Deterministic chain context and handoffs

Every participant receives:

- chain/root/step identity;
- role/class/position;
- effective scrutiny;
- stable upstream pointers;
- pending gates;
- worktree identity;
- explicit partial/missing preload state.

#### V1.4 Prompt and output-contract programme

Only after V1.1/V1.2 and the chain spine are stable:

- one generated machine-readable output contract;
- prompt/procedure/context responsibility cleanup;
- paired or factorial prompt × model experiments;
- evidence-gated promotion.

#### V1.5 Three-lens memory

Only after retrieval and pollution can be measured:

- herd, workgroup and identity lenses;
- pull-based retrieval;
- proposal/shadow close-time distillation;
- precision, pollution, duplication and reuse metrics.

### A1 — harness-native integrations

**Dependency:** I1 command outcomes and idempotency are stable.

#### A1.1 Capability verification

- Claude MCP task/background/wake behavior;
- current Specialists MCP boundary;
- Pi background-runtime comparison;
- installed-version and security evidence.

#### A1.2 Thin native tools

Initial tools:

```text
xtrm_coordination_send
xtrm_coordination_status
xtrm_coordination_read
xtrm_specialist_dispatch
xtrm_specialist_status
xtrm_specialist_result
xtrm_specialist_resume
xtrm_specialist_stop
```

Adapters invoke authoritative XTRM operations and retain no private durable state.

#### A1.3 Pi Runtime Unification residual

Create one canonical decision/closure record covering:

- current upstream Pi package usage;
- remaining embedded/RPC/coding-agent duplication;
- package/agent versus package/coding-agent decision;
- transport ownership;
- obsolete paths to delete;
- release and rollback evidence.

#### A1.4 `pi-extensible-workflows`

Integrate only through public extension APIs after idempotency and worktree-ownership checks pass.

Workflow-local replay, checkpoint and budget remain owned by the workflow runtime. XTRM jobs, messages, Beads and Git remain XTRM authorities.

#### A1.5 XT Codex production parity

- Core `xt codex` launcher and capability matrix;
- xtmux lifecycle/session/pane identity;
- deterministic non-interactive assignment;
- parity fixtures with Pi and Claude;
- no duplicate task or message store.

A read-only capability prototype may run earlier. Production promotion depends on I1.

### P1 — product surfaces

#### P1.1 Console eval and promotion views

Complete the KAN-123 read model after event/eval contracts stabilize.

#### P1.2 Agent Workspace read-only shell

First release:

- topology graph;
- pane/session navigation;
- embedded terminal;
- exact message/result/evidence inspection;
- Beads root/chain status;
- no hidden mutations.

#### P1.3 Controlled action surfaces

Add actions only by consuming command outcomes and explicit authority. No UI-specific orchestration logic.

#### P1.4 Operational Knowledge System

Start with read-only provenance, freshness and operator query contracts. Automated remediation requires a separate authorization gate.

## 8. Dependencies

Hard dependency graph:

```text
R0.1
├── I1.1
├── E1.1
├── C1.1
├── V1.1
├── A1.1
└── XT Codex read-only prototype

I1.1 → I1.2 → I1.3/I1.4
E1.1 → E1.2/E1.3 → E1.4
C1.1 → C1.2 → C1.3 → C1.4 → C1.5

I1.2 + I1.3 + E1.4 + C1.5
→ production chain promotion gate
→ D1.1 → D1.2 → D1.3 → D1.4

D1.2 + V1.1
→ V1.2

D1.3 + V1.2
→ V1.3 → V1.4/V1.5

I1 complete + idempotency proof
→ A1.2 → A1.3/A1.4/A1.5

V1.2 + stable public contracts
→ P1.1/P1.2 → P1.3
```

TypeScript 7 and remaining code-intelligence work are supporting lanes. They do not block I1–D1 unless a measured compatibility failure affects the exact implementation seam.

## 9. Parallel dispatch model

After R0.1, these lanes may run concurrently:

| Lane | Maximum initial fan-out | Work |
|---|---:|---|
| Interface | 3 | I1.1 per repository, then one synthesis |
| Execution protocol | 2 | profile/schema and PREPARE/FINALIZE boundary audit |
| Chain compiler | 2 | formula/catalog audit and pure schema/compiler design |
| Evaluation | 1 | storage/telemetry current-state audit |
| Codex | 1 | capability and launcher parity audit only |
| Supporting | 1 | TypeScript 7 or code-intelligence residual, never both if host capacity is constrained |

Do not dispatch multiple agents to modify the same shared contract simultaneously. One owner writes; independent agents review and test.

## 10. Production promotion gate

The deterministic orchestration foundation may be promoted only when a released trio proves:

1. a versioned root contract resolves to one deterministic `ResolvedChain`;
2. the approved shape is persisted and inspectable;
3. dispatch is emitted as an exact idempotent scheduler intent;
4. the selected participant runs through the minimum execution protocol;
5. output and required evidence are validated before terminal state;
6. result, Bead handoff, parent notification and cleanup are idempotent;
7. the reducer selects the next eligible transition from persisted evidence;
8. waiting/failure/restitch/escalation are explicit states;
9. progress is available through structured feed and complete result retrieval;
10. Git integration remains independently verified;
11. no duplicate mutable graph or authority was introduced;
12. packed-install and live cross-repository smoke pass against released artifacts.

Until this gate passes, templates and coordinator automation remain source/observe/shadow features.

## 11. Local agent execution protocol

Every local coordinator implementing this plan must:

1. refresh releases, default heads and recent merged PRs in every affected repository;
2. run `/spec-dispatch` against this document;
3. separate audit closure from new feature work;
4. create or reconcile one umbrella Beads epic per programme lane, not per Markdown document;
5. group tasks by reviewable PR/release boundary;
6. record symbolic workstream ID in every root Bead;
7. produce and review the dependency graph before live creation;
8. keep Jira as a portfolio mirror rather than copying every leaf Bead;
9. require independent review and test evidence for shared schemas/reducers;
10. stop if current code contradicts this ledger and update the ledger before continuing.

### First local planning packet

The first implementation board should contain only:

```text
Epic A — deterministic public interfaces
  A0 command inventory and compatibility ADR
  A1 xtmux outcome vertical slice
  A2 Specialists adoption
  A3 Core launcher/adoption

Epic B — minimum Specialist execution protocol
  B0 execution-profile contract
  B1 PREPARE reducer
  B2 FINALIZE reducer
  B3 terminal actions and idempotency

Epic C — chain compiler and durable spine
  C0 template packaging/catalog audit
  C1 ResolvedChain schema and pure compiler
  C2 persistence
  C3 Beads materializer
  C4 review/insert/approve/show CLI

Epic D — production promotion fixture
  D0 cross-repo fixture harness
  D1 reducer and scheduler-intent tests
  D2 released-trio end-to-end promotion run
```

Do not create the full V1/A1/P1 backlog as executable leaves yet. Keep later programmes as placeholder epics with entry criteria only, preventing premature local dispatch.

## 12. Jira reconciliation packet

Apply after Atlassian access is available.

### Existing issues

| Jira | Mutation |
|---|---|
| KAN-84 | mark v0 delivered; move native compiler/composition residual to KAN-119; retain historical provenance |
| KAN-85 | run installed-release smoke, then transition Done |
| KAN-110 | record phases 1–3 delivered; split remaining pyright/upstream isolation into a narrow residual |
| KAN-114 | relate/fold into KAN-121 and KAN-124 after typed-context decision |
| KAN-115 | transition In Progress; replace release snapshot with 0.11.4/0.2.3/3.21.2 and link this plan |
| KAN-116 | transition In Progress; reduce to unfinished G02 capability pin, approved graph and WP→Beads mapping |
| KAN-117 | transition In Progress; separate delivered telemetry foundation from missing Eval Core |
| KAN-118 | transition In Progress; record assignment/notification delivered and focus residual on logical sessions/recovery |
| KAN-119 | set Highest and make next critical implementation task; own compiler, `ResolvedChain` and planning integration |
| KAN-120 | record bridge persona delivered; retain resolver/reducer/entry/incident/close-time residual |
| KAN-121 | mark partial; block prompt promotion on Eval Core and stable chain/runtime contracts |
| KAN-122 | keep To Do; add V1 entry criteria |
| KAN-123 | keep To Do; clarify Console eval scope and distinguish Agent Workspace |
| KAN-124 | transition In Progress or partial; execute deterministic context with KAN-119/D1 |
| KAN-125 | detach from KAN-115 critical path and relate as non-blocking supporting lane |

### New portfolio epics

Create only these missing programmes:

1. **XTRM deterministic interfaces and harness integration** — I1 and later A1.
2. **XT Codex runtime integration** — if the local Epic is not already mirrored elsewhere.
3. **XTRM Agent Workspace** — P1.2/P1.3.
4. **XTRM Operational Knowledge System** — P1.4.

Create one bounded Archon comparison Task related to KAN-119/KAN-120. Do not create an Archon production-runtime Epic.

## 13. Work that must not start yet

Do not productionize:

- `sp chain approve` before I1 and E1 are stable;
- automatic chain advancement before the pure reducer exists;
- native workflow mutations before idempotency exists;
- prompt rewrites before Eval Core;
- automatic memory writes before calibrated precision;
- Agent Workspace mutation controls before command outcomes;
- a second `xt spec` implementation;
- Archon as an XTRM authority;
- monorepo migration as a prerequisite;
- Substrate-owned abstractions recreated as heavyweight bridge daemons without measured need.

## 14. Definition of programme control

This programme is under control when:

- every active Jira epic maps to a canonical document and real Beads roots;
- every delivered capability is marked released, source-only or experimental;
- local agents can identify the first claimable work without reading the whole PRD;
- no root task can dispatch before its required gates are present;
- every cross-repository change has an explicit coordinated-release gate;
- current execution state is updated after every release wave;
- superseded plans cannot be mistaken for active authority.

The immediate implementation centre is the seam:

```text
approved root contract
→ persisted deterministic execution shape
→ exact idempotent command intent
→ validated participant result
→ evidence-driven next transition
```

Everything else either feeds that seam, evaluates it, adapts it or presents it.