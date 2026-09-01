# PRD — Native Chain Runtime (Integrated)

> Status: CANONICAL / NORMATIVE  
> Owner: xtrm-dev/xtrm · Revised: 2026-09-02  
> Revision scope: universal typed results/evidence, provider-native messaging, passive awareness, coordination-aware execution, optional extension/capability binding, bounded executor output and context/memory boundaries.  
> Scope rule: this PRD defines the integrated object model and cross-subsystem requirements. Subsystem internals remain with their owning ADRs/specifications.

## 1. Product thesis

XTRM governs multi-agent work as deterministic, auditable chains over provider-hosted model sessions.

The runtime treats agent output as unvalidated until an accepted result contract and required evidence validate it; treats communication as carrying no authority by itself; and treats external effects as idempotent, journaled operations with explicit `uncertain` reconciliation.

Native Pi `AgentSession` hosting is the currently proven product path. Corrected RPC remains compatibility/migration/rollback/headless transport. The activation model must remain provider-neutral enough to support a future Claude Code SDK activation after separate evidence and promotion.

XTRM additionally treats **coordination structure as an explicit, measurable system property**. More agents, more messages, or a prompt-assigned coordinator are not assumed to improve outcomes. Participant grouping, useful parallelism, ownership, attention and communication policy are resolved/frozen with the chain and evaluated against outcome, cost, latency and coordination failure evidence.

Optional extensions add product capability. They do not define the runtime kernel. A generic primitive proven by an extension belongs in the kernel only when it remains useful outside that extension's domain and is required for governed/provider-independent execution correctness.

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
| Effective implementation binding | provider/extension/executor/skill implementation identity frozen in existing activation/profile materialization where required | XTRM + owning subsystem |

`ResolvedResultContract` and `ResolvedCoordinationPolicy` do not introduce new independent lifecycle authorities. Neither does implementation binding: prefer the existing activation/profile materialization contract before introducing another first-class runtime entity.

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
available implementation != selected implementation
selected implementation != frozen implementation binding
frozen implementation binding != ResolvedCapabilityGrant
loaded extension != authority
ChainDefinition != ChainRun
template != workflow ontology
skill != memory != knowledge != context
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

### R3 — Native participant runtime, PREPARE and execution lifecycle

17. Direct Pi AgentSession hosting is the current proven hosted path.
18. ActivationSupervisor owns one activation lifecycle and never chain order.
19. PREPARE and FINALIZE are runtime-owned phases; PLAN/EXECUTE are agent cognition phases.
20. PREPARE resolves only what is required to materialize and safely run the activation: Specialist binding, capability grant, required provider/extension/executor bindings, result contract, required probes/preconditions, and explicitly required frozen evidence/context.
21. PREPARE must not become a universal “load all memory/docs/knowledge” phase. Optional exploratory context remains agent-driven through granted tools/capabilities unless the chain contract explicitly freezes it.
22. Provider lifecycle facts normalize into versioned ActivationEvent envelopes before authority-bearing runtime use.
23. Provider debug payload may remain opaque inside a validated outer forensic envelope.
24. RLM/dynamic children remain bounded cognition below one approved participant/step and cannot mutate ResolvedChain, grant authority, satisfy parent results, publish, schedule canonical work or become a second workflow runtime.
25. Auxiliary executors may implement a generic execution-adapter contract, but they do not create a second activation lifecycle authority. PythonKernel, if used, is one optional implementation rather than mandatory ChainRun infrastructure.
26. Generic execution receipts should represent at least outcome, duration, bounded output summary, output/evidence references, structured error, observations and provider/implementation identity where applicable.
27. Large executor/tool output must neither flood model context nor disappear through destructive truncation. Prefer bounded head + truncation/shape metadata + bounded tail + complete-output reference.
28. For governed ChainRuns, complete output that matters to workflow correctness, evidence, review or replay must be promoted to durable XTRM evidence/artifact storage. An ephemeral `/tmp` pointer is not sufficient durable authority. Interactive operator-owned sessions may use weaker temporary references when the output is not workflow evidence.

