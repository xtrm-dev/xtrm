# XTRM GUI PRD

**Status:** Draft v0.1 — implementation baseline  
**Package:** `xtrm-dev/xtrm/packages/xtrm-app`  
**Product:** Linux-first XTRM desktop agent application  
**Primary runtime:** Pi `AgentSessionRuntime`  
**Primary interaction unit:** `Frame` (internal contract: `InteractionFrame`)

## 1. Product objective

Build a Linux-first desktop application for ordinary human ↔ agent work that provides a different interaction model from the conventional infinite vertical chat transcript while preserving Pi as the underlying agent harness and ecosystem.

The product must prove that XTRM can present agent work through bounded, navigable **Frames** without replacing Pi's mature runtime, session, extension, skill, prompt, model, authentication, and context machinery.

The initial product is not the governed Specialists/ChainRun console. Specialists, Channels, result contracts, and governed workflow state are later integrations over the same interaction substrate.

## 2. Core product concept: Frame

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
│  ├─ retries
│  ├─ compaction
│  └─ other runtime activity
└─ settled response
```

User-facing terminology is `Frame`.

The internal contract should use a more explicit name such as `InteractionFrame` to avoid ambiguity with browser frames, rendering frames, protocol frames, or stack frames.

Reserved terminology:

```text
turn   provider/runtime-level concept
run    execution/runtime concept
step   workflow/chain concept
Frame  XTRM human-facing interaction unit
```

The working definition is:

```text
idle user submit
    → open Frame

all provider activity caused by that interaction
    → belongs to the Frame

provider becomes truly settled
    → close Frame
```

For Pi, `agent_settled` is the authoritative initial close boundary. `agent_end` alone is not sufficient because retries, compaction retries, or queued continuation may still occur.

## 3. Product differentiation

The GUI must not present the session as one unbounded vertical transcript.

The default interaction model is horizontal navigation across Frames:

```text
Frame 12 | Frame 13 | Frame 14 | Frame 15
```

Each Frame contains:

```text
request
activity collapsed by default
settled response
```

A Zoom Out action changes the read model to an overview of Frames.

Conversation forks and branches are first-class and visible.

Visual branch compression is non-destructive and must not mutate provider-native transcript history.

## 4. Product identity

The target is not a reskinned ACP client, OpenCode clone, Pi desktop clone, or generic agent dashboard.

Reuse commodity infrastructure aggressively, but keep the XTRM interaction model and visual language product-owned.

XTRM owns:

```text
Frame identity and boundaries
horizontal Frame navigation
Frame overview
conversation/fork information architecture
visual branch compression
activity-density policy
XTRM naming and interaction vocabulary
XTRM visual system
later governed runtime projections
```

A screenshot should remain recognizably XTRM after provider names and logos are removed.

Visual direction:

- restrained monochrome/graphite surfaces;
- one restrained accent family;
- thin separators instead of box-heavy cards;
- narrow, readable content column where appropriate;
- browser-tab-like Frame chrome;
- dense but calm information presentation;
- minimal provider branding;
- no rainbow status system;
- no dashboard-like permanent panel clutter.

## 5. Pi compatibility is a product requirement

XTRM is an alternative product/interface around Pi, not a replacement for Pi's harness.

The initial implementation must preserve Pi-native behavior unless XTRM has an explicit reason to add governance or a presentation translation.

Required compatibility surface:

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

## 6. Extension compatibility model

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

The GUI must therefore distinguish:

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

The TUI host may use Pi-native TUI implementations. The GUI host may provide React/Tauri equivalents.

Do not promise visual parity for arbitrary TUI-only extension components.

## 7. Shared interaction substrate

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
```

Do not create a new shared package until actual duplication justifies one. Shared contracts may initially live in one package with clear ownership and later be extracted.

## 8. Provider/event model

The GUI must not branch directly on provider-specific event names.

Use an adapter boundary:

