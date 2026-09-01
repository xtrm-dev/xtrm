# xtrm-app — implementation packet

## 1. Product slice

Build a Linux-first desktop app for ordinary human ↔ agent work before integrating
the same interaction model into the governed XTRM chain harness.

The product differentiator is the **Episode** presentation:

```text
user ingress
    ↓
Episode
├─ prompt
├─ activity (collapsed by default)
│  ├─ agent turns
│  ├─ assistant/tool messages
│  ├─ tool executions
│  ├─ retries
│  └─ compaction/runtime activity
└─ final agent response
```

The operator moves horizontally between Episodes instead of using one unbounded
vertical transcript. A Zoom Out action changes the read model to an episode-card
overview. Conversation forks are first-class and can be visually compressed.

Do not import Specialists/ChainRun semantics in the first slice.

## 2. Critical Pi mapping

Pi already has nearly every primitive needed.

### Agent lifecycle

`@earendil-works/pi-agent-core` emits:

```text
agent_start
turn_start
message_start / message_update / message_end
tool_execution_start / update / end
turn_end
... more turns ...
agent_end
```

A Pi turn is **one assistant LLM response plus its tool calls/results**.

The coding-agent `AgentSessionEvent` adds retry, compaction, entry persistence and
`agent_settled`.

### Episode boundary

For this app:

```text
normal user submit while idle
    → create episode_id
    → session.prompt()

turn_start / tool_* / message_*
    → append activity to current Episode

agent_end
    → DO NOT close Episode

agent_settled
    → close Episode
```

`agent_end` is too early because coding-agent can automatically retry or compact
and continue. `agent_settled` is the correct UI completion boundary.

### Conversation tree

Do not create a duplicate Pi transcript graph.

Pi coding-agent sessions already persist entries with:

```text
id
parentId
```

and expose `SessionManager.getTree()`, `getBranch()`, `branch()` and current-leaf
semantics.

Use those provider references in the UI graph.

### Two different fork operations

Keep them distinct:

```text
AgentSession.navigateTree(...)
    = move/branch inside the current session tree

AgentSessionRuntime.fork(...)
    = create an independent session file from an earlier entry
```

The GUI can present both as branches while preserving the provider-native source.

### Compression

First implementation:

```text
UI branch compression
    raw history untouched
    ↓
+N compressed
```

Later, explicit semantic/context compression can use Pi branch summaries and
compaction. Never destroy the original fork by default.

## 3. Pi packages to use

### Required now

`@earendil-works/pi-coding-agent`

Owns:
- `createAgentSession()`
- `createAgentSessionRuntime()`
- `AgentSession`
- `SessionManager`
- tools/resources/model integration
- branch/fork/compaction/session lifecycle

`@earendil-works/pi-agent-core`

Use indirectly through coding-agent types/events. It defines the raw turn,
message, tool and agent event sequence.

### Investigate later, do not make v0 depend on them

`@earendil-works/pi-client`
- transport-neutral remote session client;
- supports Unix socket transport;
- good future GUI ↔ host boundary.

`@earendil-works/pi-server`
- currently experimental;
- not a standalone coding-agent service;
- application must provide its service implementation.

`@earendil-works/pi-protocol`
- normalized CBOR session protocol;
- useful future boundary;
- current snapshots normalize transcript into user/assistant/tool items but do
  not expose the exact raw `turn_start` / `turn_end` structure that the first
  Episode projector wants.

`@earendil-works/pi-session-backend-sqlite-node`
- promising future canonical session/search storage;
- do not migrate provider persistence just to build the GUI.

`@earendil-works/pi-tui`
- relevant to the later TUI implementation, not the GUI shell.

## 4. Linux process architecture

Recommended first implementation:

```text
<Tauri desktop shell>
    React / TypeScript UI
          │
          │ local IPC
          ▼
<Node 24 agent-host sidecar>
    ├─ PiAdapter
    │    └─ AgentSessionRuntime
    │
    └─ ClaudeAdapter
         └─ Claude Agent SDK
```

Reasons:
- keeps the desktop shell slim;
- XTRM package work already targets Node 24, which satisfies Pi coding-agent's modern Node requirement;
- avoids attempting to run Node-oriented provider SDK machinery inside a WebView;
- gives us a stable provider boundary that can later move to PiClient/Unix socket
  or XTRM runtime without rewriting the UI.

Electron is a valid fallback if Tauri-sidecar integration creates disproportionate
friction. Do not choose Electron merely because it is familiar.

## 5. Application state

