# PRD — Native Chain Runtime (Integrated)

> Status: CANONICAL / NORMATIVE  
> Owner: xtrm-dev/xtrm · Revised: 2026-09-02  
> Revision scope: universal typed results/evidence, provider-native messaging, passive awareness, coordination-aware planning/execution and coordination evaluation.  
> Scope rule: this PRD defines the integrated object model and cross-subsystem requirements. Subsystem internals remain with their owning ADRs/specifications.

## 1. Product thesis

XTRM governs multi-agent work as deterministic, auditable chains over provider-hosted model sessions.

The runtime treats agent output as unvalidated until an accepted result contract and required evidence validate it; treats communication as carrying no authority by itself; and treats external effects as idempotent, journaled operations with explicit `uncertain` reconciliation.

Native Pi `AgentSession` hosting is the currently proven product path. Corrected RPC remains compatibility/migration/rollback/headless transport. The activation model must remain provider-neutral enough to support a future Claude Code SDK activation after separate evidence and promotion.

XTRM additionally treats **coordination structure as an explicit, measurable system property**. More agents, more messages, or a prompt-assigned coordinator are not assumed to improve outcomes. Participant grouping, useful parallelism, ownership, attention and communication policy are resolved/frozen with the chain and evaluated against outcome, cost, latency and coordination failure evidence.

---

## 2. Object model

| Concept | Object | Authority |
|---|---|---|
| Stable role/cognition definition | `SpecialistDefinition` | Specialists |
| Authored workflow | `ChainSource` — Template / JSON / ad-hoc / imported | XTRM |
| Normalized authored workflow | `ChainDefinition` | XTRM |
| Approved/frozen workflow | `ResolvedChain` | XTRM |
| Durable execution | `ChainRun`, bound 1:1 to `Container(kind=chain)` | XTRM |
| Runtime profile | `SpecialistActivationProfile` | Specialists |
| Physical invocation | `Activation → attempt → provider session` | XTRM runtime |
| Effective custom result contract | `ResolvedResultContract` | XTRM + Specialists inputs |
| Effective coordination policy | `ResolvedCoordinationPolicy`, embedded in `ResolvedChain.effective` | XTRM |
| External provider delivery binding | `ProviderIngressAdapter` / `ProviderDeliveryAdapter` | runtime/xtmux boundary |

`ResolvedResultContract` and `ResolvedCoordinationPolicy` do not introduce new independent lifecycle authorities. They are frozen effective contracts of the approved/run binding.

Identity:

```text
participant_id
  != activation/job_id
  != provider session id
```

Every execution carries explicit principal/actor/assignment/participant/execution/attempt/parent/job/runtime-session/generation/authority identity plus lease/convergence fields.

Load-bearing invariants:

```text
agent ended != protocol completed
result exists != result validated
result validated != required evidence satisfied
job completed != chain step satisfied
message body != authority
attention != authorization
requested capability != granted capability
provider accepted != processed != replied
ChainDefinition != ChainRun
template != workflow ontology
more agents != automatically better coordination
```

---

## 3. Requirements

### R1 — Authoring, compilation and frozen effective policy

1. One `ChainLoader` accepts all ChainSource variants.
2. Ad-hoc composition is persisted/versioned before execution; never ephemeral prose.
3. One pure compiler emits one persisted `ResolvedChain`; no shell, Beads mutation, provider call, repository I/O or model call occurs during compile.
4. Structural change after freeze requires a reviewed successor revision.
5. Templates remain compatibility sources; JSON, ad-hoc and imported workflows converge through the same IR.
6. Beads materialization occurs only after freeze and may not invent a second dependency graph.
7. Coordination-analysis inputs are explicit authored/frozen inputs, not hidden compiler I/O.
8. `ResolvedChain.effective` may contain a `ResolvedCoordinationPolicy` describing participant grouping, useful concurrency, ownership/interface boundaries, attention and artifact-sharing policy.
9. Changing effective participant grouping/topology after freeze requires the same explicit revision path as any other topology change.

