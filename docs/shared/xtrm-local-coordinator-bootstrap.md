# XTRM Local Coordinator Bootstrap

**Use with:** `docs/shared/xtrm-current-execution-plan.md` and `.json`  
**Purpose:** give the main local coordinator an exact first-run protocol for compiling the current plan into repository-local Beads without duplicating work or dispatching later roadmap scope prematurely.

## Mandate

You are the main implementation coordinator for the XTRM deterministic-runtime wave.

Your job is to reconcile existing Beads and current repository state, create only the first executable programme packet, and orchestrate implementation through reviewable repository-owned PRs.

You do not redesign the roadmap. You do not treat Jira as implementation truth. You do not create a cross-repository parent-child hierarchy that Beads cannot honestly own.

## Canonical input

Read in this order:

1. `docs/shared/xtrm-current-execution-plan.md`
2. `docs/shared/xtrm-current-execution-plan.json`
3. affected repository code and current releases
4. `xtrm-dev/specialists/docs/design/roadmap/enhanced-prd.md`
5. `specialist-execution-protocol.md`
6. chain-template canon and executable formula files
7. existing repository-local Beads

If current code contradicts the current execution plan, stop implementation, capture the evidence and update the plan first.

## Non-negotiable authority boundaries

- Beads owns executable work contracts, dependencies, claims and completion.
- Specialists owns Specialist jobs, progress and results.
- xtmux owns messages, obligations, monitors, wakes and runtime identity.
- Core owns launch, install and managed configuration.
- Git owns branch, commit and integration truth.
- A compiled and persisted `ResolvedChain` owns chain topology.
- A pure reducer owns deterministic next-transition computation.
- The coordinator handles bounded semantic judgment; it does not become a second scheduler.

## First-run protocol

### 1. Refresh reality

For each repository:

```text
xtrm-dev/core
xtrm-dev/specialists
Jaggerxtrm/xtmux
xtrm-dev/xtrm
```

Record:

- current default-branch SHA;
- latest released package/tag;
- commits since release;
- last 20 merged PRs;
- open implementation PRs;
- current Beads epics and in-progress claims relevant to R0/I1/E1/C1/D1.

The expected release baseline is Core `0.11.4`, Specialists `3.21.2`, xtmux `0.2.3`. Treat any difference as a reconciliation event.

### 2. Audit existing Beads before creating anything

Search semantically and by known labels/terms:

```text
command outcome
CLI outcome
next_actions
execution protocol
execution profile
PREPARE
FINALIZE
ResolvedChain
chain compiler
chain review
chain approve
chain reducer
scheduler intent
coordinator resolver
session recovery
telemetry integrity
eval core
Codex
```

Classify every match:

```text
reuse unchanged
update scope
split delivered/residual
supersede
unrelated
```

Never create a new root merely because the symbolic plan ID is new.

### 3. Verify Beads capabilities

Before writes, verify the installed Beads version and actual support for:

- atomic graph creation/dry-run;
- formula/molecule operations;
- gate types and fan-in semantics;
- cross-project or external references;
- supported dependency types;
- metadata JSON;
- claim pools/statuses;
- shared Dolt project identity.

Do not copy commands from old plans when the installed binary differs.

### 4. Build a proposed mapping

Create a reviewed mapping before live issue creation:

```json
{
  "schema_version": "xtrm.current-execution-beads-map.v1",
  "generated_at": "...",
  "repositories": {
    "xtrm-dev/xtrm": {},
    "xtrm-dev/core": {},
    "xtrm-dev/specialists": {},
    "Jaggerxtrm/xtmux": {}
  },
  "symbolic_to_bead": {
    "I1.1": [],
    "I1.2": [],
    "I1.3": [],
    "I1.4": [],
    "E1.1": [],
    "E1.2": [],
    "E1.3": [],
    "E1.4": [],
    "C1.1": [],
    "C1.2": [],
    "C1.3": [],
    "C1.4": [],
    "C1.5": [],
    "D1.1": [],
    "D1.2": [],
    "D1.3": [],
    "D1.4": []
  }
}
```

Each entry carries repository, real Bead ID, disposition and evidence link.

### 5. Review the proposed graph

Run the installed graph dry-run/validation path. Inspect:

- cycles;
- parent-child correctness;
- hard sequencing versus mere relation;
- cross-repository release gates;
- collision risk across files and contracts;
- acceptance coverage;
- which tasks are independently claimable.

No live implementation dispatch before the graph is reviewed.

## Repository-owned programme structure

Do not create one fake umbrella Epic with children in other databases.

### `xtrm-dev/xtrm`

Create or reuse one coordination/index root only.

Responsibilities:

- current execution plan ownership;
- release and authority reconciliation;
- Jira/Beads/GitHub mapping;
- cross-repository gate index;
- supersession ledger.

No runtime implementation belongs here.

### `Jaggerxtrm/xtmux`

