# XTRM Native Harness on Pi — Architecture Exploration

**Status:** architecture exploration / spike proposal  
**Date:** 2026-08-09  
**Programme:** XTRM  
**Scope:** possible evolution of XTRM from an orchestration stack around Pi into an opinionated, governed agent harness built directly on Pi primitives  
**Authority:** non-normative; must not supersede the current execution plan, `specialists.execution.v1`, ResolvedChain/C1-D1, Channels, Substrate, or the v1 runtime reconciliation amendment without an accepted ADR  
**Primary reference:** `PrimeIntellect-ai/prime-agent` as a same-ecosystem example of a custom harness built on Pi  
**Programme tracking:** `R1.6` and `GATE-HARNESS-ADR` in the canonical current execution plan; the accepted ADR may retain corrected RPC or select a native harness  
**Related XTRM work:** Pi v0.84.1 remediation, runtime reconciliation, execution identity, leases, recovery/replay, Channels, memory, RLM/dynamic subagents, AgentSession comparison, deterministic chains

---

## 1. Thesis

XTRM should seriously evaluate evolving from:

```text
an orchestration stack built around Pi
```

into:

```text
an opinionated, governed agent harness built on Pi
```

The purpose would not be to build another generic coding agent or to fork Prime Agent.

The purpose would be to make the existing XTRM architecture coherent around one native execution substrate, while preserving the parts in which XTRM is intentionally more governed and deterministic than a general agent harness:

- Beads task contracts;
- Specialist roles and capability boundaries;
- deterministic chain templates;
- `ResolvedChain`;
- SCRUTINY and mandatory gates;
- independent review/test/security roles;
- evidence and forensic semantics;
- Channels;
- provenance and authority;
- reducer/scheduler separation;
- evaluation-driven promotion;
- future Substrate;
- Console / Agent Workspace.

Prime Agent demonstrates that Pi can support a substantially different harness above its lower-level packages and runtime primitives. XTRM can use that as evidence that its current external-RPC integration is not the only architectural form available.

The central question is therefore:

> Can XTRM consume Pi at a sufficiently low and stable level—preferably through public AgentSession/runtime APIs—to own its own execution harness without duplicating Pi or inheriting the full Pi coding-agent harness?

---

## 2. Why this question is now worth asking

Earlier in the programme, building an XTRM-native harness would have been easy to classify as unnecessary infrastructure.

That is no longer obviously true.

The current XTRM v1 programme already needs to implement or formalize many capabilities that are characteristic of a real harness:

```text
execution identity
execution profiles
session lifecycle
leases
mutation journaling
recovery
replay
scheduling
bounded autonomous continuation
memory retrieval
skills
inter-agent communication
dynamic children
evidence
evaluation
workspace ownership
tool policy
provenance
context assembly
```

If these are implemented independently around a subprocess RPC client, XTRM may end up constructing a harness implicitly and incrementally, but with the responsibility split across Specialists, Core, xtmux, Channels and future Substrate.

A deliberate harness design could instead reduce duplication and make ownership explicit.

The criterion is not architectural novelty.

The criterion is whether a native harness allows XTRM to become **smaller, more coherent and more deterministic**.

---

## 3. What Prime Agent proves — and what it does not

Prime Agent is highly relevant because it is built on the same Pi ecosystem.

Its most useful evidence is that Pi can act as a substrate for a higher-level harness with its own:

- daemon/supervisor;
- resident root-session workers;
- persistent agent trees;
- recursive child agents / RLM;
- direct agent messaging;
- scheduling and heartbeats;
- persistent goals;
- bounded autonomous continuation;
- leases;
- mutation journals;
- recovery;
- reconnect/replay;
- snapshots;
- persistent IPython state;
- durable skills and harness state.

This does **not** imply that XTRM should adopt Prime Agent itself.

Prime Agent and XTRM optimize for different concerns.

Prime Agent is particularly strong in generic long-running agent runtime primitives.

XTRM is particularly strong in governed workflow semantics:

```text
task contracts
role specialization
permission boundaries
deterministic chains
SCRUTINY
independent review
test chains
evidence
forensics
authority
provenance
Substrate
work graphs
release discipline
evaluation/promotion
```

The architecture opportunity is to combine these categories of capability without importing Prime Agent as an authority or dependency.

---

## 4. Target conceptual architecture

The possible target is:

```text
                         XTRM HARNESS

┌──────────────────────────────────────────────────────────────┐
│                                                              │
│ execution identity       leases          provenance          │
│ runtime lifecycle        recovery        replay              │
│ mutation journal         budgets         scheduling          │
│ Channels delivery        memory          context assembly    │
│ skills                   RLM             telemetry           │
│ workspaces               tool policy     snapshots           │
│                                                              │
│        Specialists deterministic workflow/cognition          │
│        ResolvedChain · reducer · gates · evaluations          │
│                                                              │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                            Pi

              model/provider/session/tool substrate
```

This architecture would make XTRM an opinionated harness **on Pi**, rather than a collection of external coordination tools around Pi.

---

## 5. Pi layers that must be distinguished

The architectural spike must distinguish at least three levels:

```text
Pi low-level model/runtime packages
        │
        ▼
Pi coding-agent harness
        │
        ▼
Pi CLI / JSON / RPC surfaces
```

Specialists currently interacts primarily through the outer RPC boundary.

A native XTRM harness would investigate whether the lower public APIs—especially `AgentSession` and related runtime packages—are sufficient and stable enough to become the internal execution boundary.

This changes the existing RPC-versus-SDK question.

The question is no longer merely:

> Is an SDK call more efficient than a subprocess?

It becomes:

> Can public Pi runtime APIs be the substrate of an XTRM-owned harness while Pi continues to own generic model/provider/session mechanics?

---

## 6. Desired ownership split

### 6.1 Pi should continue to own

Where stable public APIs exist, Pi should continue to own generic agent/runtime mechanics such as:

```text
model providers
model calls / streaming
base AgentSession mechanics
generic tool invocation
context-window mechanics
provider retries
Pi extension/event APIs
generic model-facing runtime primitives
```

XTRM should not fork or reimplement these without a demonstrated need.

### 6.2 XTRM harness should own

The XTRM-specific harness would own:

```text
execution identity
assignment and actor binding
authority
execution profiles
workspace ownership
leases
mutation journal
uncertain side-effect handling
Channels semantic delivery integration
evidence
forensics
bounded convergence
recovery policy
context composition
memory retrieval/promotion
evaluation hooks
workflow/runtime integration
operator projections
```

### 6.3 Specialists should narrow toward its real core

Under this architecture, Specialists could focus on:

```text
specialist definitions
role contracts
execution profiles
mandatory rules
tool/capability declarations
specialist skills
output contracts
chain templates
ResolvedChain compiler
workflow reducer
gates
review semantics
evaluation definitions
```

It would no longer need to be the long-term owner of every generic execution-runtime concern merely because Pi is currently reached through a subprocess.

---

## 7. Specialists remains the deterministic workflow engine

A native harness must not weaken the most important XTRM invariant:

```text
dynamic agent behavior
must remain inside
governed deterministic workflow boundaries
```

The canonical chain remains something like:

```text
writer
→ seconder
→ test-engineer
→ test-runner
→ security gate where applicable
→ obligations
→ reviewer
```

with SCRUTINY-dependent structural modulation.

The harness executes participants.

It does not decide that required participants or gates can disappear.

---

## 8. RLM inside XTRM

RLM is potentially a major capability for XTRM, but it should be treated as **cognitive delegation**, not workflow delegation.

The distinction should be explicit:

```text
ResolvedChain
    = governed workflow topology

RLM tree
    = execution-time cognitive topology
```

Example:

```text
ResolvedChain step: executor

executor execution
    ├── research child
    ├── API investigator
    └── migration advisor
```

The executor may use RLM children to improve its work.

The executor may not use RLM to remove the reviewer, skip QA, mutate the approved chain, grant itself authority or publish around gates.

Dynamic children therefore live **below a governed step boundary**.

---

## 9. RLM should be an execution-profile capability

A possible execution-profile shape:

```yaml
execution_profile: implementation-v1

delegation:
  rlm:
    allowed: true
    max_depth: 1
    max_children: 4
    allowed_child_roles:
      - researcher
      - explorer
      - advisor

budgets:
  max_child_tokens: ...
  max_total_tokens: ...
```

A reviewer could have a different profile:

```yaml
execution_profile: reviewer-v1

delegation:
  rlm:
    allowed: true
    max_depth: 1
    max_children: 2
    allowed_child_roles:
      - security-advisor
      - test-analysis
```

A deterministic test-runner might have:

```yaml
delegation:
  rlm:
    allowed: false
```

The principle is:

> RLM is a governed capability of the current execution profile, not a generic permission to spawn arbitrary agents.

---

## 10. Possible runtime model

Today, an execution often resembles:

```text
sp run
→ spawn Pi process
→ consume RPC
→ normalize events
→ infer lifecycle
→ Supervisor persistence
```

