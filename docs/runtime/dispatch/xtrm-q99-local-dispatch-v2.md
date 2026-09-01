# XTRM q99 Local Dispatch v2 — Generic Native Runtime, Typed Results, Native Provider Messaging, Coordination-Aware Execution

`ultracode`

## Mission

Act as the persistent local implementation coordinator for the next XTRM native-chain-runtime programme, beginning from the **current** `xtrm-q99` Beads graph.

Cold-start from current repository state. Prior chat state is non-canonical.

The programme must move from the completed qcy/qcy-postreview contracts into a **real generic ChainRun runtime** and close the product milestone:

```text
ChainSource
  → ChainLoader
  → ChainDefinition
  → pure compiler
  → frozen ResolvedChain
  → materialization
  → ChainRun / Container(kind=chain)
  → participant binding
  → PREPARE
  → ActivationSupervisor
  → provider model session
  → typed result/evidence
  → Channels cooperation
  → reducer/scheduler
  → FINALIZE
  → terminal ChainRun
```

The SRE chain must run through that path with **zero SRE-topology-specific logic in generic runtime code**.

This dispatch also adds four now-settled requirements that must be incorporated before q99 hardens old assumptions:

1. **Universal typed result contracts**, with stable XTRM protocol envelopes and dynamically frozen JSON-Schema payload contracts for arbitrary custom Specialists.
2. **Provider-native messaging**, using `pi-intercom`, Claude native cross-session messaging, and `pi-claude-link` as current dependencies/provider mechanisms for interactive/external runtimes, while preserving Channels as semantic authority.
3. **Passive awareness**, distinct from `WAITING_ON_CHANNEL`: a participant may continue foreground work while relevant Channel attention is surfaced at safe provider/runtime boundaries.
4. **Coordination-aware planning/execution**, where participant count, grouping, ownership, communication mode and useful parallelism are explicit, measurable policy rather than prompt folklore.

Do not treat these as separate orchestration systems. They refine the existing XTRM object model and runtime.

---

## Verified baseline to re-check

Repository:

```text
xtrm-dev/xtrm
```

At dispatch authoring time, `main` includes merged PR #102 and the qcy post-review repairs. Do not assume that remains the current head.

Run:

```bash
git fetch origin
git status
git log --oneline --decorate origin/main -30
```

Then inspect Beads using the installed CLI:

```bash
bd prime
bd ready
bd blocked
bd show xtrm-q99
```

Use current supported equivalents if command spelling differs.

Do not recreate already-landed qcy work:

```text
ChainSource / ChainDefinition
ChainLoader
pure compiler / ResolvedChain freeze
ChannelCommunicationService
ReplyObligation ledger
WAITING_ON_CHANNEL
FINALIZE obligation enforcement
adversarial communication suite
SRE data-defined topology parity
post-qcy R1–R8 quality-gate repairs
```

First prove whether current source has regressed before changing any of those.

---

## Mandatory authorities

Read current default-branch versions in full before mutation:

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

Read the current implementation under:

```text
experiments/agentsession-sre-chain-vertical-slice/
```

especially:

```text
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

Read current Specialists authority:

```text
xtrm-dev/specialists
  src/specialist/schema.ts
  loader/profile/runtime code
  docs/authoring.md
  current canonical PRD
  current execution protocol
```

Inspect exact current semantics of:

```text
prompt.output_schema
execution.response_format
execution.output_type
execution.expected_output_keys
```

Before exact local orchestration commands:

```bash
xt --help
xtmux --help
```

and relevant subcommand help.

Use `/multiplexing` on Claude and `/skill:multiplexing` on Pi where appropriate.

Every delegated Claude helper prompt created by this programme must include the literal word:

```text
ultracode
```

Do not use a full Specialists chain merely to coordinate this implementation programme.

---

# 1. Core architecture — preserve

Canonical workflow:

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

`Container(kind=chain)` and `ChainRun` remain 1:1 but do not gain contradictory independent terminal state machines.

Beads remains the current durable work/readiness/acceptance authority during the runway.

The provider owns the physical model session.

XTRM owns what that session means inside a governed workflow.

Direct Pi `AgentSession` remains the current proven hosted product path.

Corrected RPC remains compatibility/migration/rollback/headless transport.

A future Claude Code SDK activation may implement the same activation contract, but this programme must not claim it is already production-proven.

---

# 2. Universal typed result contract

## 2.1 Principle

The generic runtime MUST NOT contain a map such as:

```text
reviewer -> ReviewerResultSchema
explorer -> ExplorerResultSchema
diagnostician -> DiagnosticianResultSchema
custom-specialist -> runtime source edit
```

Custom Specialists must not require XTRM source changes.

Separate:

```text
XTRM protocol schema
    stable, runtime-owned, versioned

