# PRD — Native Interactive XTRM Specialists for Pi and Claude Code

**Status:** Draft v0.3  
**Date:** 2026-09-06  
**Owner:** `xtrm-dev/specialists`  
**Primary execution runtime:** Pi `AgentSession`  
**Primary coordinator surface:** Pi extension  
**Secondary coordinator surface:** Claude Code plugin/MCP integration  
**Working product name:** Specialist Fleet / `specialist-subagents`

---

# 1. Executive summary

XTRM Specialists should become first-class, persistent, interactive subagents inside normal coding-agent sessions.

Today, the Specialist runtime already contains significant value:

- layered `*.specialist.json` definitions;
- `SpecialistLoader`;
- model and fallback configuration;
- skills;
- mandatory rules;
- output schemas and required output keys;
- capability/tool policy;
- execution extensions;
- Beads integration;
- permission tiers;
- timeout/stall policy;
- retry behavior;
- observability and forensic persistence;
- worktree and lifecycle machinery.

However, in normal interactive work, especially large Mercury development sessions, Specialists are underused because invoking one remains operationally separate from the coordinator's active session.

The operator or coordinator often falls back to:

```text
generic Pi subagent
manual sp run
xt-launched Pi session
independent Pi session
Claude-native subagent
doing the task directly
```

The objective of this work is to remove that friction.

A coordinator should be able to dispatch a real configured XTRM Specialist directly:

```text
Pi coordinator
    ↓
specialist_delegate(...)
    ↓
real SpecialistLoader definition
    ↓
real native Pi AgentSession
```

and, separately:

```text
Claude Code coordinator
    ↓
specialist_delegate(...)
    ↓
same Specialists runtime
    ↓
real native Pi AgentSession
```

The Specialist remains:

- persistent;
- interactive;
- resumable;
- Bead-backed;
- capability-governed;
- lease-governed;
- observable;
- forensic;
- inspectable;
- compatible with future XTRM Chain execution.

The extension is not a wrapper around `sp run`.

It is the first production user of the intended native Specialist activation runtime.

---

# 2. Product thesis

The core product is not the TUI Fleet itself.

The core product is:

> A canonical native Specialist activation runtime that can be invoked by multiple coordinator surfaces while preserving one execution model, one authority model, one interaction protocol, and one forensic model.

The target shape is:

```text
                         COORDINATOR SURFACES

              ┌──────────────┬──────────────┐
              │              │              │
              ▼              ▼              ▼
           Pi session     Claude Code    future XTRM
              │              │
              │              │
        Pi extension     Claude plugin
              │              │
              └──────┬───────┘
                     ▼
              ActivationRequest
                     ▼
                DispatchGate
                     ▼
              SpecialistLoader
                     ▼
       SpecialistActivationProfile
                     ▼
                StepContract
                     ▼
              WorkspaceLease
                     ▼
           NativeActivationHost
                     ▼
               Pi AgentSession
                     ▼
              XTRM Specialist
                     │
         ┌───────────┼────────────┐
         │           │            │
         ▼           ▼            ▼
    interaction    result      lifecycle
         │           │            │
         └───────────┼────────────┘
                     ▼
             normalized runtime
                /           \
               ▼             ▼
       observability.db    Fleet/UI
```

Future XTRM Chains should invoke the same `NativeActivationHost`.

---

# 3. Goals

The implementation must allow a coordinator to:

1. dispatch a real XTRM Specialist from inside Pi;
2. dispatch the same real Pi Specialist from Claude Code;
3. avoid `sp run` as the normal interactive path;
4. avoid launching an `xt` terminal/session merely to obtain a Specialist;
5. use the effective layered Specialist definition from `SpecialistLoader`;
6. require a real dispatchable Bead for tracked work;
7. prevent free-form prompt text from silently supplementing an incomplete Bead;
8. derive a bounded activation-specific `StepContract`;
9. keep child Specialist sessions persistent;
10. attach interactively to any child Specialist;
11. return to the parent coordinator without killing the child;
12. allow parent→child guidance;
13. allow child→parent questions;
14. allow child→parent clarification requests;
15. allow child→parent progress updates;
16. allow child→parent findings;
17. allow child→parent escalations;
18. keep the child alive while waiting for an answer;
19. support resuming a settled Specialist;
20. allow model override per activation;
21. use the coordinator's current worktree by default;
22. enforce exactly one active writer per mutable workspace;
23. allow arbitrary read-only Specialists to coexist;
24. fence the coordinator from mutation while a child owns the writer lease;
25. preserve all applicable current Specialist runtime behavior;
26. preserve `observability.db`;
27. preserve forensic lineage;
28. preserve retry/compaction/stall/result evidence;
29. expose a compact Specialist Fleet UI;
30. provide an adapted `using-specialists` operating skill;
31. provide self-documenting tool descriptions and API docstrings;
32. provide a Claude Code plugin/MCP integration;
33. provide asynchronous Specialist→Claude events;
34. optionally register live Specialists in Claude Code's agent/session roster using a `pi-claude-link`-style adapter;
35. reuse the same native activation runtime from future XTRM Chains.

---

# 4. Non-goals

v0 does not implement:

```text
full XTRM Chain scheduler
automatic Chain selection
automatic Chain topology generation
full ResolvedChain lifecycle
Substrate daemon
Substrate state-store cutover
native Substrate Issue persistence
lazy Substrate step-issue creation
eager Substrate step-issue creation
seed containers
epic runtime
wave runtime
node runtime
automatic independent worktree provisioning per Specialist
automatic merge
automatic publish
multi-host Specialist runtime
networked Specialist transport
replacement for pi-intercom
replacement for pi-claude-link
replacement for XTRM Channels
replacement for Beads
Claude-native Specialist reimplementation
```

The extension must not grow into a second workflow engine.

---

# 5. Architectural principles

The following are hard design principles.

```text
A Specialist is a persistent typed participant, not a disposable prompt.

SpecialistLoader is authoritative for the effective Specialist.

A Bead is authoritative tracked work.

A StepContract bounds one activation.

A StepContract is not a second durable work item.

Substrate step-issues remain deferred.

The current worktree is shared by default.

Many readers may coexist.

Exactly one writer may mutate one workspace at a time.

The coordinator is also subject to the writer lease.

AgentSession lifetime is longer than writer-lease lifetime.

A resumed writer must reacquire mutation authority.

Clarification is normal lifecycle, not failure.

Escalation is normal lifecycle, not failure.

Communication does not grant authority.

Interaction messages are not activation results.

Transport does not define semantic meaning.

Same-process AgentSessions use direct transport.

Independent Pi peers may use pi-intercom.

Claude coordination uses the Claude integration adapter.

Claude roster registration is a secondary adapter, not activation authority.

observability.db remains authoritative runtime forensics.

The Fleet is a projection, not durable truth.

The extension is not a scheduler.

Future Chains consume the same NativeActivationHost.
```

---

# 6. Repository ownership

The extension belongs in `xtrm-dev/specialists`.

There is no reason to place the Specialist activation runtime in Core.

Recommended repository shape:

```text
specialists/
├── src/
│   ├── activation/
│   │   ├── request.ts
│   │   ├── profile.ts
│   │   ├── compiler.ts
│   │   ├── step-contract.ts
│   │   ├── dispatch-gate.ts
│   │   ├── materialize.ts
│   │   ├── native-host.ts
│   │   ├── registry.ts
│   │   ├── lineage.ts
│   │   ├── result.ts
│   │   └── lifecycle.ts
│   │
│   ├── interaction/
│   │   ├── protocol.ts
│   │   ├── messages.ts
│   │   ├── transport.ts
│   │   ├── direct-session.ts
│   │   ├── intercom-adapter.ts
│   │   ├── claude-channel-adapter.ts
│   │   ├── claude-peer-adapter.ts
│   │   └── attention.ts
│   │
│   ├── workspace/
│   │   ├── identity.ts
│   │   ├── mutation-class.ts
│   │   ├── lease.ts
│   │   ├── lease-store.ts
│   │   ├── lease-guard.ts
│   │   └── reconcile.ts
│   │
│   └── forensics/
│       ├── event-types.ts
│       ├── agent-session-adapter.ts
│       ├── activation-writer.ts
│       └── projections.ts
│
├── config/
│   ├── pi-extensions/
│   │   └── specialist-subagents/
│   │       └── index.ts
│   │
│   └── skills/
│       └── using-specialists/
│           └── SKILL.md
│
└── integrations/
    └── claude-code/
        ├── plugin/
        │   ├── .claude-plugin/
        │   │   └── plugin.json
        │   ├── .mcp.json
        │   └── skills/
        │       └── using-specialists/
        │           └── SKILL.md
        └── server/
            └── specialist-mcp.ts
```

