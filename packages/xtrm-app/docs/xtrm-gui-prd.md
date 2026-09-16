# XTRM Agentic Operating Environment PRD

**Status:** Draft v0.3 — product-direction baseline + canonical Console v2 amendments (§34, 2026-09-16)  
**Package:** `xtrm-dev/xtrm/packages/xtrm-app`  
**Product surface:** XTRM Console / desktop agent harness  
**Primary runtime:** Pi `AgentSessionRuntime`  
**Primary interaction unit:** `Frame` (`InteractionFrame`)  
**Primary planning unit:** executable work contract (Issue / Bead / step contract)  
**Shell contract:** `console-v2-shell-architecture.md` (canonical) · **Adoption record:** `adoption-audit.md` §10–15

> Section 34 records accepted Console v2 decisions. Where §34 and an earlier section disagree, §34 wins; the affected earlier sections carry an inline pointer.

## 1. Product objective

Build an agent-native operating environment for planning, executing, coordinating, observing, and governing work across repositories, projects, products, and programs.

XTRM is not primarily a chat client, IDE skin, task tracker, or multi-agent dashboard. It is a unified work environment where:

```text
planning
execution
coordination
observability
evidence
governance
```

are projections of the same underlying work substrate.

The product must preserve Pi as the initial mature agent harness and ecosystem while introducing XTRM-owned interaction and planning paradigms above it.

The core product thesis is:

> **XTRM does not treat planning, agent interaction, multi-agent coordination, and observability as separate products. They are projections of the same governed work substrate.**

The vision is broad, but delivery must remain staged. The first accepted vertical still needs to prove the interaction substrate against real provider activity before the full coordinated/governed environment is considered implemented.

## 2. Product primitives

Three UI primitives define normal XTRM interaction:

```text
MAIN SURFACE
work

DRAWER
inspect / control / traverse

COMPOSER
instruct / reference / coordinate
```

These primitives are reused across first-class entities rather than giving every subsystem an isolated application shell.

First-class entities may include:

```text
Repository
Issue / Bead / Step
Epic / parent work contract
Frame
Agent
Chain / ChainRun
Program workstream / assignment
Artifact
Pull request / commit
Evidence item
```

The same entity may be projected differently depending on whether it is primary work, secondary inspection, or structured context attached to the composer.

## 3. Core interaction concept: Frame

A `Frame` represents one human interaction and all agent activity that belongs to it until the agent is fully settled.

```text
human ingress
    ↓
Frame
├─ request
├─ activity
│  ├─ provider turns
│  ├─ reasoning/thinking presentation
│  ├─ assistant messages
│  ├─ tool executions
│  ├─ agent-to-agent interactions
│  ├─ specialist dispatches
│  ├─ chain activity
│  ├─ retries
│  ├─ compaction
│  ├─ review/evidence activity
│  └─ other normalized runtime activity
└─ settled response
```

User-facing terminology is `Frame`.

**Accepted invariant (§34.8).** A Frame belongs to exactly one AgentSession. Other agents keep their own AgentSessions and Frames. Cross-agent aggregation belongs to Agents, ChainRun, Graph, and Observability; it is not Frame identity.

Reserved terminology:

```text
turn   provider/runtime-level concept
run    execution/runtime concept
step   workflow/chain concept
Frame  XTRM human-facing interaction unit
```

The working boundary is:

```text
idle user submit
    → open Frame

all provider activity caused by that interaction
    → belongs to the Frame

provider becomes truly settled
    → close Frame
```

For Pi, `agent_settled` is the authoritative initial close boundary. `agent_end` alone is not sufficient because retries, compaction retries, or queued continuation may still occur.

Initial Frame status vocabulary:

```text
working
settled
failed
aborted
```

A minimal conceptual contract:

```text
InteractionFrame
  id
  sessionRef
  branchRef
  parentFrameId?
  ingress
  startedAt
  settledAt?
  status
  activity
  response
```

## 4. Conversation history paradigm

XTRM must not present the session as one unbounded vertical transcript.

The current Frame is foreground work. Conversation history is available immediately but is not permanent screen chrome.

Default composition:

```text
selected Frame
  request
  activity
  response
  composer
  ─────────────────
  recent Frame history dock
```

The recent-history dock sits beneath the composer and provides immediate navigation among nearby Frames.

A History action expands a larger history surface upward from the dock. That surface has at least two projections:

```text
Frames
  interaction-centric overview

Tree
  provider-native branch/fork topology
```

The model is:

```text
current Frame
  = foreground work

recent Frames dock
  = immediate history

Frames view
  = interaction history

Tree view
  = alternate/fork topology
```

Conversation forks and branches are first-class and visible.

Visual branch compression is non-destructive and must not mutate provider-native transcript history.

For Pi:

```text
SessionManager tree
        ↓
ConversationGraph projector
        ↓
Frames / Tree projections
```

Keep same-session branch navigation distinct from independent session fork.

User-facing actions include:

```text
Branch here
Fork as new conversation
```

Visual branch compression remains UI-only unless an explicit provider/runtime compaction operation is invoked.

## 5. Repository context and Console shell

The global repository selector is persistent context and must not be replaced by generic navigation.

The conceptual hierarchy is:

```text
current Console surface
        ↓
eligible repositories
        ↓
selected repository / working context
        ↓
selected view
```

> **Amended by §34.3–34.4.** The single left "Console rail" below is replaced by a persistent global icon rail plus a contextual sidebar. The repository selector lives at the top of the contextual sidebar. The candidate surface list is refined by `console-v2-shell-architecture.md` §8.

The left Console rail provides repository context and major product surfaces.

Candidate top-level surfaces:

```text
Issues / Planning
Graph
Agent
Agents
Specialists / Chains
Program
Observability
Explore
```

The repository rail must be truly collapsible: collapsed mode reduces the rail itself, not only its labels. It should preserve recognizable repository and navigation affordances without crowding the workspace.

Under §34.3 this requirement applies to the **contextual sidebar**: it collapses to a narrow rounded reopen rail. The global icon rail never collapses.

The Agent surface must fit cleanly inside the global Console shell. It must not add another permanent conversation sidebar inside the main workspace.

## 6. Main surface contract

The main surface is for primary work.

Examples:

```text
Issues
  primary work = planning and contract refinement

Agent
  primary work = selected agent session / current Frame

Agents
  primary work = live fleet / execution presence

Program
  primary work = cross-repository intent and governance

Graph
  primary work = relationship topology
```

A main surface should not duplicate the same entity information that is already available in the drawer. It should focus on the work mode that justifies becoming the primary surface.

## 7. Global drawer contract

The drawer is the global secondary interaction surface.

Its purpose is to understand, control, and traverse related work without losing the current primary workspace.

The same canonical drawer shell must be used across Issues, Agents, Program, Graph, Agent activity, and other surfaces. Do not create parallel entity-specific drawer implementations.

### 7.1 Drawer states

The drawer supports four primary states:

```text
CLOSED
  only the right inspector rail is visible

CONTEXTUAL
  open on the currently inspected entity

PINNED
  entity remains selected while the user navigates primary surfaces

MAXIMIZED
  deep inspection / execution-control mode
```

A separate `FOLLOW_LIVE` flag may be active for live entities such as agents or chains. It is orthogonal to the four states, not a fifth state (§34.5).

### 7.2 Inspector rail

The collapsed inspector rail remains visible on the right side of the content area.

Requirements:

- it does not overlap primary content in collapsed mode;
- it has the same vertical inset and system radius as the expanded drawer geometry;
- when expanded it becomes physically attached to the drawer with no gap;
- it remains narrow and does not become a second navigation sidebar.

### 7.3 Drawer maximize

Maximized drawer mode is for deep inspection, not a generic fullscreen modal.

When maximized:

```text
global rail | collapsed contextual reopen rail | expanded inspector rail + large drawer
```

(§34.5: "repository rail" in this section means the contextual sidebar. The global rail is always visible and is never covered.)

Requirements:

- the drawer approaches the left collapsed repository rail but never overlaps it;
- maximizing automatically collapses the repository rail if it was open;
- restoring reopens the repository rail only if maximize caused that collapse;
- a repository rail manually collapsed before maximize remains collapsed after restore;
- drawer rail and drawer remain one attached visual object;
- the main workspace remains conceptually present behind the secondary surface.

### 7.4 Drawer navigation stack

The drawer maintains traversal history so a user can move through related entities without abandoning the primary surface.

Example:

```text
Agent: pi-main
  ↓
Issue: b73q.4
  ↓
Chain: SCID remediation
  ↓
Agent: test-engineer

‹ back
```

### 7.5 Promote to primary surface

Inspected entities may expose an action that promotes them into their primary work surface.

For agents this action is `Open session`.

Example:

```text
Agents list
  click pi-main
    → Agent drawer

Open session
    → pi-main becomes the main Agent surface
```

The key rule for Agents is:

> **Agent presence is inspected in the drawer; agent work is performed in the Agent surface.**

When the current agent already occupies the main Agent surface, the drawer should normally inspect adjacent entities rather than duplicate the current agent.

Useful combinations include:

```text
MAIN
pi-main session

DRAWER
quant-reviewer
```

or:

```text
MAIN
test-engineer session

DRAWER
pi-main coordinator
```

This provides lightweight comparative inspection without permanent split panes.

### 7.6 Drawer interaction with composer

Drawer actions should feed structured references or commands into the composer rather than opening disconnected modal workflows.

Examples:

```text
Agent drawer → Message
  composer target becomes @agent:quant-reviewer

Issue drawer → Attach contract
  composer receives @issue:b73q.4

Chain drawer → Attach chain
  composer receives @chain:scid-remediation
```

### 7.7 Drawer MUST / MUST NOT

The drawer MUST:

- inspect any first-class entity;
- preserve the current primary workspace;
- support entity traversal with history/back;
- expose entity-specific actions according to authority;
- bridge planning, execution, coordination, and evidence;
- support contextual, pinned, and maximized states;
- optionally follow live entities;
- promote an inspected entity into its primary surface;
- integrate typed references and actions with the composer.

The drawer MUST NOT:

- become another permanent navigation sidebar;
- duplicate the content of the primary surface;
- create parallel entity-specific drawer shells;
- invent a separate source of execution or telemetry truth;
- obscure repository context when maximized.

## 8. Planning is a first-class product surface