custom Specialist payload schema
    authored externally, frozen into runtime contract
```

Use:

```text
Zod
  → stable XTRM protocol envelopes

JSON Schema
  → arbitrary Specialist result/evidence payloads
```

Do not require Specialist authors to write Zod.

Do not implement a home-grown partial JSON-Schema validator.

Select one maintained validator and one documented supported JSON Schema dialect/subset.

Remote/network `$ref` resolution must not become a nondeterministic or SSRF path.

Prefer self-contained schemas, local `$defs` and content-addressed identity.

---

## 2.2 ResultEnvelope

Create/promote one strict generic versioned result envelope, conceptually:

```text
xtrm.result.v1

schema_version
result_id

chain_id
step_id
participant_id
activation_id
attempt

status
  completed
  failed
  blocked
  uncertain

summary

evidence_refs[]
artifact_refs[]

contract_ref
contract_hash

payload
produced_at
```

Use the exact names that best reconcile with existing contracts.

Host injects/binds identity and contract authority.

The model must not choose:

```text
participant_id
activation_id
contract_hash
authority
role
```

by putting values in its payload.

---

## 2.3 ResolvedResultContract

Define/finalize a generic `ResultContract` / `ResolvedResultContract`.

It may combine:

```text
ChainDefinition / ResolvedChain step requirements
+
SpecialistDefinition result declaration
+
generic step-class requirements
+
runtime policy
```

The pure `ChainDefinition → ResolvedChain` compiler remains pure.

It must not load Specialist files or perform runtime I/O.

If SpecialistDefinition is resolved during materialization/PREPARE, freeze the effective result contract there and persist:

```text
schema
canonical representation
schema hash
source/provenance identity
required evidence declarations
generic gate contract if applicable
```

Schema/cognition drift fails closed under the existing frozen-binding rules.

---

## 2.4 Legacy Specialist output fields

Reconcile:

```text
execution.response_format
execution.output_type
execution.expected_output_keys
prompt.output_schema
```

Target semantics:

```text
response_format
  presentation/model hint only

output_type
  semantic classification/hint only

output_schema
  authoritative custom result-payload JSON Schema

expected_output_keys
  compatibility input;
  may compile to required properties only when no stronger schema exists
```

There must not be two independent validators that can disagree.

If `prompt.output_schema` becomes normatively JSON Schema, update Specialists owning documentation and schema comments in the same programme or a companion PR.

---

## 2.5 result_submit

Do not parse final assistant prose/JSON as runtime result authority.

Provide a host-owned tool such as:

```text
result_submit({
  status,
  summary,
  evidence_refs,
  artifact_refs,
  payload
})
```

Provider tool-schema mechanisms may validate the outer tool arguments.

Then:

```text
Zod ResultEnvelope
+
frozen JSON Schema payload validation
```

On invalid payload:

```text
typed rejection
zero accepted result
zero step satisfaction
audit/rejection fact
```

On valid payload:

```text
persist accepted ResultEnvelope / ResultReceipt
reducer and FINALIZE consume only persisted accepted state
```

Final assistant text can remain useful transcript/prose, but never becomes authoritative simply because it resembles JSON.

---

## 2.6 agent_end is not result

Provider lifecycle event:

```text
agent_end / Claude equivalent
  → normalized ActivationEvent
  → persisted lifecycle fact
```

It means neither:

```text
result accepted
evidence valid
protocol completed
step satisfied
```

Preserve:

```text
agent ended != protocol completed
result exists != result validated
result validated != evidence satisfied
```

---

## 2.7 Generic GateResult

A gate is generic because:

```text
step.class == gate
```

not because Specialist name equals `reviewer`.

Define/reuse a minimal runtime-owned gate disposition:

```text
PASS
PARTIAL
FAIL
```

A custom gate Specialist may have additional JSON-Schema payload fields.

The reducer consumes the generic disposition, not Specialist-specific JSON.

The following must require zero runtime source edits:

```text
reviewer
security-reviewer
quant-reviewer
compliance-reviewer
custom-company-reviewer
```

Prefer one verdict authority:

```text
accepted GateResult
  → durable gate authority
  → projection/emission of canonical work.verdict
