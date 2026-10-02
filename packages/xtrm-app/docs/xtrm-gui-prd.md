# XTRM Agentic Operating Environment PRD

**Status:** Draft v0.3 — product-direction baseline + canonical Console v2 amendments (§34, 2026-09-16) + accepted agent-hosting / remote amendment (§35, 2026-10-02) + accepted Agent mode amendment (§36, 2026-10-02)  
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

> Amendment §36.2 makes the Agent surface one half of the shell, selected by a `Console` / `Agent` switch on the global rail.

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

> Amendment §36.6 adds `@gh-issue`, `@commit`, `@file`, and `@session`, and defines resolution, revision, and messaging rules.

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

> Amendment §35.3–35.5 defines how sessions started outside the GUI (tmux / `xt pi`) reach this view. §36.3 defines the per-session sidebar of the Agent half.

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

> Amendment §36.7 adds a tool `origin` and separate rendering contracts for native, MCP, Pi extension, and coordination tools.

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

> Amendment §35 makes this sidecar a client of an agent host and the in-process runtime an optional local mode.

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

> Amendment §35.7 moves single-host remote access into v0.

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

### 34.12 Review revision (2026-09-16)

After review of the first executable vertical: the rail selects modes and the sidebar shows only the active mode's context; global search moves to a full-width top bar; the inspector rail follows the v15 reference (separate column, floating inset drawer); Substrate Issues become a Jira-style surface with an issue page, in-place field editing, Markdown rendering, lossless contract writes through `sb` verbs, and reviewed normalization of imported contracts. Details: `console-v2-shell-architecture.md` §16.

## 35. Agent hosting, external sessions, and remote access — accepted amendment (2026-10-02)

Status: **accepted** (2026-10-02, XTRM-2; decisions in §35.8). This section amends §12, §25, §29, §30, and §31. It does not change the Frame canon (§3–4, §34.8) or the persistence rules (§26).

### 35.1 Problem

§25 assumes that the GUI and the agents share a host: the desktop shell starts a Node sidecar, and the sidecar runs Pi in-process through `AgentSessionRuntime`. This assumption fails in three ways for actual operation:

- **The agents run elsewhere.** Repositories, provider credentials, and agent sessions live on a server. The operator's desktop is a client. A sidecar on the desktop would run Pi on the wrong machine.
- **Most sessions start outside the GUI.** Operators and coordinators start agents in tmux through `xt pi` (roles, beads, parent/child panes). §12 requires a presence view across the repository or workspace, but no section says how the GUI observes a session it did not create.
- **Remote access is deferred.** §29 lists "remote execution" under Later and §30 lists "remote multi-host scheduling" as a non-goal. Neither the transport, the authentication, nor the client/server split is specified.

### 35.2 Evidence: the ACP-bridge model (`giuliastro/harness-remote` 3.1.1)

Harness Remote was run against a real XTRM host (2026-10-02). It drives each agent through an ACP adapter process that it owns (`@automatalabs/pi-acp`, `@agentclientprotocol/claude-agent-acp`, `codex-acp`) and discovers history by listing sessions through the adapter. Findings:

- **The model owns its own processes.** A session started in tmux is visible only as persisted history. The bridge cannot stream it. Prompting it loads the session into a second Pi process, so concurrent use branches the conversation.
- **Listing does not scale.** pi-acp implements `session/list` with `SessionManager.listAll`, which parses every journal on every call. With about 4,200 journals (2.6 GB), one scan took about 21 s on its own. Concurrent client polls queued behind each other for 30–140 s and hit the 30 s request timeout, so no Pi sessions were listed at all.
- **The adapters stay resident.** The Claude, Pi, and Codex adapters plus the bridge held about 1.3 GB RSS and 1 GB swap on a production host that was already under load.

Disposition (§24): **REFERENCE**. Adopt its principles: native sessions are authoritative, cross-agent and cross-machine handoff carries lineage, and capabilities and models are discovered from the running harness. Reject its process model as the primary Pi path.

