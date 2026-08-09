# XTRM Current Execution Plan

**Status:** canonical current execution plan  
**Last reconciled:** 2026-08-09, Europe/Rome  
**Programme:** XTRM  
**Repositories:** `xtrm-dev/core`, `xtrm-dev/specialists`, `Jaggerxtrm/xtmux`, `xtrm-dev/xtrm`  
**Jira projection:** project `KAN`  
**Execution truth:** repository-local Beads graphs  

## 1. Document role

This document is the current sequencing and dispatch authority for the pre-Substrate XTRM programme.

It does not replace:

- `xtrm-dev/specialists/docs/design/roadmap/enhanced-prd.md`, the accepted requirements and success-criteria canon;
- `specialist-execution-protocol.md`, the semantic lifecycle of one managed Specialist activation;
- the chain-template canon, which defines collaboration topology;
- repository code, released packages, Beads or Git evidence.

It exists because the PRD must not simultaneously act as requirements catalogue, release ledger, implementation sequence, operational manual and Jira board.

Current-state authority order:

```text
released packages and current repository code
→ executable schemas, tests and public contracts
→ this current execution plan
→ canonical PRD and semantic design documents
→ Jira portfolio projection
→ historical plans and chat artifacts
```

Jira communicates programme state. Beads owns executable tasks, dependencies, claims, acceptance and completion evidence.

## 2. Released baseline

| Repository | Released package | Release cut | Default-branch drift |
|---|---:|---|---|
| Core | `xtrm-tools 0.11.4` | `xtrm-dev/core#535`, `9b823f80` | none |
| Specialists | `@jaggerxtrm/specialists 3.21.2` | `xtrm-dev/specialists#240`, `c1e660ab` | one release-maintenance commit only |
| xtmux | `@jaggerxtrm/xtmux 0.2.3` | `Jaggerxtrm/xtmux#89`, `12d6709e` | none |

Implementation agents must refresh releases and default heads before dispatch. Source-only behavior is not a released capability.

## 3. Closed architecture decisions

### 3.1 Four separate layers

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

| Surface | Responsibility |
|---|---|
| `/spec-dispatch` | conversational routing, release/recent-work audit, scope and sprint shaping |
| `xt spec` | durable specification lifecycle, validation, apply, reconciliation and archive |
| `/planning` | programme work graph in Beads |
| chain templates | topology for executing one root task |
| `specialists.execution.v1` | deterministic shell around one participant activation |
| xtmux | durable local attention, messages, obligations, monitors, wakes and runtime identity |
| coordinator | bounded semantic judgment over deterministic reducer output |

These surfaces may share contracts. They must not become competing workflow engines.

### 3.2 The PRD is not the implementation sequence

The PRD remains canonical for outcomes and acceptance. It does not authorize starting all work packages concurrently.

The critical path is:

```text
release and authority reconciliation
→ deterministic public command outcomes
→ minimum specialists.execution.v1 shell
→ chain compiler and persisted ResolvedChain
→ manual composition gate
→ evidence reducer and scheduler intents
→ coordinator shadow mode
→ evaluation-driven authority promotion
→ adapters and product surfaces
```

### 3.3 One authority per concern

| Concern | Authority |
|---|---|
| Programme and task contracts | Beads |
| Specialist job lifecycle, progress and result | Specialists |
| Messages, obligations, monitors, wakes and pane identity | xtmux |
| Interactive launch, installation and managed configuration | Core |
| Branch, commit and merge truth | Git |
| Chain topology | canonical template compiled to persisted `ResolvedChain` |
| Deterministic next transition | pure reducer consuming persisted evidence |
| Semantic exceptions | coordinator/operator within explicit authority |
| Portfolio/product visibility | Jira and materialized read models |

No work package may introduce a second mutable store, scheduler, message registry, job lifecycle or merge authority for these concerns.

## 4. Delivered capability ledger

### 4.1 Core 0.11.4

Delivered:

- `xt spec draft|validate|doctor|apply|status|archive`;
- XML `<change-contract>` generation and spec apply/reconciliation state;
- `/spec-dispatch`, `/planning` and `/test-planning`;
- interactive `xt pi` and `xt claude` role/subordinate launches;
- runtime-origin and coordinator lineage;
- read-only `xt topology` projection and views;
- shared `@xtrm/contracts` schemas;
- release, install, skill, hook and compatibility hardening;
- unified native Pi tool rendering.

Not delivered:

- `xtrm.command-outcome.v1`;
- `xt codex`;
- canonical chain compiler/reducer;
- native XTRM coordination/Specialist tools;
- `pi-extensible-workflows` integration.

### 4.2 Specialists 3.21.2

Delivered:

- structured `sp run --json` and `sp feed --json` progress;
- deterministic replay ordering;
- `sp result`, `feed`, `status`, `integration record/list`, `render-task`, `render-bead`;
- runtime-origin and coordinator ancestry;
- terminal parent notification for `done`, `error` and `cancelled`;
- interactive `chain-coordinator` bridge persona;
- forensic and Prometheus foundations;
- background/help/release audit closure.

Not delivered:

- executable `specialists.execution.v1` profiles and reducers;
- `sp chain review|approve|insert|show|wire-edges`;
- persisted `ResolvedChain`;
- evidence-driven chain reducer and scheduler intents;
- logical sessions and recovery classifier;
- Eval Core and `sp eval`;
- three-lens memory.

The current coordinator includes an explicit resolver TODO and manually describes the role sequence. It is a bridge persona, not the completed KAN-120 runtime.

### 4.3 xtmux 0.2.3

Delivered:

- SQLite V2 durable messages, obligations, monitors, wakes and delivery evidence;
- exact `message-get` and `agent-last` retrieval;
- runtime/session/pane/role/branch/worktree/parent identity;
- canonical Beads lifecycle streaming;
- Pi, Claude and Codex lifecycle hooks;
- bounded capture, terminal monitor projection and orphan cleanup;
- reply/FYI, receipt and fulfilment semantics.

Not delivered:

- common command-outcome schema with stable reason codes and executable next actions;
- native XTRM harness adapters;
- graphical Agent Workspace;
- Core-owned `xt codex` launch, despite xtmux Codex observation support.

## 5. `xt spec` disposition

`xt spec` is a released v0 planning front end. It must not be planned again as net-new work.

Current flow:

```text
spec.yaml
→ validate and readiness probe
→ XML change contract
→ create planner bead
→ dispatch planner Specialist
→ persist apply sidecar
→ reconcile produced epic/children
→ hand off to `sp chain review`
```

Residual scope:

- use better Beads-native creation primitives only where verified installed capabilities improve atomicity;
- connect produced root tasks to the canonical chain compiler;
- implement `sp chain review` before advertising the handoff as operational;
- retain `xt spec` as programme planning, not participant topology.

Jira disposition:

- close `KAN-85` after installed-release smoke;
- mark the KAN-84 v0 surface delivered;
- move compiler/composition residual to `KAN-119`;
- create no second `xt spec` programme.

## 6. Chain-template disposition

Fifteen `.formula.json` source assets exist. They are not yet a released orchestration product.

Gaps:

- unsupported package/install location;
- no released `sp chain` command family;
- no authoritative selection/compiler boundary;
- no persisted `ResolvedChain`;
- no enforced minimum activation protocol;
- no evidence reducer.

Template/catalog and pure compiler work may begin immediately. Production dispatch and automatic advancement may not.

## 7. Workstreams

Symbolic IDs below are stable planning identifiers. Local planning maps them to real repository-owned Beads IDs.

### R0 — release and authority reconciliation

**Owner:** `xtrm-dev/xtrm`.