Issues / Beads are not merely a task list. They are XTRM's executable planning language.

The product principle is:

> **Tracked work cannot execute until its contract is complete.**

A tracked work item should be able to represent, when applicable:

```text
Problem
Outcome / success
Scope
Non-goals
Constraints
Inputs
Expected outputs
Dependencies
Validation
Scrutiny / review expectation
Authority
Owner / role
```

The exact schema may differ by issue class or step role, but planning information required for execution must live in the tracked contract rather than in parallel Markdown plans or hidden coordinator prompts.

The UI should make contract readiness explicit.

Illustrative lifecycle:

```text
DRAFT
  missing required contract fields

READY
  contract complete
  gating dependencies satisfied

CLAIMED
  execution identity assigned

IN PROGRESS

IN REVIEW

DONE
```

`READY` is an execution gate, not merely a cosmetic status.

Planning surfaces should use calm Jira-like rows for collections. Tables are reserved for true matrices.

The Issue drawer is where the full contract, execution, and evidence relationship becomes inspectable.

Example:

```text
b73q.4
Correct SCID attribution

READY

Contract
  ...

Execution
  ● pi-main
    Frame 15

Children
  quant-reviewer
  test-engineer

Evidence
  commits
  tests
  review
```

This makes the continuity explicit:

```text
contract
+
execution
+
evidence
```

## 9. Program is not a second task tracker

Program provides cross-repository intent, governance, portfolio state, and reconciliation.

Program may own or project concepts such as:

```text
workstreams
assignments
authority
portfolio state
decisions
evidence
reconciliation
cross-repository lineage
```

Executable repository work remains authoritative in Issues / Beads / step contracts.

Program must not duplicate executable work descriptions, statuses, subtasks, or acceptance state as a parallel tracker.

The Console may project Program and executable work together because it is a read model, not because the underlying records are duplicated.

Example:

```text
WS-003
  ↓
EXP-023
  ↓ executable implementation
market-data:b73q
market-data:b73q.4
infra:xxx
```

The Program drawer should emphasize traversal to executable work and evidence rather than recreate an Issue drawer with copied fields.

## 10. Typed references and first-class composer commands

The composer is not a plain text box only. It is a structured coordination surface.

XTRM should support typed references such as:

```text
@issue:b73q.4
@epic:b73q
@agent:rates-coordinator
@frame:15
@artifact:<id>
@program:EXP-020
@chain:<id>
@pr:<number>
```

These references must not be decorative prompt text. They should resolve to structured context objects with identity, source reference, current state, and authority metadata where applicable.

Conceptual contract:

```text
ContextReference
  kind
  id
  source
  revision?
  currentState?
  authority?
```

Candidate first-class commands include:

```text
/plan
/work
/message
/dispatch
/review
/run-chain
/open
```

Examples:

```text
/work @issue:b73q.4
/plan @epic:b73q
/message @agent:quant-reviewer
/run-chain @issue:b73q
```

Autocomplete should resolve concrete repository-local and workspace-wide entities rather than forcing users to memorize IDs.

## 11. Agent identity, roles, and capabilities

XTRM should not present `Agents` and `Specialists` as fundamentally different species.

An XTRM agent has:

```text
identity
role
capabilities
authority
runtime
execution context
```

Roles may include:

```text
coordinator
executor
reviewer
researcher
test engineer
SRE
specialist capability profiles
```

A Specialist is an agent with a specific capability / contract profile. A coordinator is an agent with planning, dispatch, fan-out/fan-in, or acceptance authority within its authority envelope.

Internally do not define `Specialist == Pi subagent`.

Pi child sessions are one possible implementation mechanism, not the semantic definition of a Specialist.

## 12. First-class Agents presence view

XTRM needs a first-class surface for observing active and recent agents across the current repository or workspace.

The default presentation should be list-first rather than graph-first.

Example:

```text
ACTIVE AGENTS

market-data

● pi-main
  Coordinator
  b73q · Worker cleanup and pruning
  Frame 15 · thinking
  12s

  ├─ ● quant-reviewer
  │    reviewer · b73q.4
  │    inspecting
  │
  └─ ○ test-engineer
       waiting on implementation

console

● claude-ui
  Executor
  forge-7xu
  editing Sidebar.tsx
  41s
```

Useful grouping modes include:

```text
repository
work item
parent agent
chain
role
```

Clicking an agent opens its drawer.

`Open session` promotes that agent into the main Agent surface.

Clicking its work item opens the Issue / Program entity in the drawer.

Clicking its chain opens ChainRun inspection.

A topology/graph projection may exist as a secondary view for complex relationships, but it should not be the default fleet view.

## 13. Agent drawer

The Agent drawer is a central interaction surface for live execution.

Recommended tabs:

```text
Overview
Live
Work
Coordination
Telemetry
Evidence
```

### Overview

Show compact identity and execution context:

```text
identity
role
runtime
model
repository
working directory
current contract
current Frame
parent coordinator
children
status
started
last activity
```

### Live

Show a semantic live execution projection rather than a raw log stream.

Example:

```text
14:23:02  reading src/scid.rs
14:23:08  tool · rg sentinel
14:23:11  tool · read record.rs
14:23:24  message → quant-reviewer
14:23:39  quant-reviewer replied
14:23:44  reasoning
14:23:57  editing summary.rs
```

