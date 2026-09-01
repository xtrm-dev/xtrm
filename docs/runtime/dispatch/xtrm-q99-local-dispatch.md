# XTRM q99 Local Dispatch — Native Chain Runtime Completion

> Status: repository-owned execution packet for `xtrm-q99`; **not** a competing architecture authority.  
> Canonical integrated PRD: [`../prd/native-chain-runtime.md`](../prd/native-chain-runtime.md)  
> Owning subsystem decisions: `../adr/001..006` and [`../../channels/channels.md`](../../channels/channels.md)  
> Cold-start rule: current accepted canon and current Beads state outrank this packet when mutable evidence has moved.

`ultracode`

## 0. Mission

Act as the persistent local implementation coordinator for the **existing** `xtrm-q99` Beads graph.

Do not restart q99 planning. Do not create a replacement Epic. Do not treat chat, exported copies, old checkpoints, or this branch's historical base SHA as current implementation truth.

The milestone is actual execution through the generic native chain runtime:

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
→ accepted typed result + validated evidence
→ Channels cooperation
→ pure reducer + exact SchedulerIntent
→ FINALIZE
→ terminal ChainRun
```

The data-authored SRE chain must complete through this path with zero SRE-topology-specific logic in generic runtime code.

q99 also owns the current canonical refinements for:

```text
universal ResultEnvelope / ResolvedResultContract
host-owned result_submit
JSON-Schema custom Specialist payloads
generic GateResult / EvidenceEnvelope
provider-native external messaging adapters
PassiveAwareness != WAITING_ON_CHANNEL
ResolvedCoordinationPolicy
RepositoryCoordinationAnalysis
ownership/interface evidence
coordination telemetry + Eval Core
```

These refine the existing runtime. They do not create another orchestration system.

---

## 1. Authority and precedence

Read repository sources, not chat copies.

Use this precedence for q99 decisions:

```text
1. current accepted owning canon / ADR / subsystem specification
2. current Beads contract and dependency graph
3. this repository-owned q99 dispatch
4. durable checkpoint / memory
5. historical research, archived drafts and chat context
```

For implementation facts, verify current code/tests and exact Git heads before relying on prose. If current source or Beads falsifies an older normative claim, record the contradiction and repair the owning canon rather than silently preserving stale wording.

The dispatch may require an owning ADR/spec to change. Until that change is merged, the dispatch is an implementation instruction, not evidence that accepted canon already says the new thing.

Do not create parallel architecture documents when an owner already exists.

---

## 2. Mandatory cold start

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

Record the actual XTRM default head and the current q99 graph before mutation.

Read in full:

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

Read current implementation/tests under:

```text
experiments/agentsession-sre-chain-vertical-slice/
  src/chain-contracts/
  src/chain-loader/
  src/chain-compiler/
  src/channel-comm/
  src/obligation/
  src/waiting/
  src/finalize/
  src/agents/
  src/specialists/
  src/tools/
  src/evidence/
  src/chain/
  data/sre-team.chain.json