### 35.3 Decision: push from inside the session

The primary Pi integration is an **XTRM Pi extension** that runs inside every live Pi session, however that session was started. The existing `herdr-agent-state` and `orca-agent-status` extensions already establish this pattern on XTRM hosts.

The extension:

- **pushes** native lifecycle events to the XTRM agent host: `session_start`, `before_agent_start`, `turn_end`, `message_end`, `tool_execution_start` / `_update` / `_end`, `agent_end`, `agent_settled`, `session_shutdown`. These map into the §22 vocabulary without loss, because they are the same events the Frame projector consumes;
- **accepts** commands from the agent host: user message (`pi.sendUserMessage`), steer / follow-up, abort, and extension-UI responses (§20);
- **attaches identity**: session id, cwd, worktree, role, bead / Substrate Issue, parent session, and tmux pane. This is the §11 identity read from the `xt pi` launch context (`@agent_task`, `@agent_parent_session`, `XTMUX_AGENT_BEAD`).

A session without the extension remains visible as history only (§35.5).

### 35.4 Launch: tmux-hosted sessions

The GUI starts agents through the existing launcher instead of hosting Pi itself.

A blank Agent surface asks for:

```text
working directory     repository / worktree picker (§5 repository context)
command               pi | xt pi
xt pi options         name · --role · --bead · --model · --thinking · --skill (repeatable) · --prompt · --parent / --child
```

The agent host runs the equivalent of `xt pi … --no-attach --json` (or a bare `pi` inside a new tmux session) and returns the `xtrm.command-outcome.v1` result, including `session_name:pane_id`. When the extension connects, the GUI binds the pane to the session, and Frame 1 starts on the first submit (§3).

Consequences:

- **The agent outlives the GUI.** Closing the app or losing the connection does not stop work.
- **The terminal stays an equal client.** `tmux attach` works for every GUI-started agent, and the GUI sees every terminal-started agent.
- **There is one launch path.** Roles, beads, worktrees, and specialist resolution remain owned by `xt pi`. The GUI does not duplicate them.

The in-process `AgentSessionRuntime` path from §25 remains allowed for local-only use. It is no longer the only path, and it is not required for the first remote-capable vertical.

### 35.5 Agent host

Each machine that runs agents runs one **XTRM agent host** process:

```text
Pi sessions (tmux) ──extension socket──▶ agent host ◀──authenticated API── GUI (desktop / web / mobile)
Claude sessions    ──hooks─────────────▶     │
                                             ├─ live session registry (pushed state)
                                             ├─ incremental session index
                                             ├─ launcher (xt pi --no-attach --json)
                                             └─ command routing to live sessions
```

- **Live registry.** Holds state pushed by the extension. Nothing is polled.
- **Incremental index.** Covers sessions that are not running. It is built from provider journals by watching files and re-reading only the ones that changed, never by full rescans per request. It is a projection cache in the §26 sense: journals stay authoritative.
- **API.** One API for local and remote clients. Local use goes through the same API over loopback, so remote is not a separate mode.
- **Binding and authentication.** The host binds to loopback or a private-network address (tailnet) only. Pairing uses a short-lived one-time token that is exchanged for a revocable device session. The host never binds a public interface by default.
- **Resource budget.** The host keeps no resident adapter per provider. Its idle cost is the registry plus the index.

- **Connection modes.** The desktop app supports two equal ways to reach a remote agent host:
  - *SSH (default for desktop).* The operator enters an SSH target (`user@host`, or a `~/.ssh/config` alias). The app uses the operator's own SSH keys and agent to probe the host, start or reuse the agent host bound to loopback, and forward that loopback port to the desktop. The agent host never listens on a network interface, no pairing token is needed, and access is exactly the operator's SSH access. Tailscale SSH works the same way.
  - *Direct (tailnet + pairing).* For clients that cannot run SSH, such as mobile and web, or for a host that is deliberately bound to its tailnet address.