Each event may expand into richer evidence or raw detail when available.

### Work

Show the current executable contract and parent/child relationship.

Example:

```text
b73q
  SCID remediation

b73q.4
  Correct price attribution

contract state: READY
execution: active
acceptance: pending
```

Useful actions:

```text
Open issue
Attach issue to composer
Open parent epic
Open Program assignment
```

### Coordination

Show semantic coordination state:

```text
Parent
  pi-main

Children
  quant-reviewer
  test-engineer

Messages
  → quant-reviewer
  ← quant-reviewer

Chain
  SCID remediation
  2 / 4 gates
```

### Telemetry

Show contextual operational telemetry such as:

```text
runtime
model
context utilization
tokens
tool calls
retries
compactions
children
messages
cost where available
last heartbeat
```

This is a lightweight execution view, not an embedded monitoring dashboard.

### Evidence

Show concrete execution evidence:

```text
commits
diffs
tests
reviews
tool evidence
result-contract evidence
forensic events
```

### Agent actions

Actions are authority-derived, not universally available.

Possible actions include:

```text
Open session
Message
Steer
Follow-up
Request review
Dispatch specialist
Start chain
Pause
Resume
Stop
```

The UI must not expose controls the current principal is not authorized to invoke.

## 14. Agent-to-agent interactions inside Frames

Multi-agent work must not be hidden behind opaque generic tool calls.

The Frame activity stream should normalize semantic interactions such as:

```text
Tool
Agent message
Specialist dispatch
Chain launch
Review request
Result receipt
Handoff
Retry
Compaction
```

Example presentation:

```text
Ran 4 commands

Messaged rates-specialist
  "Verify SCID price semantics against the format spec"

rates-specialist replied
  conclusion · evidence · 3 refs

Dispatched test-engineer
  b73q.4 · validation contract

test-engineer
  running · 7/12 checks
```

The transport implementation may be Channels, intercom, provider-native messaging, or another adapter. The UI should represent the semantic interaction, not expose transport machinery as the product concept.

Provider messaging is transport. It does not grant workflow authority.

## 15. Chains and governed execution

A Chain is a governed autonomous execution of a contract, not merely a UI grouping of agents.

A user may eventually invoke autonomous execution from an Issue or Epic:

```text
Issue / Epic
  ↓
/run-chain
  ↓
resolved governed execution
```

The resulting ChainRun may coordinate agents such as:

```text
Coordinator
    │
    ├── implementation agent
    ├── test engineer
    └── reviewer
```

The default UI need not show a graph permanently.

A Chain may appear inline in Frame activity as:

```text
Chain · SCID remediation          3/4 gates

✓ implementation
● validation
○ review
○ acceptance
```

Clicking the Chain opens ChainRun inspection in the drawer.

The GUI must project the existing governed runtime / evidence model rather than create a second contradictory terminal state machine.

## 16. Observability, telemetry, and evidence

Observability is part of work, not only a separate monitoring dashboard.

Contextual telemetry belongs near the entity being worked on.

For an Agent:

```text
runtime
model
tokens
context utilization
tool calls
retries
compactions
children
messages
cost
last heartbeat
```

For a Chain:

```text
wall time
aggregate model spend
workers
failed attempts
retries
gate latency
```

For an Issue:

```text
executions
failed attempts
review iterations
time to acceptance
```

A separate Observability surface may provide fleet-wide analysis and comparisons.

Telemetry and evidence shown by the GUI must remain projections of canonical runtime/evidence contracts. Prometheus or UI-local counters must not become the authoritative source of execution truth.

Existing XTRM forensic / AgentOps event contracts should be reused and extended where needed rather than replaced by a GUI-only event model.

## 17. Activity normalization

The GUI should consume normalized semantic activity records rather than provider-specific raw event blobs.

A base tool activity may resemble:

```text
ToolActivity
  kind
  title
  subject
  status
  duration
  count/diff metadata
  preview
  fullResultRef
  locations?
  diff?
```

The broader activity vocabulary should be extensible to coordination and governance:

```text
ToolActivity
AgentMessageActivity
SpecialistDispatchActivity
ChainActivity
ReviewActivity
EvidenceActivity
RetryActivity
CompactionActivity
```

Heavy output must support deferred/lazy rendering so long sessions do not require mounting all tool result content.

Activity is collapsed by default unless the current state requires attention.

## 18. Input semantics

For the Pi-native vertical:

```text
session idle + normal Send
    → new Frame

session running + explicit steer
    → same Frame

session settled + next normal Send
    → next Frame
```

Do not silently classify every queued/follow-up/steering message as a new Frame until those semantics are explicitly designed and tested.

Commands and typed references are orthogonal to Frame creation. A structured reference attached to a normal idle submit still creates a normal new Frame unless the invoked command has explicit alternate semantics.

## 19. Pi compatibility is a product requirement

XTRM is an alternative product/interface around Pi, not a replacement for Pi's harness.

The implementation must preserve Pi-native behavior unless XTRM has an explicit reason to add governance or presentation translation.

Required compatibility surface includes:

```text
Pi built-in tools
Pi extensions
extension tools
extension hooks/events
extension commands
skills
prompt templates
AGENTS/context files
themes where applicable
models
authentication
settings
session persistence
session tree
resume
fork
compaction
steer/follow-up semantics
```

The implementation must use Pi's existing runtime/resource machinery where possible. Do not create parallel discovery for extensions, skills, prompts, context files, settings, models, or credentials.

The default Pi path should use `DefaultResourceLoader` or the exact current equivalent from the installed Pi version.

## 20. Extension compatibility model

Most Pi extension behavior should remain usable in the GUI.

Portable extension behavior includes:

```text
registerTool
lifecycle/event hooks
registerCommand
resource contributions
skills/prompts/themes
provider registration
status/notification semantics
session persistence entries
```

Pi TUI-specific custom components cannot be rendered directly by a React GUI.

The GUI must distinguish:

```text
portable semantic extension behavior
        ↓
GUI-native representation

terminal-specific custom UI
        ↓
translated fallback
or explicit tui_only disposition
```

A host abstraction should cover common extension UI semantics where practical:

```text
notify
status
widget
select
confirm
input
editor
title
custom surface
```

Do not promise visual parity for arbitrary TUI-only extension components.

## 21. Shared interaction substrate

The GUI must not depend on TUI rendering code.

The GUI and TUI should share semantic/runtime contracts only.

Target shape:

```text
Pi AgentSessionRuntime
        ↓
InteractiveSessionHost
├─ provider/session lifecycle
├─ resource/extension binding
├─ Frame projection
├─ activity normalization
├─ conversation graph projection
└─ coordination capability seam
        │
   ┌────┴────┐
   ▼         ▼
xtrm-tui   xtrm-app
pi-tui     React/Tauri
```

Likely shared concepts:

```text
InteractionFrame
FrameState
FrameProjector
ToolActivity
ConversationGraph
SessionHost
ExtensionBinding
ContextReference
AgentIdentity
```

Do not create a new shared package until actual duplication justifies one.

## 22. Provider/event model

The GUI must not branch directly on provider-specific event names.

Use an adapter boundary:

```text
provider-native events
        ↓
adapter
        ↓
small XTRM interaction-event vocabulary
        ↓
FrameProjector / agent presence projector
        ↓
GUI state
```

For Pi, preserve the richer native semantics needed by Frames:

```text
turn_start / turn_end
tool_execution_start/update/end
message streaming
retry lifecycle
compaction lifecycle
agent_end(willRetry)
agent_settled
session tree
navigateTree
fork
```

Pi remains native-first because its event/tree/settled semantics map directly to the product model.

## 23. Non-Pi agents and ACP

Do not immediately implement one custom adapter per ACP-capable agent.

Preferred direction after the Pi vertical:

```text
Pi
  native AgentSessionRuntime

non-Pi ACP-capable agents
  AcpAdapter
      ↓
    ACP runtime layer
      ├─ Claude
      ├─ Codex
      ├─ OpenCode
      └─ future ACP agents
```

Evaluate `AcpKit/acp-kit` as the preferred generic ACP runtime before building equivalent process/auth/session/event-normalization machinery.

Characterize provider-specific adapters only when a provider capability cannot be represented through the generic ACP lane without losing required product semantics.

## 24. Open-source adoption policy

Before implementing commodity agent-client infrastructure, evaluate maintained permissively licensed implementations.

Use explicit dispositions:

```text
DEPEND    consume maintained package/API
ADAPT     bounded adaptation with provenance
REFERENCE study architecture/tests/failure handling only
REJECT    do not adopt
```

High-priority references remain:

- `zvzuola/acp-components` for bounded session/workspace state, tool UI, permissions, diff/file, composer, Tauri abstraction, and session CRUD/fork mechanics;
- `AcpKit/acp-kit` for non-Pi ACP runtime lifecycle;
- OpenCode `session-ui` for projection, tool rendering, deferred rendering, virtualization, diff/review, and composer state-machine ideas;
- Panes for Tauri 2 + React architecture, sidecar lifecycle, SQLite/FTS, session replay, crash recovery, lazy hydration, and Linux packaging;
- Hermes IDE as reference only while its licensing terms restrict competing IDE/editor use.

Do not adopt a stock workbench shell if it forces chat-first information architecture.

Do not copy OpenCode's vertical transcript navigation model.

## 25. Desktop process architecture

Initial target:

```text
<Tauri 2 desktop shell>
    React / TypeScript UI
          │
          │ typed local IPC
          ▼
<Node 24 agent host>
    ├─ PiNativeAdapter
    │    └─ AgentSessionRuntime
    └─ AcpAdapter later
         └─ ACP runtime
```

Tauri is preferred for a small Linux-first native shell.

Electron remains a bounded fallback only if Tauri + sidecar packaging creates disproportionate implementation or maintenance friction.

The provider SDK/runtime must not run inside the WebView when it depends on Node process APIs.

## 26. Persistence and authority

Provider/session history remains authoritative for transcript and branch topology.

The GUI should not create a second authoritative transcript database.

Provider-owned truth includes:

```text
messages
tool results
provider session identity
provider-native branch/fork history
compaction entries
```

Canonical planning / governance / evidence sources remain authoritative for their own domains. The GUI is a projection layer and action surface, not a replacement source of truth.

