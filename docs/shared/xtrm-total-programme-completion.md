# XTRM Total Programme Completion Registry

**Status:** programme-wide completion ledger and reconciliation index. This document does not replace component specifications, accepted PRD requirements, Substrate/Channels normative designs, Beads execution truth, or released artifacts. It connects them and makes unresolved work explicit.

**Snapshot:** 2026-08-07 17:52 CEST.

**Machine-readable companion:** `docs/shared/xtrm-total-programme-registry.json`.

## 1. Purpose

XTRM has accumulated substantial implementation, design and research across `xtrm-dev/xtrm`, `xtrm-dev/core`, `xtrm-dev/specialists`, `Jaggerxtrm/xtmux`, repository-local Beads, Jira/Confluence projections, and long-running workspace discussions. No single PRD, roadmap, Jira epic, design note, or conversation is complete coverage of the programme.

This registry exists so that the programme can reach a deliberate terminal state without losing work or reviving superseded architecture. Its unit of accounting is any meaningful programme item: implemented capability, accepted requirement, design concept, research result, work package, formula/template, open PR, release obligation, prototype, migration seam, unresolved decision, or historical proposal that still needs an explicit disposition.

A programme item is considered reconciled only when it has an evidence-backed disposition. “Completion” does not mean every historical idea becomes code. Rejected, superseded, transferred, retired and prerequisite-blocked items are valid terminal or bounded states when recorded explicitly.

## 2. Truth model

Never collapse these states into one `done` flag:

```text
source implementation state
release/package state
operator/local deployment state
programme promotion state
design/reconciliation state
```

The incidents observed on 2026-08-05/06 prove why this split is necessary: Core worktree-reap and xtmux liveness fixes were merged while the operator-facing linked checkouts were still behind the merge. A merged source change is therefore not sufficient evidence that the operator is running it.

For current-state claims, use this precedence:

1. released artifacts and released-trio smoke for operator-delivered package truth;
2. default-branch code, schemas, tests and immutable commits for source truth;
3. open PRs/local worktrees for in-flight implementation evidence;
4. `docs/shared/xtrm-current-execution-plan.{md,json}` and current release snapshots for programme sequencing;
5. accepted PRD/roadmap and focused reconciliation notes for requirements and bridge architecture;
6. Substrate and Channels documents for their target runtime semantics;
7. Beads for repository-local executable work and dependency truth;
8. Jira/Confluence for programme projection and long-form product/design canon;
9. historical plans, research and workspace conversations as discovery sources until promoted or explicitly retired.

When authorities disagree, do not average them. Record the conflict, identify the owning authority and produce a supersession or migration relation.

## 3. Disposition vocabulary

Every registry item uses one of these programme states:

- `DELIVERED_RELEASED` — implemented, released and evidenced at the operator/package boundary.
- `DELIVERED_SOURCE_ONLY` — merged on the owning default branch but not yet established as released/deployed truth.
- `OPEN_IMPLEMENTATION` — active reviewable implementation exists, usually an open PR or local work packet.
- `PARTIAL` — meaningful implementation exists but accepted behavior remains incomplete.
- `PLANNED` — accepted execution work exists but implementation has not begun.
- `DESIGN_ONLY` — retained design/research with no current execution authorization.
- `NEEDS_DECISION` — incompatible alternatives or product choices require an explicit decision.
- `DORMANT_UNTIL_PREREQUISITE` — retained work intentionally waits on a named gate or dependency.
- `TRANSFERRED_TO_OTHER_OWNER` — still relevant but authority moved elsewhere.
- `SUPERSEDED` — a newer design or implementation replaces it; retained only for provenance.
- `REJECTED` — evaluated and intentionally not pursued.
- `RETIRED` — formerly active behavior intentionally removed.
- `NOT_APPLICABLE` — discovered item does not belong in the programme residual graph.
- `UNVERIFIED` — known from discussion/design but not yet reconciled against current authoritative evidence.
- `MISSING_TRACKING` — accepted or active work with no adequate durable tracker.

## 4. Repository snapshot

### 4.1 `xtrm-dev/xtrm` — programme/design and shared packages

Current programme authority includes the merged release-reconciled execution packet from PR #31:

- `docs/shared/xtrm-current-execution-plan.md`
- `docs/shared/xtrm-current-execution-plan.json`
- `docs/shared/xtrm-local-coordinator-bootstrap.md`
- `docs/shared/xtrm-jira-reconciliation-packet.json`

The merged KAN-127 sequencing note from PR #32 remains the deterministic Codex companion.

PR #33 is open/draft and focused on chain/Substrate/Channels/pulse reconciliation. Its 2026-08-04 KAN-127 implementation snapshot is now stale: this registry supersedes PR #33 only for global current-state claims, not for its architectural reconciliation.

The repository also contains substantial first-class `service-knowledge` work. The v0.1 lift-and-shift, verifier/index/MCP/dispatch/evaluation/canary progression and associated service-skill migration must remain a first-class programme lane rather than disappearing behind the runtime-trio roadmap.

### 4.2 `xtrm-dev/core` — control plane

Verified source progress includes:

- deterministic `xtrm.command-outcome.v1` contract and Pi/Claude structured launch outcomes;
- experimental Codex launcher with exact thread/worktree/safety-profile handling;
- K4 Codex skill/distribution parity and Core-side active Serena retirement;
- Specialists K4 vendor refresh required for the cross-repository observation gate;
- aggregated topology and read-only fleet views;
- ownership-safe global installer behavior and release/smoke hardening;
- `xt worktree reap` plus safer `xt end`, tiered artifact reclamation and scheduled cleanup;
- `capacity-reclaim` operational skill based on the real disk-pressure incident.

Current open source work includes Core PR #545, which extends the deploy-gap guard to committed-artifact CLI deployments. This is important programme evidence that source merge, package release and local deployed checkout must be tracked independently.