- **SSH terminal handoff.** Every tmux-hosted agent offers "Open in terminal". This opens `ssh -t <target> tmux attach -t <session>` (or `switch-client` when already in tmux), so the GUI and the terminal stay interchangeable views of the same live session (§35.4).

### 35.6 Non-Pi agents

- **Claude Code** reports through its hook surface into the same agent host and uses the same identity fields. Prompting a live Claude session follows whatever its runtime supports, and the GUI shows only the capabilities that are actually advertised.
- **Codex and other ACP agents** keep the §23 direction (generic ACP lane, evaluate `acp-kit` first). An ACP adapter is started on demand for a session the operator opens. It is not kept resident for listing.

### 35.7 Changes to earlier sections

| section | change |
|---|---|
| §12 Agents presence | Presence covers every session reporting to the agent host, including tmux / `xt pi` sessions started outside the GUI. |
| §25 Desktop process architecture | The sidecar becomes a client of an agent host, local or remote, reached over SSH port forwarding or a direct tailnet connection (§35.5). The in-process Pi runtime is an optional local mode (§35.4). |
| §29 Later | "remote execution" moves into v0. "Remote multi-host scheduling" (placing work across hosts) stays Later. |
| §30 Non-goals | Remote access to a single agent host is no longer a non-goal. Multi-host scheduling remains one. |
| §31 criteria 2–3 | Become: the operator selects a working directory and a launch profile, the agent starts in tmux on the agent host, and the GUI binds to it within seconds. A session started from a terminal on the same host appears in Agents presence without GUI action. |

### 35.8 Decisions (formerly open items, decided 2026-10-02 under XTRM-2)

