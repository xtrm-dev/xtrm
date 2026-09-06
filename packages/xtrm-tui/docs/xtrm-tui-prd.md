# XTRM TUI PRD

**Status:** Draft v0.1 — implementation baseline  
**Package:** `xtrm-dev/xtrm/packages/xtrm-tui`  
**Product:** XTRM-native human ↔ agent terminal interface  
**Primary runtime:** Pi `AgentSessionRuntime`  
**Rendering foundation:** `@earendil-works/pi-tui`  
**Primary interaction unit:** `Frame` (internal contract: `InteractionFrame`)

## 1. Product objective

Build a first-party XTRM terminal interface that presents agent work through bounded, navigable **Frames** instead of one unbounded vertical transcript, while preserving Pi as the underlying agent harness and ecosystem.

The TUI is the first proving surface for the shared XTRM interaction substrate because it has the shortest path to Pi's runtime, resource loader, extension system, session tree, and TUI primitives.

The product must remain compatible with ordinary Pi usage and must not require the Specialists/Channels runtime to function.

## 2. Product boundary

Keep the existing distinction:

```text
xt pi
  low-level Pi/worktree launcher
  provider-native escape hatch
  existing Pi-oriented operator surface

xt agent
  XTRM-native interactive human ↔ agent TUI
  Frame navigation
  XTRM presentation
  Pi runtime underneath
```

`xt agent` owns interaction presentation.

Pi continues to own:

```text
model execution
tools
session history
extensions
skills
prompts
context discovery
models/auth/settings
branching
forking
retry
compaction
provider support
```

Do not repurpose `xt pi` into the product shell.

## 3. Core interaction concept: Frame

A `Frame` represents one user interaction and all resulting agent activity until the agent becomes fully settled.

```text
human ingress
    ↓
Frame
├─ request
├─ activity
│  ├─ Pi turns
│  ├─ thinking/reasoning presentation
│  ├─ tool calls/results
│  ├─ retries
│  ├─ compaction
│  └─ runtime events
└─ settled response
```

User-facing terminology is `Frame`.

Use `InteractionFrame` internally or another explicit internal type name so the contract is not confused with rendering/protocol/stack frames.

Reserved terms:

```text
turn   Pi/provider loop unit
run    execution/runtime concept
step   workflow/chain concept
Frame  XTRM user interaction unit
```

Pi close rule:

```text
agent_end
  informational only

agent_settled
  authoritative initial Frame completion boundary
```

A retry, compaction retry, or queued continuation must remain in the same Frame.

## 4. Default screen model

The normal TUI must show one selected Frame, not the complete historical transcript.

Target shape:

```text
XTRM · repo · branch                          model · ctx · thinking
FRAMES   recover state | review contract | implement renderer
──────────────────────────────────────────────────────────────────

Frame N · title                                           settled

request
...

activity · 6 turns · 14 tools                         compressed
• Ran    ...
• Read   ...
• Edited ...

agent response
...

──────────────────────────────────────────────────────────────────
› Message agent…
──────────────────────────────────────────────────────────────────
key hints / status
```

The Frame strip should feel closer to thin browser tabs than cards.

## 5. Frame navigation

Required v0 interactions:

```text
previous Frame
next Frame
Frame overview
conversation tree
```

Recommended initial bindings, subject to final conflict testing:

```text
Ctrl+Left       previous Frame
Ctrl+Right      next Frame
Ctrl+E          Frame overview
Ctrl+B          conversation tree
Ctrl+T          thinking expand/collapse
Ctrl+L          model picker
```

The selected Frame view should preserve independent scroll position where practical.

## 6. Frame overview

The overview is the terminal equivalent of browser-tab overview/zoom-out.

Example:

```text
┌ Frames ──────────────────────────────────────────────────────────┐
│ Frame 12               Frame 13               Frame 14          │
│ Recover state          Review contract         Renderer          │
│ 6t · 8 tools           4t · 12 tools           live              │
│                                                                 │
│ docs-ui +4 compressed     renderer-spike +3 compressed          │
└─────────────────────────────────────────────────────────────────┘
```

The overview must be navigable and must not replace provider-native session topology.

## 7. Pi compatibility is mandatory

XTRM TUI must preserve Pi's ecosystem rather than rebuilding it.

