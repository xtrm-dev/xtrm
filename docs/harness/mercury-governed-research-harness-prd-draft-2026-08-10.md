# Draft PRD — Mercury Governed Research Harness

**Status:** Draft / non-authoritative product and architecture proposal  
**Date:** 2026-08-10  
**Programme:** Mercury  
**Primary product surface:** Mercury research and quantitative workflows  
**First flagship vertical:** `mercuryintelligence/quant`  
**Generic runtime dependency:** XTRM on Pi, subject to `GATE-HARNESS-ADR`  
**Implementation authority:** Not granted by this document  
**Executable work authority:** Repository-local Beads after separate technical-plan promotion  
**Portfolio reference:** Jira `ISSUE-89`

## 1. Product thesis

Mercury should develop a governed agentic research harness that combines deterministic workflow structure with dynamic recursive cognition.

The product should not be a fork of Prime Agent, a second XTRM runtime, or an opaque agent database. Pi should remain the low-level model/provider/session/tool substrate. XTRM should own generic governed execution semantics. Mercury should own the financial and quantitative domain layer: market-data identity, immutable research inputs, quantitative validation, research artifact promotion, evidence lineage, and investor/user-facing research workflows.

The target product model is:

```text
Pi
    model/provider/session/tool substrate
        ↓
XTRM governed runtime / harness
    execution identity
    lifecycle
    ResolvedChain
    reducer/scheduler
    bounded RLM
    Channels
    recovery/replay
    leases
    evidence
        ↓
Mercury Research Harness
    repository-aware context
    financial-domain execution profiles
    dataset snapshots and vintages
    quant validation
    artifact lineage
    research promotion
        ↓
Mercury domain engines
    Quant CLI/core
    Market Data
    Darth Feedor intelligence
    research-paper intelligence
    future Mercury analytical surfaces
```

`mercuryintelligence/quant` is the first flagship profile because it already contains the strongest combination of deterministic mathematics, persisted studies, notebooks, charts, provenance, validation, session state, DAG execution and agent-oriented tooling.

## 2. Problem

Current coding and research agents can be powerful but remain weak at preserving authoritative context, separating runtime state from durable truth, enforcing quantitative methodology, and maintaining exact evidence lineage across long-running work.

Mercury already contains many of the necessary primitives, but they are fragmented across layers:

```text
Quant
    data access
    mq mathematical primitives
    deterministic DAG
    studies
    notebooks
    charts
    discoveries
    provenance
    validators

XTRM
    Beads workflow authority
    Specialists
    deterministic chain design
    xtmux runtime/presentation
    Channels
    execution identity and recovery design

Pi
    AgentSession
    model/provider/tool runtime
    extension and RPC surfaces

Prime Agent reference
    persistent IPython
    recursive children / RLM
    long-running workers
    context persistence
```

The missing product is the governed seam joining these capabilities without creating duplicate authorities.

A successful Mercury harness must make long-running autonomous research more capable while making its conclusions more reproducible, inspectable and difficult to promote incorrectly.

## 3. Product goals

The product must make a research execution reconstructable from durable evidence. A reviewer should be able to identify the exact repository state, assignment, data snapshot, workflow topology, agent execution lineage, validation results and promoted artifacts that produced a conclusion.

The product must preserve repository-native structure. Files remain files at exact repository paths. Git remains source-history truth. Beads remains executable work truth. Mercury research artifacts remain domain truth. Harness storage may retain runtime state, but it must not replace those systems.

The product must support deterministic outer workflows and dynamic inner cognition. Required gates, reviewers and validation stages are fixed by a governed `ResolvedChain`; RLM children may explore, research and advise within an allowed step but may not rewrite workflow topology or grant themselves authority.

The first Mercury Quant profile must support persistent quantitative investigation with a long-lived Python state while still producing promotion-grade, deterministic outputs.

The product must reduce duplicated runtime ownership compared with the current combination of per-repository Pi extensions, RPC lifecycle inference, session-specific glue and pane-oriented supervision.

## 4. Non-goals

This PRD does not authorize or require a fork of Pi or Prime Agent.

It does not create a second task tracker, financial-truth database, message bus, scheduler, chain engine or semantic-memory authority.