1. **Extension ↔ agent host transport.** The extension connects to a Unix domain socket at `$XDG_RUNTIME_DIR/xtrm/agent-host.sock` (fallback `~/.xtrm/run/agent-host.sock`, mode `0600`). Frames are newline-delimited JSON. Each frame carries `schema`, `seq`, `sessionId`, `at`, and a payload. Events use `xtrm.agent-event.v1`; commands use `xtrm.agent-command.v1`. Clients (xtrm-app, other tools) use HTTP plus Server-Sent Events on `127.0.0.1` under `xtrm.agent-host-api.v1`; the host writes its port and pid to `~/.xtrm/run/agent-host.json`. Rationale: socket file permissions give same-user authentication for local extensions at no cost, and HTTP + SSE passes unchanged through SSH port forwarding and a browser. The schemas are one versioned package (XTRM-6) and map one-to-one onto the §22 vocabulary and the §36.7 `origin` field.
2. **SSH bootstrap.** The app runs `ssh -o BatchMode=yes <target> -- "${SHELL:-/bin/sh}" -lc 'xt host ensure --json'`. The login shell resolves Node and `xt` under nvm, asdf, or mise. `xt host ensure` starts the host if it is not running and prints `{schema: "xtrm.agent-host-ensure.v1", version, protocol: {major}, port, pid}`. The app rejects a different protocol major and tells the operator to run `xt update` on that host. The app then holds `ssh -N -L <local>:127.0.0.1:<port> <target>` and reuses an SSH ControlMaster when the operator's configuration defines one (XTRM-11).
3. **Daemon placement.** The agent host is a new `xt host` subcommand in `xtrm-dev/core`. It does not extend xtmux, which is transport and observability, or Substrate, which is durable work authority and must not hold runtime session state (XTRM-7).
4. **Claude hook coverage (v0).** Status-and-tool presence only: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`. Claude sessions advertise `capabilities: ["presence"]`; the GUI does not stream their assistant text and does not prompt them in v0 (XTRM-13).
5. **Concurrent submit policy.** The host serializes submits per session. A GUI normal submit while the session is working is rejected with `busy`; the GUI then offers Steer or Follow-up explicitly (§18). Terminal input is never intercepted: it reaches Pi directly, and the extension reports the resulting Frame with `ingress.origin: "terminal"` (GUI submits carry `"gui"`), which the Frame header shows. Between two GUI clients, the first accepted submit wins and the second receives `busy`. The host never merges or implicitly queues prompts.

## 36. Agent mode — accepted amendment (2026-10-02)

Status: **accepted** (2026-10-02, XTRM-2; decisions in §36.12). This section amends §5, §10, §12, §17, §24, and §29. It uses §35 as its transport: the Agent mode is a client of the agent host, local or remote. It does not change the Frame canon (§3–4, §34.8), the drawer contract (§7, §34.5), or the persistence rules (§26).

### 36.1 What makes the XTRM harness different

§1 and §27 state what XTRM is not. This subsection states what the harness does that other agent harnesses do not do as one system. Each property is normative and points to the section that defines it.

| property | XTRM behavior | defined in |
|---|---|---|
| Frame, not transcript | One human request and all activity it causes form one Frame. The current Frame is the foreground; history is a dock, a Frames view, and a Tree view. | §3–4 |
| Work-bound sessions | A session can be bound to an executable contract. The composer references the whole work graph: issues, PRs, commits, sessions, files. | §8, §10, §36.6 |
| Sessions it did not start are live | A session started in tmux or with `xt pi` streams into the GUI through the in-session extension. | §35.3 |
| Terminal parity | The GUI and `tmux attach` are equal clients of the same live session. The agent outlives the GUI. | §35.4–35.5 |
| Remote by construction | Local and remote use the same agent-host API. SSH forwarding is the default desktop path. | §35.5 |
| Coordination is semantic | Messages, dispatches, chains, and reviews between agents render as first-class activity, not as generic tool calls. | §14 |
| Tools by provenance | Native tools, MCP tools, and Pi extension tools have different rendering contracts. | §36.7 |
| One shell for planning and execution | The Agent mode and the Console share one shell, one drawer, and one reference vocabulary. | §36.2, §36.5 |

### 36.2 Console and Agent: two halves of one shell

The Agent mode is a first-class half of the application, not one rail destination among several.

- **Switch.** The top of the global rail carries a two-state switch: `Console` / `Agent`. The switch is always visible. It has a keyboard binding (§36.12).
- **Console half.** Keeps the existing rail modes: Work, Agents (fleet presence, §12), Program, Research, Observability.
- **Agent half.** Uses this layout:

```text
global rail | session sidebar | Frame surface | inspector rail + drawer
```

- **Shared state.** The repository context (§5) and the drawer navigation stack are shared by both halves.
- **Independent state.** Each half keeps its own route. Switching halves restores the last route of the target half.
- **No unmount of live work.** Switching halves, sessions, or Frames does not stop session streams or drop activity (§28).
- **Promotion.** `Open session` from the Agents fleet or from an Agent drawer switches to the Agent half and selects that session (§7.5).

### 36.3 Session sidebar

In the Agent half, the contextual sidebar lists sessions. It follows the §34.4 and shell-architecture §16.2 sidebar rules (plain sidebar, collapse edge, search field at the top).

**Scope.** The sidebar lists every session that the agent host knows: live sessions from the registry and stopped sessions from the incremental index (§35.5). It does not scan provider journals itself.

**Grouping.** The default grouping is by repository. Alternative groupings: work item, parent session, role (§12).

**Row anatomy (dense).**

```text
● pi-main                         coordinator · XTRM-561
  opus · 64% ctx · Frame 15 · working · 12s