A small generic Core UI/footer composition seam may be consumed if needed for exact rendering placement.

That does not change ownership.

---

# 7. Canonical object model

The implementation should preserve the current XTRM distinction among role, activation and physical session.

```text
SpecialistDefinition
        ↓
SpecialistLoader
        ↓
SpecialistActivationProfile
        ↓
StepContract
        ↓
Activation
        ↓
Attempt
        ↓
Pi AgentSession
```

Identity layers:

```text
participant_id
    stable logical participant identity

activation_id / job_id
    one activation of that participant

attempt_id
    one retry/recovery attempt

pi_session_id
    physical Pi session
```

The Pi session ID is correlation metadata.

It is not durable Specialist identity.

---

# 8. Specialist resolution

The native path must use the existing `SpecialistLoader`.

Conceptually:

```ts
const specialist = await loader.get(name);
```

The extension must preserve the effective layered configuration contract.

At minimum:

```text
package canonical Specialist
global user override
repo default override
repo user Specialist override
blocked override rules
allowed override semantics
model
fallback model(s)
timeout
stall timeout
max retries
interactive flag
thinking level
response format
output type
permission tier
requires_worktree
auto_commit
extensions
expected output keys
system prompt
system_prompt_mode
task template
output schema
skill inheritance
skills.paths
scripts
required tools
external commands
validation rules
mandatory rule template sets
mandatory inline rules
permission policy
notes behavior
Beads integration
output file behavior
```

Do not create a simplified second Specialist resolver.

---

# 9. Specialist feature parity matrix

Before implementation enables production writer Specialists, produce a durable feature matrix.

For every relevant Specialist field or runtime feature record:

```text
feature
current owner
current behavior
native implementation path
status
test
```

Allowed status:

```text
native
adapted
deferred
rejected
```

No feature is silently ignored.

Examples:

```text
execution.model
    native

mandatory_rules
    native/shared resolver

skills.paths
    native/adapted

skills.scripts
    adapted host execution

output_schema
    native validation

expected_output_keys
    native validation

auto_commit
    adapted to native activation lifecycle

legacy process-only option
    explicitly deferred/rejected
```

A production Specialist activation should be able to report its feature compatibility profile when debugging.

---

# 10. Primary Pi dispatch API

Primary model-facing tool:

```ts
specialist_delegate({
  specialist: "researcher",
  bead: "ISSUE-58",
  model?: "provider/model"
})
```

Do not expose arbitrary task text for tracked work.

Invalid:

```ts
specialist_delegate({
  specialist: "executor",
  bead: "ISSUE-58",
  task: "also rewrite the unrelated auth cache"
})
```

If tracked work is missing required information, the Bead must be fixed.

---

# 11. Dispatch request

Conceptual type:

```ts
interface ActivationRequest {
  specialist: string;
  beadId: string;
  modelOverride?: string;

  requestedByParticipantId: string;
  coordinatorSessionId?: string;

  workspaceHint?: WorkspaceIdentity;

  transportContext?: ParticipantTransportContext;
}
```

The request should remain independent of TUI state.

Future schedulers must be able to construct the same request.

---

# 12. Bead dispatch gate

The current Bead remains the authoritative tracked-work contract.

Before AgentSession creation:

```text
resolve Bead
    ↓
read contract state
    ↓
validate ready
    ↓
validate required sections
    ↓
validate SCRUTINY
    ↓
resolve Specialist
    ↓
compile activation policy
    ↓
validate external prerequisites
    ↓
resolve workspace
    ↓
evaluate mutation class
    ↓
acquire lease if writer
    ↓
admit activation
```

Current mandatory compatibility contract:

```text
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

Where applicable, SCRUTINY is also required.

Reject:

```text
contract:draft
missing sections
TBD placeholders that make dispatch ambiguous
invalid contract state
invalid SCRUTINY
unknown Specialist
invalid Specialist resolution
missing required external command
missing required extension/tool
unresolvable workspace
writer lease conflict
workspace uncertain
```

---

# 13. Dispatch refusal

A refusal is structured.

Example:

```text
SPECIALIST_DISPATCH_REJECTED

bead:
  ISSUE-58

specialist:
  executor

reason:
  contract_not_ready

missing:
  - VALIDATION
  - OUTPUT

AgentSession:
  not created
```

Or:

```text
SPECIALIST_DISPATCH_REJECTED

reason:
  workspace_lease_held

workspace:
  ~/dev/mercury/website

holder:
  participant executor
  activation act:123

requested:
  debugger
```

Every refusal is forensic.

---

# 14. No prompt smuggling

Tracked work must never use free-form delegation text to compensate for bad durable work.

Forbidden behavior:

```text
Bead incomplete
    ↓
delegate anyway
    ↓
explain missing scope in tool argument
```

Required:

```text
Bead incomplete
    ↓
update Bead
    ↓
dispatch
```

The adapted `using-specialists` skill must state this explicitly.

---

# 15. StepContract

A typed `StepContract` is produced for one activation.

Conceptual shape:

```ts
interface StepContract {
  rootWorkRef: string;

  mandate: string;

  inputs: EvidenceRef[];

  outputs: OutputRequirement[];

  scope: ScopeContract;

  nonGoals: string[];

  constraints?: string[];

  validation?: ValidationRequirement[];

  provenance: {
    specialist: string;
    generatedAt: number;
    sourceBeadRevision?: string;
  };
}
```

Compilation inputs:

```text
ready root Bead
SpecialistDefinition
participant role
current evidence
workspace
known runtime state
```

The StepContract narrows the root work to this Specialist's role.

---

# 16. Prompt composition

Child context should be layered, not blobbed.

Target:

```text
GLOBAL RULES

ROLE RULES
    "You are the executor..."
    "You are the reviewer..."

ROOT WORK CONTRACT
    complete Bead contract

STEP CONTRACT
    bounded activation mandate

CURRENT EVIDENCE
    relevant inputs/results

INTERACTION CONTEXT
    relevant coordinator/participant messages
```

The Specialist must not infer:

```text
which role it is
what root work it serves
what bounded mandate applies
which outputs are required
```

---

# 17. Deferred Substrate step-issues

This extension does not create native Substrate step-issues.

Current interactive flow:

```text
ready Bead
    ↓
derived StepContract
    ↓
Activation
```

Future Chain flow:

```text
ChainSource
    ↓
ChainDefinition
    ↓
ResolvedChain
    ↓
materializer
    ↓
step work item
    ↓
StepContract
    ↓
Activation
```

The extension must not invent:

```text
fake Container
fake ResolvedChain
fake step Issue
fake dependency graph
```

merely because an interactive Specialist exists.

---

# 18. NativeActivationHost

The shared runtime primitive should look conceptually like:

```ts
interface NativeActivationHost {
  start(
    request: ActivationRequest
  ): Promise<ActivationHandle>;

  resume(
    activationId: string,
    input: ParticipantInput
  ): Promise<void>;

  steer(
    activationId: string,
    input: ParticipantInput
  ): Promise<void>;

  stop(
    activationId: string,
    reason?: string
  ): Promise<void>;

  inspect(
    activationId: string
  ): Promise<ActivationSnapshot>;
}
```

The TUI extension and Claude integration both call this library.

Neither should invoke the legacy CLI.

---

# 19. AgentSession hosting

Use public Pi SDK APIs.

Required child capabilities:

```text
createAgentSession
subscribe
prompt
steer
followUp
abort
dispose
message history
session identity
model identity
extension binding
```

The child should use the same Pi model runtime, settings and resource-loading patterns already proven by the native AgentSession experiment and current subagent implementations.

---

# 20. Persistent session semantics

Do not implement:

```text
dispatch
→ one answer
→ dispose child
```

Implement:

```text
dispatch
→ AgentSession created
→ child works
→ child settles/waits
→ session stays alive
→ child can receive another message
→ same conversation resumes
```

A child is disposed only by:

```text
explicit stop/dispose
parent shutdown policy
governed cleanup policy
fatal unrecoverable runtime condition
explicit supersession
```

not merely because one turn completed.

---

# 21. Activation lifecycle

Conceptual lifecycle:

```text
requested
    ↓