It does not make persistent IPython a universal production tool.

It does not allow RLM children to alter mandatory chain topology, bypass independent review, promote financial conclusions, or acquire broader write authority than their parent execution profile.

It does not initially support unattended order execution, credential mutation, destructive market-data changes, production deployment or personalized trading execution.

It does not create a sixth XTRM package merely to contain a "harness". The current accepted XTRM five-package target remains the default architecture unless a later accepted ADR changes it.

## 5. Canonical authority and ownership

| Concern | Canonical owner |
|---|---|
| Market-data and quant semantics | Mercury domain code and deterministic APIs |
| Quant mathematical validators | Mercury Quant |
| Research studies, reports, notebooks and domain artifacts | Mercury artifact model |
| Executable implementation work | Repository-local Beads |
| Repository source and mutation history | Git |
| Governed workflow topology | XTRM Specialists / persisted `ResolvedChain` |
| Generic execution identity and lifecycle | XTRM runtime |
| Semantic inter-agent communication | XTRM Channels |
| Model/provider/session mechanics | Pi public runtime APIs |
| Runtime scratch and retained Python objects | Execution-local kernel/session state |
| Reusable learned procedure | Governed promoted memory/skill |
| Portfolio/product authorization | Mercury programme and Jira |

A harness database or event store is permitted only for execution concerns that do not already have a canonical owner.

## 6. Core product model

### 6.1 Workspace

A `Workspace` binds an execution to the actual repository and working environment.

Minimum identity:

```yaml
workspace_id: ...
repository: mercuryintelligence/quant
repository_root: ...
base_commit: ...
branch: ...
worktree_id: ...
dirty_diff_hash: ...
execution_id: ...
```

The workspace identity must be explicit. It must not depend on heuristics such as whether `.mercury/` happens to exist in the current working directory.

### 6.2 RepositoryRef

Every repository-backed context item must preserve exact source identity.

```yaml
repository: mercuryintelligence/quant
commit: 624399fd10d6b07c40d6b7fe6e14d4672a8008dd
path: validation/PROMOTION.md
blob_sha: ...
authority_class: repository_contract
```

When a file changes during execution, the harness should preserve before/after identity and mutation provenance rather than copying the file into an opaque private knowledge store.

### 6.3 Assignment

An execution starts from an authoritative work contract: normally a Bead and, where needed, its upstream programme/Jira authority.

The assignment includes exact scope, permitted repositories/paths, authority ceiling, acceptance requirements and execution profile.

Assignments are immutable per execution attempt. Material scope changes create an amendment or new attempt.

### 6.4 Execution

The generic runtime object should distinguish:

```text
principal_id
actor_id
assignment_id
participant_id
execution_id
attempt
parent_execution_id
runtime_session_id
generation
authority_ref
workspace_id
resolved_chain_id
```

The model cannot self-assign identity or authority by emitting these fields in prose.

### 6.5 ContextManifest

Context assembly must be explicit and versioned.

```yaml
context_manifest_id: ...
execution_id: ...
policy_sources: [...]
repository_sources: [...]
assignment_sources: [...]
upstream_evidence: [...]
memory_refs: [...]
service_knowledge_refs: [...]
excluded_or_stale_sources: [...]
conflicts: [...]
```

Context construction should be inspectable and replayable.

### 6.6 DatasetSnapshot

Financial research requires exact data identity.

```yaml
snapshot_id: ...
provider: mercury
endpoint: /...
normalized_request: ...
requested_at: ...
observed_at: ...
data_start: ...
data_end: ...
vintage: ...
timezone: ...
payload_sha256: ...
storage_ref: ...
source_freshness: ...
```

A live API call without a captured data snapshot must be classified as non-replayable rather than presented as exact reproducible evidence.

### 6.7 ResearchArtifact

A durable research object should reference execution, data and validation lineage.

```yaml
artifact_id: ...
artifact_type: study|notebook|chart|report|dataset_manifest
execution_id: ...
chain_id: ...
step_id: ...
dataset_snapshot_ids: [...]
provenance_manifest_id: ...
validator_receipts: [...]
review_receipts: [...]
state: draft|validated|reviewed|promoted|rejected|invalid
```

