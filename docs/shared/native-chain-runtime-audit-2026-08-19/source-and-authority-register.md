# XTRM Architecture Audit — Source & Authority Register

**Audit snapshot:** 2026-08-19 (Europe/Rome)  
**Status:** documentation/remote-source audit complete for the explicitly requested decision corpus; local/runtime verification remains separately enumerated  
**Primary inputs:** `xtrm-harness-notes.md`, `xtrm-full-work-prompt.md`  
**Purpose:** prove which sources were consumed, distinguish authority classes, record contradictions, and prevent the PRD from silently flattening historical, experimental and canonical material.

## 1. Audit boundary

This register closes over:

1. every explicit canonical/programme document named in `xtrm-full-work-prompt.md`;
2. every additional design family explicitly required by `xtrm-harness-notes.md`;
3. direct owner-documents needed to resolve the §9 reconciliation matrix;
4. the complete `docs/harness/**` document family and the AgentSession experiment design/report/loader/runbook/role surface;
5. current implementation documents needed to determine authority boundaries (Specialists loader/runner/supervisor, Core planning, xtmux SQLite/runtime guidance);
6. the Quant reference vertical and its workflow/promotion contracts;
7. the referenced dynamic/extensible-workflow, subagent/RLM and Prime Agent projects from their current primary repositories;
8. superseded PR #33/#34 programme artifacts where the accepted reconciliation says unique material must be dispositioned.

This is **not** a claim that every source file in every XTRM repository has been read. Source-code validation is a separate activity and is enumerated in the local verification packet.

## 2. Current remote snapshot used during audit

At the time of the audit the default heads observed were:

- `xtrm-dev/xtrm` `main`: `16c1b3a4b623d32c372dd4d8189ed1c3485841d9`
- `xtrm-dev/specialists` `master`: `daba6198ba5d1f8fcc5f5314e21ca2d5860a1c42`
- `xtrm-dev/core` `main`: `861d1ba136bebef5633bb813bdbc3c37a252f339`
- `Jaggerxtrm/xtmux` `main`: `0af90e55f9fac71f3768d83947666d67e2578503`

These are audit snapshot identities, not immutable future authority. The local verification pass must refresh them.

## 3. Authority classes

- **CURRENT CANON** — current authoritative product/programme contract.
- **ACCEPTED AMENDMENT** — accepted change packet that instructs current canon and may sunset after absorption.
- **CURRENT IMPLEMENTATION RECORD** — shipped behavior/architecture record; source/tests still win on implementation detail.
- **PROPOSED** — useful design not yet authoritative.
- **EXPERIMENT EVIDENCE** — proves or falsifies a bounded claim; does not become product canon automatically.
- **RESEARCH / REFERENCE** — informative evidence or external implementation reference.
- **HISTORICAL / SUPERSEDED** — provenance only unless a still-valid requirement is explicitly re-adopted.

## 4. Source register