```

Do not require the model to separately hand-author another verdict message that could diverge.

---

## 2.8 Generic EvidenceEnvelope

Retire SRE-specific generic evidence unions.

Create/promote a stable outer evidence envelope with:

```text
evidence_id
producer identity
chain / step / activation identity
kind/ref
summary
payload or payload_ref
optional schema contract identity
scope refs
content hash / provenance where applicable
```

Custom evidence kinds and payload schemas must not require XTRM source edits.

Declared mandatory evidence must validate before step satisfaction.

Supplemental evidence may remain opaque and non-authoritative.

---

# 3. Provider-native communication

## 3.1 Dependency stance

`pi-intercom` and `pi-claude-link` are accepted current dependencies/provider mechanisms for the interactive/external runtime path.

Do not rewrite them natively merely for ownership purity.

Before integration, inspect exact current source and installed/resolved identity.

Pin immutable package/version/commit identity where used in governed runtime behavior.

Keep dependency-specific logic behind adapter contracts.

Future native replacements must not change Channels semantics.

---

## 3.2 Preferred independent-session routing

Outside a governed ChainRun:

```text
Pi ↔ Pi
  pi-intercom

Claude ↔ Claude
  Claude native ListAgents / SendMessage / native wake

Claude ↔ Pi
  pi-claude-link

raw shell / vim / REPL / unsupported runtime
  tmux fallback
```

xtmux remains important for topology, navigation, observation, raw processes and fallback.

It is no longer the normal Claude/Pi semantic message bus.

---

## 3.3 Governed ChainRun boundary

Inside a ChainRun, semantic cooperation ALWAYS goes through Channels.

Provider-native messaging is transport only.

Correct external ingress:

```text
external Claude/Pi
  → native provider transport
  → ProviderIngressAdapter
  → authenticated identity binding
  → ingress authorization
  → ChannelCommunicationService
  → canonical ChannelMessage
  → ReplyObligation if required
  → SchedulerIntent / attention / wake
  → target participant
```

Wrong:

```text
external native transport
  → inject directly into ChainRun model
  → Channels never sees it
```

Wrong:

```text
chain participant
  → direct pi-intercom / Claude SendMessage
  → other ChainRun participant
```

Chain participants must not bypass Channels.

---

## 3.4 Provider adapter seam

Formalize the smallest useful generic seam.

Conceptually:

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

Expected bindings:

```text
DirectPiAgentSessionAdapter
PiIntercomAdapter
ClaudePeerAdapter
TmuxDeliveryAdapter
```

Future:

```text
ClaudeSdkActivationAdapter
```

Provider accepted:

```text
!= receiver received
!= injected/woken
!= processed
!= replied
```

Preserve explicit receipts and `uncertain`.

XTRM remains authority for:

```text
ChannelMessage
ReplyObligation
SchedulerIntent
FINALIZE
ChainRun
participant identity
authorization
semantic replay
```

---

# 4. Passive awareness

## 4.1 Distinguish two states

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
reply terminal → SchedulerIntent → resume/new activation
```

`PassiveAwareness`:

```text
participant continues foreground work
relevant peer messages may arrive
runtime surfaces them at safe provider/tool boundaries
no model-owned polling/watcher requirement
```

The model must not be responsible for remembering to run a watcher.

---

## 4.2 Attention policy

Passive awareness is governed by Channel semantics:

```text
routing hard
attention soft
authority hard
```

Only relevant attention is surfaced.

Do not inject every message into every participant.

Use:

```text
audience
action_targets
suggested_watchers
visibility
participant membership
step/ownership relevance
```

as inputs.

Provider-native busy delivery may safely queue/steer where characterized.

Do not apply legacy “never message a Working pane” rules to native transports merely because tmux injection required them.

---

# 5. Coordination-aware planning and execution

Research evidence from 2026 multi-agent coding studies is an input to design, not direct authority.