```

| field | source |
|---|---|
| title or name | session name, else first Frame title |
| live state | `working` / `waiting for input` / `settled` / `failed` / `history only` (no extension connected) |
| role | `xt pi --role` launch context (§35.3) |
| bound work item | `--bead` / Substrate Issue binding |
| model and thinking level | live session state |
| context utilization | tokens used ÷ context window, shown as a percentage and a thin meter |
| current Frame and last activity | Frame projector, relative time |
| children | count of child sessions |

**Selected-session details.** Below the list, the selected session shows the remaining metadata: provider, cwd, worktree, branch, tmux target (`session:pane`), origin (GUI-launched or terminal-launched), extension connected or history only, started, Frame count, tokens, and cost where the provider reports it. Full identity, telemetry, and evidence stay in the Agent drawer tabs (§13).

**Row actions** (revealed on hover or focus, authority-derived): open in terminal (§35.5), fork, attach to composer (`@session`), stop.

**Footer action.** `New session` opens the launch form from §35.4.

The list is virtualized (§28).

### 36.4 Frame surface

The main area of the Agent half is the selected session's Frame surface (§3–4).

- **Header.** Session name, role, bound work item chip (opens the issue in the drawer), model, context meter, live state, and actions: open in terminal, fork, options (`⋯`).
- **Body.** The selected Frame: request, activity, settled response. The reading column is narrow (approximately 760 px) and centred.
- **Chapters.** Frames are the chapters of a session. Each Frame has a title. The recent-Frames dock under the composer and the History view (Frames and Tree projections) are the chapter navigation (§4). The transcript is never one unbounded vertical scroll.
- **Composer.** Typed references (§36.6), commands (§10), file attachments, and explicit steer while the session is working (§18).
- **Per-session view state.** Selected Frame, scroll position, expanded activity groups, and the composer draft are kept per session. Switching sessions and back restores them.

### 36.5 Drawer in the Agent half

The drawer is the same primitive as in the Console (§7, §34.5). In the Agent half, its main job is to be a **reference source** for the composer.

- The drawer inspects Substrate Issues, GitHub issues, pull requests, commits, files, other sessions, Frames, and chains.
- Every inspected entity has an `Attach to composer` action. The action inserts the matching typed reference (§7.6).
- A reference chip in a Frame or in the composer opens its entity in the drawer.
- The drawer does not show the session that occupies the Frame surface (§7.5).
- When the session is bound to a work item, the drawer can pin that contract while the operator works.

### 36.6 Typed reference vocabulary

This subsection amends §10. Every kind resolves through a typed adapter (§34.7) to a `ContextReference`. UI components never know where the data came from.

| kind | syntax | resolves through | resolves to |
|---|---|---|---|
| Substrate Issue | `@issue:<ref>` | `adapters/substrate` | contract, state, readiness, claim |
| Epic | `@epic:<ref>` | `adapters/substrate` | parent contract and children |
| GitHub issue | `@gh-issue:<owner/repo#n>` | `adapters/github` | issue body, state, labels |
| Pull request | `@pr:<owner/repo#n>` | `adapters/github` | PR body, state, checks, diff reference |
| Commit | `@commit:<sha>` | `adapters/github` or the agent host (local git) | message, author, diff reference |
| File | `@file:<path>[#L<a>-<b>]` | agent host, in the session's cwd | path, revision, content or excerpt |
| Session | `@session:<name\|id>` | agent host registry and index | identity, state, bound work, last settled response |
| Agent | `@agent:<name>` | agent host registry | the agent identity's current live session |
| Frame | `@frame:<session>/<n>` | agent host | request and settled response |
| Artifact, Program, Chain | `@artifact:` / `@program:` / `@chain:` | unchanged from §10 | unchanged |

Rules:

1. **Files resolve on the agent host.** The file is read from the session's cwd on the machine that runs the agent, which can be remote. The desktop file system is never the source.
2. **Revision at submit.** The resolver records the revision (commit SHA, issue revision, file hash) at submit time in the `ContextReference`. A Frame keeps the revision it was given.
3. **Bounded payload.** Each kind has a size budget. Above the budget, the reference carries an excerpt and a pointer, not the full content.
4. **References do not send messages.** `@session` and `@agent` attach context. They do not deliver a message to that session. Delivery uses `/message @session:<x>` (§10, §14). Provider messaging does not grant workflow authority (§14).
5. **Fail before submit.** An unresolvable reference is marked in the composer. Submit is blocked until the operator removes or fixes it.
6. **Picker.** Typing `@` opens a `cmdk` picker with kind filters. The default scope is the session's repository. One control widens the scope to the workspace (§34.4).