```text
provider-native events
        ↓
adapter
        ↓
small XTRM interaction-event vocabulary
        ↓
FrameProjector
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

Pi remains native-first for v0 because its event/tree/settled semantics map directly to the product model.

## 9. Non-Pi agents and ACP

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

## 10. Open-source adoption policy

Before implementing commodity agent-client infrastructure, evaluate maintained permissively licensed implementations.

Use explicit dispositions:

```text
DEPEND    consume maintained package/API
ADAPT     bounded adaptation with provenance
REFERENCE study architecture/tests/failure handling only
REJECT    do not adopt
```

High-priority references:

### `zvzuola/acp-components`

Candidate for dependency/adaptation of:

- session/workspace state;
- streaming stores;
- tool call UI primitives;
- permissions;
- diff/file components;
- composer;
- Tauri platform abstraction;
- session CRUD/fork mechanics.

Do not adopt its stock workbench shell if it forces chat-first information architecture.

### `AcpKit/acp-kit`

Candidate dependency for non-Pi ACP runtime lifecycle:

- spawn/connect;
- initialize/auth;
- host adapters;
- session lifecycle;
- normalized message/reasoning/tool/turn events;
- raw traffic diagnostics.

### OpenCode `session-ui`

Reference/adaptation target for:

- turn/message projection;
- tool rendering primitives;
- default-open policy;
- deferred heavy rendering;
- virtualization;
- diff/review surfaces;
- composer state-machine ideas.

Do not copy OpenCode's vertical transcript navigation model.

### Panes

Reference/adaptation target for:

- Tauri 2 + React architecture;
- sidecar lifecycle;
- SQLite/FTS;
- session replay;
- crash recovery;
- long-session lazy hydration;
- Linux packaging/updater patterns.

### Hermes IDE

Reference only while its current BSL terms restrict competing IDE/editor use.

Study lifecycle/recovery patterns, but do not copy production code into XTRM.

## 11. Desktop process architecture

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

## 12. Persistence and authority

Provider/session history remains authoritative for transcript and branch topology.

The GUI should not create a second authoritative transcript database in v0.

Provider-owned truth includes:

```text
messages
tool results
provider session identity
provider-native branch/fork history
compaction entries
```

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
provider-independent graph edges not recoverable from provider
```

A small SQLite application index is acceptable where useful.

## 13. Frame state model

Initial status vocabulary:

```text
working
settled
failed
aborted
```

Do not expose full governed XTRM result-validation states in the ordinary v0 app.

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

Exact storage shape may change after real Pi reconstruction tests.

## 14. Input semantics

For v0:

```text
session idle + normal Send
    → new Frame

session running + explicit steer
    → same Frame

session settled + next normal Send
    → next Frame
```

Do not silently classify every queued/follow-up/steering message as a new Frame until those semantics are explicitly designed and tested.

## 15. Conversation topology

Use provider-native topology rather than fabricating a parallel graph.

For Pi:

```text
SessionManager tree
        ↓
ConversationGraph projector
        ↓
GUI branch tree
```

Keep same-session branch navigation distinct from independent session fork.

User-facing actions may eventually include:

```text
Branch here
Fork as new conversation
```

Visual branch compression is UI-only in v0:

```text
raw provider history unchanged
        ↓
+N compressed
```

Semantic/context compression remains a separate provider/runtime operation.

## 16. Core GUI surfaces

Required v0 surfaces:

```text
AppShell
├─ project/session sidebar
├─ FrameTabStrip
├─ FrameViewport
│  ├─ ingress
│  ├─ ActivityDisclosure
│  └─ settled response
├─ Composer
├─ FrameOverview
└─ ConversationTree
```

The normal screen must show the selected Frame rather than the entire historical transcript.

## 17. Activity presentation

Activity is collapsed by default.

The GUI should consume normalized activity records rather than provider-specific raw event blobs.

Examples:

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

Heavy output must support deferred/lazy rendering so long sessions do not require mounting all tool result content.

## 18. Performance requirements

The GUI must remain responsive when sessions contain many Frames and large tool outputs.

Adopt proven projection/virtualization/lazy-hydration patterns before inventing custom rendering infrastructure.

Required properties:

- selected Frame navigation does not mount all prior Frames;
- Zoom Out remains responsive with large session histories;
- large tool results are not eagerly mounted;
- switching Frames preserves independent scroll/view state where useful;
- background session activity does not disappear because a React component unmounted.

## 19. Implementation sequence

Do not build a large backend before proving the interaction model.

Do not implement GUI, TUI, Specialists, Channels, and provider coordination simultaneously.

Recommended waves:

### Wave 1 — shared Pi-native substrate

Prove:

```text
AgentSessionRuntime
DefaultResourceLoader
extensions/skills/prompts/context
FrameProjector
activity normalization
conversation graph
resume/fork/reconstruction
```

### Wave 2 — TUI vertical proves the substrate

The TUI is the shortest path to verifying Pi parity and Frame semantics.

### Wave 3 — GUI implementation begins

Start once these contracts are stable enough to consume:

```text
InteractionFrame
FrameProjector
ToolActivity
ConversationGraph
SessionHost
ExtensionBinding
```

TUI polish does not need to be complete first.

### Wave 4 — coordination capability adapters

Add Pi intercom / Claude-link / native provider messaging as ordinary interactive capabilities.

### Wave 5 — governed integration

Project Specialists, Channels, ResultContract, and ChainRun state onto the already-proven interaction substrate.

## 20. Specialists integration direction

Specialists are not required for v0.

First prove:

```text
human
→ XTRM
→ Pi AgentSession
→ tools/extensions/skills
→ Frames
```

Later, a Specialist may feel like a first-class sub-agent in the UX:

```text
main agent
→ Specialist invocation
→ Specialist activity
→ result
```

Internally do not define `Specialist == Pi subagent`.

A Specialist may carry identity, capability bounds, result contracts, and governed activation semantics. Pi child sessions are one possible implementation mechanism.

## 21. Coordination transports

Pi intercom, Pi↔Claude link, Claude-native peer messaging, and future provider-native transports are not v0 requirements.

When added, distinguish interactive transport from governed workflow authority.

```text
interactive XTRM
  provider-native transport may be exposed directly as capability

governed ChainRun
  semantic coordination
      ↓
    Channels
      ↓
  provider transport adapter
```

Provider messaging is transport. It does not grant workflow authority.

## 22. Explicit non-goals for v0

- Specialists chains;
- ResolvedChain / ChainRun UI;
- Channels workflow authority;
- XTRM result validation;
- remote multi-host scheduling;
- replacing Pi persistence;
- replacing Pi extension/skill discovery;
- universal transcript database;
- destructive branch compression;
- exact visual parity for arbitrary Pi TUI extension components;
- one custom provider adapter per agent without evidence it is needed;
- building a complete IDE before the Frame model is proven.

## 23. Acceptance criteria

The first accepted GUI vertical must prove all of the following against real provider activity, not mocked-only flows:

1. Linux application launches.
2. Operator selects or opens a working directory.
3. A real Pi session is created through Pi runtime APIs.
4. Pi's normal resource discovery remains active.
5. Existing compatible extensions, skills, prompts, AGENTS/context, settings, models and auth remain available.
6. A first user submit creates Frame 1.
7. Real assistant/tool/retry activity is projected into Frame 1.
8. `agent_end(willRetry=true)` does not settle Frame 1.
9. `agent_settled` settles Frame 1 exactly once.
10. A second idle submit creates Frame 2.
11. Frame 1 and Frame 2 are switchable without re-prompting the agent.
12. Activity is collapsed by default and can be inspected.
13. Zoom Out displays all Frames and navigates back to one Frame.
14. Pi session tree is projected into the conversation tree.
15. Same-session branch and independent fork preserve the original path.
16. UI branch compression does not mutate provider history.
17. Restart/reopen reconstructs the session and Frame projection deterministically enough for product use.
18. Abort/cancel does not fabricate settled success.
19. Background session state survives component unmount/remount.
20. The UI remains responsive with a synthetic large-session fixture.
21. No existing Pi-compatible extension becomes activation authority merely because it is installed.
22. The interface remains recognizably XTRM with provider branding removed.

## 24. Adoption spike gates

Before broad custom implementation, record explicit decisions for:

```text
GUI-SPIKE-1  acp-components
GUI-SPIKE-2  ACP Kit
GUI-SPIKE-3  native Pi vs Pi-over-ACP semantic parity
GUI-SPIKE-4  long-session rendering/lazy hydration
```

Each spike must conclude with:

```text
DEPEND / ADAPT / REFERENCE / REJECT
exact package/version/commit
license
integration friction
product constraints
custom code avoided or retained
```

## 25. Later product explorations

These are intentionally not v0 acceptance requirements:

- richer governed status overlays;
- first-class Specialist cards/children;
- Channels/coordination visualization;
- provider-to-provider communication traces;
- richer evidence/diff review surfaces;
- optional remote agent host;
- semantic context compression controls;
- full multi-pane agent workspace.

## 26. Final product invariant

The GUI succeeds when XTRM can change how agent work is navigated and understood without discarding Pi's runtime and ecosystem.

In compact form:

```text
Pi remains the harness.
XTRM owns the interaction model.
Open-source infrastructure is reused where it is commodity.
Frames are the primary human navigation unit.
Governed orchestration arrives later over the same substrate.
```