admission
    ↓
starting
    ↓
running
    ├─ progress message
    ├─ finding message
    ├─ clarification
    ├─ escalation
    ├─ retry
    ├─ waiting
    └─ result candidate
```

Possible participant presentation states:

```text
starting
running
waiting
needs_reply
escalated
settled
stopping
stopped
failed
uncertain
```

Presentation state is not necessarily durable workflow state.

---

# 22. `agent_end` / settled semantics

The implementation must distinguish:

```text
model turn stopped
agent settled
activation completed
activation accepted
```

These are not equivalent.

A child may reach a Pi quiescence boundary and remain resumable.

The runtime should use the relevant Pi session event as the normal governed waiting/settled barrier, while retaining the richer Specialists lifecycle above it.

---

# 23. Interaction is a runtime requirement

A Specialist may communicate while still active.

Required semantic message kinds:

```text
finding
progress_update
question
clarification_required
escalation
status
reply
```

Examples:

```text
"The Bead is ambiguous between option A and B."

"The implementation moved from package X to Y."

"I need operator approval before changing this migration."

"I found an out-of-scope vulnerability."

"The requested API does not exist in the current dependency."

"I need the expected backward-compatibility behavior."
```

The child must not terminate simply to report these.

---

# 24. Participant protocol

XTRM Specialists should own a transport-independent semantic protocol.

Conceptual type:

```ts
type ParticipantEvent =
  | InteractionMessage
  | ActivationResultEvent
  | LifecycleEvent
  | AuthorityEvent;
```

Interaction message:

```ts
interface InteractionMessage {
  id: string;

  from: ParticipantId;
  to: ParticipantId;

  kind:
    | "finding"
    | "progress_update"
    | "question"
    | "clarification_required"
    | "escalation"
    | "status"
    | "reply";

  body: string;

  replyTo?: string;

  createdAt: number;

  metadata?: Record<string, unknown>;
}
```

---

# 25. Message delivery metadata

The protocol should be able to carry:

```text
stable message ID
sender sequence where useful
sender timestamp
host receive timestamp
delivery timestamp
recipient receive timestamp
injection timestamp
reply_to
supersedes
retry_of
delivery state
```

Not every transport must support every field immediately.

The semantic model should not prevent future parity.

---

# 26. Interaction versus authority

Peer content is not authority.

A Specialist message cannot:

```text
grant writer lease
expand Bead scope
approve destructive work
override NON_GOALS
skip required validation
change SCRUTINY
change Specialist capability grant
approve its own result
```

The runtime must preserve this distinction.

---

# 27. Transport abstraction

Conceptual interface:

```ts
interface ParticipantTransport {
  send(
    message: InteractionMessage
  ): Promise<DeliveryReceipt>;

  reply(
    message: InteractionMessage
  ): Promise<DeliveryReceipt>;

  cancel?(
    messageId: string
  ): Promise<CancellationReceipt>;

  close?(): Promise<void>;
}
```

Transport choice depends on participant topology.

---

# 28. Transport selection

Target:

```text
same-host parent Pi ↔ child Specialist
    DirectSessionTransport

independent Pi ↔ Specialist
    PiIntercomTransport

Specialist runtime → Claude coordinator async event
    ClaudeMcpChannelTransport

Claude direct peer messaging ↔ Specialist
    ClaudePeerTransport
```

All normalize to the same semantic participant protocol.

---

# 29. Direct AgentSession transport

For the main Pi extension, parent and child share one host.

Do not send messages through an IPC broker.

Use direct process-local delivery.

Parent→child:

```text
Coordinator AgentSession
        ↓
InteractionMessage
        ↓
NativeActivationHost
        ↓
Specialist AgentSession
```

Child→parent:

```text
Specialist AgentSession
        ↓
InteractionMessage
        ↓
NativeActivationHost
        ↓
Coordinator AgentSession
```

---

# 30. Direct delivery semantics

If target is idle:

```text
deliver
→ trigger next participant turn
```

If target is busy:

```text
deliver at safe steer/follow-up boundary
→ do not abort active tool call
```

If target is settled:

```text
retain as resumable pending input
→ resume session
```

If target is unavailable:

```text
return explicit delivery failure
```

No silent message loss.

---

# 31. Child supervisor tools

Every child should receive a host-owned communication tool.

Conceptually:

```ts
specialist_message({
  kind: "finding",
  message: "..."
})
```

and a blocking/decision-oriented path:

```ts
specialist_request({
  kind: "clarification_required",
  message: "..."
})
```

The child does not need raw session IDs.

The runtime injects the coordinator target.

---

# 32. `send` versus blocking request

The semantic distinction should mirror the useful `pi-intercom` pattern.

Use non-blocking send for:

```text
progress update
finding that does not block work
status
non-blocking heads-up
```

Use blocking request for:

```text
clarification
scope decision
operator decision
approval requirement
material ambiguity
```

Blocking request:

```text
send request
    ↓
mark pending
    ↓
child waits
    ↓
reply correlated
    ↓
child continues
```

Do not treat normal completion as a blocking intercom request.

---

# 33. Pending asks

The runtime should track unresolved blocking requests.

At minimum:

```text
message_id
activation
sender
recipient
kind
created_at
delivery state
resolved_at
reply_id
```

This allows:

```text
which Specialist is waiting?
why?
which question?
was it answered?
```

---

# 34. Reply semantics

A reply must correlate to a specific request when possible.

Conceptually:

```ts
specialist_message({
  activation: "act:123",
  replyTo: "msg:456",
  message: "Use backward-compatible format."
})
```

UI sugar may infer the only pending request.

The underlying protocol should preserve explicit correlation.

---

# 35. Cancellation and supersession

Not mandatory for the first minimal release, but the semantic model should allow:

```text
cancel message
supersede message
retry message
```

because a request may already have been injected.

Cancellation must never falsely claim that already-observed peer input was erased.

This is explicitly a later-capability seam, not a v0 launch blocker.

---

# 36. Pi Intercom adapter

`pi-intercom` is not required for same-process children.

It remains the correct adapter for:

```text
independent Pi peer
another project Pi session
external Pi researcher
external Pi reviewer
```

The adapter should map:

```text
XTRM InteractionMessage
    ↔
pi-intercom send/ask/reply semantics
```

without adopting the intercom wire schema as XTRM's ontology.

---

# 37. ActivationResult

Completion is not a normal interaction message.

Conceptual result:

```ts
interface ActivationResult {
  activationId: string;
  participantId: string;
  attemptId: string;

  beadId: string;

  status:
    | "completed"
    | "failed"
    | "uncertain";

  output: unknown;

  validation: {
    valid: boolean;
    schema?: string;
    errors?: string[];
  };

  evidenceRefs: EvidenceRef[];

  piSessionId: string;

  configuredModel?: string;
  resolvedModel: string;

  completedAt: number;
}
```

---

# 38. Result lifecycle

When a Specialist settles with a result candidate:

```text
AgentSession settles
    ↓
capture candidate output
    ↓
validate response format
    ↓
validate JSON/schema if required
    ↓
validate expected output keys
    ↓
run applicable post-execution logic
    ↓
persist result evidence
    ↓
update activation state
    ↓
release/reconcile lease
    ↓
emit result notification
```

A normal message does not perform these transitions.

---

# 39. Result notification

A coordinator may receive:

```text
executor completed ISSUE-58
activation: act:123
result: validated
```

through the same transport system.

That notification is a projection/reference.

The real result remains `ActivationResult`.

---

# 40. Clarification lifecycle

Preferred flow:

```text
Specialist running
    ↓
clarification_required
    ↓
send blocking InteractionMessage
    ↓
waiting_for_reply
    ↓
release writer lease if currently safe to do so
    ↓
remain alive
    ↓
coordinator replies
    ↓
resume same AgentSession
    ↓
reacquire writer lease if necessary
```

A Specialist requesting clarification is not dead and is not failed.

---

# 41. Contract-changing clarification

The coordinator must determine whether the answer changes durable work.

If the answer changes:

```text
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

then:

```text
update Bead
    ↓
persist updated contract
    ↓
refresh child contract context
    ↓
reply
```