### R4 — Capabilities, optional extensions, result contracts, skills and probes

29. `ResolvedCapabilityGrant = f(specialist request, chain/step policy, operator policy, runtime/sandbox capabilities)`.
30. Requested tools never imply permission.
31. Extensions/capability implementations are optional product capabilities. A valid ChainRun with no optional extensions must remain valid.
32. Do not promote an extension feature into the runtime kernel merely because it is useful inside that extension. Promote only the domain-independent primitive when it is broadly reusable and belongs to governed execution correctness/runtime mechanics.
33. Distinguish discovery, selection and binding:
   - discovery: which implementations are available;
   - selection: which implementation(s) the Specialist/session/operator policy requests/allows;
   - binding: which exact implementation/version/path/hash actually executes.
34. Interactive operator-owned sessions may use looser/ambient discovery where product policy permits it. Governed ChainRun activations must freeze material implementation identity before execution.
35. Material implementation drift after freeze must not be adopted silently. Fail closed or use an explicit governed rebinding/revision path.
36. Extension/provider/skill/executor availability or loading never grants capability authority. The resolved grant controls which exposed operations are usable.
37. Prefer extending `SpecialistActivationProfile`/existing activation materialization for implementation binding. Do not create `ResolvedExtensionBinding` or another first-class lifecycle entity merely because the concept has a name.
38. Taxonomy remains: cognition · activation policy · prepare probes/validators/context inputs · result contract · finalize validators/projections/effects.
39. A Skill is guidance/procedure by default. A skill may later have an optional executable capability sidecar, but this does not redefine all Skills as executable or require Python. Any executable sidecar remains subject to ordinary implementation binding and capability authority.
40. Legacy `skills.scripts` may compile to typed probes for compatibility; implicit arbitrary scripts are not privileged authority.
41. Python, Service Knowledge, GitNexus, messaging adapters and future memory/search extensions remain optional unless a specific resolved activation contract selects/requires them.
42. Python must not become the canonical provider-neutral memory/knowledge API. Provider-neutral semantics may be exposed through runtime tools, MCP, host libraries or provider adapters as appropriate.
43. XTRM stable protocol envelopes use runtime schemas such as Zod.
44. Arbitrary custom Specialist result/evidence payloads use a frozen JSON Schema contract, not specialist-name-specific runtime code.
45. Specialist authors do not need to author Zod.
46. The supported JSON Schema dialect/subset and validator are explicit, versioned and deterministic; remote network `$ref` resolution is prohibited unless separately governed.
47. `prompt.output_schema` is the primary authored custom result-payload contract when present.
48. `response_format` is presentation/model guidance, not validation authority.
49. `expected_output_keys` is compatibility-only and may compile to required-properties constraints where no stronger output schema exists.
50. Result schema identity is frozen with canonical representation/hash/provenance.
51. A host-owned `result_submit` surface produces accepted `ResultEnvelope` / `ResultReceipt` state.
52. Final assistant prose or JSON-like text is never accepted as runtime result authority merely because it parses.
53. Invalid result payload produces typed rejection and zero accepted result/step satisfaction.
54. `agent_end` is lifecycle evidence only.
55. Gate semantics derive from `step.class == gate`, not Specialist name.
56. Generic gate disposition is PASS / PARTIAL / FAIL; custom gate payload extensions remain JSON-Schema governed.
57. Accepted GateResult is the single gate-verdict authority from which canonical `work.verdict` may be projected.
58. Evidence uses a generic stable outer envelope; arbitrary evidence kinds/payloads do not require runtime source edits.
59. Required evidence must validate before step satisfaction; supplemental opaque evidence cannot acquire semantic authority by presence alone.

### R5 — Cooperation over Channels

