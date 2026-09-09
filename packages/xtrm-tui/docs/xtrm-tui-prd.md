# XTRM TUI PRD

**Status:** Draft v0.2 — implementation baseline  
**Package:** `xtrm-dev/xtrm/packages/xtrm-tui`  
**Product:** XTRM-native human ↔ agent terminal interface  
**Primary runtime:** Pi `AgentSessionRuntime`  
**Rendering foundation:** `@earendil-works/pi-tui`  
**Primary interaction unit:** `Frame` (internal contract: `InteractionFrame`)

## 1. Product objective

Build a first-party XTRM terminal interface that presents agent work through bounded, navigable **Frames** instead of one unbounded vertical transcript, while preserving Pi as the underlying agent harness and ecosystem.

The TUI is the first proving surface for the shared XTRM interaction substrate because it has the shortest path to Pi's runtime, resource loader, extension system, session tree, and TUI primitives.

The product must remain compatible with ordinary Pi usage and must not require Specialists, Channels, or the governed Chain runtime to function.

The design target is a real terminal application, not a web-dashboard layout rendered with characters. The primary content should own almost the whole terminal; navigation and runtime chrome should be concentrated in a compact bottom dock.

## 2. Product boundary and launch path

Keep the existing distinction:

```text
pi
  stock Pi interactive mode
  optionally styled by the existing xtrm-ui extension

xt pi
  low-level XTRM Pi/worktree launcher
  provider-native escape hatch
  existing Pi-oriented operator surface

xt agent
  XTRM-native interactive human ↔ agent TUI
  Frame navigation
  XTRM presentation
  Pi runtime underneath
```

`xt agent` owns interaction presentation.

The intended launch path is:

```text
xt agent
    ↓
packages/xtrm-tui entrypoint
    ↓
createAgentSessionRuntime(...)
    ↓
InteractionFrame / activity projection
    ↓
XtrmAgentTui
    ↓
@earendil-works/pi-tui
```

Do not replace the global `pi` executable and do not repurpose `xt pi` into this product shell.

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

XTRM replaces Pi's stock `InteractiveMode` as the visible shell for `xt agent`; it does not replace Pi's runtime or terminal rendering library.

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

Use `InteractionFrame` internally, or another equally explicit internal type name, so the contract is not confused with rendering, protocol, browser, animation, or stack frames.

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

A retry, compaction retry, or queued continuation remains in the same Frame.

## 4. Spatial interaction law

This is a load-bearing product invariant.

```text
horizontal axis
  movement between Frames on the current conversation path

vertical axis
  inspection/scrolling within the selected Frame

topological/tree dimension
  forks, branches, alternate conversation paths
```

The TUI must reinforce this law consistently across keyboard navigation, overview, branch tree, Frame creation, and later GUI parity.

Consequences:

- `Ctrl+Left` and `Ctrl+Right` move between Frames, never inside Frame content.
- Vertical scrolling never changes the selected Frame.
- A branch/fork changes conversation topology and is surfaced through the tree/overview, not as another vertical transcript section.
- The normal viewport renders one selected Frame only.
- Historical Frames are not left visible above the current Frame as ordinary scrollback.

This spatial law is more important than any specific border, icon, or color choice.

## 5. Default screen model: content first, bottom-docked chrome

The normal TUI must show one selected Frame, not the complete historical transcript.

Persistent chrome should live primarily at the **bottom**. The upper screen belongs to Frame content.

Preferred normal structure:

```text
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         selected Frame                           │
│                                                                  │
│  you  ...                                                        │
│                                                                  │
│  thinking · ...                                                  │
│                                                                  │
│  activity · 8 tools                                              │
│  • Read ...                                                      │
│  • Ran  ...                                                      │
│                                                                  │
│  agent response ...                                              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ FRAMES  ◀ 12 Recover │ 13 Review │ ◆ 14 Renderer            ▶   │
├──────────────────────────────────────────────────────────────────┤
│ › Message agent…                                      ◈ sol high │
├──────────────────────────────────────────────────────────────────┤
│ ⎇ core:feature/xtrm-tui  ◉ 65%  ≡ compressed  ^E Frames  ^B Tree│
└──────────────────────────────────────────────────────────────────┘
```

The preferred fixed dock is approximately three rows:

```text
FrameNavigator
Composer
StatusLine
```

A permanent top status/header row is not required. Repo, branch, model, context, tool-view mode, runtime state, and navigation hints belong in the bottom dock unless a specific transient context marker is materially useful.

A small transient Frame marker inside the viewport is allowed, for example:

```text
◆ Frame 15 · working
```

but it must not become a second persistent header system.

