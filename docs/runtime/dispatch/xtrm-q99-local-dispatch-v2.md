# XTRM q99 Local Dispatch v2 — Generic Native Runtime, Typed Results, Native Provider Messaging, Coordination-Aware Execution

> Status: execution packet for `xtrm-q99`; not a competing architecture authority. Current repository canon always wins.  
> Canonical PRD: [`../prd/native-chain-runtime.md`](../prd/native-chain-runtime.md)  
> Companion pointer addendum: [`xtrm-q99-dispatch-addendum.md`](xtrm-q99-dispatch-addendum.md)

`ultracode`

## Mission

Act as the persistent local implementation coordinator for the current `xtrm-q99` Beads graph.

Cold-start from current repository state. Prior chat state is non-canonical.

The product milestone is a real data-defined ChainRun:

```text
ChainSource
→ ChainLoader
→ ChainDefinition
→ pure compiler
→ frozen ResolvedChain
→ materialization
→ ChainRun / Container(kind=chain)
→ participant + Specialist binding
→ frozen result/capability/provider bindings
→ PREPARE
→ ActivationSupervisor
→ provider model session
→ typed result/evidence
→ Channels cooperation
→ reducer/scheduler
→ FINALIZE
→ terminal ChainRun
```

The SRE chain must execute through that path with zero SRE-topology-specific logic in generic runtime code.

q99 must also incorporate these settled decisions before runtime wiring hardens older assumptions:

1. universal typed result contracts;
2. provider-native external/interactive messaging;
3. `PassiveAwareness` distinct from `WAITING_ON_CHANNEL`;
4. coordination-aware participant grouping, ownership, useful parallelism and evaluation.

Do not create parallel orchestration systems for these concerns.

## Cold-start

Run current supported equivalents of:

```bash
git fetch origin
git status
git log --oneline --decorate origin/main -30
bd prime
bd show xtrm-q99
bd ready
bd blocked
xt --help
xtmux --help
```

Read in full before mutation:

```text
docs/runtime/README.md
docs/runtime/prd/native-chain-runtime.md
docs/runtime/adr/001-chain-authoring-compilation.md
docs/runtime/adr/002-container-chainrun-durability.md
docs/runtime/adr/003-native-participant-runtime.md
docs/runtime/adr/004-specialist-activation-capabilities-probes.md
docs/runtime/adr/005-channels-cooperative-runtime.md
docs/runtime/adr/006-runtime-supervision-boundary.md
docs/channels/channels.md
```

Read the current implementation and tests under:

```text
experiments/agentsession-sre-chain-vertical-slice/
```

Read current Specialists authority for `SpecialistDefinition`, activation profiles and output semantics, especially:

```text
xtrm-dev/specialists/src/specialist/schema.ts
xtrm-dev/specialists/docs/authoring.md
current Specialists PRD
current specialist execution protocol
```

Reconcile current meanings of:

```text
prompt.output_schema
execution.response_format
execution.output_type
execution.expected_output_keys
```

Use `/multiplexing` on Claude and `/skill:multiplexing` on Pi where relevant. Every delegated Claude helper prompt created by this programme must contain the literal word `ultracode`.

Do not use a full Specialists chain merely to coordinate q99 implementation.

---

## 1. Preserve the settled object model

```text
ChainSource
  ├─ TemplateChainSource
  ├─ JsonChainSource
  ├─ AdHocChainSource
  └─ ImportedWorkflowSource
        ↓
ChainDefinition
        ↓
pure compiler
        ↓
ResolvedChain
        ↓
ChainRun
```

No durable `ChainProgram`.

```text
participant_id != activation/job_id != provider session id
```

`Container(kind=chain)` and `ChainRun` are 1:1 without contradictory independent terminal state machines.

Beads remains the bridge authority for durable work/readiness/acceptance. Git remains integration truth.

Direct Pi `AgentSession` is the currently proven hosted product path. Corrected RPC remains compatibility/migration/rollback/headless transport. A future Claude Code SDK activation must fit the same XTRM activation/result/Channels contract and requires separate promotion evidence.

---

## 2. Universal result and evidence contracts

The generic runtime must never contain a specialist-name result-schema registry.