```

Read current Specialists authority before changing Specialist result/output semantics:

```text
xtrm-dev/specialists/src/specialist/schema.ts
xtrm-dev/specialists/docs/authoring.md
current Specialists PRD
current Specialist execution protocol
```

Explicitly reconcile:

```text
prompt.output_schema
execution.response_format
execution.output_type
execution.expected_output_keys
```

Use `/multiplexing` on Claude and `/skill:multiplexing` on Pi where relevant. Every delegated Claude helper prompt created by this programme must include the literal word `ultracode`.

Do not use a full Specialists chain merely to coordinate q99 implementation.

---

## 3. Do not recreate already-landed qcy work

First prove a regression before rewriting any of these:

```text
ChainSource / ChainDefinition
one ChainLoader for all source variants
pure compiler / ResolvedChain freeze
ChannelCommunicationService
ReplyObligation ledger
WAITING_ON_CHANNEL
FINALIZE obligation enforcement
adversarial communication suite
SRE data-defined topology parity
post-qcy R1–R8 quality-gate repairs
```

Fingerprint/topology parity is historical evidence only. q99 still requires a real generic terminal run.

---

## 4. Cross-repository mutable dependency guard

Inspect current `xtrm-dev/core` default branch and any active integration PRs before freezing provider/extension bindings.

At authoring time, Core PR #606 (`python-kernel v2 + service-knowledge`) is still open and therefore is **not accepted Core authority**. Re-check its state locally/remotely rather than assuming this remains true.

Do not let an unmerged Core integration silently make any of the following mandatory XTRM runtime infrastructure:

```text
Python interpreter / python-kernel
Service Knowledge
ambient skill discovery
extension-specific ontology
extension-specific memory/context API
```

The stable rule is:

```text
available implementation
!= selected implementation
!= frozen binding
!= ResolvedCapabilityGrant
```

Working extensions/providers may be dependencies behind bounded adapters. Their domain-specific behavior does not become ChainRun authority merely because it is installed.

A valid ChainRun that does not require an optional extension must remain valid without it.

---

## 5. Settled architecture invariants

Preserve:

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

Identity:

```text
participant_id
!= activation/job_id
!= provider session id
```

`Container(kind=chain)` and `ChainRun` are 1:1 and must not gain contradictory independent terminal state machines.

Direct Pi `AgentSession` is the currently proven hosted product path. Corrected RPC remains compatibility/migration/rollback/headless transport. A future Claude SDK activation must implement the same XTRM activation/result/Channels contract and needs separate promotion evidence.

Supervision remains split:

```text
ChainReducer/Scheduler
  owns workflow progression

ActivationSupervisor
  owns one direct XTRM activation

xtmux RuntimeSupervisor / provider adapters
  own external/interactive runtime delivery, observation and reconciliation
```

Provider transport never becomes workflow authority.

---

## 6. Workstream A — universal typed results and evidence

### 6.1 Protocol split

Do not build a Specialist-name result registry.

Use:

```text
runtime schema (for example Zod)
  → stable XTRM protocol envelopes

JSON Schema
  → arbitrary Specialist-owned result/evidence payloads
```

Specialist authors must not need XTRM source changes or Zod code to define a custom result payload.

Use one maintained JSON-Schema validator and one explicit supported dialect/subset. Remote/network `$ref` resolution must not become nondeterministic or SSRF-capable. Prefer self-contained schemas/local `$defs` and content-addressed identity.

### 6.2 ResultEnvelope / ResolvedResultContract

Promote one strict versioned generic result envelope. Conceptually it carries:

```text
schema_version
result_id
chain_id
step_id
participant_id
activation_id
attempt
status
summary
evidence_refs[]
artifact_refs[]
contract_ref / contract_hash
payload
produced_at
```

Host/runtime binds protected identity and contract authority. Model payload must not choose participant, activation, contract hash, role or authority.

`ResolvedResultContract` freezes the effective payload schema, canonical representation/hash, provenance and required evidence declarations. Keep the ChainDefinition compiler pure; Specialist-owned result declarations may resolve/freeze during materialization/PREPARE.

Reconcile Specialist legacy fields to one validation authority:

```text
response_format
  presentation/model hint only

output_type
  semantic classification/hint only

prompt.output_schema
  authoritative custom result-payload JSON Schema when present

expected_output_keys
  compatibility-only required-properties fallback when no stronger schema exists