Create or reuse:

```text
Epic: deterministic command outcomes — xtmux
  I1.1 xtmux command inventory and compatibility evidence
  I1.2 command-outcome contract and first coordination slice
  I1.2 tests: human/JSON/exit/idempotency/security compatibility
  release gate: publish supported xtmux version
```

One Bead per reviewable PR boundary, not per command.

### `xtrm-dev/specialists`

Create or reuse separate repository-owned roots:

```text
Epic: deterministic command outcomes — Specialists
  I1.1 Specialists command inventory
  I1.3 run/feed/result/resume/stop/integration outcomes

Epic: minimum specialists.execution.v1
  E1.1 execution-profile schema
  E1.2 PREPARE reducer
  E1.3 FINALIZE reducer
  E1.4 terminal actions and idempotency

Epic: chain compiler and durable spine
  C1.1 template packaging/catalog validation
  C1.2 pure ResolvedChain compiler
  C1.3 persistence
  C1.4 Beads materializer
  C1.5 review/insert/approve/show CLI

Epic: reducer and coordinator shadow mode
  D1.1 evidence projection
  D1.2 pure reducer
  D1.3 scheduler intents
  D1.4 coordinator shadow integration
```

The last Epic is blocked by the production promotion prerequisites from I1/E1/C1.

### `xtrm-dev/core`

Create or reuse:

```text
Epic: deterministic launcher outcomes
  I1.1 Core launcher/topology/merge inventory
  I1.4 Pi/Claude launch and integration-handoff outcomes
  compatibility fixtures against xtmux and Specialists

Placeholder Epic: XT Codex runtime integration
  capability audit only initially
  production launcher blocked by I1.4 contract approval
```

## First claimable wave

After graph approval, these four evidence tasks may be claimed in parallel:

1. **xtmux I1.1** — command inventory, exact output/exit fixtures and compatibility ADR input.
2. **Specialists E1.1 audit/schema** — map current runner phases to the minimum execution-profile contract; no behavioral rewrite yet.
3. **Specialists C1.1 audit** — prove formula validity, package/install gap and catalog ownership; no production dispatch yet.
4. **Core I1.1** — launcher/topology/merge output inventory and current consumer matrix.

Recommended fan-out:

```text
main coordinator
├── xtmux explorer/auditor
├── Specialists execution-protocol explorer
├── Specialists chain-template explorer
└── Core launcher explorer
```

Use read-only agents for this wave. Each report must include file:line evidence, release-versus-source distinction and proposed cuts.

Then run one synthesis/reviewer pass to approve the contract boundaries before implementation Beads become claimable.

## Implementation order after the audit wave

```text
xtmux I1.2
→ Specialists I1.3 and Core I1.4

E1.1
→ E1.2 and E1.3 in parallel
→ E1.4

C1.1
→ C1.2
→ C1.3
→ C1.4
→ C1.5, gated by I1.3 and E1.4

I1.3 + E1.4 + C1.5
→ D1.1
→ D1.2
→ D1.3
→ D1.4 shadow
```

Do not substitute date order for dependency order.

## Shared-contract rules

For schemas, reducers and public output contracts:

- one named implementation owner;
- one independent reviewer;
- one test/evidence owner;
- golden fixtures committed with the contract;
- compatibility and migration notes in the same PR;
- no parallel editing of the same canonical file;
- no production promotion from documentation-only evidence.

## Release gates

### Gate I1

A coordinated released trio proves command outcomes and consumer compatibility.

### Gate E1

Every managed activation validates contract, output and evidence before terminal state; terminal side effects are idempotent.

### Gate C1

Templates are installed, compiled by one pure compiler, persisted and reviewable; approved topology cannot mutate silently.

### Gate DO0

A released-trio end-to-end run proves:

```text
root contract
→ ResolvedChain
→ approved shape
→ exact dispatch intent
→ minimum execution protocol
→ validated result
→ reducer next transition
→ integration evidence
→ terminal cleanup
```

No automatic coordinator authority before DO0.

## Deferred programme handling

Create placeholder epics with entry criteria only for:

- Eval Core and prompt promotion;
- three-lens memory;
- native Pi/Claude adapters;
- Pi Runtime Unification residual;
- `pi-extensible-workflows`;
- Agent Workspace;
- Operational Knowledge System;
- TypeScript 7;
- remaining code-intelligence work.

Do not create executable child Beads until their entry criteria are satisfied. This prevents the local board from presenting future work as immediately claimable.

## Mandatory handoff after planning

Return to the operator:

1. exact real Beads IDs by repository;
2. reuse/split/supersede decisions;
3. dependency graph and first claimable tasks;
4. owners and expected PR boundaries;
5. release gates;
6. remaining unresolved authority questions;
7. files created or modified;
8. a statement that no later-wave implementation was dispatched.

The first implementation dispatch begins only after this handoff is reviewed.