### R2 — Durability and recovery

10. Every external effect carries an idempotency key; receipts are append-only.
11. Mutation outcomes include completed / failed / `uncertain`.
12. `uncertain` blocks blind replay and requires reconciliation evidence.
13. Reducer derives transitions only from persisted authoritative evidence.
14. Scheduler intents are exact and idempotent.
15. Recovery preserves work/evidence and never fabricates completion.
16. Minimal durability kernel includes stable IDs, ChainRun/Container identity, lineage, journals/receipts, snapshots/projections and explicit uncertain state without gating on a full Substrate daemon migration.

### R3 — Native participant runtime and lifecycle

17. Direct Pi AgentSession hosting is the current proven hosted path.
18. ActivationSupervisor owns one activation lifecycle and never chain order.
19. PREPARE and FINALIZE are runtime-owned phases; PLAN/EXECUTE are agent cognition phases.
20. Provider lifecycle facts normalize into versioned ActivationEvent envelopes before authority-bearing runtime use.
21. Provider debug payload may remain opaque inside a validated outer forensic envelope.
22. RLM/dynamic children remain bounded cognition below one approved participant/step and cannot mutate ResolvedChain, grant authority, satisfy parent results, publish, schedule canonical work or become a second workflow runtime.

### R4 — Capabilities, result contracts, skills and probes

23. `ResolvedCapabilityGrant = f(specialist request, chain/step policy, operator policy, runtime/sandbox capabilities)`.
24. Requested tools never imply permission.
25. Taxonomy remains: cognition · activation policy · prepare probes/validators/context resolvers · result contract · finalize validators/projections/effects.
26. Legacy `skills.scripts` may compile to typed probes for compatibility; implicit arbitrary scripts are not privileged authority.
27. XTRM stable protocol envelopes use runtime schemas such as Zod.
28. Arbitrary custom Specialist result/evidence payloads use a frozen JSON Schema contract, not specialist-name-specific runtime code.
29. Specialist authors do not need to author Zod.
30. The supported JSON Schema dialect/subset and validator are explicit, versioned and deterministic; remote network `$ref` resolution is prohibited unless separately governed.
31. `prompt.output_schema` is the primary authored custom result-payload contract when present.
32. `response_format` is presentation/model guidance, not validation authority.
33. `expected_output_keys` is compatibility-only and may compile to required-properties constraints where no stronger output schema exists.
34. Result schema identity is frozen with canonical representation/hash/provenance.
35. A host-owned `result_submit` surface produces accepted `ResultEnvelope` / `ResultReceipt` state.
36. Final assistant prose or JSON-like text is never accepted as runtime result authority merely because it parses.
37. Invalid result payload produces typed rejection and zero accepted result/step satisfaction.
38. `agent_end` is lifecycle evidence only.
39. Gate semantics derive from `step.class == gate`, not Specialist name.
40. Generic gate disposition is PASS / PARTIAL / FAIL; custom gate payload extensions remain JSON-Schema governed.
41. Accepted GateResult is the single gate-verdict authority from which canonical `work.verdict` may be projected.
42. Evidence uses a generic stable outer envelope; arbitrary evidence kinds/payloads do not require runtime source edits.
43. Required evidence must validate before step satisfaction; supplemental opaque evidence cannot acquire semantic authority by presence alone.

### R5 — Cooperation over Channels