## 7. Deterministic workflow versus RLM

The central architecture invariant is:

```text
ResolvedChain
    = governed workflow topology

RLM tree
    = execution-time cognitive topology
```

A deterministic Quant chain may be:

```text
research contract
→ dataset snapshot
→ researcher
→ deterministic data-integrity gate
→ model development
→ mathematical validation
→ no-lookahead / OOS / walk-forward gate
→ robustness analysis
→ independent methodologist
→ independent reviewer
→ promotion gate
```

Inside `researcher`, the execution profile may allow:

```text
researcher
├── rates investigator
├── macro investigator
└── methodology advisor
```

Those children may return evidence and advice. They cannot remove the methodologist, skip validation, mutate the approved chain, publish around promotion gates or widen their parent authority.

RLM depth, child count, permitted roles, token budget, wall time, tools and workspace access must be profile-controlled.

## 8. Quant execution profiles

### 8.1 `quant-research-rlm`

Purpose: exploratory quantitative research.

Capabilities may include persistent IPython, read-only Mercury data, RLM children, plotting, local research artifacts and bounded repository writes inside an isolated research workspace.

Promotion authority is absent.

### 8.2 `quant-methodologist`

Purpose: independent methodology review.

Primarily read-only. May inspect code, datasets, assumptions, sampling, statistical tests, look-ahead risk, data leakage, robustness and economic interpretation. It must not be the producer of the model being reviewed.

### 8.3 `quant-validator`

Purpose: deterministic execution.

No RLM by default. Runs schema, mathematical, data integrity, no-lookahead, walk-forward, golden-fixture and reproducibility checks.

### 8.4 `quant-reviewer`

Purpose: independent final review.

Read-only except for governed verdict/evidence output. Reviews requirements, working tree, actual artifacts, validation receipts and unresolved obligations.

### 8.5 `implementation`

Purpose: repository code changes.

Uses XTRM worktree and Beads ownership. Persistent unrestricted Python is not assumed merely because the Quant research profile has it.

## 9. Persistent Python state

Persistent IPython is a first-class capability for the Quant research profile because DataFrames, fitted estimators, feature matrices, plots and intermediate analytical objects have real value across multiple turns and compactions.

Persistent Python state is nevertheless scratch execution state.

```text
Python object
≠ evidence
≠ research artifact
≠ semantic memory
≠ accepted financial finding
```

A durable object must cross an explicit persistence or promotion boundary.

The environment contract must identify the exact Python environment and package lock used. A Pi/Prime-managed kernel must not silently run a different dependency environment from the Mercury project environment.

## 10. Policy precedence and conflict detection

The harness must not ask the model to infer authority from a pile of prompt files.

It should resolve policy in a deterministic precedence order, for example:

```text
programme governance
→ repository AGENTS contract
→ assignment/amendment
→ domain execution profile
→ selected skill/procedure
→ historical/advisory documentation
```

Conflicting instructions must produce an explicit diagnostic with both sources and the effective authority.

This requirement is motivated by current Quant repository evidence: `AGENTS.md` makes Beads the implementation-task authority, while `validation/WORKFLOW.md` still describes a Jira-centric execution model. A future agent context assembler must surface that conflict instead of silently choosing whichever document appears later in a prompt.

## 11. Mercury artifact model corrections required before autonomous promotion

The current Quant implementation already supports studies, notebooks, charts, discoveries, provenance manifests and validators, but autonomous promotion requires stronger semantics.

Today validator failures are warnings. `save_result()` can persist a study even when validator status is failed, and `important=True` can then auto-promote that study to the discovery surface.

The harness requires a hard separation:

```text
DRAFT
→ VALIDATED
→ REVIEWED
→ PROMOTED
```

with failure paths:

```text
DRAFT → INVALID
VALIDATED → REJECTED
```

Persisting an invalid exploratory draft is acceptable.

Promoting one is not.

`important=True` should become a promotion-candidate hint, not promotion authority.

## 12. Concurrency and durability

Multi-agent execution requires the Mercury artifact stores to be safe under concurrent writers.

Current study/discovery index logic uses read-modify-replace operations over shared index files. That is insufficient for concurrent RLM and parallel chain participants.

The preferred direction is:

```text
immutable per-object artifacts = authority
mutable indexes = derived/rebuildable projection
```

Where a mutable shared surface remains necessary, it requires process-safe locking or fencing.

Session and workspace identity must also use collision-resistant IDs and explicit execution binding.

## 13. Relationship to the existing Mercury DAG

The Mercury DAG is deterministic computation infrastructure, not an agent workflow engine.

It should remain available inside a governed chain step.

Example:

```text
ResolvedChain step: backtest
        ↓
Mercury DAG
    fetch_snapshot
    → transform
    → model
    → metrics
    → robustness
        ↓
deterministic output
        ↓
next ResolvedChain gate
```

The DAG and the agent chain must not duplicate each other's responsibilities.

## 14. Relationship to XTRM

XTRM is the intended generic runtime owner if and only if the accepted harness decision gate selects the native path.

The current canonical XTRM programme already requires:

```text
Pi v0.84.1 RPC correctness
→ minimum specialists.execution.v1
→ direct Pi AgentSession spike
→ lifecycle/evidence parity against corrected RPC
→ one governed RLM child
→ GATE-HARNESS-ADR
```

The Mercury product must not assume that gate has already passed.

Mercury-specific design may proceed in parallel where it is transport-independent: dataset snapshot contracts, artifact states, quantitative validation gates, context-source identity, promotion semantics and the Quant vertical fixture.

Runtime-specific implementation should follow the XTRM decision rather than create a competing execution substrate.

## 15. Relationship to Pi and Prime Agent

Pi should remain a dependency through stable public runtime APIs wherever feasible. Mercury/XTRM should not fork generic provider/model/session/tool mechanics.

Prime Agent is a reference implementation and source of architectural lessons, especially persistent Python control state, recursive child sessions, retained long-running work and separation between model-facing cognition and authoritative host runtime state.

Prime Agent is not a source of authority and should not become a required Mercury runtime dependency.

## 16. Security and authority

Persistent Python and generic shell execution are not security sandboxes.

Execution profiles therefore require actual capability boundaries. Read-only research, implementation, review, deterministic testing and future operational profiles must differ in allowed tools, filesystem scope, network behavior, credentials and mutations.

The initial product supports research and engineering, not live trading authority.

Any future order/execution path requires a distinct product/security design with explicit authorization, idempotency, stale-data and limit checks, audit evidence and fail-closed controls.

## 17. First flagship vertical slice

The first implementation-quality experiment should remain intentionally narrow.

Input:

```text
Quant repository at exact Git SHA
one research assignment
one immutable market-data snapshot
one Quant research execution profile
one small deterministic ResolvedChain
```

Flow:

```text
resolve repository/workspace identity
→ assemble versioned context manifest
→ capture immutable dataset snapshot
→ create Pi-backed researcher execution
→ retain persistent Python state
→ permit one bounded RLM research/advisor child
→ produce one typed study candidate
→ run deterministic mathematical/data validation
→ run one independent methodologist/reviewer
→ emit notebook, chart and structured report
→ produce promotion receipt
```

Required output:

```text
assignment_id
execution_id
repository SHA
workspace identity
context manifest
dataset snapshot ID/hash
RLM lineage
study ID
notebook/chart/report refs
validation receipts
review receipt
terminal state
resource usage
```

No daemon, scheduler, broad autonomous continuation, live trading integration or graphical UI is required for this first slice.

## 18. Acceptance criteria for the first slice

The slice succeeds only if it proves that the same research can be reconstructed from exact source and data identity; mandatory gates cannot be bypassed by the agent; a dynamic child cannot mutate the `ResolvedChain`; validator failure prevents promotion; the result preserves Mercury studies/notebooks/provenance rather than creating a parallel artifact authority; the workspace remains tied to exact repository paths and Git identity; concurrent execution does not lose artifact/index writes; resource use and RLM lineage are attributable; the XTRM runtime owns execution semantics rather than Quant maintaining its own Pi lifecycle implementation; and the resulting workflow is materially easier to use than repeated one-shot `mercury analyze` runs without reducing auditability.

## 19. Product surface after proof

After runtime and evidence semantics stabilize, the natural product projection is a Mercury Agent Workspace.