If the answer only clarifies an interpretation already inside the contract:

```text
reply directly
```

Free-form interaction must not silently rewrite durable authority.

---

# 42. Escalation lifecycle

Escalation examples:

```text
insufficient permission
destructive action required
scope contradiction
security concern
irreversible decision
contract inconsistency
uncertain mutation
blocked dependency
```

Flow:

```text
Specialist
    ↓
escalation
    ↓
coordinator
    ↓
operator / durable contract / authority decision
    ↓
reply
    ↓
resume / stop / supersede
```

Escalation is not synonymous with failure.

---

# 43. Workspace behavior

The default workspace is the coordinator's current worktree.

Do not automatically provision a new worktree for a write-capable child.

Default:

```text
Coordinator
  ~/dev/mercury/website

researcher
  same worktree · READ

reviewer
  same worktree · READ

executor
  same worktree · WRITE lease
```

Independent worktrees are a higher-level decomposition concern.

---

# 44. Workspace identity

Conceptual:

```ts
interface WorkspaceIdentity {
  repositoryRoot: string;
  gitCommonDir?: string;
  worktreePath: string;
  branch?: string;
}
```

Worktree path is the mutation domain.

Two linked Git worktrees sharing one common repo are distinct mutable workspaces.

---

# 45. Writer classification

Do not hardcode:

```text
executor = writer
```

Instead:

```text
SpecialistDefinition
    ↓
resolved capability grant
    ↓
resolved tool/effect authority
    ↓
WorkspaceAccess
```

Conceptual:

```ts
type WorkspaceAccess =
  | "read"
  | "write";
```

Typical result:

```text
explorer
    read

researcher
    read

reviewer
    read

seconder
    read

executor
    write

debugger
    write

test-engineer
    write when authoring

custom Specialist
    derived
```

---

# 46. Mutation classification

Writer determination must consider more than native tool names.

Potential mutation sources:

```text
Edit
Write
mutating Bash
custom extension tool
filesystem MCP tool
git mutation
generated code tool
other trusted extension effect
```

The existing Specialist capability policy should be reused to resolve mutation authority.

---

# 47. Workspace writer lease

Adopt the Substrate-designed invariant.

```text
N readers
+
maximum 1 writer
```

Conceptual lease:

```ts
interface WorkspaceLease {
  workspaceId: string;

  holderParticipantId: string;
  holderActivationId: string;
  holderAttemptId?: string;

  acquiredAt: number;

  generation: number;

  state: "leased";
}
```

Free means no active lease object or explicit free state.

---

# 48. WorkspaceLeaseStore

Required interface:

```ts
interface WorkspaceLeaseStore {
  inspect(
    workspace: WorkspaceIdentity
  ): Promise<LeaseState>;

  acquire(
    request: LeaseAcquireRequest
  ): Promise<LeaseAcquireResult>;

  release(
    request: LeaseReleaseRequest
  ): Promise<LeaseReleaseResult>;

  markUncertain(
    request: LeaseUncertainRequest
  ): Promise<void>;

  reconcile(
    workspace: WorkspaceIdentity
  ): Promise<LeaseReconciliationResult>;
}
```

This abstraction is intentionally compatible with a future Substrate-backed implementation.

---

# 49. Lease acquisition

Before a write-capable activation starts:

```text
validate Bead
    ↓
resolve Specialist
    ↓
resolve workspace
    ↓
resolve mutation class
    ↓
inspect lease
    ↓
atomic acquire
    ↓
start AgentSession
```

If the lease cannot be acquired:

```text
do not start the writer AgentSession
```

For v0:

> fail loudly rather than silently queueing a second writer.

Writer queuing belongs to future Chain scheduling.

---

# 50. Second-writer refusal

Example:

```text
WORKSPACE_LEASE_HELD

workspace:
  ~/dev/mercury/website

holder:
  participant: executor
  activation: act:123

requested:
  participant: debugger

result:
  dispatch rejected

read-only dispatch:
  still allowed
```

This refusal must be durable in `observability.db`.

---

# 51. Coordinator participation in the lease

The coordinator is also a potential writer.

While a child owns the lease:

```text
Coordinator

Read
    allowed

Grep
    allowed

Find
    allowed

Git status/diff inspection
    allowed

Edit
    denied

Write
    denied

mutating Bash
    denied

mutating extension call
    denied
```

A delegated child cannot race the coordinator.

---

# 52. Lease enforcement — active tool surface

When a child writer acquires the lease:

```text
parent mutation-capable tools
    ↓
temporarily deactivate/remove
```

When lease releases:

```text
restore prior resolved active tool set
```

The implementation should integrate with existing Specialists/Pi tool-selection mechanisms.

---

# 53. Lease enforcement — hard tool-call guard

Tool-set changes alone are insufficient.

Every mutation attempt must pass a lease guard.

Conceptually:

```ts
onToolCall(event) {
  if (!isMutating(event)) return;

  const lease = inspectWorkspaceLease();

  if (!callerOwnsLease(lease)) {
    return {
      block: true,
      reason: "workspace writer lease held by another participant"
    };
  }
}
```

This protects current-turn timing gaps.

---

# 54. Lease enforcement — extension effects

Explicitly enabled extension tooling does not bypass the lease.

If an extension effect mutates the leased workspace, it must be fenced by the same authority decision.

The implementation should avoid a model where only `Edit`/`Write` are protected while custom mutation remains unrestricted.

---

# 55. Lease lifetime

A Specialist session is not equivalent to a lease.

```text
AgentSession
    ────────────────────────────────────────

Writer lease
        ────────        ─────────
```

A writer acquires only when it needs mutation authority.

At the governed waiting/quiescence boundary it releases the lease.

The AgentSession may remain alive.

---

# 56. Resume and lease reacquisition

Later:

```text
existing executor AgentSession
    ↓
new instruction
    ↓
writer turn required
    ↓
acquire workspace lease
```

If free:

```text
resume
```

If held by another writer:

```text
do not start mutation turn
surface conflict
```

Never silently restore stale authority.

---

# 57. Writer clarification and lease release

If a writer blocks on clarification:

```text
writer encounters ambiguity
    ↓
sends clarification request
    ↓
reaches safe waiting boundary
    ↓
releases lease
    ↓
waits alive
```

The coordinator or another sequential writer may then obtain mutation authority.

When the original child resumes it must reacquire.

---

# 58. Crash semantics

A disappeared PID/session does not prove the workspace is safe.

If a writer disappears while mutation outcome is unclear:

```text
leased
    ↓
writer disappears
    ↓
uncertain
    ↓
reconcile
```

Do not simply:

```text
PID absent
→ lease free
```

---

# 59. Uncertain reconciliation

Reconciliation should be able to inspect at least:

```text
activation forensic events
tool/effect events
git/worktree state
known session termination evidence
lease generation
last successful durable boundary
```

Possible outcomes:

```text
safe_free
recovered_holder
superseded
manual_attention_required
```

The exact reconciliation engine may start simple, but blind clearing is forbidden.

---

# 60. Model override

A coordinator may override the configured Specialist model for one activation.

Example:

```ts
specialist_delegate({
  specialist: "overthinker",
  bead: "unitAI-123",
  model: "openai/gpt-5.6"
})
```

The Specialist remains the same Specialist.

---

# 61. Model resolution precedence

Preferred precedence:

```text
explicit activation model override
    ↓
effective configured Specialist model
    ↓
configured fallback behavior
```

The runtime must reuse current Specialist model resolution where possible.

---

# 62. Model override validation

Before session creation:

```text
model exists in Pi registry
provider available
auth available
runtime supports model
thinking configuration compatible
required execution capability compatible
```

Explicitly requested unavailable model:

```text
dispatch rejected
```

Do not silently replace it.

---

# 63. Model fallback with override

Explicit override and fallback are separate decisions.

Example:

```text
configured primary = A
configured fallback = B
override = C
```

Initial model must be C.

Recommended v0 fallback behavior:

```text
C unavailable before start
    → reject

C starts but later triggers existing recoverable model failure
    → configured fallback policy may apply
      only if activation fallback policy permits
```

Do not invent a complex new fallback DSL.

An optional future field may be:

```ts
fallback: "configured" | "none"
```

---

# 64. Model picker

Any interactive model picker should use Pi's live model registry.

Do not maintain a hard-coded model list.

Desired UI:

```text
Model

> configured · anthropic/...
  openai/...
  ...
```

---

# 65. Model override forensics

Persist:

```text
configured_model
resolved_model
model_override
override_source
fallback_used
```

A forensic query must be able to answer:

```text
what was configured?
what actually ran?
was it overridden?
did fallback occur?
```

---

# 66. Specialist Fleet UI

Native children should appear persistently beneath the coordinator area.

Desired order:

```text
prompt/editor
XTRM statusline
Specialist Fleet
```

Example:

```text
› Message coordinator…

xtrm ~/mercury/website(feature/oauth)   61%/200k   gpt-5.6

SPECIALISTS · 3
  ● executor     ISSUE-58   editing callback.ts      1m42s · WRITE
> ! researcher   ISSUE-92   needs reply                52s · READ
  ✓ reviewer     ISSUE-58   settled                    31s · READ

↑↓ select · Enter attach · m message · x stop · Esc coordinator
```

Keep visual noise low.

---

# 67. Fleet state

Presentation vocabulary:

```text
starting
running
waiting
needs_reply
escalated
settled
stopping
stopped
failed
uncertain
```

Markers should make attention states obvious.

Example:

```text
● running
! needs attention
✓ settled
× failed
? uncertain
```

Exact glyphs are implementation detail.

---

# 68. Fleet navigation

Recommended behavior copied from proven Pi interaction patterns.

When editor has content:

```text
arrow keys remain editor controls
```

When editor is empty:

```text
Down or Left
    activate Fleet focus
```

Fleet:

```text
Up / Down
j / k
    select

Enter
    attach

Esc
    return
```

Avoid global key hijacking.

---

# 69. Attach view

`Enter` opens the real child session view.

Example:

```text
┌ executor · ISSUE-58 · WRITE ─────────────────────────────────┐
│ workspace mercury/website(feature/oauth)                    │
│ model openai/gpt-5.6                                        │
│                                                             │
│ user                                                        │
│ Implement the bounded callback normalization step.          │
│                                                             │
│ assistant                                                   │
│ ...                                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ › Guide Specialist…                                        │
├─────────────────────────────────────────────────────────────┤
│ Esc coordinator · x stop                                   │
└─────────────────────────────────────────────────────────────┘
```

The parent coordinator AgentSession remains alive.

---

# 70. Attach implementation boundary

Do not mutate Pi's main `InteractiveMode` session into the child.

The Specialists extension should own a custom child viewport.

Conceptually:

```text
parent session
    stays parent

child viewport
    renders child AgentSession
```

---

# 71. Parent-to-child guidance

If child is running:

```text
guidance
    ↓
steer / followUp
```

If child is settled:

```text
guidance
    ↓
prompt
    ↓
resume same session
```

The UI may simplify this to one input action while runtime chooses correct primitive.

---

# 72. Observability requirement

Moving to native `AgentSession` must not reduce Specialists observability.

`observability.db` remains the authoritative forensic store.

Native hosting must preserve:

```text
activation traceability
Specialist identity
Bead correlation
workspace correlation
participant identity
activation identity
attempt identity
Pi session identity
model
thinking
turn lifecycle
tool lifecycle
tool blocking
retry
stall
compaction
message interaction
clarification
escalation
lease changes
result validation
failure
uncertainty
usage
timing
```

---

# 73. No telemetry fork

Forbidden:

```text
legacy sp
    ↓
observability.db

native extension
    ↓
specialist-subagents.db
```

Required:

```text
legacy sp ──────┐
                │
                ▼
        shared forensic model
                │
native host ────┘
                ↓
         observability.db
```

If existing writers are too coupled to the current runner, extract them.

---

# 74. Forensic adapter

Use one semantic adapter from Pi events.

```text
Pi AgentSession event
    ↓
AgentSessionForensicAdapter
    ↓
Specialists semantic event
    ↓
identity enrichment
    ↓
observability.db
```

Avoid UI, lease and host layers each inventing their own event names.

---

# 75. Required lifecycle forensic categories

Normalize/persist equivalents for:

```text
activation_requested
activation_admitted
activation_rejected
activation_starting
activation_started

turn_started
turn_completed

tool_started
tool_completed
tool_failed
tool_blocked

interaction_sent
interaction_delivered
interaction_received

clarification_requested
clarification_replied

escalation_requested
escalation_resolved

waiting
resumed

lease_requested
lease_acquired
lease_denied
lease_released
lease_uncertain
lease_reconciled

retry_started
retry_completed
retry_failed

compaction_started
compaction_completed

output_validation_started
output_validation_passed
output_validation_failed

activation_settled
activation_completed
activation_stopped
activation_failed
activation_uncertain
activation_disposed
```

Exact persisted names should reuse existing Specialists schema names whenever equivalent concepts already exist.

---

# 76. Dispatch-gate forensics

Persist every rejected dispatch.

Include:

```text
requesting participant
bead
Specialist
requested model
workspace
gate name
reason
timestamp
override attempt if any
```

A failed dispatch is still runtime evidence.

---

# 77. Interaction forensics

At minimum persist:

```text
message_id
sender
receiver
activation
kind
reply_to
created_at
delivery state
attention state
resolved state
```

The forensic system should answer:

```text
why did this Specialist stop progressing?
did it ask a question?
was it delivered?
was it answered?
did it resume?
```

Full text persistence should follow current policy.

Do not duplicate Pi transcripts unnecessarily.

---

# 78. Lease forensics

Persist every transition.

At minimum:

```text
workspace_id
previous_holder
new_holder
participant_id
activation_id
attempt_id
reason
timestamp
generation
```

Required event classes:

```text
lease requested
lease acquired
lease denied
lease released
lease uncertain
lease reconciled
```

---

# 79. Blocked mutation forensics

If a coordinator or child attempts a forbidden mutation:

```text
tool attempted
    ↓
lease guard rejects
    ↓
forensic event
```

Persist enough to answer:

```text
who attempted?
which tool/effect?
which workspace?
who held lease?
```

---

# 80. Retry forensics

Native Pi retry events must remain visible.

Do not let retries become opaque implementation detail inside AgentSession.

Preserve distinction:

```text
transient
retrying
failed
uncertain
```

---

# 81. Compaction forensics

Persist relevant compaction events.

A child may remain alive across compaction.

The activation identity remains stable.

Compaction does not imply new activation.

---

# 82. Usage telemetry

Where available preserve:

```text
provider
model
thinking level
input tokens
output tokens
cache usage
turn duration
activation duration
retry count
compaction count
```

Native activations must remain visible to existing runtime reports.

---

# 83. Fleet source of truth

Prefer one reducer/model:

```text
AgentSession events
    ↓
normalized activation state
    ├─→ observability.db
    └─→ Fleet projection
```

Avoid:

```text
UI reducer
forensic reducer
lease reducer
```

all independently interpreting raw Pi events.

---

# 84. Adapted `using-specialists`

The extension must ship an adapted `using-specialists` skill.

This remains the canonical agent mental model.

Do not split usage guidance into a competing `using-specialist-subagents` unless a real product distinction later requires it.

The skill should explain both:

```text
native interactive Specialist use
legacy Specialist paths where still relevant
```

with native interactive delegation preferred when available.

---

# 85. What the skill must teach

At minimum:

```text
what a Specialist is
what a Specialist is not
when to delegate
when not to delegate
Bead readiness
seven-section contract
SCRUTINY
native delegation
model override
read-only vs writer
shared-worktree behavior
writer lease
parent fencing
persistent child lifecycle
questions
clarifications
progress updates
findings
escalations
reply semantics
attachment
resume
peer messaging
result versus interaction
observability
uncertain recovery
Chain boundary
deferred step issues
Claude coordinator behavior
```

---

# 86. Agent-facing Specialist definition

Suggested wording conceptually:

```text
A Specialist is a persistent typed participant backed by:

- an effective Specialist definition;
- a durable Bead work contract;
- a bounded StepContract;
- a Pi AgentSession;
- resolved capabilities;
- workspace authority;
- forensic logging.

A Specialist is not:

- a generic prompt preset;
- a disposable one-shot subagent;
- a free-form delegation target.
```

---

# 87. Delegation guidance

The skill should encourage delegation when:

```text
a real Specialist role already exists
bounded expertise is useful
read-only work can proceed in parallel
independent judgment is valuable
implementation should be governed by the writer lease
persistent child context is useful
```