60. ChainRun participants communicate semantically only through the canonical Channels contract.
61. Routing hard / attention soft / authority hard.
62. read != ack != processed.
63. `channel_messages.id` is the semantic cursor; recovery never renumbers messages.
64. Evidence travels pointer-first.
65. No direct participant resume/wake bypasses the scheduler.
66. `ChannelCommunicationService` provides semantic send/request/reply/inbox over durable messages and ReplyObligations.
67. A request transaction atomically establishes semantic request identity and reply obligation before physical delivery/wake.
68. The model does not own wait/monitor correctness.
69. `WAITING_ON_CHANNEL` means the participant cannot make useful progress until a required obligation reaches a terminal disposition.
70. `PassiveAwareness` is distinct: the participant continues foreground work while relevant Channel attention may be surfaced at safe runtime/provider boundaries.
71. Passive awareness does not satisfy obligations, grant authority or directly advance chain state.
72. External provider-native messages enter a ChainRun only through authenticated provider ingress → identity binding → authorization → canonical ChannelMessage/ReplyObligation → scheduler/attention.
73. A ChainRun participant may not use provider-native messaging to bypass Channels.
74. Provider receipt is transport evidence, never semantic authority.
75. Message vs artifact policy is task-dependent:
   - actionable request/finding/proposal/challenge → ChannelMessage;
   - large reusable result → Evidence artifact;
   - shared interface/plan/schema → durable artifact;
   - attention/wake → pointer/projection.
76. Messages should remain concise and pointer-first rather than duplicating large evidence bodies.

### R6 — Work/evidence authority

77. Beads remains the durable bridge authority for work contracts, dependency readiness, gates, claims and acceptance.
78. Git remains integration truth.
79. Evidence validation gates chain satisfaction; self-report cannot satisfy a step.
80. Participant/step contracts may carry ownership scopes and interface-contract refs.
81. Shared/public interface changes emit typed evidence identifying the affected interface, compatibility implications and downstream owners/steps.
82. Runtime may project targeted attention from that evidence but may not invent workflow authority from it.

### R7 — Supervision and provider boundaries

83. Three supervisors remain distinct:
   - ChainReducer/Scheduler → workflow progression;
   - ActivationSupervisor → one direct XTRM-owned activation;
   - xtmux RuntimeSupervisor/provider layer → external/interactive runtime execution/delivery/reconciliation.
84. Direct Pi AgentSession activations are not forced through xtmux.
85. For interactive/external Pi, `pi-intercom` is an accepted current provider dependency/mechanism behind an adapter.
86. For Claude↔Pi interactive communication, `pi-claude-link` is an accepted current bridge/provider mechanism behind an adapter.
87. Claude↔Claude should prefer native cross-session messaging where characterized.
88. tmux remains topology/navigation/observation/raw-process/fallback infrastructure, not the preferred Claude/Pi message correctness boundary.
89. Provider dependency identity must be pinned/recorded; dependency-specific semantics cannot leak into Channels authority.
90. Provider adapters expose explicit delivery/receipt/reconciliation outcomes.
91. Multiple external requesters remain correlated by XTRM semantic identities even if an underlying provider bridge has weaker waiter correlation.
92. Future Claude Code SDK activation must implement the same XTRM activation/result/Channels semantics and requires separate evidence before promotion.

### R8 — Observability, coordination telemetry and evaluation

93. Forensics carry exact identity; Prometheus remains low-cardinality.
94. Eval Core extends existing subjects rather than creating a second eval subsystem.
95. Whole-chain evaluation includes compiler determinism, freeze integrity, replay equivalence, duplicate-effect rate, recovery, leaks, authority violations, cooperation, cost/time/token and end-to-end outcome.
96. Coordination is a first-class measured subject.
97. Existing forensic events may project a temporal coordination graph with participants, artifacts/files/evidence/interfaces as nodes and message/read/write/interface-change edges.
98. Useful coordination metrics include message density, broadcast ratio, cross-participant edges, coordination-token share, evidence reuse, artifact fan-out, wait/idle ratio, duplicate work, unanswered obligations and interface regressions.
99. Coordination projections are observational only and may not become a second scheduler/authority store.
100. Eval Core supports controlled coordination-policy experiments that hold task/model/runtime fixed while varying participant count, partition/grouping, communication mode, passive awareness, artifact-sharing and review topology.
101. Coordination claims require repeated trials where stochastic behavior matters; one successful run is not promotion evidence.
102. Coordination failure taxonomy may classify communication, commitment and expectation failures using existing Channels/Beads/evidence truth rather than a new database.