A native harness could eventually become:

```text
XTRM runtime
    │
    ├── execution A — Pi AgentSession
    │      ├── RLM child A.1
    │      └── RLM child A.2
    │
    ├── execution B — Pi AgentSession
    │
    └── execution C — Pi AgentSession
    │
    ├── scheduler
    ├── leases
    ├── Channels delivery
    ├── execution journal
    ├── recovery
    └── snapshot/replay
```

Then:

```text
sp run executor
```

could conceptually become:

```text
createExecution({
  assignment,
  participant,
  executionProfile,
  context,
  model,
  workspace
})
```

and return:

```text
execution_id
```

`sp feed`, `sp steer`, `sp result`, `sp stop` and future Console operations become projections/commands against that execution rather than separate process-management concepts.

---

## 11. RPC does not have to disappear

A native harness does not imply that RPC is obsolete.

RPC can remain a transport/client surface.

Possible target:

```text
XTRM Harness

├── embedded / SDK integration
├── local daemon protocol
├── RPC
├── JSON/JSONL
├── CLI
└── Console client
```

The architecture goal is:

```text
runtime semantics independent of transport
```

not:

```text
replace every subprocess with one specific API
```

The current Pi v0.84.1 RPC remediation remains mandatory before any migration decision.

---

## 12. Channels becomes the semantic communication protocol of the harness

Channels should not be replaced by a lower-level direct-agent messaging feature.

Instead:

```text
Channels semantic message
        ↓
authority / relevance / workflow
        ↓
DeliveryIntent
        ↓
XTRM runtime delivery
        ↓
target execution / AgentSession
```

The harness may expose low-level primitives such as:

```text
deliver
steer
follow_up
queue
```

Channels determines what the communication means:

```text
work.verdict
work.finding
work.proposal
control.steer
control.attention_requested
system.done
...
```

This preserves the existing distinction between:

```text
ChannelMessage
DeliveryIntent
DeliveryAttempt
ProcessingReceipt
```

Direct agent-to-agent communication would therefore use the same runtime delivery machinery but remain subordinate to Channels and authority rules when the message has workflow significance.

---

## 13. Memory becomes part of context assembly, not a generic persistence bucket

A native harness could finally expose a coherent context assembly pipeline:

```text
base harness policy
        +
specialist / role definition
        +
execution profile
        +
Bead contract
        +
ResolvedChain position
        +
upstream evidence
        +
promoted memory retrieval
        +
service knowledge
        +
current runtime state
        ↓
Pi AgentSession context
```

The context composition itself should be versioned, observable and evaluable.

The harness should preserve the distinctions already accepted in the v1 reconciliation:

```text
kernel / scratch state
session context
execution artifacts
transcript/history
evidence
forensics
semantic memory
skills/policy
```

Only promoted, reusable knowledge is semantic memory.

Persistent computation or a retained RLM child is not automatically memory.

---

## 14. Governed learning instead of silent self-modification

Prime Agent's continual-harness ideas are useful, but XTRM should preserve stronger governance.

The preferred lifecycle is:

```text
execution observation
→ candidate learning
→ evidence-backed candidate
→ contradiction / supersession check
→ review / deterministic validation
→ promoted memory / skill / policy artifact
```

Not:

```text
agent notices something
→ silently rewrites future behavior
```

A native harness could make candidate production easy while retaining explicit promotion authority.

---

## 15. Persistent IPython as a profile, not universal production policy

Persistent IPython is highly attractive for:

- research;
- quantitative work;
- data investigation;
- notebook-like analysis;
- transformation-heavy tasks;
- RLM orchestration.

It should not automatically become the default production tool boundary.

A possible distinction:

```text
profile: deterministic-specialist
    explicit bounded tools

profile: research-rlm
    persistent IPython
    RLM enabled

profile: reviewer
    read-only tools
    optional bounded advisor children
```

This retains auditability and least privilege.

---

## 16. xtmux becomes an attachment/presentation layer over executions

A native harness would clarify the long-term role of xtmux.

Instead of:

```text
pane == execution
```

the model becomes:

```text
execution
   ├── tmux/terminal attachment
   ├── Console attachment
   ├── CLI attachment
   └── headless mode
```

A pane may disappear without implying that the execution is semantically gone.

An execution may exist without ever receiving a visible terminal pane.

This aligns with the v1 requirement that execution identity be durable and independent of UI/presentation.

---

## 17. Substrate becomes the durable domain model of the harness

The already accepted five-package target remains a good fit:

```text
core
substrate
channels
specialists
console
```

No sixth generic `harness` package is required by this idea.