| ID | Deliverable |
|---|---|
| R0.1 | merge current execution plan, graph and coordinator bootstrap |
| R0.2 | refresh PRD release snapshot and landed-capability ledger |
| R0.3 | reconcile Jira KAN-84/85, KAN-110 and KAN-115–125 |
| R0.4 | publish Jira↔Beads↔GitHub mapping |
| R0.5 | mark historical and superseded plans |

R0.1 unlocks evidence-only audit lanes. R0.2–R0.5 must close before deterministic orchestration is promoted.

### I1 — deterministic public command outcomes

**Primary owner:** xtmux.  
**Companions:** Specialists and Core.  
**Source:** `xtrm-cli-actionable-outcomes-and-followups.md`.

#### I1.1 Command inventory and compatibility ADR

Evidence-only inventory across released commands:

```text
mutation/query classification
human and JSON output
stdout/stderr contract
exit codes
stable identifiers
current follow-up semantics
known consumers
breaking-change risk
candidate disposition
```

#### I1.2 xtmux coordination vertical slice

Initial commands:

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

Target additive contract:

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
Pi/Claude launch result
topology
merge/integration handoff
future Codex launch result
```

### E1 — minimum `specialists.execution.v1`

**Owner:** Specialists.

Implement the smallest deterministic shell required by all later chains.

#### E1.1 Execution-profile schema

A versioned profile declares:

- phase applicability;
- permission posture;
- contract and evidence requirements;
- output schema;
- commit policy;
- allowed overrides.

#### E1.2 PREPARE reducer

Runtime-owned:

- context and identity resolution;
- structural contract/readiness validation;
- mandatory-rule resolution and receipt;
- capability validation;
- explicit blocked and waiting states.

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
- emit forensic evidence;
- release owned resources only;
- make replay and duplicate terminal processing safe.

Prompt redesign, memory and semantic grading are non-goals for E1.

### C1 — chain compiler and durable spine

**Primary owner:** Specialists.  
**Development:** pure schema/compiler work may run parallel to I1/E1.  
**Promotion:** composition CLI requires I1.3 and E1.4.

#### C1.1 Package and validate template catalog

- supported package/install path;
- CI formula/catalog validation;
- explicit catalog version/build identity;
- per-repo extension resolution retained.

#### C1.2 Pure compiler

```text
root contract
+ scrutiny
+ scope/surface classification
+ selected template or override
+ catalog version
→ ResolvedChain draft
```

No shelling, Beads mutation, tmux or model call.

#### C1.3 Persisted `ResolvedChain`

Minimum contract:

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
→ verified molecule/root/step/gate operations
→ stable Beads IDs
→ links persisted back into ResolvedChain
```

It must not invent a second dependency graph.

#### C1.5 Manual composition CLI

```text
sp chain review <root>
sp chain insert <root> ...
sp chain approve <root>
sp chain show <root> [--json]
```

Review creates a draft. Insert mutates draft only. Approve freezes topology. Runtime evidence updates step status but never silently changes the approved shape.

### D1 — evidence reducer and scheduler intents

**Owner:** Specialists.  
**Entry gate:** `GATE-COMPOSE`.

#### D1.1 Authoritative evidence projection

Normalize only:

- validated job result;
- gate verdict;
- Beads readiness/status;
- Git and integration evidence;
- pending human gate;
- retry/incident state.

#### D1.2 Pure chain reducer

```text
ResolvedChain
+ authoritative evidence projection
→ next chain state
+ zero or more scheduler intents
```

No side effects.

#### D1.3 Exact scheduler intents

Example:

```json
{
  "kind": "dispatch_specialist",
  "role": "reviewer",
  "bead_id": "...",
  "arguments": {},
  "idempotency_key": "chain:<id>/step:<id>/attempt:<n>"
}
```

Other intents: wait, request-input, retry, restitch, escalate, record-integration and terminalize.

#### D1.4 Coordinator shadow mode

The coordinator consumes reducer output rather than encoding the chain in prompt prose.