The design goal is **low chrome area, not low visual quality**.

## 6. Bottom dock behavior

The bottom dock is the persistent interaction locus.

Normal idle example:

```text
FRAMES  ◀ 12 Recover │ 13 Review │ ◆ 14 Renderer               ▶
› Message agent…                                           ◈ sol high
⎇ core:feature/xtrm-tui · ◉ 65% · ≡ compressed · ^E Frames · ^B Tree
```

Running example:

```text
FRAMES  ◀ 13 Review │ ✓ 14 Renderer │ ● 15 Reconstruction      ▶
› steer agent…                                             ◈ sol high
● working · 5 tools · 1m12s · ◉ 64% · ≡ compressed · Esc interrupt
```

The bottom dock may adapt labels/status while preserving row ownership and spatial stability.

When a full overlay owns focus, the dock may collapse to a single concise hint/status row if that increases usable space and avoids duplicated information.

The dock must degrade coherently on narrow terminals. If all metadata cannot fit, preserve this order of importance:

```text
1. current Frame identity / navigation
2. composer / current input mode
3. active runtime state / interrupt affordance
4. model
5. context
6. repo/branch
7. optional hints
```

## 7. Visual quality and icon/chrome policy

Terminal-native does not mean visually primitive.

Use tasteful icons/glyphs, subtle separators, inverse/bright text, spacing, and restrained state markers where terminal/font capability permits.

Potential semantic icon vocabulary:

```text
⎇  git/worktree
◉  context
◆  current Frame
●  working
✓  settled
!  error
≡  tool-density/view mode
◈  model
⌘  command/shortcut
⑂  fork/branch
◀ ▶ Frame navigation
```

Prefer icons to communicate stable categories. Do not place a decorative icon before every label merely to make the interface busier.

Where a Nerd Font/Octicon-compatible glyph is reliably available, the implementation may use a richer icon set. The product must also support a safe Unicode/ASCII fallback.

Requirements:

- icon choice must not corrupt column width or alignment;
- glyph fallback must be deterministic;
- unsupported glyphs must never make controls disappear;
- all important state remains readable without color or special icons;
- one restrained accent family is preferred over rainbow status/tool coloring.

The product should look designed and polished while remaining recognizably a TTY application.

## 8. Frame creation and atomic transition

Creating a new Frame is a first-class state transition, not ordinary transcript append behavior.

The transition must be visually unmistakable, deterministic, and consistent.

For an accepted normal user submit while the session is settled:

```text
1. freeze the previous Frame state and scroll position
2. allocate the new InteractionFrame
3. attach the accepted ingress to the new Frame
4. set selectedFrameId to the new Frame
5. replace the primary viewport with the new Frame
6. start/continue Pi prompt processing for that Frame
```

The UI state change from previous Frame to new Frame must be atomic from the user's perspective.

Hard invariant:

```text
Frame 14 viewport
       │
       │ accepted submit
       ▼
Frame 15 viewport

NOT

Frame 14
────────
Frame 15 appended underneath
```

If Pi rejects a submission before acceptance, do not advance the Frame navigator merely to fabricate progress. Exact preflight/acceptance behavior must be characterized against the installed Pi version.

When accepted, the new ingress must appear immediately inside the newly selected Frame even before the first assistant token arrives.

## 9. Frame transition cue

The semantic transition is mandatory. A brief visual cue is recommended when it can be implemented without flicker or input delay.

Example:

```text
✓ 14 Renderer  ───▶  ● 15 Reconstruction
```

The cue may use two or three deterministic renders over a very short interval, but continuous animation is not required.

Requirements:

- animation/cue never delays prompt dispatch;
- cue never changes state authority;
- cue must remain readable at 80 columns;
- transition must still be obvious when animation is disabled;
- switching back with `Ctrl+Left` follows the same horizontal grammar.

The Frame navigator itself is the authoritative persistent indication of the current Frame.

## 10. Frame navigation

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

The selected Frame should preserve independent scroll position where practical.

Navigation must be immediate and must never re-prompt or mutate provider history.

## 11. Frame overview

The overview is the terminal equivalent of browser-tab overview/zoom-out.

Example:

```text
┌ Frames ──────────────────────────────────────────────────────────┐
│                                                                 │
│  12                    13                    14                  │
│  Recover state         Review contract       Renderer            │
│  ✓ 1m03 · 8 tools      ✓ 2m16 · 12 tools    ✓ 2m31 · 14 tools  │
│                                                                 │
│                        ◆ 15                                     │
│                        Reconstruction                           │
│                        ● working · 5 tools                      │
│                                                                 │
│  ⑂ docs-ui                                                       │
│    +4 compressed                                                │
└─────────────────────────────────────────────────────────────────┘
```