App-owned state may include:

```text
project registry
provider-session mapping
Frame projection cache
Frame title
selected Frame
UI-collapsed branches
favorites/pins
layout/window state
drawer pin/navigation state
provider-independent graph edges not recoverable from provider
```

A small SQLite application index is acceptable where useful.

## 27. Visual system and product identity

The target is not a reskinned ACP client, OpenCode clone, Pi desktop clone, GitHub Dark imitation, Linear imitation, or generic monitoring dashboard.

XTRM and Mercury Intelligence are sibling products in the same family. They should share family-level design discipline without sharing identity accent or becoming visually interchangeable.

Current XTRM identity direction:

```text
base identity          #833CF0
dark-surface text role accessible light violet derivative
```

Design principles:

- restrained neutral surfaces;
- XTRM Violet used sparingly for identity, selection, and focus;
- dark theme uses an accessible lighter violet role rather than forcing the base identity color onto small text;
- thin separators and structure before shadow;
- 6 / 8 / 12 px radius family;
- no card soup;
- no glassmorphism;
- no large pill-heavy UI;
- no rainbow status system;
- no general monospace aesthetic;
- calm Jira-like collection rows;
- continuous reading surfaces for agent response/source content;
- graph only when relationships are the primary task;
- dense but readable default density (§34.9 supersedes the earlier "comfortable default, compact optional" rule);
- narrow readable content column where appropriate;
- minimal provider branding.

A screenshot should remain recognizably XTRM after provider names and logos are removed.

## 28. Performance requirements

The GUI must remain responsive when sessions contain many Frames, active agents, and large tool outputs.

Required properties:

- selected Frame navigation does not mount all prior Frames;
- Frames history remains responsive with large session histories;
- Tree projection is lazy where possible;
- large tool results are not eagerly mounted;
- switching Frames preserves independent scroll/view state where useful;
- background session activity does not disappear because a React component unmounted;
- Agents presence view does not require mounting every raw event;
- drawer live-follow uses bounded/lazy projection rather than replaying the full session on every update;
- graph views defer expensive layout and rendering until explicitly opened.

Adopt proven projection/virtualization/lazy-hydration patterns before inventing custom rendering infrastructure.

## 29. Delivery sequence

The product vision is intentionally broader than the first deliverable. Do not attempt to ship the full operating environment in one implementation wave.

### v0-base — Console v2 base shell (§34.10)

Delivered first, before the Pi-native Agent vertical: canonical documentation baseline, then an executable React shell in `packages/xtrm-app` with Substrate Issues, Program, and GitHub/repository Activity as the first real surfaces. The Agent and Agents destinations exist as explicit placeholders.

### v0 — Pi-native Agent surface and Console substrate

Prove:

```text
Pi AgentSessionRuntime
DefaultResourceLoader
extensions / skills / prompts / context
FrameProjector
activity normalization
agent_settled boundary
current Frame
recent Frames dock
Frames history view
Tree history view
resume / fork / reconstruction
composer
repository context
shared inspector drawer shell
true contextual-sidebar collapse (global rail persistent)
right inspector rail
normal / maximized drawer behavior
```

Also provide the first read-only or low-risk Issues / planning projection sufficient to connect Frames to tracked work without attempting full governance.

### v0.5 — executable planning and agent presence

Add:

```text
executable Issue / Bead contract presentation
contract readiness / READY gate projection
typed @ references
/plan
/work
/message
first-class Agents presence view
Open session
basic contextual telemetry
issue ↔ agent ↔ Frame traversal
```

### v1 — coordinated governed execution

Add:

```text
coordinator / specialist interactions
agent-to-agent messaging projection
specialist dispatch / result / resume / stop
ChainRun projection
/run-chain
issue / epic → autonomous governed chain
Program projection without executable-work duplication
evidence integration
richer telemetry
Observability surface
```

### Later

Potential later integrations include:

```text
remote multi-host scheduling
richer ACP provider coverage
advanced governance / result validation
persistent artifact workspaces
remote execution
additional coordination transports
```

## 30. Explicit non-goals for the first vertical

The first accepted vertical does not require:

- complete Specialists chain governance;
- full ChainRun control UI;
- universal Channels workflow authority;
- remote multi-host scheduling;
- replacing Pi persistence;
- replacing Pi extension/skill discovery;
- universal transcript database;
- destructive branch compression;
- exact visual parity for arbitrary Pi TUI extension components;
- one custom provider adapter per agent without evidence it is needed;
- a second Program task tracker;
- a second GUI-native telemetry authority;
- building a complete IDE before the Frame model is proven;
- implementing every planned slash command before the typed-reference substrate exists.

## 31. Acceptance criteria — first Agent vertical

The first accepted Agent vertical must prove all of the following against real provider activity, not mocked-only flows:

1. Linux application launches.
2. Operator selects or opens a working directory / repository context.
3. A real Pi session is created through Pi runtime APIs.
4. Pi's normal resource discovery remains active.
5. Existing compatible extensions, skills, prompts, AGENTS/context, settings, models, and auth remain available.
6. A first user submit creates Frame 1.
7. Real assistant/tool/retry activity is projected into Frame 1.
8. `agent_end(willRetry=true)` does not settle Frame 1.
9. `agent_settled` settles Frame 1 exactly once.
10. A second idle submit creates Frame 2.
11. Frame 1 and Frame 2 are switchable without re-prompting the agent.
12. Current Frame remains the foreground work surface rather than appearing in an unbounded transcript.
13. Recent Frames are reachable from a dock beneath the composer.
14. History expands into a Frames projection without permanently occupying a sidebar.
15. The same history can switch to a provider-native Tree / fork projection.
16. Activity groups are collapsed by default and can be inspected.
17. Individual tool activity can expose command/output detail lazily.
18. Repository context persists while switching Console surfaces.
19. The contextual sidebar truly collapses its physical width to the reopen rail; the global icon rail stays visible.
20. The canonical right inspector rail remains visible in collapsed state without overlapping primary content.
21. The drawer opens attached to the inspector rail with no gap.
22. The drawer can maximize without covering the global rail or the collapsed contextual reopen rail.
23. Maximizing the drawer auto-collapses the contextual sidebar and restores it according to the state rules in this PRD and `console-v2-shell-architecture.md` §4.3.
24. At least one first-class entity can be inspected in the drawer and promoted to a primary surface.
25. `Open session` promotes an inspected Agent into the main Agent surface once the Agents projection exists.
26. Background runtime activity remains alive when the visible Frame or surface changes.
27. Long tool outputs do not require eager mounting of the full session history.
28. No GUI-local state contradicts provider-owned session history.

## 32. Acceptance criteria — planning / coordination expansion

The v0.5 / v1 expansion is accepted only when the following properties are proven against real canonical sources and runtime behavior:

1. Issue / Bead contracts are projected from their authoritative source rather than copied into a second tracker.
2. Contract readiness is derived from explicit required fields / gates rather than a cosmetic UI toggle.
3. Typed Issue / Agent / Frame references resolve to structured context objects.
4. `/work` can bind an Agent Frame/session to a concrete executable work contract.
5. Agents presence reflects real active execution identity and does not infer presence from stale UI state.
6. `Open session` switches to the selected real provider session without creating a duplicate conversation.
7. Agent-to-agent interactions are rendered semantically in Frame activity while preserving underlying transport provenance.
8. Agent drawer actions are authority-derived.
9. ChainRun UI projects canonical governed runtime/evidence state and does not invent a parallel terminal state machine.
10. Program links cross-repository intent to executable work without duplicating Issue/Bead authority.
11. Telemetry and Evidence tabs are backed by canonical runtime / forensic / AgentOps sources where applicable.
12. UI-local counters, Prometheus projections, or cached summaries cannot override canonical execution/evidence truth.

## 33. Product decision summary

The direction established by this PRD is:

```text
                         XTRM
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
      PLAN               ACT              OBSERVE
        │                 │                  │
      Issues            Frames             Agents
      Epics             Composer           Chains
      Program           Tools              Telemetry
      Contracts         Messages           Evidence
        │                 │                  │
        └────────────── COORDINATE ─────────┘
                          │
                    Specialists
                    Coordinators
                    Channels
                    ChainRun
```

Below the product layer:

```text
Pi / ACP / provider runtimes
Beads / executable work contracts
Git
Program
XTRM forensic / AgentOps evidence
```

The defining product behavior is not that XTRM has all of these features. It is that planning, execution, coordination, observation, and evidence remain connected as the same work moves through them.

## 34. Console v2 canonical baseline — accepted amendments (2026-09-16)

This section reconciles the PRD with the closed PR #170 audit pack (head `e1bc91236caf5fd95a4729da8ae8b6f5ee5eb35c`) and the Supernova/PiChamber audits (`xt/rq8w @ a13989f`). It amends the PRD. It does not replace it. The PR #170 rewrite of this file is intentionally **not** adopted, because it removed the Frame canon in §3–4.

Evidence: `adoption-audit.md` §10–15 and the `console-v2-audit-*.md` files. Shell mechanics: `console-v2-shell-architecture.md` (canonical). Sequencing: `console-v2-migration-plan.md`.

### 34.1 Implementation root

Console v2 is implemented in `xtrm-dev/xtrm/packages/xtrm-app`. The current `Jaggerxtrm/console` host is a reusable backend during migration (repository discovery, GitHub fetch/cache, realtime). It is not the target UI architecture.

### 34.2 Visual benchmark

Supernova-level restraint and cleanliness is the visual benchmark (`console-v2-audit-supernova.md` §1). XTRM adopts mechanisms and discipline from it, not its identity: palette, accent, font, and product naming stay XTRM-owned (§27).

### 34.3 Shell

```text
GLOBAL ICON RAIL          persistent, application-level, never collapses
CONTEXTUAL SIDEBAR        repository / work navigation; collapses to a narrow rounded reopen rail
PRIMARY SURFACE           current work
INSPECTOR RAIL + DRAWER   canonical drawer (§7, §34.5)
```

- The global rail is XTRM-owned new work. Neither Conar nor Supernova provides a precedent.
- The global rail never shows repository-specific state.
- The contextual sidebar is grouped as `Work` / `Code` / `System` / `Governance`. `XTRM Issues` and `GitHub Issues` are distinct, differently labelled destinations.
- The shell does not add a permanent conversation sidebar or a permanent split pane (§5, §12).