```

### 6.3 result_submit

Canonical result authority is host-owned:

```text
result_submit
→ validate outer ResultEnvelope
→ validate payload against frozen ResolvedResultContract
→ persist accepted result/receipt
→ validate required evidence
→ FINALIZE
→ reducer may satisfy step
```

Never use final assistant prose/JSON parsing as result authority.

Invalid payload:

```text
typed rejection
zero accepted result
zero step satisfaction
```

### 6.4 agent lifecycle is not result authority

Normalize provider lifecycle into versioned ActivationEvent envelopes, with events such as:

```text
activation.started
activation.message_observed
activation.tool.started
activation.tool.ended
activation.settled
activation.ended
activation.failed
activation.cancelled
```

Preserve:

```text
agent_end != accepted result
accepted result != evidence satisfied
result/evidence present != protocol completed
```

### 6.5 Generic gates and evidence

Gate semantics derive from `step.class == gate`, not Specialist name.

Generic gate disposition:

```text
PASS
PARTIAL
FAIL
```

Custom gate payload extensions remain JSON-Schema governed. Accepted GateResult is the durable verdict authority; canonical `work.verdict` should be projected from it rather than separately hand-authored by the model.

Use one generic stable outer EvidenceEnvelope. Custom evidence kinds/payload schemas must not require runtime source edits. Required evidence validates before step satisfaction; supplemental evidence remains non-authoritative unless a contract promotes it.

---

## 7. Workstream B — provider-native external messaging

Current preferred interactive/external routing:

```text
Pi ↔ Pi
  pi-intercom

Claude ↔ Claude
  Claude native peer/cross-session messaging

Claude ↔ Pi
  pi-claude-link

raw shell / vim / REPL / unsupported runtime
  tmux fallback
```

Inspect and pin the exact package/source/commit identities actually used. Keep dependency-specific semantics behind adapters. Do not rewrite a working dependency merely for ownership purity.

Inside a governed ChainRun, semantic communication **always** enters/leaves through Channels:

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

A ChainRun participant may not bypass Channels through direct `pi-intercom`, Claude native messaging or another provider mechanism.

Bounded seams:

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

Expected current bindings may include:

```text
DirectPiAgentSessionAdapter
PiIntercomAdapter
ClaudePeerAdapter
TmuxDeliveryAdapter
```

Future-only until separately proven:

```text
ClaudeSdkActivationAdapter
```

Preserve:

```text
provider accepted
!= receiver processed
!= replied
```

and explicit `uncertain` reconciliation.

---

## 8. Workstream C — PassiveAwareness

Do not collapse:

```text
WAITING_ON_CHANNEL
```

and:

```text
PassiveAwareness
```

`WAITING_ON_CHANNEL`:

```text
participant cannot make useful progress
pending required obligation
runtime settles/waits
obligation terminal → SchedulerIntent → resume/new activation
```

`PassiveAwareness`:

```text
participant continues useful foreground work
relevant Channel attention may arrive
runtime surfaces it at safe provider/tool boundaries
no model-owned polling/watcher requirement
```

Attention remains:

```text
routing hard
attention soft
authority hard
```

Use audience/action targets/watchers/visibility/membership/ownership relevance. Do not inject every message into every participant.

Native busy-recipient queue/steer behavior may be used where characterized. Do not preserve tmux-specific restrictions when the native provider safely supports better delivery semantics.

Passive attention cannot satisfy ReplyObligation, grant authority or directly mutate chain readiness.

---

## 9. Workstream D — coordination-aware planning and execution

Operationalize only the bounded principle:

```text
more agents != better
parallelism != coordination
prompted coordinator != structural coordinator
communication policy must fit task topology
```

External systems/papers are evidence, never XTRM runtime authority.

### 9.1 ResolvedCoordinationPolicy

Do not create a new lifecycle entity. Freeze effective coordination policy inside `ResolvedChain.effective`, conceptually covering:

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

Grouping/topology change after freeze uses the existing explicit revision path.

### 9.2 RepositoryCoordinationAnalysis

The pure compiler must never do hidden repository I/O/static analysis.

Planning may provide an explicit frozen artifact containing:

```text
work units
file/module dependencies
likely ownership groups
high-coupling hubs
cross-group interfaces
parallel-safe regions
estimated coupling / communication cost
```

Possible producers include GitNexus, Serena/LSP, deterministic repository analysis, planning artifacts or human structure. None becomes authority merely by producing analysis.

### 9.3 Coupling-aware grouping

Do not map every ready unit to a different participant. Keep tightly coupled decisions together when coordination cost exceeds useful parallelism. Allow max useful concurrency below physical runtime capacity.

Do not block q99 on an optimal graph-partitioning algorithm. Establish the schema, policy and measurement seam.

### 9.4 Ownership/interface evidence

Expose ownership scopes/interface refs in step/participant contracts where useful. Shared/public interface changes produce typed `InterfaceChangeEvidence` sufficient to identify changed interface, compatibility impact and affected downstream owners/steps. Channels may project targeted attention from this evidence.

Do not rely on “remember to notify teammates”.

### 9.5 Message vs artifact policy

```text
request / finding / proposal / challenge
  → ChannelMessage