Avoid delegation merely to:

```text
avoid reasoning
fragment trivial work
create unnecessary agents
bypass durable work contracts
obtain another concurrent writer
```

---

# 88. Bead guidance

The skill must state:

> The Bead is the task. The delegation call is not a second task prompt.

If the Bead is incomplete:

```text
update it
```

Do not supplement it through hidden tool-call prose.

---

# 89. Clarification guidance

Decision rule:

```text
Specialist asks question
    ↓
does answer modify durable work?
```

If no:

```text
reply
```

If yes:

```text
update Bead
refresh activation context
reply
```

---

# 90. Escalation guidance

The skill must state:

```text
escalation != failure
```

The coordinator should inspect, decide, update authority/contract if needed, then resume or stop deliberately.

---

# 91. Resume guidance

Prefer:

```text
existing executor
    ↓
review finding
    ↓
resume same executor
```

over blindly spawning another executor.

A resumed writer must reacquire its lease.

---

# 92. Observability guidance

The skill should tell the coordinator that native Specialist activity is already forensic.

Do not create ad-hoc logs.

When debugging:

```text
inspect Fleet
inspect activation state
inspect observability
inspect lease
```

before replacing a child.

---

# 93. Chain boundary guidance

Interactive delegation is:

```text
one bounded Specialist activation
```

It is not:

```text
a complete resolved XTRM Chain
```

The coordinator must not claim that interactive delegation instantiated a full chain topology.

---

# 94. Deferred step-issue guidance

The skill should state:

```text
interactive path:
Bead → StepContract → Activation

future Chain path:
ResolvedChain → materialized step work → StepContract → Activation
```

Do not create artificial child work items just because a subagent exists.

---

# 95. Tool self-description

The `specialist_delegate` tool description should explain, concisely:

> Delegate a ready Bead to a configured XTRM Specialist as a persistent native Pi subagent. The Specialist may ask questions, report findings, or escalate while remaining alive. Read-only Specialists may run concurrently. Write-capable Specialists share the current worktree and require the exclusive workspace writer lease; the coordinator is also fenced from mutation while that lease is held. Do not use free-form delegation to supplement an incomplete Bead.

---

# 96. Public API docstrings

Public runtime interfaces must document semantics.

Especially:

```text
NativeActivationHost
ActivationRequest
ActivationResult
StepContract
ParticipantTransport
InteractionMessage
WorkspaceIdentity
WorkspaceLeaseStore
WorkspaceLease
SpecialistRegistry
AgentSessionForensicAdapter
```

Example lease docstring:

```ts
/**
 * Acquires exclusive mutation authority for one mutable workspace.
 *
 * Readers do not require a lease.
 *
 * A writer activation must hold the lease before beginning a
 * mutation-capable turn.
 *
 * The lease may be released while the AgentSession remains alive.
 * A later writer turn must reacquire it.
 *
 * A disappeared holder does not imply a safe free workspace:
 * unresolved mutation state becomes `uncertain` and must be reconciled.
 */
```

---

# 97. Documentation parity requirement

The runtime is incomplete if these disagree:

```text
implementation
using-specialists/SKILL.md
tool descriptions
public API docstrings
developer README
Claude integration docs
```

A PR changing authority/lifecycle semantics must update all affected documentation.

---

# 98. Claude Code integration objective

Claude Code should be able to remain the coordinator while dispatching a real Pi Specialist.

Target:

```text
Claude Code
    ↓
specialist_delegate(...)
    ↓
Specialists Claude integration
    ↓
NativeActivationHost
    ↓
Pi AgentSession
    ↓
real Specialist
```

No `sp run`.

No `xt` intermediary required.

---

# 99. Claude integration packaging

Ship a Specialists-owned Claude Code plugin.

Recommended contents:

```text
plugin
MCP server
using-specialists skill
optional hooks
optional peer/roster registration
```

The MCP server imports/calls the Specialists runtime library directly.

Forbidden normal implementation:

```text
MCP handler
    ↓
exec("sp run ...")
```

---

# 100. Claude MCP tool surface

Keep small.

Required:

```text
specialist_delegate
specialist_message
specialist_status
specialist_stop
```

Optional:

```text
specialist_result
```

Example:

```ts
specialist_delegate({
  specialist: "executor",
  bead: "ISSUE-58",
  model: "openai/gpt-5.6"
})
```

---

# 101. Claude dispatch semantics

`specialist_delegate` should return quickly after activation admission.

Example:

```json
{
  "activation": "act:123",
  "specialist": "executor",
  "state": "running"
}
```

Do not block the Claude coordinator for the entire Specialist lifecycle.

Claude should continue working.

---

# 102. Claude asynchronous event transport

The Specialist may later produce:

```text
clarification
finding
escalation
attention
completion
failure
uncertain state
```

These should be pushable into the active Claude coordinator session through the supported Claude MCP channel/event surface where available.

Flow:

```text
Pi Specialist
    ↓
InteractionMessage
    ↓
NativeActivationHost
    ↓
ClaudeMcpChannelTransport
    ↓
Claude coordinator
```

---

# 103. Claude reply

Claude responds:

```ts
specialist_message({
  activation: "act:123",
  message: "Preserve the old behavior during the migration."
})
```

The integration maps this into:

```text
InteractionMessage
    ↓
NativeActivationHost
    ↓
child prompt / steer / followUp
```

depending on child state.

---

# 104. Claude completion

When child completion becomes valid:

```text
AgentSession settles
    ↓
ActivationResult validation
    ↓
observability.db
    ↓
activation state update
    ↓
Claude async notification
```

Claude receives a structured summary/reference.

The notification is not the durable result itself.

---

# 105. Claude built-in `Agent` distinction

Do not attempt to replace Claude's built-in `Agent` backend through unsupported interception.

Claude sees:

```text
Agent(...)
    → Claude-native subagent

specialist_delegate(...)
    → XTRM Pi Specialist
```

The adapted skill teaches the distinction.

---

# 106. Optional Claude roster registration

As an additional integration, live Pi Specialists should optionally register in Claude Code's peer/agent roster using the same general mechanism proven by `pi-claude-link`.

Desired UX:

```text
/list-agents

claude-native-reviewer
pi-specialist:executor:ISSUE-58
pi-specialist:researcher:ISSUE-92
```

This provides:

```text
discoverability
participant visibility
familiar Claude UX
direct SendMessage interoperability
```

---

# 107. Claude roster identity

Roster display name is not durable activation identity.

Conceptually:

```text
display:
  pi-specialist:executor:ISSUE-58

internal:
  participant_id
  activation_id
  pi_session_id
```

Duplicate display names must not create ambiguous authority.

The adapter should use stable internal identity.

---

# 108. Claude roster lifecycle

On activation start:

```text
register peer
```

While waiting/settled but resumable:

```text
remain registered
```

On explicit disposal:

```text
unregister
```

A Specialist should not disappear from the roster merely because one turn ended.

---

# 109. Claude direct `SendMessage`

If Claude sends directly to the registered peer:

```text
Claude SendMessage
    ↓
ClaudePeerTransport
    ↓
InteractionMessage
    ↓
NativeActivationHost
    ↓
Pi Specialist AgentSession
```

Replies follow the reverse route.

The same participant protocol is used.

---

# 110. MCP channel versus peer transport

Use MCP channel primarily for runtime-originated events:

```text
attention
clarification
completion
failure
state transition
```

Use peer transport primarily for:

```text
direct Claude↔Specialist conversation
roster discoverability
SendMessage interoperability
```

They must not become separate messaging ontologies.

---

# 111. Security/trust boundary

Cross-agent messages are peer input.

They are not equivalent to operator authority.

This applies to:

```text
Pi child messages
pi-intercom messages
Claude MCP channel messages
Claude SendMessage peer messages
```

The receiving participant must know sender identity and trust class.

---

# 112. Specialist capability policy

Native children must preserve Specialists fail-closed capability behavior.

Invariant:

```text
extension installed
    !=
extension selected
    !=
capability granted
```

The child receives the resolved active set.

Do not expose every available Pi tool merely because the child is in-process.

---

# 113. Existing tool-policy reuse

The current Specialists extension-tool-policy direction should be reused.

Where direct AgentSession creation changes how active tools are configured, refactor the existing policy into a shared resolver.

Do not duplicate permission logic.

---