Use:

```text
Zod/runtime schemas
  → stable XTRM protocol envelopes

JSON Schema
  → arbitrary Specialist result/evidence payloads
```

Specialist authors must not need to write Zod or modify XTRM source code to introduce a new valid result payload.

Define/promote one versioned generic `ResultEnvelope` and a frozen `ResolvedResultContract` containing the effective custom payload schema, canonical representation/hash, provenance and required evidence declarations.

The pure ChainDefinition compiler must remain pure. Specialist-owned result declarations may be resolved/frozen during materialization/PREPARE rather than by introducing runtime I/O into compilation.

Use a maintained JSON-Schema validator and an explicitly documented dialect/subset. Do not implement a home-grown validator. Remote/network `$ref` resolution must not become a nondeterministic/SSRF path.

Target Specialist compatibility semantics:

```text
response_format
  presentation/model hint

output_type
  semantic classification/hint

prompt.output_schema
  authoritative custom result-payload JSON Schema

expected_output_keys
  compatibility-only required-properties fallback when no stronger schema exists
```

No two independent validators may disagree about result acceptance.

### result_submit

Canonical runtime authority must come through a host-owned surface conceptually like:

```text
result_submit({
  status,
  summary,
  evidence_refs,
  artifact_refs,
  payload
})
```

The host injects/binds participant, activation, attempt and contract identity.

```text
result_submit
→ validate outer ResultEnvelope
→ validate payload against frozen ResolvedResultContract
→ persist accepted result/receipt
→ validate required evidence
→ FINALIZE
→ reducer may satisfy step
```

Never use:

```text
assistant final prose
→ JSON.parse / regex
→ step satisfied
```

Invalid payload means typed rejection, zero accepted result and zero step satisfaction.

### agent lifecycle

Normalize provider lifecycle facts into validated ActivationEvent envelopes. `agent_end`/provider equivalent is lifecycle evidence only:

```text
agent ended != result accepted
result accepted != evidence satisfied
result/evidence present != protocol completed
```

### generic gates

Gate semantics derive from `step.class == gate`, not `SpecialistName == reviewer`.

Use a generic PASS / PARTIAL / FAIL disposition. Custom gate payload fields remain dynamically schema-governed. Accepted GateResult is the gate-verdict authority; canonical `work.verdict` should be projected from it rather than separately hand-authored by the model.

### generic evidence

Promote one stable outer EvidenceEnvelope. Custom evidence kinds/payload schemas must not require runtime source edits. Required declared evidence must validate before step satisfaction; supplemental evidence remains non-authoritative unless a contract says otherwise.

---

## 3. Provider-native messaging

For current interactive/external sessions, treat these as accepted provider dependencies/mechanisms rather than research-only curiosities:

```text
Pi ↔ Pi
  pi-intercom

Claude ↔ Claude
  Claude native peer / cross-session messaging

Claude ↔ Pi
  pi-claude-link

raw shell / vim / REPL / unsupported provider
  tmux fallback
```

Inspect and pin the exact source/package/commit identities actually used. Keep dependency-specific behavior behind provider adapters. Do not rewrite working dependencies merely for ownership purity.

Outside a ChainRun, these transports may be used directly for operator-owned sessions.

Inside a governed ChainRun, all semantic communication remains Channels-owned:

```text
external native provider message
→ ProviderIngressAdapter
→ trusted identity binding
→ ingress authorization
→ ChannelCommunicationService
→ ChannelMessage / ReplyObligation
→ SchedulerIntent / attention
→ participant
```

A ChainRun participant may not directly use `pi-intercom` or Claude native `SendMessage` to bypass Channels.

Provider accepted/queued/delivered never implies processed/replied.

Formalize the smallest useful seams, conceptually:

```text
ProviderDeliveryAdapter
  deliver(intent, binding)
  observe(receipt)
  reconcile(uncertain)

ProviderIngressAdapter
  bindSender(providerIdentity)
  receive(providerMessage)
  commitToChannels(...)
  reply/egress(...)
```

Expected current implementations/bindings:

```text
DirectPiAgentSessionAdapter
PiIntercomAdapter
ClaudePeerAdapter
TmuxDeliveryAdapter
```