Required compatibility surface:

```text
Pi built-in tools
Pi extensions
extension tools
extension lifecycle hooks
extension commands
skills
prompt templates
AGENTS/context files
themes
models/auth/settings
session persistence
resume
fork
session tree
compaction
steer/follow-up
```

Use Pi's own resource/runtime machinery.

Do not implement a parallel discovery system for:

```text
~/.pi/agent/extensions
.pi/extensions
skills
prompts
themes
AGENTS.md
settings.json
models.json
auth.json
```

The exact current `DefaultResourceLoader` or equivalent must be used after verifying the installed Pi version.

## 8. Extensions remain first-class

The TUI should preserve Pi extension behavior directly where possible.

Native-compatible extension behaviors include:

```text
registerTool
registerCommand
registerShortcut where compatible
lifecycle hooks
custom message/entry renderers
resource contributions
session state entries
ctx.ui interactions
custom pi-tui components
```

Because this product itself uses `pi-tui`, TUI-specific extension components are materially easier to preserve here than in the GUI.

The TUI should remain the strongest compatibility surface for arbitrary Pi TUI extensions.

Do not silently disable extension UI because XTRM has its own shell.

When the XTRM shell owns a conflicting global keybinding or layout area, define explicit host conflict policy and test it.

## 9. Existing XTRM `xtrm-ui` work

Current Core/XTRM Pi extensions already contain useful product machinery:

```text
XTRM themes
CustomEditor
custom header
thinking presentation
native built-in tool renderers
external tool renderer patch
preferences
```

Do not duplicate this implementation.

Refactor or consume these primitives through an explicit dependency boundary.

Target conceptual split:

```text
shared XTRM UI primitives
├─ prefs
├─ theme
├─ thinking
├─ tool render
├─ tool view policy
└─ editor
        │
        ├─ ordinary Pi xtrm-ui extension adapter
        └─ xtrm-tui native shell
```

The existing extension remains supported for ordinary upstream Pi usage.

## 10. Do not fork Pi interactive mode for v0

Prime Agent demonstrates that a deep Pi fork can support a very different product, but XTRM should not start there.

Use public Pi SDK and `pi-tui` primitives first.

A hard fork is justified only if a required product behavior cannot be achieved cleanly through public/runtime/package boundaries and the maintenance cost is measured against the benefit.

The first implementation should not depend on private Pi internals merely for convenience.

## 11. Reuse Pi interactive components where practical

Before rebuilding commodity TUI components, characterize current Pi source and reuse/adapt public-compatible implementations.

High-value targets include:

```text
TreeSelector
SessionSelector
ModelSelector
ScopedModelsSelector
ToolExecutionComponent
AssistantMessageComponent
Markdown renderer
editor/input components
overlay system
terminal capability handling
keyboard/input handling
```

The exact source/API status must be checked against the installed/current Pi version before adoption.

Disposition each component:

```text
DEPEND
ADAPT
REFERENCE
REJECT
```

Do not create an XTRM clone of an already-correct Pi component unless product behavior requires a different abstraction.

## 12. `pi-tui` is the rendering foundation

Use `@earendil-works/pi-tui` for terminal rendering.

Required primitives include, as available in the current version:

```text
differential rendering
synchronized output
layout containers
ScrollView/application-owned scrolling
overlays
focus management
keyboard protocol handling
character-width/grapheme correctness
Markdown rendering
terminal image/capability detection where useful
```

Do not build a second terminal rendering engine.

## 13. Shared semantic substrate, independent renderer

The GUI is not built on TUI components.

TUI and GUI share semantic/runtime contracts:

```text
Pi AgentSessionRuntime
        ↓
InteractiveSessionHost
├─ resource/extension binding
├─ Frame projection
├─ activity normalization
├─ conversation graph
└─ coordination capability seam
        │
   ┌────┴────┐
   ▼         ▼
xtrm-tui   xtrm-app
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

TUI-specific components remain inside `xtrm-tui`.

Do not make React depend on `pi-tui`, and do not distort terminal rendering abstractions to satisfy GUI needs.

## 14. Runtime/event mapping

Use direct Pi runtime events for v0.

Conceptual flow:

```text
xt agent
  createAgentSessionRuntime()
      ↓
  AgentSession
      ↓
  AgentSessionEvent
      ↓
  FrameProjector
      ↓
  XtrmAgentTui