# 114. External-command preconditions

If the Specialist declares required external commands:

```text
validate before session start
```

Failure should be a dispatch rejection, not a mid-run surprise where avoidable.

---

# 115. Skills

Preserve Specialist skill behavior.

Required:

```text
resolve paths
verify paths
fingerprint where applicable
load into child
fail closed when required skill missing
```

Do not silently omit skills because native hosting differs from CLI invocation.

---

# 116. Mandatory rules

Preserve:

```text
default globals
template sets
inline rules
disable_default_globals semantics
rule compilation
```

The native path must use the same rule compiler/resolver.

---

# 117. System prompt behavior

Preserve:

```text
prompt.system
system_prompt_mode append/replace
task_template
mandatory rule layers
tool advisory where applicable
StepContract
Bead context
```

Do not flatten these into one ad-hoc string without respecting current semantics.

---

# 118. Scripts

Pre/post scripts require explicit parity treatment.

Pre scripts:

```text
run before model session
required failure may abort
inject_output may affect child context
```

Post scripts:

```text
run at governed result/finalize stage
```

Shell execution is host authority.

Do not blindly execute arbitrary script semantics without preserving current policy.

---

# 119. Output validation

Preserve:

```text
response_format
output_type
output_schema
expected_output_keys
```

A model response is not a valid result merely because the model stopped.

---

# 120. Auto-commit/checkpoint semantics

Where `auto_commit` applies, native hosting must either:

```text
reuse current implementation
```

or:

```text
explicitly adapt it to activation lifecycle
```

No silent loss.

The lease model and auto-commit behavior must not conflict.

---

# 121. Stall detection

Preserve existing stall-related behavior where meaningful.

Examples:

```text
running silence warning
running stale/error threshold
waiting stale threshold
tool duration warning
optional waiting auto-close policy
```

Native AgentSession events should feed the same semantics.

---

# 122. Retry behavior

Use existing Specialist retry policy.

Retries should create/track attempts under one activation.

Conceptually:

```text
activation
  ├─ attempt 1
  ├─ attempt 2
  └─ attempt 3
```

Do not create a new logical participant for each retry.

---

# 123. Result persistence

If current Specialists writes result/output files or notes, native hosting must preserve applicable behavior.

Any deliberate incompatibility must appear in the parity matrix.

---

# 124. Fleet attention behavior

A child requiring coordinator action should surface strongly but compactly.

Example:

```text
SPECIALISTS · 3
  ● executor     ISSUE-58    working
  ! researcher   ISSUE-92    needs reply
  ! debugger     ISSUE-101   escalated
```

Do not flood the coordinator transcript with routine tool activity.

---

# 125. Notifications

Coordinator-visible interruptions should be reserved for semantically relevant events.

Good interruption:

```text
clarification required
escalation
writer uncertainty
activation completed
activation failed
```

Routine progress should generally stay in Fleet/observability unless explicitly important.

---

# 126. Future Chain integration

The native activation runtime must be callable without TUI state.

Future:

```text
ChainReducer
    ↓
SchedulerIntent
    ↓
ActivationRequest
    ↓
NativeActivationHost
```

Interactive:

```text
Pi/Claude coordinator
    ↓
ActivationRequest
    ↓
NativeActivationHost
```

Same runtime.

---

# 127. Future Substrate integration

This work intentionally adopts selected Substrate semantics early:

```text
participant identity
activation identity
workspace lease
StepContract
waiting/resume
uncertain/reconcile
```

It does not implement full Substrate.

The lease store should be replaceable later by:

```text
Substrate-backed Container.worktree_lease
```

without changing coordinator APIs.

---

# 128. Future Frames integration

Future conceptual projection:

```text
Frame
├─ coordinator AgentSession
├─ Specialist Fleet
│   ├─ participant
│   ├─ participant
│   └─ participant
└─ interaction/result evidence
```

This PRD must not depend on Frames landing first.

---

# 129. Implementation phases

## Phase 0 — reconciliation

Produce:

```text
feature parity matrix
current runner map
forensic writer map
existing native experiment reuse map
```

No production coding before identifying the reusable seams.

---

## Phase 1 — read-only native Specialist

Prove:

```text
Pi coordinator
    ↓
specialist_delegate(researcher)
    ↓
real SpecialistLoader
    ↓
real AgentSession
    ↓
real skill/tool policy
    ↓
result
```

No writer support yet.

---

## Phase 2 — persistent Fleet

Add:

```text
registry
state projection
compact Fleet UI
selection
attach
return
resume
```

---

## Phase 3 — Bead hard gate

Implement:

```text
ready validation
7-section validation
SCRUTINY validation
structured refusal
forensic refusal
```

---

## Phase 4 — StepContract

Implement bounded activation contract compilation.

Do not create step issues.

---

## Phase 5 — direct participant transport

Implement:

```text
InteractionMessage
direct parent/child transport
message IDs
reply correlation
send
blocking request
pending asks
attention
```

---

## Phase 6 — clarification and escalation

Prove:

```text
child question
child waits
parent replies
same AgentSession resumes
```

and:

```text
child escalates
remains alive
operator/coordinator resolves
child resumes
```

---

## Phase 7 — observability parity

Wire native AgentSession events into the shared forensic pipeline.

Verify `observability.db`.

---

## Phase 8 — writer lease

Implement:

```text
workspace identity
mutation classification
lease store
atomic acquire
release
parent fencing
second-writer failure
resume reacquisition
```

---

## Phase 9 — uncertain recovery

Implement:

```text
uncertain lease
reconciliation
forensic evidence
safe release
```

---

## Phase 10 — writer Specialist parity

Enable:

```text
executor
debugger
test-engineer
other write-capable roles
```

only after capability/lease/forensic parity passes.

---

## Phase 11 — model override

Implement:

```text
model override
validation
fallback semantics
model picker
forensics
```

---

## Phase 12 — documentation

Ship:

```text
using-specialists
tool descriptions
docstrings
operator docs
developer docs
```

---

## Phase 13 — Claude Code plugin

Expose the same native activation runtime through MCP.

No CLI shell-out.

---

## Phase 14 — Claude async channel

Implement Specialist→Claude asynchronous runtime events.

---

## Phase 15 — Claude peer/roster adapter

Register live Pi Specialists in Claude's roster and support `SendMessage`.

Treat this as an additive integration layer.

---

# 130. Acceptance matrix

The implementation is incomplete until these pass.

---

## A — real Specialist resolution

A global/repo override affects the native child exactly as `SpecialistLoader.get()` says it should.

---

## B — configured default model

No override uses the effective configured Specialist model.

---

## C — explicit model override

A valid override runs the child with the requested model while keeping all Specialist policy unchanged.

---

## D — invalid model override

Unavailable explicit model rejects before AgentSession creation.

---

## E — override persistence

`observability.db` records:

```text
configured model
resolved model
override status
```

---

## F — config is not mutated

Next activation without override returns to configured model.

---

## G — read-only child

Researcher runs in coordinator workspace and cannot mutate.

---

## H — persistent child

Child settles.

Operator attaches and sends another message.

Same child session continues.

---

## I — parent attach

Attaching to child does not destroy or replace parent coordinator session.

---

## J — clarification

Child sends `clarification_required`.

Fleet shows `needs_reply`.

Parent replies.

Child resumes in same session.

---

## K — clarification with contract change

Child identifies a scope mismatch.

Coordinator updates Bead before sending revised durable instructions.

---

## L — escalation

Child escalates.

Activation remains alive and inspectable.

---

## M — progress update

Child sends non-blocking progress without halting execution.

---

## N — result distinction

Routine completion produces `ActivationResult`.

It is not stored merely as an untyped message.

---

## O — ready Bead gate

Draft/incomplete work cannot dispatch.

---

## P — no prompt smuggling

Tracked delegation cannot supplement missing scope with arbitrary task text.

---

## Q — missing prerequisite

Required external command/tool/skill failure rejects before model execution where possible.

---

## R — feature parity diagnostics

Unsupported Specialist feature is visible as:

```text
deferred
rejected
```

not silently omitted.

---

## S — one writer

Writer A acquires lease.

Writer B dispatch fails loudly.

---

## T — readers coexist

Researcher/reviewer can run while executor holds write lease.

---

## U — coordinator fenced

Parent coordinator attempts Edit while child owns lease.

Call is blocked.

---