The overview must be keyboard navigable and must not replace provider-native session topology.

Overview is allowed more visual chrome than the normal Frame viewport because it is an explicit navigation surface, not permanent screen furniture.

## 12. Pi compatibility is mandatory

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

Use the exact current `DefaultResourceLoader` or equivalent after verifying the installed Pi version.

## 13. Extensions remain first-class

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

## 14. Existing XTRM `xtrm-ui` work

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

The current xtrm-ui visual language is an implementation asset, not a requirement to preserve its existing large boxed header. Theme, density, editor, thinking, and tool-rendering knowledge should be retained while the new first-party shell adopts the bottom-docked information architecture defined here.

## 15. Do not fork Pi interactive mode for v0

Prime Agent demonstrates that a deep Pi fork can support a very different product, but XTRM should not start there.

Use public Pi SDK and `pi-tui` primitives first.

A hard fork is justified only if a required product behavior cannot be achieved cleanly through public/runtime/package boundaries and the maintenance cost is measured against the benefit.

The first implementation should not depend on private Pi internals merely for convenience.

## 16. Reuse Pi interactive components where practical

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

## 17. `pi-tui` is the rendering foundation

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

## 18. Shared semantic substrate, independent renderer

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

## 19. Runtime/event mapping

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

## 20. Input semantics

For v0:

```text
idle + accepted normal Enter
  → atomic transition to new Frame
  → session.prompt()/accepted Pi processing

streaming + explicit steer
  → same Frame

settled + accepted next normal Enter
  → atomic transition to next Frame
```

Pi follow-up semantics should remain available.

Do not silently reinterpret Pi queue behavior in a way that breaks extension commands or user expectations.

Extension commands or other Pi inputs that are handled immediately without representing a normal conversational ingress must be characterized before deciding whether they create a Frame. Do not invent a second command ontology merely for the UI.

## 21. Tool display: tri-state policy

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

## 22. Tool-view controls

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

The active tool-view mode should appear in the bottom status row, preferably with a compact semantic marker such as `≡ compressed`.

## 23. Activity normalization

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

## 24. Conversation topology

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

## 25. Branch compression

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

## 26. Composer

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

The composer is the middle row of the bottom dock. Its prompt label should reflect active mode when useful:

```text
› Message agent…
› steer agent…
› follow up…
```

Do not move normal text entry to a top pane or floating input surface.

## 27. Open-source adoption policy

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

## 28. Performance and terminal correctness

The TUI must remain responsive under high-frequency streaming and large histories.

Required properties:

- no full historical transcript rerender requirement for every event;
- application-owned scrolling works in alternate screen mode;
- selected-Frame-only rendering remains practical with 50–200 Frames;
- Frame overview remains responsive independently of total transcript size;
- large tool output does not dominate memory/render cost;
- width-aware rendering behaves at 80/120/160/220 columns;
- ANSI/Unicode/grapheme widths remain correct;
- icon/fallback width remains correct;
- terminal resize does not corrupt Frame state;
- extension custom UI can gain focus without breaking the shell;
- streaming sessions remain usable over tmux and common terminals;
- Frame transition cues do not introduce flicker, scroll jumps, or input lag.

Smoke targets:

```text
tmux
Kitty
Alacritty
plain Linux terminal path
```

## 29. Rich settled response surface — deferred exploration

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

## 30. Specialists and sub-agents

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

The bottom dock should be able to show a future focused execution context such as:

```text
SPECIALIST reviewer-2 · Frame 7/9
```

without redesigning the primary viewport.

## 31. Pi intercom / Claude link / provider messaging

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

## 32. Implementation sequence

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
bottom-docked shell
Frame 1
atomic accepted transition to Frame 2
selected-Frame-only viewport
horizontal navigation
compressed tools
normal/expanded tools
Frame overview
conversation tree
extension/skill/command compatibility
```

The first vertical is not accepted if it keeps Pi's normal vertical transcript underneath the Frame navigator.

### Wave 3 — stabilize shared contracts

Freeze enough semantic contracts for the GUI worker to proceed independently.

### Wave 4 — coordination adapters

Introduce Pi intercom / Pi↔Claude / provider-native messaging as optional capabilities.

### Wave 5 — governed runtime projection

Add Specialists, Channels, ResultContract, ChainRun state, and richer governed statuses over the same shell/substrate.

## 33. Proposed package structure

```text
packages/xtrm-tui/
├── src/
│   ├── app.ts
│   ├── keybindings.ts
│   ├── frame-projector.ts
│   ├── frame-navigator.ts
│   ├── frame-viewport.ts
│   ├── frame-overview.ts
│   ├── conversation-tree.ts
│   ├── bottom-dock.ts
│   ├── composer.ts
│   ├── status-line.ts
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