Future only:

```text
ClaudeSdkActivationAdapter
```

XTRM remains authority for ChannelMessage, ReplyObligation, SchedulerIntent, FINALIZE, ChainRun, participant identity, authorization and semantic replay.

---

## 4. Passive awareness

Do not collapse `PassiveAwareness` into `WAITING_ON_CHANNEL`.

```text
WAITING_ON_CHANNEL
  participant cannot make useful progress
  pending required obligation
  runtime waits/settles
  obligation terminal → SchedulerIntent → resume/new activation

PassiveAwareness
  participant continues useful foreground work
  relevant Channel attention may arrive
  runtime surfaces it at safe provider/tool boundaries
  no model-owned polling/watcher required
```

Attention remains governed by Channels:

```text
routing hard
attention soft
authority hard
```

Use audience, action targets, suggested watchers, visibility, membership and ownership relevance to avoid injecting every message into every participant.

Native providers may safely queue/steer busy recipients where characterized; do not carry forward tmux-specific “never message Working pane” restrictions into native transports.

Passive attention does not satisfy ReplyObligations, grant authority or directly mutate chain readiness.

---

## 5. Coordination-aware planning and execution

Research evidence is an input to design, not runtime authority. Operationalize only this bounded convergence:

```text
more agents != better
parallelism != coordination
prompted coordinator != structural coordinator
communication policy must fit task topology
```

### ResolvedCoordinationPolicy

Do not create a new durable lifecycle entity. Resolve/freeze coordination policy inside the approved `ResolvedChain.effective`, with fields conceptually covering:

```text
participant grouping
max useful parallelism
ownership scopes
interface contract refs
attention policy
artifact-sharing policy
negotiation requirements
communication policy
```

A grouping/topology change after freeze uses the existing explicit revision path.

### RepositoryCoordinationAnalysis

The pure compiler must not perform repository I/O/static analysis. Planning may produce an explicit frozen artifact describing:

```text
work units
file/module dependencies
likely ownership groups
high-coupling hubs
cross-group interfaces
parallel-safe regions
estimated coupling/communication cost
```

Possible evidence sources may include GitNexus, Serena/LSP, repository analysis, planning artifacts or human/coordinator structure. None becomes workflow authority by itself.

### coupling-aware grouping

Do not naively assign every ready work unit to a different participant. Preserve useful parallelism while keeping tightly coupled decisions together when cross-participant coordination would cost more than isolation benefits.

Do not block q99 on an optimal graph-partitioning algorithm. Establish the contract and measurement seam first.

### ownership/interface evidence

Allow step/participant contracts or refs to express ownership scopes and interface contracts. Shared/public interface changes should produce typed `InterfaceChangeEvidence` sufficient to identify changed interface, compatibility impact and affected downstream owners/steps. Channels may project targeted attention from that evidence.

Do not rely on “remember to notify teammates”.

### messages vs artifacts

Choose medium by semantic purpose:

```text
request / finding / proposal / challenge
  → ChannelMessage

large reusable result
  → Evidence artifact

shared interface / plan / schema
  → durable artifact

attention / wake
  → Channel pointer/projection
```

Messages should remain concise and pointer-first instead of repeatedly copying large evidence payloads.

### participant count

The planner may choose one participant, cooperating participants, independent advisors, cohesive workgroups or pipeline ownership. Max useful parallelism may be lower than available agent/runtime capacity.

---

## 6. Coordination telemetry and Eval Core

Extend existing `xtrm.forensic.v1` / Eval projections rather than creating another authority store.

A run may be projected as a temporal coordination graph with participants, files/artifacts/evidence/interfaces as nodes and message/read/write/interface-change edges.

Useful metrics include:

```text
message density
broadcast ratio
cross-participant edges
coordination-token share
evidence reuse
artifact fan-out
wait/idle ratio
duplicate-work rate
unanswered-obligation rate
interface-regression rate
```

These are observations, not scheduler authority.

Extend existing Eval Core with coordination-policy evaluation. Hold task/model/runtime/validation fixed and vary:

```text
participant count
partition/grouping strategy
communication policy
PassiveAwareness
artifact-sharing policy
review topology
```