The convergent lesson to operationalize is:

```text
more agents != better
parallelism != coordination
prompted coordinator != structural coordinator
communication policy must fit task topology
```

Do not copy external frameworks wholesale.

---

## 5.1 ResolvedCoordinationPolicy

Do NOT add another durable lifecycle entity.

Add a resolved effective policy inside the approved/frozen chain, conceptually:

```text
ResolvedChain.effective.coordination
  participant_grouping
  max_useful_parallelism
  ownership_scopes
  interface_contract_refs
  attention_policy
  artifact_sharing_policy
  negotiation_requirements
  communication_policy
```

Use exact naming after reconciling existing schema.

Once the chain is frozen, effective coordination policy is frozen with it.

Runtime evidence may not silently rewrite participant grouping/topology.

A topology/grouping change requires the existing explicit revision path.

---

## 5.2 RepositoryCoordinationAnalysis

The pure compiler must not perform repository I/O/static analysis.

Planning may produce a deterministic evidence/artifact input such as:

```text
RepositoryCoordinationAnalysis
  work units
  file/module dependencies
  likely ownership groups
  high-coupling hubs
  cross-group interfaces
  parallel-safe regions
  estimated coupling / communication cost
```

Possible inputs may come from:

```text
GitNexus
Serena/LSP
repository dependency analysis
planning artifacts
explicit human/coordinator structure
```

The compiler consumes frozen inputs.

Do not make any one external analysis tool authority.

---

## 5.3 Coupling-aware partitioning principle

Avoid naive:

```text
all ready work
  → different participant
```

when those work units are tightly coupled.

The planner/compiler should minimize the conceptual trade-off:

```text
critical-path compute cost
+
cross-participant coordination cost
```

Do not implement Co-Coder/Infomap verbatim unless independently justified.

Begin with inspectable heuristics and measured evidence.

Participant grouping should keep tightly coupled decisions together where that reduces interface ambiguity, while still exposing useful parallelism.

---

## 5.4 Ownership and interface contracts

Extend step/participant contracts or evidence refs to express:

```text
ownership_scope
interface_contract_refs
affected_interface_refs
```

When a participant changes a shared/public interface, emit typed evidence:

```text
InterfaceChangeEvidence
  interface identity
  changed symbol/API/schema
  compatibility impact
  downstream affected owners/steps
  evidence refs
```

Then Channels may project attention to affected participants.

Do not rely on “remember to notify teammates”.

---

## 5.5 Messages vs artifacts

Do not mandate one communication medium universally.

Use:

```text
request / finding / proposal / challenge
  → ChannelMessage

large reusable semantic result
  → Evidence artifact

shared interface / plan / schema
  → durable artifact

attention / wake
  → Channel pointer/projection
```

Messages should normally be pointer-first:

```text
concise actionable summary
+
evidence/artifact refs
```

Do not duplicate large evidence payloads into repeated peer messages.

Artifact-sharing policy may differ by chain/task shape and should be measurable.

---

## 5.6 Agent count as policy

The planner must be allowed to choose:

```text
one participant
two cooperating participants
parallel independent advisors
cohesive workgroup
pipeline
```

Do not derive concurrency from the maximum number of available agents.

Do not spawn an agent merely because a step can technically be separated.

---

# 6. Coordination telemetry projection

Extend existing `xtrm.forensic.v1` / Eval projections rather than creating another authority store.

Represent a run as a temporal coordination graph.

Possible nodes:

```text
participants
files/artifacts
evidence objects
interfaces
```

Possible edges:

```text
participant → participant
  message/request/reply

participant → artifact
  write/publish

artifact → participant
  read/dereference

participant → interface
  change/claim
```

Carry:

```text
timestamp
kind
chain_run_id
step_id
bytes
token/cost estimate where available
```

Useful projections:

```text
message density
broadcast ratio
cross-participant edge count
cross-partition coupling
coordination token share
evidence reuse
artifact fan-out
participant degree distribution
wait/idle ratio
duplicate-work rate
unanswered obligation rate
interface-regression rate
```

This is observational/Eval state.

It must not become another scheduler or source of workflow truth.

---

# 7. Eval Core — coordination as first-class subject

Do not create a second Eval subsystem.