A plausible ownership shape is:

```text
@xtrm/core
    harness/
    runtime/
    execution/
    daemon/
    contracts/

@xtrm/substrate
    durable work/runtime entity model

@xtrm/channels
    semantic communication protocol

@xtrm/specialists
    specialized cognition + deterministic workflow

@xtrm/console
    operator/UI projection
```

This is an architectural direction only; it does not authorize immediate package movement or monorepo migration.

---

## 18. The harness should reduce duplication

This proposal is only successful if it eventually simplifies XTRM.

A bad outcome would be:

```text
Pi
+ new XTRM harness
+ old Specialists process supervisor
+ old RPC inference layer
+ duplicate xtmux runtime state
+ new daemon
```

A good outcome would converge toward:

```text
Pi
        ↓
XTRM harness/runtime
        ↓
Specialists / Channels / Substrate
        ↓
CLI / tmux / Console / MCP
```

with progressive retirement of:

- RPC-specific lifecycle inference that no longer serves a compatibility purpose;
- duplicated process supervision;
- pane-as-execution assumptions;
- parallel messaging paths;
- bridge-only coordinator glue;
- session-specific compatibility hacks;
- duplicate runtime stores.

Reduction of duplicated authority is an explicit acceptance criterion.

---

## 19. Do not build the daemon first

The exploration must be incremental.

Recommended sequence:

```text
1. complete Pi v0.84.1 RPC remediation
2. inspect current public Pi AgentSession/runtime APIs
3. build one in-process XTRM execution spike
4. run one existing Specialist through it
5. compare output, evidence and lifecycle parity with current RPC
6. add XTRM execution identity + journal
7. prove one governed RLM child under a Specialist execution
8. test cancellation/retry/recovery/context behavior
9. decide whether resident workers / daemon are justified
10. record the decision in an ADR
```

Do not begin with:

```text
build an XTRM version of Prime Agent
```

The first experiment should remain small enough to delete if the architecture does not hold.

---

## 20. Minimum XTRM Harness Spike

### Input

```text
Bead / assignment
specialist = explorer
model/provider
workspace
```

### Flow

```text
resolve XTRM execution identity
→ load Specialist definition
→ resolve execution profile
→ assemble context
→ instantiate Pi AgentSession directly
→ execute one managed Specialist turn/session
→ capture canonical events/evidence
→ persist Specialist result
→ finalize through specialists.execution.v1 semantics
```

### Output

At minimum:

```text
assignment_id
execution_id
participant_id
runtime_session_id
model/provider
result_ref
evidence_refs
terminal_state
resource usage
```

### Required parity comparison

Compare the spike against current RPC execution for:

```text
prompt/context equivalence
tool availability
stream/event semantics
result semantics
cancellation
retry
compaction
terminal completion
forensic evidence
resource cleanup
```

---

## 21. Second spike: governed RLM child

After the first vertical slice succeeds:

```text
executor execution
→ spawn one bounded research/advisor child
→ child returns evidence/message
→ executor consumes it
→ executor completes
→ normal downstream chain gate remains mandatory
```

The test must prove:

- child identity and lineage;
- budget attribution;
- authority inheritance or reduction;
- workspace/tool permissions;
- result/evidence capture;
- inability to mutate approved `ResolvedChain`;
- deterministic downstream workflow remains intact.

---

## 22. Decision fork

The current programme should not assume the outcome.

After RPC correctness and the harness spike:

```text
Pi RPC remediation
        ↓
minimum execution semantics
        ↓
AgentSession/XTRM Harness spike
        ↓
       ADR
      /   \
     /     \
RPC-compatible      native XTRM harness
runtime remains     becomes target runtime
     \               /
      \             /
       C1 / D1 continue
```

`ResolvedChain`, reducer, scheduler and Channels semantics must remain valid in either branch.

The spike is therefore intended to be **architecture-revealing but non-blocking** for the deterministic workflow design.

---

## 23. Questions the ADR must answer

The spike is successful only if it produces evidence for these questions.

### Pi boundary

- Which Pi packages/APIs are public and stable enough to consume directly?
- Does direct `AgentSession` avoid current RPC inference without depending on private internals?
- Can upstream Pi updates remain manageable?
- What compatibility surface would XTRM commit to supporting?

### Runtime

- Who owns process/session lifecycle?
- Is a resident worker actually required?
- What survives detach, crash and compaction?
- How are generation, replay and snapshots represented?
- What is the authoritative execution store?

### Specialists