### XTRM programme and runtime

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/shared/xtrm-current-execution-plan.md` | CURRENT CANON | Programme ordering/gates. Still template-centric in C1 and still frames R1.6 as neutral RPC/native. |
| `docs/shared/xtrm-current-execution-plan.json` | CURRENT CANON | Machine-readable sequencing mirror; must remain consistent with Markdown. |
| `docs/shared/xtrm-v1-completion-ledger.md` | CURRENT CANON | Programme completion accounting and residual evidence. |
| `docs/shared/xtrm-v1-completion-ledger.json` | CURRENT CANON | Machine-readable completion ledger. |
| `docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md` | ACCEPTED AMENDMENT | Runtime/workflow split, rich identity, leases, `uncertain`, replay, Channels delivery split, memory governance, work vs execution graphs, bounded dynamic children. §9 gives owner-patch matrix. |
| `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` | PROPOSED → now strongly evidenced | Generic Pi runtime, AgentSession possibility, RLM below step, CLI/RPC/Console as surfaces. Recent experiment changes confidence from neutral to native-target-favoured. |
| `docs/shared/xtrm-codex-kan-127-execution-note.md` | CURRENT COMPANION | KAN sequencing and parity/release constraints; should not absorb the new chain runtime. |
| `docs/shared/xtrm-cli-actionable-outcomes-and-followups.md` | CURRENT DESIGN/CONTRACT | Structured command outcomes, exact next actions, ownership, failure taxonomy; must evolve coherently with `uncertain`. |
| `docs/shared/xtrm-harness-native-adapters.md` | CURRENT DESIGN | Provider/runtime adapter boundary and compatibility semantics. |
| `docs/shared/xtrm-native-pi-tools-pi-extensible-workflows-integration-2026-07-30.md` | REFERENCE DESIGN | Tool injection, workflow composition ideas; persistence/worktree lifecycle must not become a second `ChainRun`. |
| `docs/shared/xtrm-deterministic-quant-pipelines-2026-08-10.md` | CROSS-REPO REFERENCE CONTRACT | Best complex vertical fixture: agent cognition + deterministic gates + evidence + recovery + human promotion. |
| `docs/monorepo-migration.md` | ACCEPTED TARGET DESIGN | Five-package target: core/substrate/channels/specialists/console; staged migration. Timing must be revisited before new runtime implementation. |
| `docs/xtrm-MOC.md` | DESIGN INDEX | Historical/current design map; useful for provenance and owner discovery. |
| `docs/_meta/2026-06-21-design-reconciliation.md` | HISTORICAL DECISION RECORD | Earlier daemon/state.db-first critical path. New AgentSession/ChainRun evidence justifies sequencing revision, not erasure of the underlying target contracts. |
| `docs/state-store-options.md` | TARGET STORAGE DESIGN | SQLite WAL local authority + optional Postgres/shared projection; state-engine discipline. |

### Substrate

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/substrate/substrate_design_it.md` | CURRENT TARGET CANON (rev12) | `Container` is generic lifecycle envelope (`seed|chain|epic|wave|node`); planning seed; transient chain containers; teardown/recovery; Issues/work graph; ad-hoc → repeated → formalized lifecycle. |
| `docs/substrate/substrate_design_en.md` | STALE COMPANION | Earlier rev; useful only where reconciled to Italian rev12. |
| `docs/substrate/chain_templates.md` | HISTORICAL/TARGET COMPANION | Strong lesson against prompt-owned ad-hoc dispatch; templates should become one ChainSource, not sole authoring mode. |
| `docs/premortem-substrate/audit-brief.md` | HISTORICAL RISK INPUT | Requested cross-audit and challenge of over-large migration. |
| `docs/premortem-substrate/synthesis.md` | HISTORICAL RISK INPUT | Kernel/value sequencing concerns. |
| `docs/premortem-substrate/audit-result.md` | HISTORICAL RISK INPUT | Freeze rules, bridge proof, delivery demo/second-eyes; warns against daemon-first big bang. |

### Channels

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/channels/channels.md` | CURRENT TARGET CANON | Typed semantic communication; stable participant identity; scheduler resolution; stream semantics; Channels not lifecycle authority. |
| `docs/channels/channels-upgrade.md` | CURRENT DESIGN | Routing hard / attention soft / authority hard; audience; read vs processing ack; free-flow cooperation with bounded authority. |
| `docs/channels/channels-forensic-attention-proposal.md` | CURRENT PROPOSAL/COMPANION | Forensic twin, attention model, bounded ambient awareness, evidence pointers. |
| `docs/channels/channels_plain_it.md` | EXPLANATORY COMPANION | Plain-language semantics consistent with Channels design. |

### Telemetry / observability

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/telemetry/forensic-event-contract.md` | CURRENT CONTRACT | `xtrm.forensic.v1`, identity/correlation, Git/process/worktree facts, redaction/cardinality. Reuse and extend; do not replace. |
| `docs/telemetry/agentops-event-catalog.md` | CURRENT CATALOG | Event/evidence vocabulary and projection boundaries. |
| `docs/telemetry/prometheus-projection-contract.md` | CURRENT CONTRACT | Low-cardinality metrics projection; forensic drilldown remains separate. |
| `docs/telemetry/prometheus-infra-console-handoff.md` | CURRENT HANDOFF | Console/infra consumption boundary. |