```

Required event families:

```text
turn_start / turn_end
message_start/update/end
tool_execution_start/update/end
retry events
compaction events
agent_end(willRetry)
agent_settled
queue/session replacement events where material
```

Session replacement requires correct unsubscription/rebinding to the new `AgentSession`.

## 15. Input semantics

For v0:

```text
idle + normal Enter
  → new Frame
  → session.prompt()

streaming + explicit steer
  → same Frame

settled + next normal Enter
  → next Frame
```

Pi follow-up semantics should remain available.

Do not silently reinterpret Pi queue behavior in a way that breaks extension commands or user expectations.

## 16. Tool display: tri-state policy

This is a core v0 product feature.

Implement:

```text
compressed → normal → expanded
```

Default: `compressed`.

### compressed

Goal: extremely low vertical noise.

One physical row per completed tool call where terminal width permits.

Examples:

```text
• Ran    git status --short                            2 lines · 1.3s
• Read   packages/.../index.ts                        1782 lines · 65KB · 0.8s
• Edited README.md                                     +18 -3 · 0.4s
• Serena find_symbol registerXtrmUiTools              3 hits · 0.9s
```

Required metadata:

- action/tool label;
- concise subject;
- status/error;
- count/diff statistics where meaningful;
- duration;
- payload/truncation marker only when useful;
- inspection path for the individual call.

No result body in compressed mode.

### normal

Use the current good XTRM bounded-preview behavior as baseline:

- bash: bounded latest output;
- read/find/grep/ls: bounded preview;
- edit/update: bounded rich diff;
- external tools: normalized bounded rendering;
- footer/meta when content is hidden.

### expanded

Show the complete renderable result within provider/tool and terminal safety limits.

Tool presentation must never modify:

```text
model-facing tool result
persisted provider result
provider transcript
```

## 17. Tool-view controls

Preferred first-party behavior:

```text
Ctrl+O          compressed → normal → expanded → compressed
Shift+Ctrl+O    reverse cycle, if terminal/key support is reliable
```

Upstream Pi compatibility requires care because Pi may already bind `Ctrl+O` to tool expansion.

In `xtrm-tui`, XTRM owns the keymap.

In ordinary Pi + XTRM extension mode, prefer an explicit command first, such as:

```text
/xtrm-ui-tools compressed|normal|expanded
```

Only override upstream shortcuts after conflict behavior is characterized.

## 18. Activity normalization

The TUI should render normalized activity rather than scattering provider event logic across components.

Conceptual activity type:

```text
ToolActivity
  kind
  action
  subject
  status
  duration
  count/diff metadata
  preview
  fullResultRef
  locations?
  diff?
```

The same semantic activity may later be rendered differently in the GUI.

## 19. Conversation topology

Use Pi's native session tree.

```text
SessionManager.getTree()
        ↓
ConversationTreeProjector
        ↓
ConversationTree overlay
```

Keep distinct:

```text
navigateTree
  same-session branch/navigation

AgentSessionRuntime.fork
  independent session fork
```

Potential user-facing actions:

```text
Branch here
Fork as new conversation
```

## 20. Branch compression

V0 branch compression is visual only.

```text
provider history unchanged
        ↓
XTRM UI metadata
        ↓