Measure success, wall time, token/cost, coordination overhead, repair loops, interface regressions, unanswered obligations, duplicate work, human intervention and recovery events.

Repeat trials where behavior is stochastic; one successful run is not promotion evidence.

Use communication / commitment / expectation as Eval/forensic failure categories backed by existing Channels/Beads/evidence truth. Do not create a second commitment store.

---

## 7. Documentation work is part of q99

Do not leave normative decisions only in code comments or Beads memory.

Reconcile existing owning authority as implementation becomes concrete:

```text
docs/runtime/prd/native-chain-runtime.md
ADR-001 — authoring/compiler/coordination inputs
ADR-004 — ResultContract, dynamic schemas, gate/evidence result semantics
ADR-005 — external ingress, request/reply, PassiveAwareness
ADR-006 — native provider adapters, tmux fallback boundary
docs/channels/channels.md — only where canonical Channels semantics need amendment
Eval Core owning docs
Specialists authoring/schema/protocol docs when output_schema semantics change
runtime README / execution plan / ledger when programme truth changes
```

Do not create parallel architecture documents when an owner already exists. Do not rewrite archived historical reconciliation material except to repair broken pointers.

---

## 8. Reconcile the existing q99 Beads graph

Read `xtrm-q99` before creating work.

Classify requirements as:

```text
already represented correctly
  → keep existing Bead

represented with stale assumptions
  → amend existing Bead contract

genuinely missing and required for q99 acceptance
  → one bounded discovered-from child

valid but not required for q99
  → follow-up only when concrete enough to execute
```

Do not create a new mega-epic.

Likely conceptual packets, only where genuinely missing:

```text
canon/ADR amendments
ResultEnvelope + ResultReceipt
ResolvedResultContract + JSON-Schema validator
result_submit
generic EvidenceEnvelope
generic GateResult / verdict projection
ActivationEvent normalization
ProviderIngress/Delivery seam
pi-intercom adapter
Claude native / pi-claude-link adapter
PassiveAwareness
coordination-policy contracts / telemetry hooks
generic materialization/runtime wiring
SRE hard-coded-path retirement
full data-defined SRE E2E proof
```

Dependency order follows semantic prerequisites, not this list order.

---

## 9. Mandatory acceptance

### Results/events

Prove at minimum:

1. arbitrary custom Specialist `output_schema` needs no specialist-specific XTRM code;
2. valid custom payload creates one accepted persisted ResultEnvelope;
3. invalid payload creates no accepted result and cannot satisfy a step;
4. schema hash is deterministic across reload;
5. schema drift after freeze fails closed;
6. absent output schema follows a documented opaque fallback with no custom reducer authority;
7. `expected_output_keys` compatibility is deterministic;
8. `agent_end` without accepted result does not satisfy a step;
9. accepted result without required evidence does not satisfy a step;
10. valid result + evidence + clear FINALIZE can satisfy the step;
11. custom gate PASS/PARTIAL/FAIL works without name-specific runtime code;
12. JSON-like final prose without `result_submit` is non-authoritative;
13. model payload cannot override host identity/contract authority.

### Native messaging

Prove at minimum:

1. external Pi ingress creates exactly one canonical ChannelMessage;
2. external Claude ingress creates exactly one canonical ChannelMessage;
3. external required request creates ReplyObligation and correlated egress reply;
4. duplicate provider delivery dedupes semantically;
5. provider accepted/queued does not imply processed/replied;
6. crash before Channel commit is retry/reconciliation safe;
7. Channel commit + uncertain physical wake preserves semantic message and explicit uncertain delivery;
8. spoofed role/authority in body cannot grant authority;
9. unknown external identity fails closed or enters an explicit low-authority intake lane;
10. tmux fallback preserves semantic identity;
11. adapter restart does not erase ChainRun semantic state;
12. multiple external requesters retain XTRM-exact correlation;
13. ChainRun participants cannot bypass Channels via provider-native messaging.

### PassiveAwareness

Prove:

1. participant continues foreground work while attention is pending;
2. relevant attention surfaces without model polling;
3. irrelevant watcher traffic is not injected;
4. passive attention does not satisfy ReplyObligation;
5. passive attention does not directly mutate readiness;
6. transition to `WAITING_ON_CHANNEL` is explicit when useful progress becomes impossible;
7. reconnect/restart does not lose the underlying Channel message;
8. duplicate attention delivery is idempotent;
9. native busy-recipient behavior does not unsafely interrupt in-flight tools;
10. tmux fallback may degrade latency but not semantic correctness.

### Coordination policy

Prove:

1. coordination policy freezes with ResolvedChain;
2. compiler remains pure and repo analysis arrives explicitly;
3. participant-grouping change after freeze requires revision;
4. tightly coupled work may remain one participant/workgroup;
5. independent work may remain parallel;
6. max concurrency may be lower than available agent count;
7. ownership scopes are visible to runtime/context;
8. interface change produces typed evidence + targeted attention;
9. large artifacts may be referenced instead of duplicated in messages;
10. coordination telemetry is projection-only.

Do not block q99 on proving an optimal partitioning algorithm.

---

## 10. End-to-end q99 proof

The milestone is actual execution, not topology fingerprint parity:

```text
SRE JSON ChainSource
→ loader
→ ChainDefinition
→ pure compiler
→ frozen ResolvedChain
→ materialize
→ ChainRun
→ Specialist binding
→ frozen ResultContract
→ PREPARE
→ ActivationSupervisor
→ direct Pi AgentSession
→ typed result/evidence
→ Channels
→ reducer/scheduler
→ FINALIZE
→ terminal ChainRun
```

Required negative proofs:

```text
no hard-coded SRE topology constructor
no generic scheduler branches on SRE role names
no prompt-only result/verdict authority
no specialist-name output-schema map
no provider-native Channels bypass
no model-owned wait/monitor correctness
no tmux dependency for direct AgentSession correctness
```

Preserve the historical cognition-drift fail-closed proof. Add one clean full data-defined successful terminal run as complementary evidence.

---

## 11. Review and autonomous execution loop

Every substantive PR requires a fresh non-author review on the exact final head after reading the Bead contract, relevant canon, complete diff and tests.

Verdict:

```text
PASS
PARTIAL
FAIL
```

PARTIAL/FAIL means repair, rerun validation and obtain a fresh exact-head review.

Normal coordinator loop:

```text
ready
→ claim
→ implement
→ validate
→ fresh review
→ repair if needed
→ PASS
→ merge
→ close + durable checkpoint
→ refresh main
→ refresh Beads
→ next ready
```

Do not ask operator permission after each bounded successful Bead.

After each completed Bead persist a current `bd remember` checkpoint with Bead, PR, merge SHA, exact-head review verdict, tests/evidence, docs/ADR changes, schemas/contracts, provider identities exercised, coordination/eval changes, follow-ups, current q99 graph and next ready Bead.

Escalate only for irreconcilable canon contradiction, genuinely new authority/entity, unauthorized compatibility break, materially invalid q99 graph, repeated architecture-review failure, provider behavior falsifying the transport model, unsafe JSON-Schema resolution, unsatisfied data-loss/replay guarantees, or an explicitly operator-reserved decision.

Stop only when an escalation condition fires, all remaining q99 work is genuinely externally blocked, a documented q99 milestone gate is reached, the graph requires operator approval, or the q99 root completion contract is satisfied.

## Final success condition

At q99 completion it must be truthful that:

1. custom Specialists require no XTRM result-schema source changes;
2. runtime protocol events are typed/validated;
3. prompt prose/JSON is not runtime authority;
4. custom payloads validate against frozen dynamic JSON Schemas;
5. gate/evidence semantics are generic;
6. `agent_end` is lifecycle evidence only;
7. Pi/Claude native messaging is preferred transport where characterized;
8. external participants can reach ChainRun participants without bypassing Channels;
9. `PassiveAwareness` keeps participants reachable while working;
10. tmux remains topology/raw/fallback infrastructure, not normal Claude/Pi message correctness;
11. participant grouping/concurrency/communication policy is explicit resolved policy rather than prompt folklore;
12. coordination cost/topology is observable through existing forensic/Eval projections;
13. the SRE chain executes end-to-end from data-defined topology through the generic runtime and terminalizes correctly.