large reusable result
  → Evidence artifact

shared interface / plan / schema
  → durable artifact

attention / wake
  → pointer/projection
```

Prefer concise pointer-first messages rather than repeatedly duplicating large evidence payloads.

---

## 10. Workstream E — coordination telemetry and Eval Core

Extend existing forensics/Eval; do not create another authority store.

Project a run as a temporal coordination graph when useful:

```text
nodes
  participants
  files/artifacts/evidence
  interfaces

edges
  message/request/reply
  read/dereference
  write/publish
  interface change/claim
```

Useful projections:

```text
message density
broadcast ratio
cross-participant edge count
coordination-token share
evidence reuse
artifact fan-out
wait/idle ratio
duplicate-work rate
unanswered-obligation rate
interface-regression rate
```

These are observations, not scheduler authority.

Extend existing Eval Core with coordination-policy experiments. Hold task/model/runtime/validation constant and vary participant count, grouping, communication policy, PassiveAwareness, artifact-sharing policy and review topology.

Measure outcome, wall time, tokens/cost, coordination overhead, repair loops, interface regressions, unanswered obligations, duplicate work, human intervention and recovery.

Use communication / commitment / expectation as forensic/eval failure categories backed by current Channels/Beads/evidence truth. Do not create a second commitment store.

Require repeated trials for stochastic coordination claims. One successful run is not promotion evidence.

---

## 11. Canon update map

Implementation is incomplete if code lands while owning canon remains materially stale.

Amend existing owners only when warranted:

```text
ADR-001
  coordination-analysis input and frozen coordination policy

ADR-004
  ResultContract / JSON Schema / result_submit
  generic GateResult / EvidenceEnvelope
  binding vs capability authority where affected

ADR-005
  external ingress/egress through Channels
  PassiveAwareness != WAITING_ON_CHANNEL
  pointer-first message/artifact policy

ADR-006
  pi-intercom / Claude native / pi-claude-link provider adapters
  tmux as topology/raw/fallback
  direct AgentSession not forced through xtmux

docs/channels/channels.md
  only if canonical Channel semantics actually change

Eval Core owning docs
  coordination-policy subject/metrics

Specialists canon
  when output_schema or activation/binding contracts change

runtime README / execution plan / ledger
  when programme truth changes
```

Do not rewrite archived historical documents except to repair broken pointers.

---

## 12. Reconcile the existing q99 Beads graph

Read `xtrm-q99` before creating anything.

For each requirement:

```text
already represented correctly
  → keep

represented with stale architecture
  → amend existing Bead

genuinely missing and required for q99 acceptance
  → create one bounded discovered-from child

useful but not required for q99
  → follow-up only if concrete enough to execute