+N compressed
```

Do not conflate visual compression with Pi context compaction or branch summaries.

Context compression can become a separate explicit action later.

## 21. Header/footer design

Avoid the current large box-heavy header becoming the permanent first-party shell.

Prefer thin fixed chrome:

```text
row 1  XTRM / repo / branch / model / context
row 2  Frames
body   selected Frame
row N  composer
last   concise key/status hints
```

Keep colors restrained.

Prefer typography, spacing, separators, and one accent over decorative boxes.

## 22. Composer

The composer must preserve Pi capabilities rather than becoming a reduced text box.

Expected direction:

- multiline input;
- extension commands;
- skill commands;
- prompt templates;
- model picker;
- history/navigation where useful;
- steer/follow-up semantics;
- eventual file/agent mentions if adopted from upstream/open-source references.

Reuse/adapt Pi's editor/input machinery before building a separate editor implementation.

## 23. Open-source adoption policy

Reuse commodity TUI infrastructure aggressively without importing another product's personality.

Primary references:

### Pi / `pi-tui`

Preferred dependency/adaptation source for rendering, overlays, selectors, session tree, model selection, tool execution and input behavior.

### Prime Agent

MIT reference for how far a Pi-derived product can change terminal UX.

Use as evidence/reference. Do not infer that XTRM therefore needs a hard fork.

### OpenCode TUI

Reference for:

- compact inline tools;
- dialogs/pickers;
- leader-key strategies;
- session navigation;
- permission/question surfaces;
- prompt autocomplete.

Do not adopt OpenCode's product navigation model wholesale.

### Codex TUI

Reference for event-driven UI/controller separation, history cells, active streaming state, bottom-pane overlays, and transcript handling.

Each material adoption requires provenance/license verification at implementation time.

## 24. Performance and terminal correctness

The TUI must remain responsive under high-frequency streaming and large histories.

Required properties:

- no full historical transcript rerender requirement for every event;
- application-owned scrolling works in alternate screen mode;
- large tool output does not dominate memory/render cost;
- width-aware rendering behaves at 80/120/160/220 columns;
- ANSI/Unicode/grapheme widths remain correct;
- terminal resize does not corrupt Frame state;
- extension custom UI can gain focus without breaking the shell;
- streaming sessions remain usable over tmux and common terminals.

Smoke targets:

```text
tmux
Kitty
Alacritty
plain Linux terminal path
```

## 25. Rich settled response surface — deferred exploration

The idea of promoting a settled final answer into a bounded rich Markdown response viewport is accepted as a post-v0 UX exploration, not a first vertical acceptance requirement.

Concept:

```text
Frame
├─ request
├─ activity
└─ result
    rich Markdown viewport
    independent scrolling
    focus mode
    copy original Markdown
```

Potential controls:

```text
c     copy full original Markdown
o     focus/open response
Esc   return
```

Clipboard implementation should be hidden behind a host abstraction and may use Wayland/X11/OSC52/tmux-compatible paths as appropriate.

Do not make this feature block the first working harness.

Do not put boxes around every activity item merely because the final response may eventually have a richer framed surface.

## 26. Specialists and sub-agents

Specialists are not required for v0.

First prove ordinary interaction:

```text
human
→ XTRM TUI
→ Pi AgentSession
→ tools/extensions/skills
→ Frames
```

Later, the TUI may expose a Specialist invocation so it feels like a first-class sub-agent:

```text
main agent
→ Specialist
→ activity
→ result
```

Internally do not define `Specialist == Pi subagent`.

A Specialist can carry XTRM identity, capability grants, result contracts, and governed activation semantics. An in-process Pi child is only one possible execution implementation.

## 27. Pi intercom / Claude link / provider messaging

These are future first-class coordination capabilities, not v0 requirements.

Interactive mode may expose provider-native messaging directly when useful.

Governed ChainRun integration must preserve:

```text
semantic coordination
    Channels
        ↓
provider transport adapter
    pi-intercom
    pi-claude-link
    Claude native peer messaging