It may make bounded semantic judgments, propose permitted insertion, escalate ambiguity and explain deterministic decisions. It may not invent scheduling, skip mandatory gates or mutate approved topology outside explicit authority.

### V1 — telemetry, evaluation, context, prompts and memory

#### V1.1 Telemetry integrity closure

Prove `telemetry-integrity-v1` against raw forensic evidence.

#### V1.2 Eval Core

- eval storage and candidate fingerprints;
- deterministic/model grader interfaces;
- historical completeness/backfill;
- compare and promotion reports;
- observe-only initial operation.

#### V1.3 Deterministic chain context and handoffs

Every participant receives chain/root/step identity, role/class/position, effective scrutiny, stable upstream pointers, pending gates, worktree identity and explicit partial/missing context state.

#### V1.4 Prompt and output-contract programme

Only after V1.1/V1.2 and stable chain/runtime contracts:

- one generated machine-readable output contract;
- prompt/procedure/context responsibility cleanup;
- paired/factorial prompt × model experiments;
- evidence-gated promotion.

#### V1.5 Three-lens memory

Only after retrieval and pollution can be measured:

- herd, workgroup and identity lenses;
- pull-based retrieval;
- proposal/shadow distillation;
- precision, pollution, duplication and reuse metrics.

### A1 — harness-native integrations

**Entry:** stable I1 contracts and idempotency.

#### A1.1 Capability verification

Claude MCP tasks/background/wake behavior, Specialists MCP boundary, Pi background-runtime comparison and installed-version/security evidence.

#### A1.2 Thin native tools

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

Adapters retain no private durable authority.

#### A1.3 Pi Runtime Unification residual

Canonical decision/closure record for upstream Pi packages, embedded/RPC duplication, package/agent versus package/coding-agent, transport ownership, obsolete paths, release and rollback.

#### A1.4 `pi-extensible-workflows`

Integrate through public extension APIs only after replay idempotency and worktree ownership are proven.

#### A1.5 XT Codex parity

Core `xt codex`, xtmux lifecycle identity, deterministic assignment and parity fixtures. Read-only prototype may start early; production depends on I1.4.

### P1 — product surfaces

#### P1.1 Console evaluation and promotion views

Complete KAN-123 after event/eval contracts stabilize.

#### P1.2 Agent Workspace read-only shell

Topology graph, pane/session navigation, embedded terminal, exact message/result/evidence inspection and Beads chain status. No hidden mutation.

#### P1.3 Controlled Agent Workspace actions

Consume command outcomes and explicit authority. No UI-specific orchestration logic.

#### P1.4 Operational Knowledge System

Read-only provenance, freshness and query contracts first. Automated remediation requires a separate authorization gate.

## 8. Dependency graph and promotion gates

### 8.1 Parallel audit start

```text
R0.1
├── I1.1
├── E1.1
├── C1.1
├── V1.1 audit
├── A1.1 audit
└── XT Codex read-only capability audit
```

### 8.2 Interface gate

```text
I1.1 → I1.2 → I1.3/I1.4
```

`GATE-IFACE` requires:

- approved command-outcome contract;
- xtmux vertical slice;
- Specialists and Core consumer compatibility fixtures;
- released-trio smoke of the affected public commands.

Passing `GATE-IFACE` authorizes thin adapters and later scheduler intents to consume these outcomes. It does not authorize chain automation.

### 8.3 Activation and composition gate

```text
E1.1 → E1.2/E1.3 → E1.4
C1.1 → C1.2 → C1.3 → C1.4
GATE-IFACE + E1.4 + C1.4 → C1.5
```

`GATE-COMPOSE` requires:

- released command outcomes for relevant Specialists commands;
- minimum activation protocol;
- packaged catalog and pure compiler;
- persisted draft/approved shape;
- manual review/insert/approve/show fixture;
- no automatic next-step dispatch.

Passing `GATE-COMPOSE` authorizes manual deterministic composition and observe-only execution. It does not authorize automatic advancement or coordinator authority.