```

Do not manufacture one Bead per heading in this document.

Likely conceptual packets, only where genuinely missing:

```text
canon/ADR amendments
ResultEnvelope + ResultReceipt
ResolvedResultContract + JSON-Schema validation
result_submit
generic EvidenceEnvelope
generic GateResult / verdict projection
ActivationEvent normalization
ProviderIngress/Delivery seam
pi-intercom adapter
Claude native / pi-claude-link adapter
PassiveAwareness
coordination policy / analysis contracts
coordination forensic/Eval projection
generic materialization/runtime wiring
SRE hard-coded-path retirement
full data-defined SRE E2E proof
```

Do not expand q99 into:

```text
a full memory redesign
a universal retrieval platform
mandatory Python/service-knowledge integration
a new extension marketplace
a CRDT workspace
a second workflow runtime
a second message store
a standalone coordination lifecycle
a hard-coded graph-partitioning algorithm
mandatory multi-agent execution
```

---

## 13. Preferred implementation sequence

```text
1. cold-start + reconcile current q99 graph/canon
2. result/event protocol schemas
3. frozen ResolvedResultContract + JSON-Schema validation
4. result_submit + generic result/evidence/gate authority
5. provider ingress/delivery adapter seam
6. native Pi/Claude interactive transports where current evidence supports them
7. PassiveAwareness
8. coordination-policy/analysis contracts + telemetry hooks
9. generic ChainRun materialization/runtime wiring
10. retire SRE-specific runtime paths
11. run real data-defined SRE happy path + failure/recovery fixtures
12. fresh exact-head non-author review
```

Parallelize independent research/audit lanes. Serialize writes to shared schemas, reducer/scheduler and canonical docs.

---

## 14. Mandatory acceptance matrix

### A. Typed result/evidence authority

Prove:

1. arbitrary custom Specialist `output_schema` requires zero Specialist-specific XTRM runtime code;
2. valid custom payload creates one accepted persisted ResultEnvelope;
3. invalid payload creates typed rejection, zero accepted result and zero step satisfaction;
4. schema hash is deterministic across reload;
5. schema drift after freeze fails closed;
6. absent output schema follows a documented opaque fallback and grants no custom reducer authority;
7. `expected_output_keys` compatibility is deterministic;
8. `agent_end` without accepted result cannot satisfy a step;
9. accepted result without required evidence cannot satisfy a step;
10. accepted result + required evidence + clear FINALIZE may satisfy a step;
11. arbitrary custom gate PASS/PARTIAL/FAIL works without name-specific code;
12. PARTIAL routes only bounded remediation;
13. FAIL routes the fail path;
14. JSON-like final assistant prose without `result_submit` is non-authoritative;
15. model payload cannot override host identity/contract authority.

### B. Provider-native messaging

Prove:

1. external Pi ingress creates exactly one canonical ChannelMessage;
2. external Claude ingress creates exactly one canonical ChannelMessage;
3. required external request creates ReplyObligation and correlated reply/egress;
4. duplicate provider delivery deduplicates semantically;
5. provider queued/accepted does not imply processed/replied;
6. crash before Channel commit is retry/reconciliation safe;
7. Channel commit + uncertain physical wake preserves semantic state + explicit uncertain delivery;
8. spoofed authority in message body cannot grant authority;
9. unknown external identity fails closed or enters an explicit low-authority intake lane;
10. tmux fallback preserves semantic message identity;
11. safe native busy-recipient queue/steer behavior works where characterized;
12. adapter restart does not erase ChainRun semantic state;
13. multiple external requesters retain XTRM-exact correlation;
14. ChainRun participants cannot bypass Channels through provider-native messaging.

### C. PassiveAwareness

Prove:

1. participant continues useful foreground work while attention is pending;
2. relevant attention surfaces without model polling;
3. irrelevant watcher traffic is not injected;
4. passive attention does not satisfy ReplyObligation;
5. passive attention does not directly mutate readiness;
6. transition to `WAITING_ON_CHANNEL` is explicit when useful progress becomes impossible;
7. reconnect/restart does not lose the underlying Channel message;
8. duplicate attention delivery is idempotent;
9. native busy-recipient semantics do not unsafely interrupt in-flight provider tools;
10. tmux fallback may degrade latency but not semantic correctness.

### D. Coordination policy

Prove:

1. coordination policy freezes with ResolvedChain;
2. compiler remains pure and repository analysis arrives explicitly;
3. grouping/topology change after freeze requires revision;
4. tightly coupled work can remain one participant/workgroup;
5. independent work can remain parallel;
6. max concurrency may be lower than available agent count;
7. ownership scopes are visible to runtime/context;
8. interface change creates typed evidence + targeted attention;
9. large artifacts may be referenced instead of duplicated in messages;
10. coordination telemetry is projection-only and cannot directly drive workflow authority.

### E. Optional extension/binding guard

Where q99 touches extension/provider binding, prove:

1. an activation with no optional extensions launches correctly;
2. installed-but-unselected extension gains no authority;
3. selected implementation identity is captured/frozen where material;
4. frozen activation does not silently adopt implementation drift;
5. ResolvedCapabilityGrant, not mere extension availability, governs exposed operations.

### F. Full q99 E2E

Run:

```text
SRE JSON ChainSource
→ loader
→ ChainDefinition
→ pure compiler
→ frozen ResolvedChain
→ materialize
→ ChainRun
→ Specialist/result/capability/provider binding
→ PREPARE
→ ActivationSupervisor
→ direct Pi AgentSession
→ accepted typed result/evidence
→ Channels
→ reducer/scheduler
→ FINALIZE
→ terminal ChainRun
```

Negative proofs:

```text
no hard-coded SRE topology constructor
no generic scheduler branch on SRE role names
no prompt-only result/verdict authority
no Specialist-name output-schema map
no direct provider-native Channels bypass
no model-owned wait/monitor correctness
no tmux dependency for direct AgentSession correctness
```

Preserve the historical cognition-drift fail-closed proof. Add one clean data-defined successful terminal run as complementary evidence.

---

## 15. Review and autonomous execution loop

Every substantive PR requires a fresh non-author review on the exact final head after reading the Bead contract, relevant canon, complete diff and tests.

Verdict:

```text
PASS
PARTIAL
FAIL
```

PARTIAL/FAIL:

```text
repair
→ rerun validation
→ fresh exact-head review
```

Normal loop:

```text
ready
→ claim
→ implement
→ validate
→ fresh non-author exact-head review
→ repair if required
→ PASS
→ merge
→ memory-gated close/checkpoint
→ refresh main + Beads
→ next genuinely ready Bead
```

Do not ask the operator for permission after every successful bounded Bead.

After each completed Bead, persist a current `bd remember` checkpoint containing at least:

```text
Bead
PR
merge SHA
exact-head review verdict
tests/evidence
docs/ADR changes
schemas/contracts
provider/extension identities exercised
coordination/eval changes
follow-ups
current q99 graph
next ready Bead
known provider limitations
```

---

## 16. Escalate only when

Escalate for:

```text
irreconcilable accepted-canon contradiction
genuinely new first-class authority/entity required
unauthorized public schema/storage compatibility break
materially invalid q99 graph
two repair/re-review cycles fail on the same architecture issue
provider behavior falsifies the assumed native transport model
unsafe/nondeterministic JSON-Schema resolution required
data-loss/replay guarantees cannot be achieved
canon explicitly reserves an operator decision
destructive/irreversible operation lacks authority
```

Do not escalate naming, file layout, bounded adapter plumbing or straightforward bugs.

Stop only when an escalation fires, all remaining q99 work is genuinely externally blocked, a documented q99 milestone gate is reached, the graph requires operator approval, or the q99 root completion contract is satisfied.

Do not stop because this documentation PR or one implementation PR completes.

---

## 17. Final success condition

At q99 completion it must be truthful that:

1. custom Specialists require no XTRM result-schema source changes;
2. runtime protocol events are typed and validated;
3. prompt prose/JSON is not runtime authority;
4. custom result/evidence payloads validate against frozen dynamic JSON Schemas;
5. gate/evidence semantics are generic;
6. `agent_end` is lifecycle evidence only;
7. Pi/Claude native messaging is preferred transport where characterized;
8. external participants can reach ChainRun participants without bypassing Channels;
9. `PassiveAwareness` keeps participants reachable while doing foreground work;
10. tmux remains topology/raw/fallback infrastructure, not normal Pi/Claude message correctness;
11. participant grouping/concurrency/communication policy is explicit resolved policy rather than prompt folklore;
12. coordination cost/topology is observable through existing forensic/Eval projections;
13. optional extensions remain optional and capability grants remain authoritative;
14. the SRE chain executes end-to-end from data-defined topology through the generic runtime and terminalizes correctly.