44. ChainRun participants communicate semantically only through the canonical Channels contract.
45. Routing hard / attention soft / authority hard.
46. read != ack != processed.
47. `channel_messages.id` is the semantic cursor; recovery never renumbers messages.
48. Evidence travels pointer-first.
49. No direct participant resume/wake bypasses the scheduler.
50. `ChannelCommunicationService` provides semantic send/request/reply/inbox over durable messages and ReplyObligations.
51. A request transaction atomically establishes semantic request identity and reply obligation before physical delivery/wake.
52. The model does not own wait/monitor correctness.
53. `WAITING_ON_CHANNEL` means the participant cannot make useful progress until a required obligation reaches a terminal disposition.
54. `PassiveAwareness` is distinct: the participant continues foreground work while relevant Channel attention may be surfaced at safe runtime/provider boundaries.
55. Passive awareness does not satisfy obligations, grant authority or directly advance chain state.
56. External provider-native messages enter a ChainRun only through authenticated provider ingress → identity binding → authorization → canonical ChannelMessage/ReplyObligation → scheduler/attention.
57. A ChainRun participant may not use provider-native messaging to bypass Channels.
58. Provider receipt is transport evidence, never semantic authority.
59. Message vs artifact policy is task-dependent:
   - actionable request/finding/proposal/challenge → ChannelMessage;
   - large reusable result → Evidence artifact;
   - shared interface/plan/schema → durable artifact;
   - attention/wake → pointer/projection.
60. Messages should remain concise and pointer-first rather than duplicating large evidence bodies.

### R6 — Work/evidence authority

61. Beads remains the durable bridge authority for work contracts, dependency readiness, gates, claims and acceptance.
62. Git remains integration truth.
63. Evidence validation gates chain satisfaction; self-report cannot satisfy a step.
64. Participant/step contracts may carry ownership scopes and interface-contract refs.
65. Shared/public interface changes emit typed evidence identifying the affected interface, compatibility implications and downstream owners/steps.
66. Runtime may project targeted attention from that evidence but may not invent workflow authority from it.

### R7 — Supervision and provider boundaries

67. Three supervisors remain distinct:
   - ChainReducer/Scheduler → workflow progression;
   - ActivationSupervisor → one direct XTRM-owned activation;
   - xtmux RuntimeSupervisor/provider layer → external/interactive runtime execution/delivery/reconciliation.
68. Direct Pi AgentSession activations are not forced through xtmux.
69. For interactive/external Pi, `pi-intercom` is an accepted current provider dependency/mechanism behind an adapter.
70. For Claude↔Pi interactive communication, `pi-claude-link` is an accepted current bridge/provider mechanism behind an adapter.
71. Claude↔Claude should prefer native cross-session messaging where characterized.
72. tmux remains topology/navigation/observation/raw-process/fallback infrastructure, not the preferred Claude/Pi message correctness boundary.
73. Provider dependency identity must be pinned/recorded; dependency-specific semantics cannot leak into Channels authority.
74. Provider adapters expose explicit delivery/receipt/reconciliation outcomes.
75. Multiple external requesters remain correlated by XTRM semantic identities even if an underlying provider bridge has weaker waiter correlation.
76. Future Claude Code SDK activation must implement the same XTRM activation/result/Channels semantics and requires separate evidence before promotion.

### R8 — Observability, coordination telemetry and evaluation

77. Forensics carry exact identity; Prometheus remains low-cardinality.
78. Eval Core extends existing subjects rather than creating a second eval subsystem.
79. Whole-chain evaluation includes compiler determinism, freeze integrity, replay equivalence, duplicate-effect rate, recovery, leaks, authority violations, cooperation, cost/time/token and end-to-end outcome.
80. Coordination is a first-class measured subject.
81. Existing forensic events may project a temporal coordination graph with participants, artifacts/files/evidence/interfaces as nodes and message/read/write/interface-change edges.
82. Useful coordination metrics include message density, broadcast ratio, cross-participant edges, coordination-token share, evidence reuse, artifact fan-out, wait/idle ratio, duplicate work, unanswered obligations and interface regressions.
83. Coordination projections are observational only and may not become a second scheduler/authority store.
84. Eval Core supports controlled coordination-policy experiments that hold task/model/runtime fixed while varying participant count, partition/grouping, communication mode, passive awareness, artifact-sharing and review topology.
85. Coordination claims require repeated trials where stochastic behavior matters; one successful run is not promotion evidence.
86. Coordination failure taxonomy may classify communication, commitment and expectation failures using existing Channels/Beads/evidence truth rather than a new database.