```

Provider messaging is transport, not workflow authority.

The TUI should introduce a clean capability/adapter seam so these can be added later without redesigning the Frame model.

## 28. Implementation sequence

Recommended sequence:

### Wave 1 — shared Pi-native substrate

Verify current Pi APIs and implement:

```text
AgentSessionRuntime
DefaultResourceLoader
extension/skill/prompt/context parity
FrameProjector
activity normalization
conversation graph
session resume/fork/reconstruction
```

### Wave 2 — first TUI vertical

Prove against real Pi:

```text
Frame 1
Frame 2
horizontal navigation
compressed tools
normal/expanded tools
Frame overview
conversation tree
extension/skill/command compatibility
```

### Wave 3 — stabilize shared contracts

Freeze enough semantic contracts for the GUI worker to proceed independently.

### Wave 4 — coordination adapters

Introduce Pi intercom / Pi↔Claude / provider-native messaging as optional capabilities.

### Wave 5 — governed runtime projection

Add Specialists, Channels, ResultContract, ChainRun state, and richer governed statuses over the same shell/substrate.

## 29. Proposed package structure

```text
packages/xtrm-tui/
├── src/
│   ├── app.ts
│   ├── keybindings.ts
│   ├── frame-projector.ts
│   ├── frame-tabs.ts
│   ├── frame-viewport.ts
│   ├── frame-overview.ts
│   ├── conversation-tree.ts
│   ├── composer.ts
│   └── tool-view.ts
├── docs/
│   ├── xtrm-tui-prd.md
│   ├── design.md
│   ├── adoption-audit.md
│   └── local-worker-dispatch.md
└── prototype/
```

Shared semantic contracts may later move to a shared XTRM package if evidence justifies extraction.

Core remains an upstream dependency/source for currently-owned XTRM Pi extension primitives until ownership is deliberately moved.

## 30. Explicit non-goals for v0

- replacing Pi runtime;
- replacing Pi resource discovery;
- replacing the Pi extension ecosystem;
- hard-forking Pi interactive mode without evidence;
- Specialists chains;
- Channels workflow authority;
- ResultContract validation UI;
- remote multi-host orchestration;
- universal provider abstraction before Pi is proven;
- custom terminal rendering engine;
- destructive branch compression;
- rich final-response Markdown frame as a blocking requirement;
- building an IDE-scale file/git/terminal cockpit before the core Frame interaction works.

## 31. Acceptance criteria

The first accepted TUI vertical must prove all of the following:

1. `xt pi` behavior remains unchanged.
2. `xtrm-tui` uses real Pi `AgentSessionRuntime`/`AgentSession` APIs, not terminal scraping as the primary runtime integration.
3. Normal Pi resource discovery remains active.
4. Existing compatible Pi extensions load and function.
5. Skills, prompt templates, context files, settings, models and auth remain available.
6. A normal idle submit opens one Frame.
7. Multiple Pi turns and tool calls remain inside that Frame.
8. `agent_end(willRetry=true)` cannot settle the Frame.
9. `agent_settled` settles the Frame exactly once.
10. A second idle submit opens the next Frame.
11. Previous/next navigation switches selected Frames without mutating provider state.
12. Frame overview navigates across Frames.
13. Compressed tool mode renders one concise row per call where width permits.
14. Normal tool mode preserves bounded XTRM previews.
15. Expanded mode exposes the complete renderer surface.
16. Failed tools remain visible in all modes.
17. External tools such as Serena/GitNexus obey the same tool-view policy where renderable.
18. Tool-view changes never mutate model-facing results.
19. Pi same-session tree navigation is represented correctly.
20. Independent fork preserves the original session path.
21. UI branch compression is non-destructive.
22. Resume/restart reconstructs Frames and topology sufficiently for continued use.
23. Runtime session replacement correctly rebinds subscriptions/extensions.
24. No stale event from a replaced session is attributed to the active session.
25. Extension custom TUI surfaces remain usable or receive an explicit compatibility disposition.
26. Terminal widths 80/120/160/220 are exercised.
27. tmux, Kitty, Alacritty and a plain Linux terminal path are smoke-tested.
28. No new Pi fork is required for the accepted vertical.
29. The product remains recognizably XTRM when provider/model branding is removed.

## 32. Adoption/reuse gates

Before implementing equivalents from scratch, complete bounded spikes for:

```text
TUI-SPIKE-1  Pi selectors/tree/model components
TUI-SPIKE-2  Pi tool/assistant/Markdown rendering
TUI-SPIKE-3  xtrm-ui primitive extraction/reuse
TUI-SPIKE-4  overlay/editor/input integration
TUI-SPIKE-5  terminal width/input/performance parity
```

Each spike must record:

```text
DEPEND / ADAPT / REFERENCE / REJECT
source/version/commit
license/provenance
public/private API status
required modifications
maintenance risk
custom code avoided
```

## 33. Final invariant

The TUI succeeds when XTRM can provide a materially different agent interaction model while retaining Pi's runtime, ecosystem, extensibility, and terminal strengths.

In compact form:

```text
Pi remains the harness.
pi-tui remains the terminal foundation.
Frames become the human navigation model.
XTRM owns presentation and information architecture.
Existing Pi capabilities are preserved by default.
Specialists and governed coordination arrive later over the same substrate.
```