The Core README architecture rewrite remains an old open draft (#533) and must be reconciled or retired rather than left indefinitely ambiguous.

Current known published baseline remains `xtrm-tools 0.11.4`; source is materially ahead of that release.

### 4.3 `xtrm-dev/specialists` — bounded cognitive/execution runtime

Verified source progress includes:

- native Codex render/role surface;
- K4 structured Core launch-outcome consumption and result-retrieval parity without creating a second result authority;
- active Serena runtime retirement merged;
- current release snapshot and roadmap pickup reconciliation;
- background job support, parent notification, dead-job recovery, branch integration read surface and substantial testing/quarantine repair;
- review-chain semantic hardening merged in PR #250: working-tree truth, test-theatre checks, failure-mode inversion, root-cause placement, bounded Seconder additions and stronger security-review methodology.

Fifteen formula assets exist, but they are not a production chain runtime. The pure compiler, persisted `ResolvedChain`, manual composition surface, minimum activation protocol, reducer/scheduler spine and released-trio fixture remain separate future work unless newer evidence lands.

The Specialists README architecture rewrite remains an old open draft (#243) and requires reconciliation/retirement.

Current known published baseline remains `@jaggerxtrm/specialists 3.21.2`; source is ahead.

### 4.4 `Jaggerxtrm/xtmux` — coordination runtime

Verified source progress includes:

- durable identity/lifecycle, messages, obligations, waits, wakes, monitors, turn capture and event journal;
- topology projection carrying role/worktree/branch/parent lineage;
- Codex K1 characterization, K3 runtime adapter and merged EVAL-01 Codex recovery/idempotence evidence gate (#93);
- compatibility-link installer adoption (#94);
- monitor liveness and a real detached monitor poller (#95), including stale-running detection and safe convergence with other terminal writers.

Current critical open work is PR #96, `K4-xtmux — complete Codex lifecycle, recovery, and managed distribution`. Its PR explicitly identifies itself as the last KAN-127 critical-path implementation item before the cross-repository K4 matrix, K5 and K6. It addresses positional Codex hook trust, legacy entry adoption, restart recovery, inbound reply/reminder behavior, terminal cleanup and production dispatcher routing. Independent Codex review was unavailable at the PR checkpoint because the review quota was exhausted; this remains review evidence to account for before promotion.

The xtmux README architecture rewrite remains an old open draft (#90) and requires reconciliation/retirement.

Current known published baseline remains `@jaggerxtrm/xtmux 0.2.3`; source is ahead.

## 5. Current programme critical path

The deterministic runtime programme is currently best represented as:

```text
released baseline reconciliation
→ deterministic public command outcomes
→ minimum Specialists execution envelope
→ KAN-127 Codex parity completion
→ K4 cross-repository observation packet
→ K5 parity promotion
→ K6 compatibility/release wave
→ released-trio smoke
→ C1 pure chain compiler + persisted ResolvedChain
→ GATE-COMPOSE
→ D1 evidence reducer + scheduler intents
→ GATE-DO0
→ measured evaluator/coordinator shadow
→ GATE-AUTH
→ selected automatic authority
```

KAN-127 must not absorb C1/D1, Channels or Substrate runtime work. It supplies stable interfaces those later layers can consume.

As of this snapshot:

- Core K1/K2/K3/K4: source complete.
- Specialists K1/K3/K4 invocation-result and Serena retirement: source complete.
- Core re-vendor of Specialists K4 assets: source complete.
- xtmux K1/K3 and EVAL-01 evidence: source complete.
- xtmux K4: `OPEN_IMPLEMENTATION` in PR #96.
- K5 promotion: no merged implementation artifact located in this repository audit.
- K6 compatibility releases/released-trio smoke: not located.

## 6. Programme lanes

### P-DET — deterministic interface contracts

**State:** `PARTIAL` at programme level; Core launcher outcome is source-complete.

Current evidence includes `xtrm.command-outcome.v1`, exact argv next actions, explicit ownership and stable error/status boundaries. The current execution plan also calls for the minimum `specialists.execution.v1` execution shell before C1. Do not infer that contract is delivered until direct source evidence is found.

Residual: finish the minimum execution envelope where still absent, establish released compatibility, and use these contracts as the only machine boundary for later chain execution.

### P-KAN127 — XT Codex parity

**State:** `OPEN_IMPLEMENTATION`.

Residual graph:

```text
xtmux #96
→ xtrm-ozknq.15 cross-repository K4 observation/parity matrix
→ K5 explicit promotion
→ K6 ordered releases
→ released-trio smoke
```

Do not call the programme delivered merely because the three source trees contain Codex code.

### P-CHAIN — deterministic chain/formula runtime

**State:** `PLANNED` with substantial design assets and formula inventory.

Retained model:

```text
formula / chain template
→ pure deterministic composition
→ persisted resolved_chain_json / ResolvedChain
→ explicit approval/activation
→ exact command and Specialist activation intents
→ persisted outcomes/evidence
→ deterministic reducer transition
```

Do not introduce a new central `ChainRun` authority. During the bridge, composition spans Core, Specialists, xtmux and Beads; post-migration the runtime maps to Substrate container/issues/participants/activations.

Required work includes compiler, immutable resolved artifact, manual review/approve/show, explicit step dependencies and bounded loops, minimum activation contract, evidence reducer, scheduler intents, recovery/idempotency and promotion fixtures.

The quant/math declarative pipeline is the preferred vertical fixture because it combines deterministic domain commands/validators with probabilistic Specialist roles and can exercise evidence, review and backtest gates.

### P-SUB — Substrate

**State:** `DESIGN_ONLY` target architecture, with extensive design and premortem material.

Primary authorities include `docs/substrate/substrate_design_en.md` / Italian companion and the substrate premortem corpus. Preserve its container/issue/participant/activation/provenance/pulse semantics. Bridge work must be Substrate-shaped without assuming the future daemon/store already exists.

Do not create a new “K2.5”, global interpreter or metaphysical memory layer that is not supported by the normative design.

### P-CHAN — Channels

**State:** `DESIGN_ONLY` target runtime; bridge compatibility required in C1/D1.

Primary authorities include:

- `docs/channels/channels.md`
- `docs/channels/channels-upgrade.md`
- `docs/channels/channels-forensic-attention-proposal.md`

Channels owns typed ordered communication, subscriptions/topology/judge/attention semantics. It must not become a second job/result/lifecycle store. Current xtmux messages/obligations/wakes are bridge authorities, not a reason to fork the design.

### P-PULSE — pulse/emitter/progress semantics

**State:** `DESIGN_ONLY`, bound to Substrate/Channels reconciliation.

A CLI command is not inherently a pulse emitter. A pulse requests reevaluation; persisted validated evidence authorizes transition. Emitters require bounded registered capability, correlation and idempotency. Short commands should normally be wrapped by the runner; long-running domain processes may emit bounded checkpoints through explicit adapters.

### P-CORE — Core control-plane completion

**State:** `PARTIAL` because source capabilities exceed current release/deployment truth.

Retained residuals include KAN-127 release promotion, deploy-gap guard #545, ongoing release/fleet hygiene, verification of any remaining worktree/index follow-ups such as the shared GitNexus-index decision, and consolidation of stale documentation/naming surfaces.

### P-SP — Specialists runtime completion

**State:** `PARTIAL`.

Major runtime and review-chain capabilities are source-complete, but chain composition/reducer work remains future. The historical testing quarantine and previously recorded defects must be re-audited against current master before creating new work: never resurrect a defect from an old audit without reproducing it.

### P-XTMUX — coordination runtime completion

**State:** `PARTIAL`; K4 Codex remains open.

After #96, independently verify the K4 matrix, the known `fresh-db` concurrent-open flake family, restart/rebind semantics and release packaging before calling the runtime lane delivered.

### P-REVIEW — review-chain quality and deterministic QA

**State:** `DELIVERED_SOURCE_ONLY` for the latest semantic hardening.

PR #250 strengthens Reviewer, Seconder and Security Auditor without changing chain order. Future deterministic chain work should consume these contracts rather than recreate reviewer logic in the chain engine.

### P-TOPO — topology, lineage and operator projection

**State:** `DELIVERED_SOURCE_ONLY` / partially released depending package baseline.

Core has aggregated read-only topology views; xtmux publishes richer lineage fields. Preserve the rule that completion is derived from authoritative work/PR/job evidence, never terminal prose. Future Console/UI should consume this projection rather than create an independent topology authority.

### P-UI — Console / xtmux visual workspace

**State:** `UNVERIFIED` programme design lane.

Workspace discussions describe a user-friendly shell around tmux: main orchestrator at left, selectable child terminal/runtime at right, graph of parent/children/nested specialists, better session/pane switching, Beads/work controls, deterministic-run visibility and eventually web/Electron packaging. References investigated or proposed include Archon’s viewer, pi-studio, Piebald and October-style interfaces.

This lane must be reconciled against whatever Console/materializer implementation currently exists before work is authorized. The UI must remain a projection/control surface over Core/Specialists/xtmux/Substrate authorities, not a fourth runtime truth store.

### P-MEM — memory evolution

**State:** `DESIGN_ONLY` / `UNVERIFIED` implementation state.

Canonical research anchor: Core `docs/design/memory-system-r6g.md`, “Memory System Evolution — r6g research”, merged in Core PR #435. It is research/design, not the plan of record. Preserve the distinction between Beads/Dolt work truth, durable project memory, retrieval/indexing and eventual close/distillation workflows. Do not infer a global Substrate-memory ontology from this document.

### P-KNOW — service-knowledge / operational knowledge substrate

**State:** `PARTIAL` to `DELIVERED_SOURCE_ONLY`; requires exact package/release/deployment reconciliation.

The xtrm repo contains a first-class `packages/service-knowledge` line originating in PR #13 and advanced through verifier, FTS5 indexing, MCP query surfaces, dispatch/activator integration, evaluation/telemetry and guarded canary work. This lane must be reconciled with Core retirement/migration, Specialists service-knowledge roles, DevOps/OKS documentation and actual published package version.

### P-NATIVE-PI — native Pi tools and extensible workflow integration

**State:** `DESIGN_ONLY` / `UNVERIFIED` current implementation.

Prior design work evaluated native Pi tool wrappers around authoritative CLI surfaces and `pi-extensible-workflows`, with the boundary:

```text
CLI authority → native Pi tools → durable xtmux/Specialists state
```

No second workflow engine or fork is authorized. Reconcile the existing design artifact `xtrm-native-pi-tools-pi-extensible-workflows-integration-2026-07-30.md` and current Pi extension code before opening work.

### P-PI-RUNTIME — Pi runtime/bridge modernization

**State:** `NEEDS_DECISION` / `UNVERIFIED`.

The programme has discussed Pi RPC mode, JSON mode, `packages/agent` versus `packages/coding-agent`, runtime bridge modernization and related implementation/runtime trade-offs. This is not automatically part of the deterministic-chain critical path. Perform a current code-and-upstream compatibility audit before selecting a migration.

### P-OBS — observability, forensics and evaluation

**State:** `PARTIAL` with substantial delivered primitives.

Existing work includes xtmux event journal, Specialist telemetry/observability, topology, EVAL-01, failure classification and the `xtrm.forensic.v1` design family. Residual work is to reconcile canonical event taxonomy, evaluation/promotion evidence, Console consumption and future Substrate forensic twins without duplicating source-of-truth stores.

### P-DEVOPS — DevOps/service skills/operational reliability

**State:** `PARTIAL` with major source delivery.

Includes deploy-monitor, SRE/service-knowledge doctrine, dependency/update policy, smoke/release procedures, capacity reclaim, worktree/fleet hygiene and the broader OKS/service-skills documentation. Current #545 demonstrates the need to treat local CLI deployment as a first-class deployment shape.

### P-REL — release, packaging and CI

**State:** `PARTIAL`.

Release/smoke machinery is significantly hardened, but the KAN-127 source wave has not yet been demonstrated as a new compatible released trio. Preserve coordinated release ordering, package compatibility, pre/post release smoke, installer ownership, security gates and explicit release notes/changelog contracts.

### P-MONO — XTRM monorepo and naming convergence

**State:** `PLANNED` / `UNVERIFIED` current execution packet.

Accepted naming direction: XTRM is the whole stack; Core is the control-plane component; `xtrm-tools` is a transitional npm distribution name. The old README PRs #533/#243/#90 reflect this direction but are stale open drafts. Reconcile whether to refresh/merge/close them and where the eventual monorepo migration is actually tracked before implementation.

### P-MCP — MCP evolution and external integration

**State:** `DESIGN_ONLY` / adjacent programme dependency.

MCP 2.0 research and broader tool-surface simplification affect how XTRM capabilities may be exposed or consumed, but do not automatically belong to the Core/Specialists/xtmux runtime critical path. Register explicit interfaces and dependencies rather than pulling Mercury-specific MCP redesign into XTRM by association.

### P-PROV — agent identity and provenance

**State:** `UNVERIFIED` / `NEEDS_DECISION`.

Programme discussions require clear identity provenance between web agents, local agents, GitHub/Jira actors, comments and autonomous dispatch. Reconcile this with current xtmux runtime identity, GitHub/Jira account strategy, Beads ownership and audit/event schemas. Do not solve UI attribution by inventing a parallel execution identity.

### P-DOC — documentation freshness and authority

**State:** `PARTIAL`.

Known stale/open items include the three old README architecture PRs and the current-state section in PR #33. Programme docs must distinguish normative design, mutable current snapshot, research, historical evidence and generated/operational truth. The registry itself becomes the programme completion index, not a replacement for detailed specifications.

### P-ARCHON — Archon and external orchestration research

**State:** `DESIGN_ONLY` / `REJECTED` as replacement architecture.

Archon remains a useful reference for explicit workflows, approval/control surfaces and graph visualization. It is not an adopted replacement for Core, Specialists, xtmux, Beads, the main orchestrator or Substrate. Use it as comparative evidence only unless a bounded adapter is separately approved.

## 7. Completion graph and execution waves

### Wave A — finish currently active source work

1. complete independent review and merge decision for xtmux #96;
2. complete the K4 cross-repository observation/parity packet;
3. resolve Core #545;
4. re-read current Beads/Jira state before mutating programme trackers.

### Wave B — promotion and release truth

1. explicit K5 parity promotion;
2. K6 ordered compatibility releases;
3. released-trio smoke on clean installation plus local-deployment truth check;
4. update Specialists release snapshot and this registry.

### Wave C — programme-wide corpus reconciliation

Run a read-only multi-agent fan-out over:

- all meaningful XTRM workspace conversations and produced Markdown plans;
- all design/roadmap/research docs in the four repositories;
- current and historical Beads epics/leaves;
- Jira/Confluence programme projections;
- open/merged PRs and default-branch source;
- local worktrees/branches/artifacts not represented in GitHub.

Output only evidence-backed registry deltas, conflict/supersession edges and missing-tracking entries. Do not create implementation tasks during discovery.

### Wave D — deterministic composition foundation

After the interface/release baseline is stable:

1. minimum Specialists execution envelope;
2. C1 pure compiler and persisted `ResolvedChain` with Substrate/Channels compatibility fields;
3. manual review/approve/show and composition evidence;
4. `GATE-COMPOSE`;
5. D1 reducer/scheduler intents and progress projection;
6. `GATE-DO0`.

Use the quant/math declarative chain as a vertical fixture, but do not make the generic engine depend on quant-specific semantics.

### Wave E — measured authority and product surfaces

Only after deterministic foundation and evaluation:

- coordinator shadow and measured evaluation;
- `GATE-AUTH` promotion for selected automatic actions;
- Channels runtime activation where justified;
- Substrate migration/runtime work according to its own gates;
- Console/visual workspace consuming canonical projections;
- memory, native Pi tools, runtime modernization and monorepo work according to their reconciled dependency positions.

## 8. Mandatory fan-out protocol for “complete XTRM”

A local programme coordinator receiving this registry must not interpret “complete everything” as “implement every open idea”. It must first create evidence-backed coverage.

Recommended read-only discovery fan-out:

```text
programme coordinator
├── repository auditor: xtrm
├── repository auditor: Core
├── repository auditor: Specialists
├── repository auditor: xtmux
├── design crosswalk: PRD/roadmap/current plan/formulas
├── architecture crosswalk: Substrate/Channels/pulses
├── history crosswalk: workspace chats + produced Markdown artifacts
├── operations crosswalk: releases/CI/deploy/fleet/service-knowledge
├── product-surface crosswalk: topology/Console/UI/memory/native Pi
└── independent reconciliation reviewer
```

Every discovered item must record:

```text
stable id
origin/source
current owning authority
status/disposition
source evidence
release evidence
deployment evidence
tracker links
dependencies
supersedes / superseded_by
conflicts
next gate
residual delta
```

Only after independent reconciliation review may residual items become bounded implementation packets.

## 9. Known coverage gaps of this snapshot

This document is total in **scope**, not a claim that every historical artifact has already been reread in this single pass. The four repositories and current PR/source progress were live-audited at programme-lane level. The following remain explicit reconciliation inputs rather than silently assumed facts:

- complete workspace-chat artifact inventory;
- live Jira issue/workflow state, including programme epics and any missing projections;
- live Confluence freshness and supersession state;
- repository-local Beads graphs and active assignments;
- local unpublished worktrees/branches/artifacts;
- current implementation state of Console/UI, native Pi workflow experiments, Pi runtime modernization, monorepo migration and some memory/evaluation work;
- exact current published/deployed version of the standalone service-knowledge package.

These are not optional omissions. They are entries in the completion procedure and must be resolved before a programme-wide `COMPLETE` verdict.

## 10. Programme completion criteria

XTRM may be called programme-complete only when all of the following hold:

1. every discovered programme item has a valid disposition and owning authority;
2. every accepted residual implementation item has durable tracking and acceptance evidence;
3. no `UNVERIFIED`, `MISSING_TRACKING` or unresolved conflict remains on an active programme path;
4. every delivered runtime capability required by the product has release and deployment evidence, not only merged source;
5. bridge authorities and target Substrate/Channels semantics are reconciled without duplicate stores or lifecycle owners;
6. all promoted automatic authority has passed its explicit evidence gate;
7. obsolete designs and drafts carry explicit supersession/retirement relations;
8. Jira/Confluence/Beads/GitHub projections are reconciled at the level appropriate to each system;
9. the released runtime set passes the agreed clean-install/integration smoke;
10. an independent reviewer can reconstruct the residual graph and reach the same terminal dispositions from the recorded evidence.

Until then, this file and its JSON companion are the programme completion ledger, not a declaration that the programme is finished.