### R9 — Memory promotion discipline

87. Durable Beads memory, synthesized project memory, harness auto-memory and close-time-distilled memories remain distinct.
88. Promotion is evidence-gated.
89. Findings are candidates, not truth.
90. No silent self-modification.
91. Three semantic lenses only: herd / workgroup / identity. Execution lineage remains provenance, not memory ontology.

### R10 — Coordination-aware planning and partitioning

92. Participant count and grouping are explicit policy outputs, not derived from available agent count.
93. The planner may choose one participant, cooperating participants, independent advisors, cohesive workgroups or pipeline ownership according to task structure.
94. Planning may emit a `RepositoryCoordinationAnalysis` artifact containing dependency/coupling/ownership/interface information.
95. The pure compiler consumes that frozen input but does not perform repository analysis itself.
96. Tightly coupled decisions should be kept within a participant/workgroup when cross-boundary communication would exceed useful parallelism.
97. Independent regions may execute in parallel as soon as authoritative dependencies are satisfied.
98. Max useful parallelism may be lower than physical runtime capacity.
99. The system must not assume that assigning a coordinator role by prompt creates structural coordination.
100. A coordinator becomes structurally relevant only through explicit authority, topology, gating or scheduling contracts.
101. Coordination policy must remain inspectable and evaluable; future adaptive policy requires Eval evidence and a separate promotion decision, not silent runtime learning.

---

## 4. Research-derived design constraints

Recent multi-agent coding evidence motivates but does not itself authorize implementation details.

The product adopts the following bounded lessons:

```text
task topology shapes useful communication topology
naive parallelism can reduce correctness
shared artifacts can replace repeated messages on dense-sharing work
mandatory artifact/file coordination can add overhead on already pipeline-shaped work
passive mid-task awareness can outperform blocking/synchronized communication
prompt-only leadership is not structural leadership
coordination failures include communication, commitment and expectation mismatch
```

XTRM must therefore measure coordination rather than infer it from prompt roles or agent count.

No external research framework becomes runtime authority.

No CRDT workspace is required by this PRD.

No graph-partitioning algorithm is mandated.

---

## 5. Non-goals

This PRD does not authorize:

```text
a second messaging ontology
a second workflow runtime
a specialist-name result schema registry
model final-text parsing as authority
provider-native messaging bypassing Channels
forcing every chain to use multiple agents
maximizing concurrency by default
mandatory shared-file coordination for every workflow
a CRDT rewrite of the workspace
a Substrate daemon prerequisite
a Claude SDK production claim without evidence
removing tmux as topology/raw/fallback infrastructure
```

Console remains a read-model and never workflow authority.

---

## 6. Programme-level acceptance

The next milestone is accepted only when the SRE chain executes **actually**, not merely fingerprint-equivalently, through:

```text
data-authored SRE ChainSource
→ ChainLoader
→ ChainDefinition
→ pure compiler
→ frozen ResolvedChain
→ materialization
→ ChainRun / Container
→ participant + Specialist binding
→ frozen ResolvedResultContract
→ PREPARE
→ ActivationSupervisor
→ direct Pi AgentSession
→ accepted typed ResultEnvelope
→ validated required evidence
→ Channels cooperation / obligations / passive attention where applicable
→ pure reducer
→ exact SchedulerIntent
→ FINALIZE
→ terminal ChainRun
```

with:

```text
zero SRE topology code in generic runtime
zero specialist-name result schema mapping
zero prompt-only gate/result authority
zero direct provider-native Channels bypass
zero model-owned monitor/wait correctness
zero tmux requirement for direct AgentSession correctness
```

The programme must also leave a stable provider-adapter seam for interactive Pi/Claude ingress/egress and a measurable coordination-policy seam suitable for later Eval-guided optimization.

The historical cognition-drift fail-closed run remains valid safety evidence.

A clean full data-defined terminal run is required as the complementary happy-path proof.