### 8.4 Deterministic orchestration gate

```text
GATE-COMPOSE
→ D1.1
→ D1.2
→ D1.3
→ released-trio end-to-end fixture
```

`GATE-DO0` requires:

1. versioned root contract resolves to one deterministic `ResolvedChain`;
2. approved shape is persisted and inspectable;
3. dispatch is an exact idempotent scheduler intent;
4. participant runs through minimum `specialists.execution.v1`;
5. output/evidence are validated before terminal state;
6. handoff, notification and cleanup are idempotent;
7. reducer derives next transition from persisted evidence;
8. wait/failure/retry/restitch/escalation are explicit;
9. progress/result/integration evidence remain authoritative;
10. packed-install and cross-repository released-trio smoke pass;
11. no duplicate mutable authority exists.

Passing `GATE-DO0` authorizes deterministic scheduler intents and coordinator shadow mode. It does not authorize broad automatic enforcement.

### 8.5 Authority-promotion gate

```text
GATE-DO0
→ D1.4 shadow
→ V1.1/V1.2
→ measured promotion report
```

`GATE-AUTH` requires accepted precision, parity, override, recovery and false-positive evidence.

Only `GATE-AUTH` may promote selected coordinator/reducer policies from observe/shadow to warn/enforce or automatic advancement.

## 9. Parallel dispatch model

After R0.1:

| Lane | Initial fan-out | Scope |
|---|---:|---|
| Interface | 3 | I1.1 per runtime repository, then one synthesis |
| Execution protocol | 2 | profile/schema and PREPARE/FINALIZE audit |
| Chain compiler | 2 | catalog/package audit and pure schema/compiler design |
| Evaluation | 1 | telemetry/eval current-state audit |
| Codex | 1 | read-only capability and parity audit |
| Supporting | 1 | TypeScript 7 or code-intelligence residual if host capacity permits |

One owner writes each shared contract. Independent agents review and test it. Do not dispatch parallel writers to the same canonical schema or reducer.

## 10. First local implementation packet

Create executable Beads leaves only for:

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

Epic D — deterministic orchestration fixture and reducer
  D0 cross-repository fixture harness
  D1 evidence projection and pure reducer
  D2 scheduler intents
  D3 released-trio DO0 run
  D4 coordinator shadow integration