### Harness and AgentSession experiment

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/harness/README.md` | EXPERIMENT INDEX | Harness work is non-canonical evidence until promoted. |
| `docs/harness/mercury-governed-research-harness-prd-draft-2026-08-10.md` | PROPOSED | Governed research harness; useful role/tool/evidence constraints. |
| `docs/harness/experiments/README.md` | EXPERIMENT INDEX | Explicitly isolates experiments from product canon. |
| `docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md` | EXPERIMENT SPEC | Direct AgentSession, ChainRun, reducer, SchedulerIntent, Channels/evidence, Beads, crash/resume. |
| `experiments/agentsession-sre-chain-vertical-slice/README.md` | EXPERIMENT IMPLEMENTATION DOC | How to run/inspect prototype. |
| `.../experiment-report.md` | EXPERIMENT EVIDENCE | Real Mercury/infra run; AgentSession sufficient; logical participant survives session replacement; `sp` baseline exposed coordinator wait-loop failure. |
| `.../full-specialist-json-loader.md` | EXPERIMENT BRIDGE DESIGN | Full Specialist JSON → activation profile; `native/adapted/deferred/rejected`; JSON + skill fingerprinting. |
| experiment runbooks/roles/scripts | EXPERIMENT SUPPORT | Preserve authority overlays and runbook evidence; do not promote SRE-specific hardcoding. |
| experiment chain/reducer/scheduler/store/Channels/Beads/bridge code | EXPERIMENT SOURCE EVIDENCE | Strong proof surface but contains known prototype limitations; source-code findings recorded below. |

### Specialists product canon and implementation

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/design/roadmap/specialists-roadmap.md` | CURRENT ARCHITECTURE SSOT FOR BRIDGE | Bridge runway and retained Substrate-compatible opportunities. |
| `docs/design/roadmap/enhanced-prd.md` | CURRENT OPERATIONAL PRD | Large reusable body: resolved config, execution protocol, Beads, Eval Core, memory pull, security, fingerprints, telemetry. Contains bridge-era sequencing assumptions that need revision. |
| `docs/design/roadmap/current-release-snapshot.md` | HISTORICAL SNAPSHOT | Useful provenance, not current architecture. |
| `docs/design/roadmap/chains-prompt-evals.md` | CURRENT DESIGN | Prompt/chain eval methodology; extend, do not replace. |
| `docs/design/execution-protocol-design/specialist-execution-protocol.md` | CURRENT PROTOCOL CANON | PREPARE → PLAN → EXECUTE → FINALIZE; one activation; topology external; protocol reducer/intents; recovery. |
| `.../specialist-execution-protocol-ownership-decision.md` | CURRENT OWNERSHIP DECISION | Places activation lifecycle vs workflow authority. |
| `docs/pi-rpc-boundary.md` | CURRENT BRIDGE CONTRACT | RPC transport and supervisor ownership in current implementation; target can evolve without losing protocol semantics. |
| `docs/design/pi-v0.84.1-compatibility-audit.md` | CURRENT AUDIT | RPC settlement/compaction/retry/cancel/version issues; still required for compatibility even if native becomes product target. |
| `docs/design/roadmap/chain-templates/README.md` | CURRENT INDEX WITH BROKEN CANON POINTER | Points to missing `docs/design/chain-templates.md`; P0 documentation-authority gap before compiler promotion. |
| `src/specialist/schema.ts` | CURRENT SOURCE CONTRACT | Specialist JSON shape; preserve upstream ownership. |
| `src/specialist/loader.ts` | CURRENT SOURCE CONTRACT | Effective package/global/repo resolution; XTRM should consume rather than duplicate permanently. |
| `src/specialist/mandatory-rules.ts` | CURRENT SOURCE | Mandatory rule resolution/budget behavior. |
| `src/specialist/task-prompt.ts` | CURRENT SOURCE | One-pass safe template, surface skill prefix, rule budget, prompt fingerprint. |
| `src/specialist/runner.ts` | CURRENT IMPLEMENTATION | Contains many reusable primitives but mixes authoring resolution, PREPARE, scripts, tools/capabilities, AgentSession/RPC lifecycle, retry, output/finalization. Decompose rather than rewrite. |
| `src/specialist/supervisor.ts` | CURRENT IMPLEMENTATION | Job lifecycle/projection, lineage, parent notification, observability, handoff/context/Git/auto-commit behavior. Must be decomposed between Chain runtime, ActivationSupervisor and finalization/effect layers. |