### R9 — Skills, memory, knowledge and context boundaries

103. Keep four concepts semantically distinct:
   - Skill — how to perform a task;
   - Memory — what was learned/decided/discovered previously;
   - Knowledge — what evidence/information exists about the subject;
   - Context — the bounded subset of available information useful for one activation.
104. Context is not necessarily another store. It may be assembled from existing evidence, tools, memories, docs, knowledge extensions and explicit chain inputs.
105. q99 must not introduce a mandatory first-class `ContextResolver` merely to name this composition boundary.
106. Durable Beads memory, synthesized project memory, provider/project memory and close-time-distilled memories may remain distinct stores with different mechanics.
107. Memory/knowledge sources expose narrow retrieval capabilities where useful; they do not become workflow authority.
108. q99 must not standardize a universal “ask the memory system” endpoint, universal retrieval platform or giant new memory database.
109. Existing `docs/design/memory-system-r6g.md` remains design/research until separately promoted through its owning process; q99 may cross-reference its principles but must not silently make it production canon.
110. Findings remain candidates, not truth. Promotion is evidence-gated; no silent self-modification.
111. Three semantic memory lenses remain herd / workgroup / identity where that canon applies. Execution lineage remains provenance, not memory ontology.

### R10 — Coordination-aware planning and partitioning

112. Participant count and grouping are explicit policy outputs, not derived from available agent count.
113. The planner may choose one participant, cooperating participants, independent advisors, cohesive workgroups or pipeline ownership according to task structure.
114. Planning may emit a `RepositoryCoordinationAnalysis` artifact containing dependency/coupling/ownership/interface information.
115. The pure compiler consumes that frozen input but does not perform repository analysis itself.
116. Tightly coupled decisions should be kept within a participant/workgroup when cross-boundary communication would exceed useful parallelism.
117. Independent regions may execute in parallel as soon as authoritative dependencies are satisfied.
118. Max useful parallelism may be lower than physical runtime capacity.
119. The system must not assume that assigning a coordinator role by prompt creates structural coordination.
120. A coordinator becomes structurally relevant only through explicit authority, topology, gating or scheduling contracts.
121. Coordination policy must remain inspectable and evaluable; future adaptive policy requires Eval evidence and a separate promotion decision, not silent runtime learning.

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

Extension-derived implementation evidence follows a similar rule: promote the generic runtime primitive, not the extension-specific ontology.

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
mandatory Python / PythonKernel
mandatory Service Knowledge or service ontology
mandatory Git/repository assumptions for non-code Specialists
Python as the canonical memory/knowledge API
a universal retrieval platform or giant memory store
a mandatory ContextResolver subsystem
an extension marketplace inside q99
making every Skill executable
a first-class ResolvedExtensionBinding entity without implementation evidence
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
→ frozen result/capability/provider/implementation bindings as required
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
zero mandatory optional-extension dependency
```

Extension/runtime binding acceptance additionally proves:

1. an activation with no optional extensions launches correctly;
2. a non-code Specialist does not receive Python, Git, Service Knowledge or code-specific assumptions unless selected/required and granted;
3. installed-but-unselected implementation gains no activation authority;
4. selected material implementation identity is captured/frozen where required;
5. implementation drift after freeze is not silently adopted;
6. `ResolvedCapabilityGrant`, not extension availability, governs exposed operations;
7. large workflow-relevant executor output is bounded for model visibility while retaining a durable complete-output reference;
8. auxiliary executor crash/failure becomes a structured failure receipt/event and cannot fabricate success;
9. PREPARE does not preload optional memory/docs/knowledge surfaces unless explicitly required by the activation contract;
10. PythonKernel absence does not affect a ChainRun that does not require Python.

The programme must also leave a stable provider-adapter seam for interactive Pi/Claude ingress/egress and a measurable coordination-policy seam suitable for later Eval-guided optimization.

The historical cognition-drift fail-closed run remains valid safety evidence.

A clean full data-defined terminal run is required as the complementary happy-path proof.