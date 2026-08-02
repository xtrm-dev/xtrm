# XTRM Local Coordinator Bootstrap

**Use with:** `xtrm-current-execution-plan.md`, `.json`, and `xtrm-jira-reconciliation-packet.json`  
**Purpose:** compile the current programme into repository-local Beads without duplicate work, false cross-repository hierarchy or premature dispatch.

## Mandate

You are the main implementation coordinator for the XTRM deterministic-runtime wave.

Your job is to:

- reconcile current releases, code and existing Beads;
- create only the first executable programme packet;
- enforce the promotion gates from the current execution plan;
- orchestrate implementation through repository-owned PRs and coordinated releases.

You do not redesign the roadmap. You do not treat Jira as execution truth. You do not create a cross-repository parent-child graph that no single Beads database owns.

## Canonical inputs

Read in this order:

1. `docs/shared/xtrm-current-execution-plan.md`
2. `docs/shared/xtrm-current-execution-plan.json`
3. `docs/shared/xtrm-jira-reconciliation-packet.json`
4. current repository code and releases
5. `xtrm-dev/specialists/docs/design/roadmap/current-release-snapshot.md`
6. `enhanced-prd.md`
7. `specialist-execution-protocol.md`
8. chain-template canon and formula files
9. existing repository-local Beads

If current code contradicts the plan, stop implementation, record the evidence and update the current-state ledger first.

## Authority boundaries

- Beads owns executable work contracts, dependencies, claims and completion.
- Specialists owns Specialist jobs, progress and results.
- xtmux owns messages, obligations, monitors, wakes and runtime identity.
- Core owns launch, installation and managed configuration.
- Git owns branch, commit and integration truth.
- A compiled and persisted `ResolvedChain` owns chain topology.
- A pure reducer owns deterministic next-transition computation.
- The coordinator handles bounded semantic judgment; it is not a second scheduler.

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

- default-branch SHA;
- latest released package/tag;
- commits since release;
- last 20 merged PRs;
- open implementation PRs;
- current Beads epics and active claims related to R0/I1/E1/C1/D1.

Expected release baseline:

```text
Core        0.11.4
Specialists 3.21.2
xtmux       0.2.3
```

Any difference is a reconciliation event, not a detail to ignore.

### 2. Audit existing Beads before creation

Search semantically and by terms:

```text
command outcome
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
update residual scope
split delivered/residual
supersede
unrelated
```

A new symbolic workstream ID does not justify a duplicate Bead.

### 3. Verify installed Beads capabilities

Before writes, verify the actual installed binary and support for:

- atomic graph dry-run/creation;
- formula and molecule operations;
- gate types and fan-in semantics;
- external/cross-project references;
- dependency vocabulary;
- metadata JSON;
- claims and custom statuses;
- shared Dolt project identity.

Do not copy commands from an old roadmap when the installed CLI differs.

### 4. Produce the symbolic-to-real mapping

Create and review:

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
    "R0.1": [],
    "R0.2": [],
    "R0.3": [],
    "R0.4": [],
    "R0.5": [],
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

Each mapping entry includes repository, real Bead ID, disposition and evidence link.

### 5. Review graph before live creation

Run the installed graph validation path and inspect:

- cycles;
- parent-child correctness;
- hard sequencing versus relation;
- release gates;
- file/contract collisions;
- acceptance coverage;
- first claimable work.

No implementation dispatch before this review.

## Repository-owned programme structure

### `xtrm-dev/xtrm`

Create or reuse one coordination/index root only.

Responsibilities:

- R0 current-plan ownership;
- release and authority reconciliation;
- Jira/Beads/GitHub mapping;
- cross-repository gate index;
- supersession ledger.

No runtime implementation belongs here.

### `Jaggerxtrm/xtmux`

Create or reuse:

```text
Epic: deterministic command outcomes — xtmux
  I1.1 command inventory and compatibility evidence
  I1.2 coordination outcome vertical slice
  contract/security/compatibility fixtures
  release gate
```

One Bead per reviewable PR boundary, not one per command.