## 34. Explicit non-goals for v0

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
- building an IDE-scale file/git/terminal cockpit before the core Frame interaction works;
- recreating a web dashboard or permanent multi-panel cockpit inside the terminal;
- preserving a permanent top header merely because the previous xtrm-ui extension had one.

## 35. Acceptance criteria

The first accepted TUI vertical must prove all of the following:

1. `xt pi` behavior remains unchanged.
2. `xt agent` opens the XTRM first-party shell rather than Pi's stock `InteractiveMode`.
3. `xtrm-tui` uses real Pi `AgentSessionRuntime`/`AgentSession` APIs, not terminal scraping as the primary runtime integration.
4. Normal Pi resource discovery remains active.
5. Existing compatible Pi extensions load and function.
6. Skills, prompt templates, context files, settings, models and auth remain available.
7. A normal idle accepted submit opens one Frame.
8. Multiple Pi turns and tool calls remain inside that Frame.
9. `agent_end(willRetry=true)` cannot settle the Frame.
10. `agent_settled` settles the Frame exactly once.
11. A second accepted idle submit performs an atomic transition to the next Frame.
12. Once the new Frame is accepted/selected, previous Frame content is not left above it in the primary viewport.
13. The new ingress appears immediately inside the newly selected Frame before assistant streaming begins.
14. Rejected preflight/input does not fabricate an accepted new Frame.
15. Previous/next navigation switches selected Frames without mutating provider state.
16. Horizontal navigation always means Frame movement; vertical navigation always means selected-Frame inspection.
17. Frame overview navigates across Frames and exposes branch context without replacing the provider tree.
18. The persistent shell chrome is bottom-docked; the main content area does not require permanent top header rows.
19. Bottom dock remains usable at 80 columns and prioritizes Frame/navigation/input over secondary metadata.
20. Icons/glyphs have safe Unicode/ASCII fallback and do not corrupt column alignment.
21. Compressed tool mode renders one concise row per call where width permits.
22. Normal tool mode preserves bounded XTRM previews.
23. Expanded mode exposes the complete renderer surface.
24. Failed tools remain visible in all modes.
25. External tools such as Serena/GitNexus obey the same tool-view policy where renderable.
26. Tool-view changes never mutate model-facing results.
27. Pi same-session tree navigation is represented correctly.
28. Independent fork preserves the original session path.
29. UI branch compression is non-destructive.
30. Resume/restart reconstructs Frames, selected path, and topology sufficiently for continued use.
31. Runtime session replacement correctly rebinds subscriptions/extensions.
32. No stale event from a replaced session is attributed to the active session.
33. Extension custom TUI surfaces remain usable or receive an explicit compatibility disposition.
34. Terminal widths 80/120/160/220 are exercised.
35. tmux, Kitty, Alacritty and a plain Linux terminal path are smoke-tested.
36. Frame transition cues, if enabled, never delay dispatch and remain coherent when disabled.
37. A session with at least 50 Frames remains navigable without rendering the full historical transcript in the normal viewport.
38. No new Pi fork is required for the accepted vertical.
39. The product remains recognizably XTRM when provider/model branding is removed.

## 36. Adoption/reuse gates

Before implementing equivalents from scratch, complete bounded spikes for:

```text
TUI-SPIKE-1  Pi selectors/tree/model components
TUI-SPIKE-2  Pi tool/assistant/Markdown rendering
TUI-SPIKE-3  xtrm-ui primitive extraction/reuse
TUI-SPIKE-4  overlay/editor/input integration
TUI-SPIKE-5  terminal width/input/performance parity
TUI-SPIKE-6  bottom-dock layout and icon/fallback width parity
TUI-SPIKE-7  atomic Frame transition against real Pi preflight/settled behavior
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

## 37. Final invariant

The TUI succeeds when XTRM can provide a materially different agent interaction model while retaining Pi's runtime, ecosystem, extensibility, and terminal strengths.

In compact form:

```text
Pi remains the harness.
pi-tui remains the terminal foundation.
Frames become the human navigation model.
Horizontal means Frame progression.
Vertical means inspection inside one Frame.
Branches remain explicit topology.
The normal viewport shows only the selected Frame.
Persistent chrome lives primarily in the bottom dock.
Frame creation is an atomic, unmistakable transition.
XTRM uses tasteful terminal chrome/icons without becoming a web dashboard.
Existing Pi capabilities are preserved by default.
Specialists and governed coordination arrive later over the same substrate.
```