### Core

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/design/memory-system-r6g.md` | RESEARCH DESIGN | Three memory systems/lenses, typed metadata/retrieval; not plan of record. New PRD should promote semantic concepts, not blindly adopt storage. |
| `skills/planning/SKILL.md` | CURRENT OPERATOR/AGENT PROCEDURE | Epic first, child `--parent`, dependency edges after IDs, self-contained seven-section contracts, planning then test-planning. Strong input to future planner/Chain composer. |

### xtmux

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/xtmux-gaps.md` | CURRENT IMPLEMENTATION GUIDANCE | Explicit authority split; stable topology, journal cursor, runtime origin, readiness/handoff, no second Channels/chain authority. |
| `docs/ts-sqlite.md` | CURRENT NORMATIVE PRD FOR SQLITE V2 | SQLite typed domains already own messages/receipts, instances/transitions, turns, monitors, handoffs, delivery attempts, telemetry/audit. No mandatory daemon. |
| `docs/observability-redesign.md` | CURRENT SHIPPED IMPLEMENTATION RECORD | SQLite V2 default-on; Channels invariants imported selectively; runtime/event/domain split. |
| proposed RuntimeSupervisor ADR supplied with audit | PROPOSED | Consolidate event-driven runtime supervision + provider adapters + terminal backends; should evolve existing V2 rather than introduce a second store/control plane. |