A user should be able to inspect:

```text
Repository / exact SHA

Assignment / authority

ResolvedChain
snapshot → research → model → validate → review → promote

Active executions and RLM children

Evidence
data snapshots
source files
model code
test and validation results
review verdicts

Artifacts
studies
notebooks
charts
reports

Actions
resume
compare
branch hypothesis
replay
inspect evidence
```

The UI must remain a projection over canonical runtime, repository and artifact contracts. It must not contain hidden orchestration logic.

## 20. Investor/product narrative

The differentiating product claim should not be "many autonomous agents".

The proposed product category is:

**governed autonomous financial research with reproducible evidence.**

The defensible composition is not Pi, Prime or RLM individually. It is the combination of Mercury financial infrastructure, deterministic quantitative primitives, immutable data identity, governed workflow structure, dynamic recursive cognition, independent review, repository-native artifact lineage and reproducible promotion.

Any investor-facing claim about uniqueness, market demand or commercial value still requires separate capability and market evidence before publication.

## 21. Sequencing

Phase 0 is contract preparation and correctness. Quant should harden promotion semantics, dataset snapshots/vintages, workspace identity, policy precedence, artifact concurrency and Pi/XTRM configuration ownership without creating a new generic runtime.

Phase 1 is the XTRM runtime decision already defined by the canonical programme: Pi compatibility correction, `specialists.execution.v1`, direct `AgentSession` spike, RPC parity, governed RLM child, then `GATE-HARNESS-ADR`.

Phase 2 is the Quant flagship vertical slice described in this PRD.

Phase 3 adds robust execution/recovery, more execution profiles, richer research chains and replay/compare workflows.

Phase 4 adds the Mercury Agent Workspace once the underlying contracts are stable.

Expansion to other Mercury research domains follows only after the Quant slice demonstrates reusable generic semantics.

## 22. Current source baseline and known findings

This draft was produced from a read-only audit with these key current refs:

```text
mercuryintelligence/quant
remote master:
624399fd10d6b07c40d6b7fe6e14d4672a8008dd

open Quant PR:
#114 — impact-scoped offline domain gate
base: 624399fd10d6b07c40d6b7fe6e14d4672a8008dd

mercuryintelligence/program
observed head:
b0d960fe4c0f141fa5b7260e131a06b0e3a11bc7

xtrm-dev/xtrm
observed head:
b78a2b347a2321cc564cdcef916ca62c5c62bc65

XTRM native harness exploration:
docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md

XTRM canonical execution plan:
docs/shared/xtrm-current-execution-plan.md

XTRM accepted runtime reconciliation:
docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md

Specialists Pi compatibility audit:
docs/design/pi-v0.84.1-compatibility-audit.md

Jira:
ISSUE-89
```

Known Quant findings that affect this PRD:

```text
validator failures currently do not block study persistence;
important=True may auto-promote a failed study;
live mc.* response payloads are not automatically immutable provenance inputs;
study/discovery shared indexes are not designed for concurrent multi-agent writers;
workspace/session location can depend on cwd/.mercury existence heuristics;
Study.run_id exists but is not populated by the current save path;
repository XTRM/Pi integration contains version/import drift;
AGENTS.md and validation/WORKFLOW.md currently encode conflicting work-tracking policy;
analyze documentation still says 60 seconds while implementation defaults to 300 seconds.
```

The prior ISSUE-89 audit also reports a local `mercury test mq` MSAR smoke mismatch on a checkout that was six commits ahead of remote. That exact local state is not web-verifiable from the current GitHub baseline and remains local evidence until reconciled.

## 23. Decision requested

This PRD requests product-direction review of the following proposition:

> Mercury should treat governed autonomous research as a first-class product architecture. XTRM should own the generic Pi-based governed runtime; Mercury should own financial-domain research contracts and artifacts; Quant should be the first flagship execution profile; deterministic workflow and validation should bound dynamic RLM cognition.

Approval of this product direction would not itself authorize implementation.

If accepted, the next durable action is to promote the relevant generic runtime requirements through the existing XTRM `GATE-HARNESS-ADR` path and create a separate repository-local Quant technical plan whose executable decomposition is represented in live Quant Beads.