## V — blocked write forensic

The blocked parent tool call appears in `observability.db`.

---

## W — lease release

Executor settles/waits at governed barrier and releases lease.

---

## X — sequential writer handoff

Debugger later acquires the same workspace lease.

---

## Y — resumed writer

Settled executor receives new write instruction.

It reacquires the lease first.

---

## Z — resume conflict

Another writer owns lease.

Old executor cannot resume mutation.

---

## AA — writer clarification release

Writer asks blocking question and reaches safe waiting state.

Lease releases while session remains alive.

---

## AB — crash uncertainty

Writer disappears during unresolved mutation.

Workspace becomes uncertain, not silently free.

---

## AC — reconciliation

Uncertain workspace can be reconciled using durable evidence.

---

## AD — direct transport

Same-process Pi parent/child messaging works without `pi-intercom`.

---

## AE — busy child delivery

Parent guidance sent while child is busy is delivered at a safe steer boundary.

---

## AF — idle child delivery

Message to idle/settled child resumes it.

---

## AG — reply correlation

Blocking request can be matched to its reply.

---

## AH — pending ask inspectability

Runtime can identify which Specialist is waiting on which unresolved request.

---

## AI — interaction forensic

Question→delivery→reply→resume order can be reconstructed.

---

## AJ — native observability

Native activation produces durable lifecycle records.

---

## AK — Bead lineage

Forensic query can recover originating Bead from activation.

---

## AL — Specialist lineage

Forensic query can recover Specialist/participant/activation/attempt/session relationship.

---

## AM — retry lineage

Retries remain attempts under one activation.

---

## AN — compaction evidence

Compaction remains visible without changing activation identity.

---

## AO — output validation

Invalid configured output fails validation even if model stopped normally.

---

## AP — no telemetry side store

No separate native-subagent database is introduced.

---

## AQ — Fleet forensic consistency

Fleet state agrees with normalized activation state.

---

## AR — documentation usability

A fresh coordinator can use the system correctly from `using-specialists`.

---

## AS — lease guidance understood

Agent does not try to bypass a child-held lease.

---

## AT — no unnecessary worktree

Coordinator does not invent a second worktree merely because executor was delegated.

---

## AU — result versus message guidance

Agent understands that progress messages do not mean work is complete.

---

## AV — Claude dispatch

Claude Code launches a real Pi Specialist without `sp run`.

---

## AW — Claude does not require xt

Claude Code does not need to launch a separate terminal/xt session to obtain the Specialist.

---

## AX — Claude async clarification

Specialist sends clarification to active Claude coordinator.

Claude can reply.

Child resumes.

---

## AY — Claude completion

Claude receives structured completion notification tied to validated `ActivationResult`.

---

## AZ — Claude model override

Claude can specify activation model override through the same runtime.

---

## BA — Claude shared lease

A Specialist launched by Claude obeys the same workspace writer lease.

---

## BB — Claude coordinator fencing

If Claude itself can mutate the same workspace through its coordinator environment, the integration must ensure equivalent lease enforcement at the authority boundary available to that integration.

Any limitation must be explicit and fail safe.

---

## BC — Claude roster registration

When enabled, live Specialist appears in Claude roster.

---

## BD — roster survives settle

Resumable settled Specialist remains registered.

---

## BE — roster unregisters on disposal

Disposed Specialist disappears from roster.

---

## BF — Claude SendMessage

Direct Claude peer message reaches real Pi Specialist.

---

## BG — Claude peer reply

Pi Specialist reply returns through Claude peer transport.

---

## BH — duplicate ontology prevented

Direct, Intercom, Claude MCP and Claude peer transports all normalize to one semantic protocol.

---

## BI — future scheduler seam

A synthetic non-interactive `SchedulerIntent` can create the same activation without TUI dependencies.

---

# 131. Success criteria

The first meaningful success case is daily interactive work.

Example:

```text
operator:
"Research whether the SDK change affects ISSUE-58."

coordinator
    ↓
uses/updates ready Bead
    ↓
delegates researcher

SPECIALISTS
    ● researcher · ISSUE-58

researcher:
"There are two incompatible interpretations.
Do you mean public OAuth clients or service principals?"

SPECIALISTS
    ! researcher · needs reply

operator
    ↓
attach or reply
    ↓
answer
    ↓
return coordinator

researcher continues
    ↓
result
```

Writer case:

```text
coordinator
    ↓
delegate executor

executor acquires WRITE lease

coordinator:
    still reads
    cannot mutate

researchers:
    continue normally

second writer:
    rejected

executor:
    asks clarification
    waits
    releases lease

coordinator:
    answers

executor:
    reacquires
    continues
```

Claude case:

```text
Claude Code coordinator
    ↓
specialist_delegate(executor, ISSUE-58)
    ↓
real Pi Specialist starts

Claude continues working

Specialist:
    "I need clarification."

Claude receives async event
    ↓
replies

Specialist resumes

/list-agents
    includes pi-specialist:executor:ISSUE-58

Specialist completes
    ↓
validated ActivationResult
    ↓
observability.db
    ↓
Claude completion notification
```

---

# 132. Final architecture

```text
                             COORDINATORS

               ┌──────────────┬──────────────┐
               │              │              │
               ▼              ▼              ▼
            Pi session     Claude Code     future Frame
               │              │
         Pi extension     Claude plugin
               │              │
               └──────┬───────┘
                      ▼
               ActivationRequest
                      ▼
                 DispatchGate
                      ▼
               SpecialistLoader
                      ▼
        SpecialistActivationProfile
                      ▼
                 StepContract
                      ▼
               WorkspaceLease
                      ▼
            NativeActivationHost
                      ▼
                Pi AgentSession
                      ▼
                XTRM Specialist

                      │
        ┌─────────────┼──────────────┐
        │             │              │
        ▼             ▼              ▼
  Interaction     Activation      Lifecycle /
    Message         Result         Authority
        │             │              │
        └─────────────┼──────────────┘
                      ▼
              normalized runtime
                /             \
               ▼               ▼
       observability.db       Fleet/UI


                    PARTICIPANT TRANSPORTS

              NativeActivationHost
                      │
          ┌───────────┼─────────────┬─────────────┐
          │           │             │             │
          ▼           ▼             ▼             ▼
       Direct      PiIntercom    Claude MCP    Claude Peer
       Session      Adapter       Channel        Adapter
          │           │             │             │
          ▼           ▼             ▼             ▼
     parent Pi    external Pi     Claude        Claude
     AgentSession    session      runtime      SendMessage


                         FUTURE

                    ChainReducer
                        ↓
                  SchedulerIntent
                        ↓
                 ActivationRequest
                        ↓
              same NativeActivationHost
```

---

# 133. Final invariant set

The following invariants are release-blocking:

```text
1. SpecialistLoader remains authoritative.

2. Tracked work requires a ready Bead.

3. Free-form delegation cannot replace durable work.

4. StepContract does not create a second work graph.

5. Substrate step-issue creation remains deferred.

6. Native Specialist sessions are persistent.

7. Questions and escalations do not kill the child.

8. Interaction is bidirectional.

9. Interaction messages and results are distinct.

10. Same-process sessions use direct transport.

11. pi-intercom is optional peer transport, not required child infrastructure.

12. Claude coordinates the same Pi Specialist runtime.

13. Claude integration does not shell out to sp run.

14. Claude roster registration is an adapter, not runtime authority.

15. Read-only Specialists may coexist.

16. Exactly one writer may mutate a workspace.

17. The coordinator obeys the same writer lease.

18. A new writer does not automatically receive a new worktree.

19. Session lifetime and lease lifetime are independent.

20. Resumed writers reacquire leases.

21. Unknown mutation state becomes uncertain.

22. Uncertain state requires reconciliation.

23. Model override is activation-scoped.

24. Model override does not mutate Specialist config.

25. Capability policy remains fail-closed.

26. Specialist runtime features are reused or explicitly classified.

27. observability.db remains authoritative.

28. Native execution does not create a telemetry fork.

29. Every authority decision is forensic.

30. The Fleet is a projection.

31. Documentation is part of the implementation contract.

32. Future Chains must reuse the same NativeActivationHost.
```

The central deliverable is therefore a canonical, persistent, interactive Specialist runtime that can be driven from Pi today, Claude Code immediately after, and XTRM Chains later without rewriting what a Specialist is.