- Which current Supervisor responsibilities disappear?
- Which remain workflow-specific and therefore stay in Specialists?
- Can one Specialist definition run identically through RPC and the native harness during migration?

### RLM

- Can RLM be bounded by execution profile?
- How are child budgets, capabilities and lineage enforced?
- How are child outputs converted into evidence?
- Can dynamic cognitive delegation remain incapable of changing workflow topology?

### Channels

- Can all agent-to-agent semantic communication continue through Channels?
- Which low-level delivery APIs belong to Core?
- How are direct runtime messages prevented from becoming a second semantic messaging system?

### Memory

- Can context assembly pull only relevant promoted memory?
- Can learning remain proposal/evidence/review/promotion based?
- How is runtime state prevented from polluting semantic memory?

### Operations

- Does the native harness materially reduce code and operational complexity?
- Does it improve recovery and observability?
- What new security risks come from persistent workers or persistent kernels?
- Can worktree/tool authority remain fail-closed?

---

## 24. Acceptance criteria for adopting the native harness

Do **not** adopt the harness direction merely because the prototype works.

Promotion should require evidence that it:

1. preserves or improves all current Specialist execution guarantees;
2. preserves deterministic chain semantics;
3. reduces duplicate runtime/process/session ownership;
4. improves identity/recovery/replay semantics;
5. does not create a second Channels or Beads authority;
6. supports current Pi providers/tools without unacceptable fork maintenance;
7. supports bounded RLM children safely;
8. preserves worktree and tool capability boundaries;
9. produces equal or better forensic/evidence surfaces;
10. has a credible compatibility and migration path from RPC;
11. does not require a sixth XTRM package;
12. can be tested independently from Console/tmux/UI;
13. reduces total long-term architectural complexity.

If these conditions are not met, keep the corrected RPC architecture.

---

## 25. Explicit non-goals

This exploration does not authorize:

- forking Prime Agent;
- making Prime Agent an XTRM dependency;
- forking Pi without a separate accepted necessity;
- replacing Specialists;
- removing deterministic chain gates;
- replacing Beads with persistent goals;
- allowing RLM children to self-authorize work;
- creating a generic swarm runtime;
- universal persistent IPython;
- silently self-modifying prompts, skills or policies;
- replacing Channels with raw direct messaging;
- replacing Substrate with a daemon-internal object graph;
- creating a sixth `@xtrm/harness` package;
- immediate monorepo migration;
- building a resident daemon before the smaller AgentSession spike proves value.

---

## 26. Relationship to the XTRM v1 termination path

This idea should be inserted as a bounded architecture decision inside the already accepted programme path, not as a reset of that path.

Current critical work remains:

```text
Pi 0.84.1 remediation
→ KAN-127 release/promotion closure
→ minimum specialists.execution.v1
→ ResolvedChain
→ reducer/scheduler
→ evaluation/promotion
```

The harness exploration belongs around the runtime-semantics closure after Pi RPC correctness and before XTRM commits unnecessarily to long-lived RPC-specific implementation details.

It must not delay pure C1 compiler/schema work.

It must not invalidate D1 semantics.

The goal is to choose the best execution substrate for the already accepted workflow architecture.

---

## 27. Long-term identity of XTRM if adopted

If the spike succeeds, the cleanest product/architecture statement may become:

> **XTRM is a governed agent harness built on Pi. Pi provides generic model/session/runtime primitives. XTRM provides durable execution identity, authority, deterministic workflows, specialist cognition, communication semantics, promoted memory, evidence, evaluation, workspaces and operator experience.**

In that model:

```text
Beads
    describes authoritative work

ResolvedChain
    describes governed workflow

Reducer
    derives next semantic state

Scheduler
    authorizes the next execution

XTRM Harness
    owns durable execution mechanics

Channels
    communicates semantic work and attention

Memory
    preserves promoted reusable knowledge

Specialists
    provides specialized cognition and deterministic workflows

Substrate
    materializes durable work/runtime entities and graphs

Console / tmux / CLI
    are clients and projections

Pi
    remains the generic agent/session/model substrate
```

---

## 28. Final principle

The objective is not to imitate Prime Agent.

The objective is to recognize that XTRM is already converging on the responsibilities of an agent harness and to decide deliberately whether those responsibilities should be unified around Pi's native runtime primitives.

The proposal should be accepted only if that unification lets XTRM retire glue and duplicate authorities.

The desired outcome is:

```text
fewer competing runtime concepts
+ stronger deterministic governance
+ richer agent capability
+ first-class RLM
+ better recovery and continuity
+ clearer ownership
```

not simply:

```text
more infrastructure
```