```

Later V1/A1/P1 programmes remain placeholder epics with entry criteria only. They must not appear claimable before their gates pass.

No fictitious cross-repository parent-child hierarchy is allowed. Each repository owns its own executable roots; `xtrm-dev/xtrm` owns the index and cross-repository release gates.

## 11. Jira reconciliation packet

Apply after Atlassian access is available.

| Jira | Mutation |
|---|---|
| KAN-84 | mark v0 delivered; move compiler/composition residual to KAN-119 |
| KAN-85 | installed-release smoke, then Done |
| KAN-110 | record phases 1–3 delivered; split pyright/upstream residual |
| KAN-114 | fold/relate to KAN-121 and KAN-124 after typed-context decision |
| KAN-115 | In Progress; update release ledger and link this plan |
| KAN-116 | In Progress; retain unfinished G02, approved graph and WP→Beads mapping |
| KAN-117 | In Progress; separate delivered telemetry foundation from Eval Core |
| KAN-118 | In Progress; record assignment/notifications delivered, focus on recovery |
| KAN-119 | Highest and next critical implementation item; own compiler and `ResolvedChain` |
| KAN-120 | record bridge persona delivered; retain reducer/entry/incident/close residual |
| KAN-121 | partial; block prompt promotion on Eval Core and stable runtime contracts |
| KAN-122 | keep To Do with V1 entry criteria |
| KAN-123 | keep To Do; distinguish Console eval scope from Agent Workspace |
| KAN-124 | partial/In Progress; execute deterministic context with C1/D1 |
| KAN-125 | detach from critical path and relate as non-blocking supporting lane |

Create only these missing portfolio programmes:

1. **XTRM deterministic interfaces and harness integration** — I1 and later A1.
2. **XT Codex runtime integration** — if the local Epic is not already mirrored.
3. **XTRM Agent Workspace** — P1.2/P1.3.
4. **XTRM Operational Knowledge System** — P1.4.

Create one bounded Archon comparison Task related to KAN-119/KAN-120. Do not create an Archon production-runtime Epic.

## 12. Work that must not start early

Do not productionize:

- automatic chain advancement before `GATE-DO0`;
- coordinator warn/enforce authority before `GATE-AUTH`;
- workflow mutation adapters before idempotency;
- prompt promotion before Eval Core;
- automatic memory writes before precision calibration;
- Agent Workspace mutation controls before command outcomes;
- a second `xt spec` implementation;
- Archon as an XTRM authority;
- monorepo migration as a prerequisite;
- heavyweight bridge daemons without measured need.

## 13. Local coordinator rules

Every local coordinator must:

1. refresh releases, heads and recent merged PRs;
2. run `/spec-dispatch` against this document;
3. inspect/reconcile existing Beads before creation;
4. verify installed Beads capabilities before writes;
5. group work by reviewable PR/release boundary;
6. record symbolic workstream IDs in root Beads;
7. review the dependency graph before live creation;
8. keep Jira as a portfolio mirror, not a leaf-task clone;
9. require independent review and test evidence for schemas/reducers;
10. update this ledger before continuing if code contradicts it.

## 14. Definition of programme control

The programme is under control when:

- every active Jira epic maps to canonical documents and real repository Beads roots;
- every capability is marked released, source-only, experimental or residual;
- agents can identify first claimable work without reading the complete PRD;
- no root dispatches before required gates exist;
- every cross-repository change has an explicit coordinated-release gate;
- this plan is refreshed after each release wave;
- superseded documents cannot be mistaken for active authority.

The immediate implementation centre is:

```text
approved root contract
→ persisted deterministic execution shape
→ exact idempotent command intent
→ validated participant result
→ evidence-driven next transition
```

Everything else feeds, evaluates, adapts or presents this seam.

## 15. 2026-08-09 v1 termination amendment

This section is the current sequencing amendment derived from the accepted runtime reconciliation. It supplements the existing workstream descriptions without creating a competing plan.

The immediate critical path is:

```
RUN 0 document reconciliation
→ Pi v0.84.1 compatibility closure
→ KAN-127 K5 parity promotion
→ K6 published compatibility releases
→ clean-install released-trio smoke
→ specialists.execution.v1 runtime semantics
→ ChainTemplate compiler and persisted ResolvedChain
→ manual composition gate
→ quant/math vertical fixture
→ evidence reducer, scheduler intents and runtime delivery
→ Eval Core, deterministic context and memory v1
→ Channels v1 bridge, pulse and attention compatibility
→ measured authority gate
→ final released-artifact E2E and deployment freshness
```

RUN 0 is not complete from documentation alone. The single completion ledger at docs/shared/xtrm-v1-completion-ledger.md is the disposition index. Repository-local Beads remain executable truth, and no residual may be implemented by inventing a second cross-repository work graph.

The target Substrate runtime and migration are explicitly deferred by accepted gate for this campaign. Substrate design patches, including separate work-causality and execution-lineage projections, remain mandatory; the bridge must stay compatible with the target semantics.

Each implementation packet must carry a stable ID, owning repository, authority reference, current baseline, exact missing behavior, dependencies, scope/non-goals, acceptance and negative tests, E2E checkpoint, rollback/compatibility rule and release consequence. Completion claims must separately identify design, source, release, deployment/operator and promotion state.

The plan now requires a cross-document contradiction review across the PRD, roadmap, execution protocol, chain canon, Channels, memory, Substrate compatibility, command outcomes, adapters, JSON graph and completion ledger before GATE-R0 can pass.