Extend current Eval Core with a coordination-policy subject/suite.

Conceptually:

```text
suite_kind: coordination
```

Keep fixed:

```text
task
model/provider
prompt/skills
runtime version
validation target
```

Vary:

```text
participant count
partition/grouping strategy
communication policy
passive awareness
artifact-sharing policy
review topology
```

Measure:

```text
task success
wall time
tokens/cost
coordination token share
repair loops
interface regressions
unanswered obligations
duplicate work
human intervention
recovery events
```

Do not promote adaptive coordination policy to authority from one successful run.

Repeated trials are required because coordination behavior is stochastic.

Record configuration distributions, not only one headline result.

---

# 8. Coordination failure taxonomy

Use the following as Eval/forensic categories, not new authority databases:

```text
communication
commitment
expectation
```

Communication examples:

```text
required request unanswered
stale/late message
repeated non-actionable status
incorrect coordination statement
high message cost with low actionable content
```

Commitment examples:

```text
claimed work not produced
promised interface differs from artifact
evidence-less completion claim
ownership/lease violation
```

Expectation examples:

```text
duplicate work
stale assumption about peer progress
work against superseded interface
question already answered by durable projection/evidence
```

Use existing Beads claims, Chain contracts, Channels and evidence as the underlying truth.

Do not invent a second “commitment store”.

---

# 9. Runtime lifecycle schemas

Normalize authority-bearing provider lifecycle facts through versioned runtime schemas.

At minimum consider:

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

Opaque provider debug payload may be retained inside a validated outer forensic envelope.

Reducers/schedulers must not derive authority from unvalidated provider blobs.

---

# 10. Documentation updates — mandatory

This programme must update canon as implementation decisions become concrete.

Do not leave them only in Beads/checkpoints or implementation comments.

## PRD

Update:

```text
docs/runtime/prd/native-chain-runtime.md
```

to include:

```text
Universal ResultEnvelope / ResolvedResultContract
Zod protocol + JSON Schema custom payload split
result_submit
agent_end != result
generic GateResult
generic EvidenceEnvelope
provider-native external ingress/egress
pi-intercom / pi-claude-link dependency stance
PassiveAwareness
ResolvedCoordinationPolicy
RepositoryCoordinationAnalysis input
coupling-aware participant grouping
messages-vs-artifacts policy
ownership/interface evidence
coordination temporal-graph projection
coordination-policy Eval Core suite
```

## ADR-004

Expand the existing result-contract decision with:

```text
dynamic JSON Schema payload contracts
schema freeze/hash/provenance
no specialist-name schema map
result_submit
generic GateResult
generic evidence contract
agent_end != result
```

## ADR-005

Add:

```text
external provider-native ingress/egress always translates through Channels
authenticated external participant binding
native provider receipt != semantic authority
PassiveAwareness distinct from WAITING_ON_CHANNEL
pointer-first message/artifact policy
```

Do not duplicate Channels internals.

## ADR-006

Update the external/interactive path:

```text
Pi interactive/external
  → pi-intercom adapter

Claude interactive
  → native cross-session adapter

Claude ↔ Pi
  → pi-claude-link bridge/provider adapter

tmux
  → topology/raw/fallback
```

Record provider adapters as preferred native delivery where characterized.

Direct hosted Pi AgentSession remains ActivationSupervisor-owned and does not need xtmux.

Future Claude SDK remains future/provider-parity work.

## ADR-001 / planning authority

If `ResolvedCoordinationPolicy` and coordination-analysis inputs affect authoring/compiler semantics, update ADR-001 rather than creating an unowned side document.

Record:

```text
coordination analysis is a compiler/planner input
compiler remains pure
resolved policy freezes with ResolvedChain
```

## Channels canon

Amend only if needed to make explicit:

```text
external native transport
  → authenticated ingress
  → ChannelMessage
  → SchedulerIntent / attention

PassiveAwareness
  != direct provider authority
```

## Eval docs

Update current Eval Core authority to include coordination-policy evaluation rather than creating another eval framework.

## Specialists docs

If `prompt.output_schema` becomes canonical JSON Schema, update the owning Specialists docs and schema comments.

---

# 11. Beads graph reconciliation

Read `xtrm-q99` before creating anything.

If equivalent work already exists, update/reconcile the existing child contracts.