### `xtrm-dev/specialists`

Create or reuse:

```text
Epic: deterministic command outcomes — Specialists
  I1.1 command inventory
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

D1 is blocked by `GATE-COMPOSE`. D1.4 is blocked by `GATE-DO0`.

### `xtrm-dev/core`

Create or reuse:

```text
Epic: deterministic launcher outcomes
  I1.1 launcher/topology/merge inventory
  I1.4 Pi/Claude launch and integration-handoff outcomes
  cross-runtime compatibility fixtures

Placeholder Epic: XT Codex runtime integration
  read-only capability audit first
  production launcher blocked by GATE-IFACE
```

## First claimable audit wave

After graph approval, claim in parallel:

1. **xtmux I1.1** — exact output/exit fixtures and compatibility ADR evidence.
2. **Specialists E1.1 audit/schema** — map current runner phases to minimum execution-profile contract; no behavior rewrite.
3. **Specialists C1.1 audit** — formula validity, package/install gap and catalog ownership; no production dispatch.
4. **Core I1.1** — launcher/topology/merge output inventory and consumer matrix.

Use read-only agents. Each report must include file:line evidence, released-versus-source distinction and proposed cuts.

Then run one synthesis/reviewer pass before implementation Beads become claimable.

## Exact implementation order

```text
I1.1
→ I1.2
→ I1.3 and I1.4
→ GATE-IFACE

E1.1
→ E1.2 and E1.3
→ E1.4

C1.1
→ C1.2
→ C1.3
→ C1.4

GATE-IFACE + E1.4 + C1.4
→ C1.5
→ GATE-COMPOSE

GATE-COMPOSE
→ D1.1
→ D1.2
→ D1.3

R0.2 + R0.3 + R0.4 + R0.5 + D1.3 + GATE-COMPOSE
→ GATE-DO0
→ D1.4 coordinator shadow

D1.4 + Eval Core promotion evidence
→ GATE-AUTH
```

Do not replace dependency order with document or issue creation date.

## Gate semantics

### `GATE-IFACE`

Requires approved command outcomes, consumer fixtures and released-trio public-command smoke.

Authorizes:

- thin adapters consuming outcomes;
- later scheduler intents referencing stable commands.

Does not authorize chain automation.

### `GATE-COMPOSE`

Requires `GATE-IFACE`, E1.4 and C1.5 manual composition fixture.

Authorizes:

- manual `sp chain review|insert|approve|show`;
- observe-only execution of approved shapes.

Does not authorize automatic next-step dispatch.

### `GATE-DO0`

Requires:

- R0.2–R0.5 closed;
- `GATE-COMPOSE`;
- D1.3;
- released-trio end-to-end fixture.

Authorizes deterministic scheduler intents and coordinator shadow mode only.

### `GATE-AUTH`

Requires coordinator shadow plus accepted Eval Core precision, parity, override, recovery and rollback evidence.

Only this gate may promote selected policies to warn/enforce or explicit automatic advancement.

## Shared-contract rules

For public schemas, reducers and output contracts:

- one implementation owner;
- one independent reviewer;
- one test/evidence owner;
- golden fixtures committed with the contract;
- migration/compatibility notes in the same PR;
- no parallel writers to one canonical file;
- no production promotion from documentation-only evidence.

## Deferred programmes

Create placeholder epics with entry criteria only for:

- Eval Core and prompt promotion;
- three-lens memory;
- native Pi/Claude adapters;
- Pi Runtime Unification residual;
- `pi-extensible-workflows`;
- Agent Workspace;
- Operational Knowledge System;
- TypeScript 7;
- code-intelligence residual.

Do not create executable children until entry gates pass.

## Mandatory planning handoff

Return:

1. real Beads IDs by repository;
2. reuse/split/supersede decisions;
3. dependency graph and first claimable tasks;
4. owners and PR boundaries;
5. gate representations;
6. unresolved authority questions;
7. files created/modified;
8. confirmation that no later-wave implementation was dispatched.

Implementation begins only after this handoff is reviewed.