Keep provider state and app UI state separate.

### Provider-owned truth

Pi:
- session transcript/tree;
- provider session identity;
- messages;
- branch/compaction entries.

Claude:
- Claude Agent SDK session transcript/session IDs.

### App-owned SQLite/index

Store only UI/product metadata initially:

```text
projects
provider_sessions
conversation_edges not derivable from provider
episode_boundaries/cache
episode_titles
ui_collapsed_branches
favorites/pins
window/layout state
```

Do not copy the entire provider transcript into a second authoritative store in v0.

## 6. Provider-neutral model

See the TypeScript starter files in this packet.

Important constraint:

```text
provider event vocabulary
    ↓
adapter
    ↓
small AppEvent vocabulary
    ↓
EpisodeProjector
    ↓
GUI
```

The GUI must not branch on Pi event names.

## 7. UX rules for episode creation

For the first implementation:

```text
session idle + normal Send
    → new Episode

session running + operator intervention
    → explicit Steer action
    → stays inside current Episode

session settled + next Send
    → next Episode
```

This preserves the mental model.

Do not silently turn every steering/follow-up message into a new Episode until the
interaction semantics are deliberately designed.

## 8. Claude adapter

Characterize the current installed Claude Agent SDK before coding the adapter.

Expected capabilities to exploit:
- list sessions;
- read stored messages without spawning an agent;
- resume;
- fork session from a selected message;
- stream assistant/tool activity;
- terminal result containing run/session metadata.

The Claude storage model does not need to match Pi's same-file entry tree. Project
separate forked Claude session IDs into the same visible `ConversationGraph`.

## 9. First vertical slice

Acceptance sequence:

```text
launch Linux app
  ↓
select cwd
  ↓
create Pi session
  ↓
submit prompt
  ↓
Ep 1 tab appears
  ↓
stream assistant output
  ↓
tool events accumulate under collapsed Activity
  ↓
agent_settled
  ↓
Ep 1 becomes settled
  ↓
submit second prompt
  ↓
Ep 2 tab appears
  ↓
click Ep 1 / Ep 2
  ↓
no vertical archaeology required
  ↓
Zoom Out
  ↓
episode cards
  ↓
click a card
  ↓
focused episode
```

Then:

```text
fork from prior user message
  ↓
sidebar tree gains branch
  ↓
switch branch
  ↓
collapse branch in UI
  ↓
+N compressed
  ↓
restart app
  ↓
tree + episodes reconstruct correctly
```

## 10. Package placement and local worker sequence

Canonical implementation root: `xtrm-dev/xtrm/packages/xtrm-app`. Do not recreate this work under Core, Specialists, or a separate repository. Shared runtime contracts may be extracted later only when an existing XTRM package has clear ownership.

```text
P0  scaffold Tauri + React + Node 24 sidecar
P1  copy current HTML visual language into React components
P2  implement PiAdapter against exact installed 0.84.x API
P3  implement EpisodeProjector and event fixtures
P4  wire one live prompt with streaming/tool activity
P5  implement tab switching + Zoom Out cards
P6  implement Pi session list/reopen/reconstruction
P7  implement in-session branch navigation and runtime fork
P8  UI-only branch compression
P9  add small app SQLite index
P10 characterize current Claude Agent SDK
P11 implement ClaudeAdapter
P12 package Linux AppImage/deb; evaluate Flatpak after filesystem/tool semantics
```

## 11. Tests that matter before styling refinements

1. Multiple Pi tool calls in one LLM turn count as one turn.
2. A second Pi turn after tools stays in the same Episode.
3. `agent_end(willRetry=true)` does not close the Episode.
4. `agent_settled` closes exactly once.
5. A failed tool remains visible in Activity.
6. Abort yields a terminal UI state without fabricating success.
7. Reopening a session reconstructs episode content deterministically.
8. Forking from an old user message preserves the original branch.
9. UI compression does not mutate provider history.
10. Switching runtime session causes event subscriptions to be rebound.
11. No event from the replaced Pi session is attributed to the new session.
12. Claude and Pi adapters produce the same minimum `AppEvent` invariants even
    when their native storage/topology differs.

## 12. Explicit non-goals for the first app

- Specialists chains
- ResolvedChain / ChainRun
- Channels workflow authority
- XTRM result validation
- provider-to-provider agent messaging
- remote/multi-host scheduling
- replacing Pi persistence
- universal transcript database
- semantic branch destruction
- exact parity between Pi and Claude internals

The app should prove the Episode interaction model with real agent events first.