Do not create duplicates.

Expected conceptual packets, only where missing:

```text
A  canon / ADR amendments
B  ResultEnvelope + ResultReceipt
C  ResolvedResultContract + JSON-Schema validator
D  result_submit
E  generic EvidenceEnvelope / evidence contract
F  generic GateResult / work.verdict projection
G  ActivationEvent normalization
H  ProviderIngress/Delivery adapter seam
I  pi-intercom adapter
J  Claude native / pi-claude-link adapter
K  PassiveAwareness runtime semantics
L  coordination analysis / ResolvedCoordinationPolicy contract
M  coordination forensic/Eval projection
N  generic q99 materialization/runtime wiring
O  SRE hard-coded-path retirement
P  full data-defined SRE E2E proof
```

Dependency graph must follow semantic prerequisites, not this alphabetical order.

Keep broader coupling-aware planning optimization bounded if it is not necessary to close q99.

At minimum q99 must leave the schema/seam correct so future planning work does not require an architecture rewrite.

---

# 12. Implementation sequencing

Preferred order:

```text
1. cold-start q99 + reconcile canon
2. result/event schemas
3. JSON-Schema validation + frozen result contracts
4. result_submit / evidence / generic gate
5. provider adapter seam
6. native interactive transports
7. PassiveAwareness
8. coordination policy contracts + telemetry hooks
9. generic materialization/runtime wiring
10. retire SRE hardcoding
11. real data-defined SRE run
12. exact-head independent review
```

Parallelize research/audit lanes freely.

Serialize writes to shared contracts, reducer/scheduler and canonical docs.

---

# 13. Mandatory result-contract acceptance

Prove at minimum:

1. Arbitrary custom Specialist `output_schema` executes without adding specialist-specific runtime code.
2. Valid custom payload → accepted persisted ResultEnvelope.
3. Invalid custom payload → typed rejection, zero accepted result, zero step satisfaction.
4. Schema hash deterministic across reload.
5. Schema drift after freeze fails closed.
6. No output_schema → documented opaque-payload fallback; reducer gains no custom semantic authority.
7. `expected_output_keys` compatibility deterministic.
8. `agent_end` without accepted result does not satisfy step.
9. Accepted result without required evidence does not satisfy step.
10. Accepted result + required evidence + clear FINALIZE may satisfy step.
11. Arbitrary custom gate Specialist routes PASS without name-specific code.
12. PARTIAL routes only bounded remediation.
13. FAIL routes fail path.
14. JSON-like final assistant prose without `result_submit` is non-authoritative.
15. Model cannot override host identity/contract authority from payload.

---

# 14. Mandatory provider/native messaging acceptance

Prove at minimum:

1. external Pi → native provider ingress → exactly one canonical ChannelMessage.
2. external Claude → native provider ingress → exactly one canonical ChannelMessage.
3. external required request → ReplyObligation → target delivery → reply → provider egress.
4. duplicate provider delivery → one semantic message.
5. provider queued/accepted != processed/replied.
6. crash before Channel commit → deterministic retry/reconciliation.
7. Channel commit + uncertain physical wake → durable semantic message + uncertain delivery state.
8. spoofed role/authority in message body cannot grant authority.
9. unknown external identity fails closed or enters an explicitly low-authority intake lane.
10. tmux fallback preserves semantic message identity.
11. native busy recipient may safely queue/steer according to provider capability.
12. adapter restart does not erase ChainRun semantic state.
13. multiple external requesters retain XTRM-exact correlation even if bridge-native waiter correlation is weaker.
14. ChainRun participant cannot bypass Channels with native provider messaging.

---

# 15. Mandatory PassiveAwareness acceptance

Prove:

1. participant can continue useful foreground work while attention is pending.
2. relevant message surfaces at safe runtime/provider boundary without model polling.
3. irrelevant watcher traffic is not injected.
4. passive attention does not satisfy ReplyObligation.
5. passive attention does not mutate chain readiness directly.
6. transition from PassiveAwareness to WAITING_ON_CHANNEL is explicit when progress becomes impossible.
7. provider reconnect/restart does not lose the underlying Channel message.
8. duplicate attention delivery remains idempotent.
9. native busy-recipient semantics do not interrupt an unsafe in-flight provider tool operation.
10. tmux fallback may degrade delivery latency but not semantic correctness.