### 36.7 Tool taxonomy and rendering

This subsection amends §17. Each tool activity carries its origin. The agent host sets the origin from the tool's registration source. The UI never guesses the class from the tool name.

```text
ToolActivity
  ...                (fields from §17)
  origin
    class            native | mcp | extension | coordination
    server?          MCP server name and transport
    extension?       extension package and version
```

| class | examples | rendering contract |
|---|---|---|
| **native** | Pi built-ins: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` | Dense one-line rows inside collapsed activity groups ("Ran 4 commands", "Read 3 files"). Lazy detail: command and output, file and range, diff for `edit` / `write`. Optimized for scanning. |
| **mcp** | any tool from an MCP server | Server identity is always visible. Arguments render as structured fields from the tool's input schema, not raw JSON. Results render by content type (text, image, resource link, structured content). Protocol errors and tool errors are distinct. MCP calls are never merged into native groups. |
| **extension** | tools registered by Pi extensions (`registerTool`) | Extension identity is visible. A GUI-native renderer is used when the extension declares one (§20); otherwise a structured fallback. Extension UI requests (`select`, `confirm`, `input`, `editor`) render inline in the Frame as blocks that wait for the operator's answer. A `tui_only` disposition is shown explicitly. |
| **coordination** | message, dispatch, chain launch, review request, result receipt | Rendered as the semantic activity of §14, even when the transport is an extension tool or an MCP tool. Transport provenance stays available in the detail view. |

Permission and approval prompts follow the class of the tool that asks.

### 36.8 Component adoption for the Agent half

This subsection applies §24 to the Agent half. Candidates come from `ui-component-reference-registry.md` ("Agent UI" and "Full product references").

| need | candidate | disposition (proposed) |
|---|---|---|
| transcript and session-state primitives, control bar | LiveKit Agents UI (`agent-chat-transcript`, `agent-session-provider`, `agent-session-view-01`) | **ADAPT** after licence verification; restyle onto Base UI and XTRM tokens |
| tool UI, permissions, diff and file views, composer, session fork | `zvzuola/acp-components` | per `adoption-audit.md` §3 |
| activity groups, timeline, sidebar rows, composer feel | Supernova | **ADAPT** patterns; values rejected (§34.2) |
| projection, deferred rendering, virtualization, diff review | OpenCode session UI | **REFERENCE**; do not copy its vertical transcript navigation |
| idempotent send, event paging, stream budgets | PiChamber | **ADAPT** protocols |

Rules: adopt mechanisms, restyle everything onto the XTRM visual standard (§27, §34.9), and install registry source through the `shadcn` MCP with `--cwd packages/xtrm-app`. Do not adopt a stock chat-first shell (§24).

Existing stubs in this package become the starting point of the tranche:

- `src/runtime/provider.ts` and `src/runtime/providers/{pi,claude}.ts` move behind the agent host. The provider adapters run in the host process (Node), not in the WebView (§25, §35.5). The UI consumes the host API.
- `src/episode/model.ts` and the `episode_*` events are renamed to the Frame vocabulary (`InteractionFrame`, `FrameProjector`, `frame_*`).
- The Agent route placeholder (`DeferredSurface` in `src/surfaces/other.tsx`) is replaced by the Agent half.

### 36.9 Later: tabs and multiple windows

- **Now.** One session is visible at a time. The operator switches sessions in the sidebar, and per-session view state is preserved (§36.4).
- **Later.** Tabs in the Agent half, one session per tab. Separate desktop windows through Tauri multi-window.
- **Not planned.** Permanent split panes (§34.3). Comparison of two agents stays a main-surface-plus-drawer pattern (§7.5).

### 36.10 Changes to earlier sections

| section | change |
|---|---|
| §5 Repository context and shell | The global rail carries the `Console` / `Agent` switch. The Agent half has its own sidebar (sessions). |
| §10 Typed references | Adds `@gh-issue`, `@commit`, `@file`, `@session`. Defines resolution, revision, budget, and messaging rules (§36.6). |
| §12 Agents presence | The fleet view stays in the Console half. `Open session` switches to the Agent half. |
| §17 Activity normalization | `ToolActivity` gains `origin` and the four-class rendering contract (§36.7). |
| §24 Adoption policy | Agent-half candidates and dispositions (§36.8). |
| §29 Delivery sequence | v0 Agent vertical uses the §36 layout. Tabs move to Later. |

### 36.11 Acceptance criteria — Agent half

These criteria add to §31. Each criterion must pass against a real agent host and real provider activity.

1. The `Console` / `Agent` switch is visible in every mode. Activating it restores the last route of the target half.
2. Switching halves, sessions, or Frames does not interrupt a working session's stream.
3. The session sidebar lists a session started from a terminal with `xt pi` on the agent host, without GUI action, and marks it live.
4. A session without the extension is listed as `history only` and cannot receive prompts from the GUI.
5. Each session row shows live state, role, bound work item, model, context utilization, and last activity from real host data.
6. Switching to another session and back restores the selected Frame, scroll position, and composer draft.
7. `@issue`, `@gh-issue`, `@pr`, `@commit`, `@file`, and `@session` each resolve through their adapter, and the submitted Frame records the revision of each reference.
8. `@file` against a remote host reads the file on that host, not on the desktop.
9. An unresolvable reference blocks submit and is marked in the composer.
10. `Attach to composer` in the drawer inserts the matching typed reference.
11. A `@session` reference does not deliver a message to that session. `/message` does.
12. A native tool call, an MCP tool call, and a Pi extension tool call in the same Frame render with their distinct contracts, and the MCP call shows its server identity.
13. An extension UI request (`confirm` or `select`) renders inline in the Frame and the operator's answer reaches the extension.
14. A specialist dispatch made through an extension tool renders as coordination activity (§14), with transport detail available on expand.

### 36.12 Decisions (formerly open items, decided 2026-10-02 under XTRM-2)

1. **Switch binding.** `Mod+.` toggles between the halves. The Console modes keep `Mod+1…5` (Work, Agents, Program, Research, Observability); pressed in the Agent half, they switch to the Console half and open that mode. The Agent mode leaves the numbered mode list.
2. **`@session` payload and budgets.** `@session` attaches identity, bound work item, live state, and the last settled response truncated to its budget. Budgets are UTF-8 bytes of rendered context:

   | kind | budget | above budget |
   |---|---|---|
   | `@issue`, `@epic` | 16 KB | contract sections in order, then pointer |
   | `@gh-issue`, `@pr` | 8 KB | body and metadata; diff always by pointer |
   | `@commit` | 4 KB | message and file stat; diff always by pointer |
   | `@file` | 32 KB | requested range, else first 200 lines, plus pointer |
   | `@session`, `@agent` | 4 KB | identity and work, response truncated |
   | `@frame` | 8 KB | request, response truncated |
   | total per submit | 96 KB | submit blocked until references are removed |

3. **MCP tools in Pi sessions.** Delegated to decision issue XTRM-3. On this host MCP reaches Pi through the `pi-mcp-adapter` extension, so the classification rule and the source of `origin.server` need evidence from that adapter.
4. **Claude tool classes.** Claude built-in tools are `native`. `mcp__<server>__<tool>` is `mcp` with `origin.server = <server>`: this namespace is Claude's own registration scheme, so it is registration-source data, not a name heuristic. Claude's subagent tool is `coordination`. Claude sessions have no `extension` class.
5. **Sidebar scope.** The session sidebar follows the repository selector. A scope control in the sidebar header switches between `This repository` (default) and `All repositories`; in `All`, sessions whose cwd is outside every known repository appear under `Other`.
