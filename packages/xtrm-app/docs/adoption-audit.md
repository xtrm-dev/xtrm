# xtrm-app — open-source adoption audit

**Status:** implementation guidance / adoption gate  
**Scope:** `packages/xtrm-app`  
**Product:** Linux-first XTRM desktop agent application

## 1. Governing decision

Do not build commodity agent-client infrastructure from scratch when a maintained, compatible, permissively licensed implementation already exists.

At the same time, do not let an upstream workbench define the XTRM product identity.

Use this boundary:

```text
reuse aggressively
├── session/runtime plumbing
├── process and transport lifecycle
├── auth and permission mechanics
├── state stores
├── tool/diff/file primitives
├── markdown/composer primitives
├── desktop/Tauri integration patterns
└── performance/recovery techniques

own deliberately
├── Episode identity and boundaries
├── horizontal Episode navigation
├── zoomed-out Episode overview
├── conversation/fork information architecture
├── visual branch compression
├── XTRM interaction language
├── XTRM visual system
└── later XTRM ChainRun/Channels/runtime projections
```

The target is not a reskinned ACP client. The target is an XTRM product assembled from proven infrastructure.

## 2. Adoption classes

Every external reference must receive one explicit disposition before code is copied or a dependency is added.

```text
DEPEND
  consume the maintained package/API directly

ADAPT
  port or wrap a bounded implementation into XTRM-owned code
  preserve license/attribution requirements

REFERENCE
  study architecture/tests/failure handling only
  implement independently

REJECT
  do not adopt because of architecture, maintenance, license, or product-fit concerns
```

A worker must not silently vendor a repository or copy a component because it looks convenient.

## 3. High-value GUI references

### 3.1 `zvzuola/acp-components` — candidate DEPEND/ADAPT

License: MIT.

Why it matters:

- framework-independent ACP core;
- React workbench components;
- vanilla Zustand stores;
- multi-agent and multi-session lifecycle;
- workspace/session state;
- streaming text/thought/tool state;
- permission prompts;
- file tree and viewer;
- diff view;
- plan/thought/tool components;
- session create/load/switch/close/delete/fork;
- Tauri/stdin transport examples;
- host `Platform` abstraction for filesystem, dialogs, clipboard, updater, system and process spawning.

This is the highest-priority GUI adoption spike.

Do not adopt `WorkbenchShell` wholesale without first proving that its navigation and state ownership can accommodate XTRM Episodes. Prefer its lower-level core/stores/components where the stock workbench imposes chat-first information architecture.

Spike questions:

1. Can `@acp-components/core` own generic ACP session state while XTRM owns the Episode projection?
2. Can `ToolCallCard`, permission, diff, file and composer primitives be reused independently?
3. Can its Tauri `Platform` seam replace custom host-capability plumbing?
4. Does its session fork representation preserve enough provider identity for the XTRM conversation graph?
5. What is the smallest dependency surface that avoids importing a full competing workbench shell?

### 3.2 `AcpKit/acp-kit` — candidate DEPEND

License: MIT.

Purpose: reusable ACP client runtime above `@agentclientprotocol/sdk`.

It already owns the repetitive machinery that a product otherwise tends to reimplement:

```text
agent profile
→ spawn/connect
→ initialize/auth
→ session lifecycle
→ raw ACP updates
→ normalized message/reasoning/tool/turn events
→ transcript reduction
```

It also keeps host-specific filesystem, terminal and permission capabilities behind adapters.

Recommended direction:

```text
Pi
  → native XTRM Pi adapter first

Claude / Codex / OpenCode / other ACP agents
  → AcpAdapter
      → ACP Kit
```

Do not replace the native Pi lane solely to force protocol uniformity. Pi exposes richer provider-native turn/tree/settled semantics that are useful to the Episode model.

### 3.3 Pi ACP adapters — candidate ADAPT/REFERENCE

Relevant implementations include direct in-process Pi SDK adapters that map `AgentSession` to ACP.