---

# 16. Mandatory coordination-policy acceptance

At minimum prove contracts/tests for:

1. resolved coordination policy freezes with ResolvedChain.
2. compiler remains pure; repo analysis arrives as explicit input/artifact.
3. changing participant grouping after freeze requires revision.
4. tightly coupled work can be represented as one participant/workgroup instead of forced fan-out.
5. independent work can remain parallel.
6. max concurrency can be lower than available agent count.
7. ownership scopes are visible to runtime/context.
8. interface change produces typed evidence and targeted attention.
9. large artifact may be referenced instead of duplicated in messages.
10. coordination telemetry is projection-only and cannot drive authority directly.

Do NOT block q99 on proving an optimal graph-partitioning algorithm.

The immediate objective is to establish the correct contract and measurement seam.

---

# 17. End-to-end q99 acceptance

The milestone is not fingerprint parity.

Prove actual execution:

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

Requirements:

```text
no hard-coded SRE topology constructor
no generic scheduler branches on SRE role names
no prompt-only result/verdict authority
no specialist-name output-schema map
no direct provider-native bypass of Channels
no model-owned wait/monitor correctness
no tmux dependency for direct AgentSession correctness
```

Preserve the historical cognition-drift fail-closed proof separately.

Obtain one clean full data-defined successful terminal run as the complementary proof.

---

# 18. Independent review

Every substantive PR:

```text
fresh non-author reviewer
exact final head
cold-read Bead contract
read relevant canon
review complete diff
review tests
```

Verdict:

```text
PASS
PARTIAL
FAIL
```

PARTIAL/FAIL:

```text
repair
rerun validation
fresh exact-head review
```

Do not stop for remote ChatGPT after every Bead.

---

# 19. Continuous implementation mode

Normal loop:

```text
ready
→ claim
→ implement
→ validate
→ fresh review
→ repair
→ PASS
→ merge
→ close
→ refresh main
→ refresh Beads
→ next ready
```

Do not ask operator permission after each successful bounded Bead.

---

# 20. Escalate only when

Escalate if:

```text
current canon irreconcilably contradicts itself
a genuinely new first-class authority/entity is required
public schema/storage compatibility must break without authorized migration
q99 graph is materially invalid
two repair/re-review cycles fail on same architecture issue
provider behavior falsifies the assumed native transport model
JSON Schema requires unsafe/nondeterministic remote resolution
data-loss/replay guarantees cannot be achieved
canon explicitly reserves an operator decision
```

Do not escalate normal implementation naming, file layout, adapter plumbing or straightforward bugs.

---

# 21. Durable checkpoint

After each completed Bead record via current supported `bd remember` mechanism:

```text
bead
PR
merge SHA
exact-head review verdict
tests/evidence
docs/ADR updates
schemas/contracts
provider versions/commits exercised
coordination policy/eval changes
follow-ups
current q99 graph
next ready bead
known provider limitations
```

Cold-start successor must be able to resume from Git + Beads + canon alone.

---

# 22. Stop condition

Stop only when:

```text
A escalation fires
B all remaining q99 work is genuinely externally blocked
C documented q99 milestone gate reached
D graph requires operator approval
E q99 root completion contract satisfied
```

Do not stop because one PR merged.

---

# 23. Final success condition

At programme completion we must be able to say truthfully:

1. Custom Specialists require no new XTRM result-schema code.
2. Runtime protocol events are typed and validated.
3. Prompt prose/JSON is not runtime authority.
4. Custom result/evidence payloads validate against frozen dynamic JSON Schemas.
5. Gate semantics are generic.
6. `agent_end` is lifecycle evidence, not result authority.
7. Pi/Claude native messaging is preferred transport where characterized.
8. External participants can reach ChainRun participants without bypassing Channels.
9. `PassiveAwareness` lets participants keep working while remaining reachable.
10. tmux remains topology/raw/fallback infrastructure, not normal Claude/Pi message correctness.
11. Participant count/grouping and communication policy are explicit resolved policy, not prompt folklore.
12. Coordination cost/topology is observable through existing forensic/Eval projections.
13. The SRE chain executes end-to-end from data-defined topology through the generic runtime and terminalizes correctly.