### Console / UI

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/console/console-product-contract.md` | CURRENT PRODUCT CONTRACT | UI is read/control surface, not authority. |
| `docs/console/architecture/console-architecture.md` | CURRENT DESIGN | One backend/read model; frontend does not read source DBs directly. |
| `docs/console/architecture/console-observability-spec.md` | CURRENT DESIGN | Aggregate metrics vs high-cardinality forensic drilldown. |
| `docs/console/architecture/apps-console-scaffold-preflight.md` | CURRENT PRE-FLIGHT | Package/implementation constraints. |
| `docs/console/architecture/console-test-guards.md` | CURRENT GUARDS | Prevent drift/incorrect authority. |
| `docs/console/specialists-console-handoff.md` | CURRENT HANDOFF | Integration contract. |

### DevOps / operational roles

| Source | Class | Main authority / finding |
|---|---|---|
| `docs/devops/devops-system.md` | CURRENT DESIGN | Namespaced operational Specialist roles/skills, Beads handoff and telemetry; preserve as role/capability library, not workflow engine. |

### Quant vertical

| Source | Class | Main authority / finding |
|---|---|---|
| XTRM/Quant `deterministic-quant-pipelines` copies | CROSS-REPO REFERENCE | Complex chain fixture for deterministic orchestration. |
| Quant `validation/WORKFLOW.md` | CURRENT DOMAIN WORKFLOW | Greenfield vs port-and-validate, operator/Jira boundaries, current manual iteration. |
| Quant `validation/PROMOTION.md` | CURRENT DOMAIN PROMOTION CONTRACT | Pure math core, unit/golden parity, operator-owned production promotion/backfill. |
| Quant `validation/ARCHITECTURE.md` | CURRENT ORIENTATION | `analyze` and `run-dag` are computation/research surfaces, not XTRM workflow authority. |
| Quant validator/testing docs referenced by the design | DOMAIN VALIDATION AUTHORITY | Deterministic validation and test contracts must remain domain-owned and become evidence/gates, not be rewritten into the chain runtime. |

### External/reference projects

| Source | Class | Main authority / finding |
|---|---|---|
| `Michaelliv/pi-dynamic-workflows` current README/source model | EXTERNAL REFERENCE | Small JS DSL with `agent`, `parallel`, `pipeline`, `phase`; no persisted/resumable runtime yet. Good authoring/cognitive pattern. |
| `vekexasia/pi-extensible-workflows` current README/changelog | EXTERNAL REFERENCE | Durable workflow lifecycle, journal/resume/budgets/worktrees/CLI; proves useful ideas but would duplicate XTRM `ChainRun` if adopted as authority. |
| `QuintinShaw/pi-dynamic-workflows` current README | EXTERNAL REFERENCE | More complete durable workflow UX/model routing/worktrees; useful feature reference, not runtime authority. |
| `gotgenes/pi-packages` / `@gotgenes/pi-subagents` | EXTERNAL REFERENCE | In-process children, typed service/events, steering/resume/tool filtering; useful bounded RLM/child primitive. |
| `PrimeIntellect-ai/prime-agent` | EXTERNAL REFERENCE | RLM + persistent IPython + continual harness; use as evidence for bounded cognitive delegation and governed memory candidates, not as product dependency/authority. |
| Prime Agent ↔ XTRM/Hive audit supplied with campaign | RESEARCH AUDIT | Adoption matrix and architectural comparison; subordinate to current XTRM source/canon. |

### Superseded programme drafts

| Source | Class | Main authority / finding |
|---|---|---|
| XTRM PR #33 | SUPERSEDED PROVENANCE | Valuable early Chain/Substrate/Channels/pulse reconciliation. Unique valid concepts should be absorbed; its “do not create ChainRun” conclusion predates the successful AgentSession experiment and needs revised interpretation. |
| XTRM PR #34 | SUPERSEDED PROVENANCE | Total programme registry and truth-state taxonomy; useful accounting concepts, superseded as master authority. |

## 5. Major contradictions / revisions discovered

### C-01 — template-only authoring is too narrow

Current plan and historical chain-template canon treat templates as the safe alternative to ad-hoc dispatch.

**Reconciliation:** preserve the safety rule, replace the conclusion.

```text
TemplateChainSource
JsonChainSource
AdHocChainSource
ImportedWorkflowSource
        ↓
one ChainLoader
        ↓
ChainDefinition
        ↓
one compiler
        ↓