Useful machinery:

- Pi event → ACP message/thought/tool translation;
- structured tool titles and file locations;
- edit/write diff translation;
- session list/load/resume/close;
- model and thinking configuration;
- usage/cost updates;
- client filesystem and terminal delegation;
- experimental fork handling;
- session registry patterns.

Use these to avoid rediscovering translation and capability-negotiation edge cases.

The first XTRM Pi vertical should still consume `AgentSessionRuntime` directly until an ACP path proves semantic parity for:

```text
turn_start / turn_end
agent_end(willRetry)
agent_settled
SessionManager.getTree()
navigateTree()
independent fork
compaction / branch summaries
```

### 3.4 OpenCode `packages/session-ui` — candidate ADAPT/REFERENCE

License: MIT.

OpenCode has already solved several UI problems that overlap strongly with XTRM:

- a shared session-turn UI package;
- message-part dispatch by content type;
- specialized and generic tool rendering;
- reasoning/thinking blocks;
- prompt state machine with mentions/attachments/commands;
- default-open policy for tool/reasoning content;
- virtualized timeline projection;
- row reuse during streaming;
- diff summary and review surfaces;
- deferred mounting of expensive tool content.

The conceptual mapping is useful:

```text
OpenCode SessionTurn
  user prompt + assistant parts

XTRM Episode
  ingress + all provider turns/activity until settled + final response
```

Do not copy OpenCode's vertical timeline as the product navigation model. Reuse projection and rendering techniques beneath the XTRM horizontal Episode surface.

### 3.5 `wygoralves/panes` — candidate REFERENCE/ADAPT

License: MIT.

Important Linux/Tauri implementation reference:

- Tauri 2 + React + Zustand;
- Rust backend ownership of persistence and native resources;
- Claude Agent SDK sidecar;
- Codex app-server integration;
- SQLite/FTS;
- PTY/xterm integration;
- session replay/resume;
- crash recovery;
- windowed message loading and lazy hydration for long sessions/tool output;
- setup/update flows.

The highest-value pieces are lifecycle, persistence, lazy hydration and packaging patterns. Do not import its overall cockpit information architecture if it conflicts with Episodes.

### 3.6 Hermes IDE — REFERENCE ONLY

License: Business Source License 1.1 with restrictions relevant to competing IDE/editor products.

Do not copy production code into XTRM.

Study these failure-handling patterns only:

- Node SDK bridge behind Tauri/Rust;
- NDJSON process bridge;
- stdout backpressure;
- maximum line/output bounds;
- permission round-trip normalization;
- startup control-operation buffering;
- idempotent initialization latch;
- generation-aware stale-exit rejection;
- long-lived session stores that survive component unmounts.

Equivalent XTRM code must be independently implemented or sourced from permissively licensed projects.

## 4. Architecture after adoption research

Recommended desktop layering:

```text
<XtrmApp>
  XTRM product layer
    EpisodeWorkspace
    EpisodeTabStrip
    EpisodeOverview
    ConversationGraph
    BranchCompression

  reusable interaction primitives
    Composer
    Markdown
    Tool cards
    Permission UI
    Diff/review
    Files

  product-neutral session/runtime layer
    PiNativeAdapter
      AgentSessionRuntime

    AcpAdapter
      ACP Kit
        Claude
        Codex
        OpenCode
        future ACP agents

  host layer
    Tauri 2
    Node 24 sidecar where required
    filesystem / process / notifications / persistence
```

Do not introduce one provider adapter per ACP-speaking agent unless a provider-specific capability actually requires it.

## 5. XTRM product personality

Reuse must remain visually and conceptually subordinate to XTRM.

The desktop application should feel like one coherent product, not a gallery of imported agent components.

### Interaction identity

The defining interaction is:

```text
Episode
  ingress
  collapsed activity
  final response
```

not an endless alternating chat stream.

Navigation is horizontal and stateful:

```text
thin Episode tabs
    ↕ zoom
Episode card overview
```

Conversation topology is first-class:

```text
main
├─ Episode...
└─ fork
   └─ +N compressed
```

### Visual identity

Use:

- restrained monochrome/graphite surfaces;
- one restrained accent family;
- thin separators instead of stacked cards where possible;
- high information density without clutter;
- browser-tab-like Episode chrome;
- Linear/Vercel-level spacing discipline;
- ChatGPT/Codex familiarity only where it reduces learning cost;
- XTRM naming and interaction vocabulary.

Avoid:

- rainbow provider badges;
- dashboard-style boxed layouts;
- visually importing another project's theme wholesale;
- making ACP or provider implementation details the dominant product vocabulary;
- rendering every event as permanent vertical transcript content.

### Product invariant

A user should be able to identify the XTRM app from a screenshot even if every provider name and logo is removed.

## 6. Adoption spikes before full implementation

Do these before building commodity components ourselves.

### APP-SPIKE-1 — acp-components

Build a disposable integration under the package/worktree, not a new permanent product architecture.

Prove:

- one local ACP session;
- streaming message/tool state;
- permission UI;
- session switch/fork;
- one reused tool/diff component;
- XTRM Episode projector consuming the state without adopting the stock chat layout.

Decision output:

```text
DEPEND / ADAPT / REFERENCE / REJECT
+ exact packages/components
+ version/license
+ integration friction
+ code removed from our starter as a result
```

### APP-SPIKE-2 — ACP Kit

Prove one non-Pi provider through a single generic adapter.

Acceptance:

- launch/auth/session bootstrap;
- normalized text/reasoning/tool events;
- cancel;
- provider capability discovery;
- no provider-specific branches in React UI;
- raw event access remains available for diagnostics.

### APP-SPIKE-3 — native Pi versus Pi-over-ACP

Run equivalent prompts through:

```text
native AgentSessionRuntime
Pi ACP adapter
```

Compare:

- turn boundaries;
- settled/completion semantics;
- tool correlation;
- tree/fork identity;
- compaction visibility;
- resume/reload fidelity;
- implementation complexity.

Native Pi remains preferred unless ACP reaches semantic parity for the Episode requirements.

### APP-SPIKE-4 — long-session rendering

Borrow the proven projection/lazy-hydration ideas from OpenCode/Panes.

Prove that thousands of event/message/tool records do not require mounting the whole historical transcript.

The Episode overview and selected Episode should remain responsive independently of total history size.

## 7. License and provenance gate

Before DEPEND or ADAPT:

1. record repository/package and exact license;
2. record exact version/commit used for evaluation;
3. preserve required copyright/license notices;
4. distinguish copied/adapted code from architectural reference;
5. reject code reuse from incompatible source-available licenses;
6. prefer package dependency over vendoring when the upstream API is stable enough;
7. keep a small provenance section in the implementation PR for material reused code.

Current high-value permissive references found in this audit include Pi, OpenCode, Prime Agent, `acp-components`, and ACP Kit under MIT terms. Verify licenses again at adoption time.

Hermes is reference-only under its current BSL terms.

## 8. Definition of successful reuse

Reuse is successful only when it removes product code or maintenance burden without weakening XTRM's interaction model.

Good result:

```text
less custom transport/auth/session/tool/file machinery
+ more upstream-tested behavior
+ XTRM Episodes remain the top-level mental model
```

Bad result:

```text
fork a whole workbench
+ hide XTRM concepts inside its chat model
+ inherit upstream navigation/theme/state coupling
```

## 9. Implementation rule

Before writing a new generic UI/runtime primitive, the worker must answer:

```text
Does Pi, acp-components, ACP Kit, OpenCode session-ui, Panes,
or another already-approved reference provide this?
```

If yes, evaluate adoption first.

If custom code is still chosen, record the concrete reason: missing semantic capability, incompatible ownership, unacceptable dependency, license, performance, security, or product identity.