### 34.4 Contextual sidebar, search, command, options

These concepts were lost in later visual mocks and are restored as requirements:

- **Expanded contextual sidebar** is a rich navigation and search surface: repository selector, full-width search field, grouped hierarchy with counts, status, and hover/focus row actions, footer actions.
- **Collapsed contextual sidebar** is a narrow rounded reopen rail with one reopen affordance. It is not zero width and not a second icon menu.
- **Repository selector** is persistent working context (§5).
- **Global search** stays prominent. It searches across entity kinds with the selected repository as default scope and one control to widen to the workspace. It is reachable from the sidebar field and from a keyboard palette when the sidebar is collapsed.
- **Command and options affordances** stay explicit: a command palette for navigation and actions, and `⋯` options menus on surface and drawer headers. Actions are authority-derived.
- **Collapsed inspector rail** stays visible and mirrors the collapsed contextual rail (§7.2).

### 34.5 Drawer

```text
CLOSED
CONTEXTUAL
PINNED
MAXIMIZED
FOLLOW_LIVE   orthogonal flag on any open state
```

- The drawer renders inside the primary region, so it cannot cover the global rail by construction.
- `MAXIMIZED` auto-collapses the contextual sidebar to its reopen rail and restores it only if the maximize action caused the collapse.
- One drawer primitive serves all entity kinds. The bottom dock, when built, is a docked mode of the same primitive.
- Drawer navigation uses a typed reference stack that shares vocabulary with composer references (§10).
- The inspected entity is URL-restorable.

### 34.6 UI stack

```text
Base UI                 @base-ui/react — single primitive layer
motion-panels           resizable shell panels, one XTRM adapter module, exact pin
TanStack Router         @tanstack/react-router
TanStack Virtual        @tanstack/react-virtual — only virtualization library
cmdk                    search and command palette
```

Versions, licences, the full dependency list, and open adoption items: `adoption-audit.md` §12 and §15.

### 34.7 Planning authority and data boundaries

- Substrate Issues are executable-work authority, read through the Substrate typed service and projections.
- The app never reads or writes `~/.xtrm/state.db` with SQL. No dual-write.
- UI components never know data origin. Data arrives through typed adapters: `adapters/github`, `adapters/substrate`, `adapters/program` (`console-v2-shell-architecture.md` §9.3).
- If the typed service lacks a required bounded or batched read, the UI is built against a typed fixture behind the adapter and the missing API is reported. The gap is never bypassed through SQLite.
- Program remains a governance and reference projection. It never duplicates executable Issue state (§9).

### 34.8 Frame

- A Frame belongs to exactly one AgentSession.
- Cross-agent aggregation is not Frame identity. It belongs to Agents, ChainRun, Graph, and Observability.
- Frame projection is session-local UI state over provider-owned session history (§26).
- Open contract details (optional response body, provisional IDs before settlement, child-agent references, compaction-only units) are inputs to the Agent/Frames tranche, recorded in `console-v2-audit-supernova.md` §3.3–3.6. They are not decided here.

### 34.9 Visual standard

```text
quiet · flat · restrained · professional · dense but readable
hairline borders · small number of surface levels · minimal shadows
hover/focus-revealed secondary actions · restrained XTRM violet accent
no card soup · no dashboard aesthetic · no cyberpunk/terminal styling
```

Concrete rules and the shared primitive list: `console-v2-shell-architecture.md` §15.

### 34.10 Delivery order

1. Canonical documentation baseline (this amendment). No product code.
2. Executable Console v2 prototype in `packages/xtrm-app`: shared primitives first, then shell, then Substrate Issues, Program, and GitHub/repository Activity as real surfaces. Agent, Agents, Graph, and Observability are explicit placeholder routes. No further static HTML mocks.
3. Agent/Frames runtime tranche, separately contracted, using Supernova and DeepSeek Harness as runtime/session references.

A visible Agent destination does not authorize starting the Agent/Frames tranche.

### 34.11 Disposition of PR #170 amendments A1–A12

| amendment | disposition |
|---|---|
| A1 global rail is XTRM-owned | adopted (§34.3) |
| A2 reserved collapsed contextual rail | adopted (§34.4; B1 mechanism) |
| A3 geometric rail protection | adopted (§34.5) |
| A4 dock is a drawer mode | adopted (§34.5) |
| A5 deep-linkable repository surfaces, disambiguated Issues labels | adopted (§34.3, §34.5; route contract in shell architecture §9.1) |
| A6 Base UI + motion-panels | adopted (§34.6) |
| A7 Console v1 visual contract shell rules superseded ("no rounded corners", "one shell, one sidebar", "no nested topbars") | adopted; its typography, density, and row-anatomy guidance remains input |
| A8 `Work` / `Code` / `System` / `Governance` groups | adopted (§34.3) |
| A9 Substrate readiness gate before wave E | amended: the gate applies to live integration only; UI work proceeds against a typed fixture (§34.7) |
| A10 Console v1 defect dispositions before cutover | adopted (`console-v2-audit-console-v1-preservation.md` §5–6b) |
| A11 placement open | resolved (§34.1) |
| A12 Agent scope unchanged after DeepSeek audit | adopted (§34.10) |