ResolvedChain
```

Ad-hoc means typed composition before execution, never runtime prompt-owned dispatch.

### C-02 — `ChainRun` vs Substrate `Container`

Substrate already owns a generic lifecycle envelope and defines `chain` as a transient Container kind. The experiment independently created `ChainRun`.

**Recommended reconciliation:** one chain execution has one `Container(kind=chain)` and one chain-specific execution record/projection called `ChainRun`, with a strict 1:1 identity relationship. `Container` owns generic lifecycle/resources/membership/cleanup; `ChainRun` owns resolved-chain progression, step attempts, reducer state and scheduler intent receipts. They must not have independent terminal state machines.

### C-03 — native AgentSession gate is no longer neutral

Old canon correctly required RPC remediation first and left native AgentSession as an ADR spike. The direct vertical slice now proves the public hosting boundary, custom tools, parallel reducer scheduling and crash/resume.

**Recommended decision:** native AgentSession is preferred product target; corrected RPC remains compatibility/migration/rollback/headless transport where useful. Gate becomes production-parity/hardening evidence, not a coin-flip architecture decision.

### C-04 — “Substrate deferred” is too coarse

Full Issues/container/store/daemon migration still carries migration risk, but ChainRun/native harness needs Substrate-grade durability now.

**Recommended decision:** implement a minimum runtime kernel early:
- execution identity + generation
- Container/ChainRun registry
- append journal
- leases
- mutation journal + `uncertain`
- scheduler-intent/effect receipts
- snapshots/replay/recovery
- durable projections

Keep later:
- Beads → Substrate Issue authority cutover
- full Seed/Epic/Wave/Node migration
- full daemon-first topology
- full memory-domain migration
- bridge retirement.

### C-05 — Channels should be earlier, but storage is not the main decision

Channels already converges on SQLite operational state; xtmux has also migrated away from global JSONL to typed SQLite.

**Recommended decision:** production operational truth remains typed SQLite/state-engine oriented. File/JSONL forms remain:
- deterministic fixture format
- portable export/audit bundle
- replay test input
- debugging/human inspectable projection

Do not use git-versioned operational message files as the main concurrent runtime store.

### C-06 — `skills.scripts` conflates cognition and effects

**Decision:** preserve backward compatibility but compile legacy scripts into typed `ProbeDefinition` / `EffectDefinition`. Skills remain cognition.

### C-07 — permission/requested tools are not grants

**Decision:** Specialist definitions request capabilities; runtime resolves them against chain/step/operator/environment policy into a `ResolvedCapabilityGrant`. Tool availability follows the grant, not role prose or permission tier.

### C-08 — runner/supervisor should be decomposed, not copied

Preserve implementations where valid, move responsibility into:
- authoring resolver
- SpecialistActivationProfile compiler
- PREPARE
- capability/probe engine
- ActivationSupervisor
- FINALIZE
- shared terminal effects.

Chain progression stays outside participant runtime.

### C-09 — Eval Core is not missing; its subject model is incomplete

Extend existing Eval Core with:
- `ChainDefinition` / compiler evaluation
- `ResolvedChain` deterministic composition
- whole `ChainRun` / Container outcomes
- cooperation/communication
- recovery/replay
- resource cleanup
- authority violations
- cost/time/token/evidence efficiency.

### C-10 — observability should be extended, not rebuilt

Promote `xtrm.forensic.v1` and current event catalogs. Add:
- container lifecycle
- chain-run lifecycle
- participant/activation/generation
- scheduler intent/effect receipt
- capability grant/denial
- probe execution
- message delivery/processing
- teardown/resource-leak facts.

### C-11 — planner already has valuable machinery

Core planning skill already enforces good work graph construction.

Future planner should:
1. create/resolve root objective authority;
2. produce versioned `ChainDefinition` draft;
3. expose coordinator edits/review;
4. freeze `ResolvedChain`;
5. materialize all known step Beads atomically/idempotently;
6. then dispatch ready steps.

### C-12 — monorepo timing must change carefully

The target five-package layout remains coherent. Building substantial new vNext runtime twice is wasteful.

**Recommendation:** perform the next implementation in target package boundaries where practical, but require a local dependency/import/release audit before moving Specialists/runtime source. Do not introduce a sixth package.

## 6. Experiment source findings that must not be promoted as-is

- fixed SRE topology and `sre-team.ts` mapping belong in Chain data;
- reviewer verdict extraction still uses prototype summary parsing;
- scheduler effect receipt order/recovery requires production journal semantics;
- Beads close/reconciliation failures can still produce inconsistent logical/forensic state in prototype code;
- regex + `bash -lc` `sre_exec` is policy characterization, not a sandbox;
- filesystem JSONL state is an excellent reference fixture but not production concurrent storage by itself;
- projection-channel behavior is incomplete;
- live AgentSession adversarial/recovery/smoke runbooks remain evidence gates where not yet executed.

## 7. Coverage statement

The audit consumed the complete explicitly requested **decision corpus**: the two campaign inputs, current XTRM programme canon, §9 owner families, Channels, Substrate, Memory, Telemetry, Harness/experiment documentation, Specialists roadmap/PRD/protocol/evals and key implementation source, Core planning, xtmux current runtime design, Console, DevOps, Quant reference contracts, relevant external workflow/RLM/Prime references, and superseded programme drafts.

The following are intentionally **not represented as already verified**:
- local-only Beads/Jira/worktrees/operator configuration;
- installed CLI/runtime versions;
- unpublished branches/files;
- every implementation line in Core/Specialists/xtmux;
- live fault-injection/performance behavior;
- package/install/runtime parity.

Those are enumerated as bounded verification work in the local verification packet.
