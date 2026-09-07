# Local worker dispatch — XTRM Frame TUI

Implement the first XTRM-native human ↔ agent terminal interface in `xtrm-dev/xtrm/packages/xtrm-tui`.

The canonical product requirements are in:

```text
packages/xtrm-tui/docs/xtrm-tui-prd.md
```

Treat that PRD as authoritative when this dispatch or older design material differs.

The product implementation belongs in `packages/xtrm-tui`. Do not move it into Core, Specialists, or a separate repository.

## 1. Cold start

Before editing code:

1. Read `docs/xtrm-tui-prd.md` in full.
2. Read `docs/adoption-audit.md` in full.
3. Read the current package starter and prototype.
4. Read current XTRM/Core Pi integration surfaces, especially:
   - `cli/src/commands/pi.ts`
   - `cli/src/core/pi-runtime.ts`
   - `docs/xtrm-ui.md`
   - `packages/pi-extensions/extensions/xtrm-ui/index.ts`
   - `packages/pi-extensions/extensions/xtrm-ui/format.ts`
   - the managed `packages/pi-extensions` package boundaries.
5. Read current upstream Pi sources/docs for the exact installed version:
   - `packages/coding-agent/docs/sdk.md`
   - `packages/coding-agent/docs/tui.md`
   - `packages/coding-agent/docs/extensions.md`
   - `AgentSession` / `AgentSessionRuntime`
   - `DefaultResourceLoader`
   - `SessionManager`
   - interactive-mode `TreeSelector`, `SessionSelector`, `ModelSelector`, `ToolExecutionComponent`, assistant rendering, Markdown, editor/input, overlay primitives and keybindings.

Do not code against remembered Pi APIs. Record the exact installed/source Pi version and the exact public/importable surfaces used.

Run repository-local Beads tracking before implementation. This dispatch does not replace Beads ownership.

## 2. Product boundary

Preserve this distinction:

```text
xt pi
  existing low-level Pi/worktree launcher
  provider-native escape hatch
  existing role/bead/model/skills/runtime controls

xt agent
  new XTRM-native interactive TUI
  Frame navigation
  XTRM presentation
  Pi runtime underneath
```

Do not repurpose or break `xt pi`.

The intended v0 launch path is:

```text
xt agent
    ↓
load packages/xtrm-tui entrypoint
    ↓
createAgentSessionRuntime(...)
    ↓
XTRM first-party TUI shell over @earendil-works/pi-tui
```

The TUI should also expose a package-local executable/entrypoint suitable for direct development and testing, but `xt agent` is the intended operator-facing command.

Do not replace the upstream `pi` executable globally. Ordinary `pi` continues to use Pi's own interactive mode, optionally styled by the existing XTRM `xtrm-ui` extension.

## 3. Core architectural rule

XTRM is an alternative product/interface around Pi, not a replacement for Pi's agent harness and ecosystem.

The new TUI must use Pi for:

```text
model execution
provider support
authentication
settings
session persistence
session tree
resume/fork/compaction
built-in tools
extension tools
extension hooks/events
skills
prompt templates
AGENTS/context files
resource discovery
steer/follow-up behavior
```

Do not rebuild those systems unless a concrete product requirement cannot be met through Pi's current public/runtime surfaces.

Use `AgentSessionRuntime` rather than terminal scraping or RPC for the first vertical.

Use Pi's `DefaultResourceLoader` or the exact current equivalent so existing Pi resources continue to load.

## 4. Frame model

The user-facing interaction unit is **Frame**.

The internal contract should use `InteractionFrame`.

Reserved terminology:

```text
turn   Pi/provider runtime-level concept
run    execution/runtime concept
step   workflow/chain concept
Frame  XTRM human-facing interaction unit
```

One normal idle user submit opens one Frame.

All Pi activity caused by that interaction remains in that Frame until the session is truly settled.

```text
idle + normal Enter
  → create InteractionFrame
  → session.prompt(...)

turn/tool/message/retry/compaction events
  → append/project into current Frame

agent_end
  → informational only
  → DO NOT close Frame

agent_settled
  → close Frame exactly once
```

A steering intervention during active work remains inside the current Frame unless later product semantics explicitly define otherwise.

The normal screen must show only the selected Frame, not all Frames concatenated into one vertical transcript.

## 5. Shared semantic substrate, independent renderer

The GUI and TUI may share semantic/runtime contracts, but the GUI must not depend on TUI rendering code and the TUI must not depend on React/desktop rendering code.

Target conceptual boundary:

```text
Pi AgentSessionRuntime
        ↓
InteractiveSessionHost / equivalent
├─ session lifecycle
├─ resource/extension binding
├─ Frame projection
├─ normalized activity/tool model
├─ conversation graph projection
└─ future coordination-capability seam
        │
    ┌───┴────┐
    ▼        ▼
xtrm-tui   xtrm-app
pi-tui     React/Tauri
```

Likely common concepts include:

```text
InteractionFrame
FrameState
FrameProjector
ToolActivity
ConversationGraph
SessionHost
ExtensionBinding
```

Do not create a new shared package merely because these concepts have names. Extract a shared package only when actual implementation duplication justifies it.

## 6. Adoption-first rule

Do not reimplement commodity terminal or Pi interaction machinery before evaluating existing maintained implementations.

Run the bounded adoption spikes from `docs/adoption-audit.md` before broad implementation.

Update stale spike terminology to `Frame` where needed.

At minimum prove/document:

```text
TUI-SPIKE-1  Pi component/public API reuse map
TUI-SPIKE-2  Frame shell on stock @earendil-works/pi-tui
TUI-SPIKE-3  TreeSelector / SessionSelector reuse or bounded adaptation
TUI-SPIKE-4  tri-state tool presentation over real Pi tool events
TUI-SPIKE-5  keymap/input/overlay compatibility
TUI-SPIKE-6  Pi resource/extension compatibility smoke
```

Every candidate receives an explicit disposition:

```text
DEPEND / ADAPT / REFERENCE / REJECT
public import or internal-source status
exact upstream version/commit
license
integration/adaptation cost
reason custom XTRM code is still required
```

Prefer public package APIs.

If a Pi interactive component is not exported but is permissively licensed and materially useful, a bounded adaptation is acceptable with provenance. Do not take a broad Pi fork merely to gain UI components.

Prime Agent, OpenCode and Codex are references, not default dependencies.

## 7. Reuse current xtrm-ui work

Do not create a second XTRM terminal design system.

The current Core `xtrm-ui` Pi extension already contains useful XTRM-owned work for:

```text
theme
compact density
editor styling
thinking presentation
built-in tool rendering
external tool rendering
metadata formatting
preferences
```

Extract or consume these primitives so the relationship becomes:

```text
ordinary upstream pi
    + xtrm-ui extension adapter
            │
            ▼
    shared XTRM UI primitives
            ▲
            │
        xtrm-tui
    first-party shell
```

The existing extension remains supported.

`xtrm-tui` should use the same XTRM theme/rendering knowledge directly rather than pretending to be an extension inside its own product shell.

Where Pi already implements a generic mechanism, reuse it and apply XTRM presentation policy above it.

No duplicated renderer implementation.

## 8. Pi ecosystem compatibility

The v0 TUI must preserve, at minimum:

```text
Pi built-in tools
Pi extensions
extension tools
extension hooks/events
extension commands
skills
prompt templates
AGENTS/context files
themes where relevant
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

Smoke with real existing resources, not only mocked extensions.

Do not introduce XTRM-only hidden discovery paths that cause resources available in ordinary Pi to disappear under `xt agent`.

If XTRM intentionally filters or overrides a Pi resource, record the product/governance reason and test it explicitly.

## 9. Extension UI compatibility

Pi extensions that register tools, hooks, commands, resources or session data should work through the same session/resource machinery.

TUI-specific extension UI is naturally supported because `xtrm-tui` is built on Pi TUI primitives, but do not assume arbitrary extension UI can bypass the XTRM shell's focus/layout rules.

Characterize:

```text
notify
status
widget
select
confirm
input
editor
title
custom TUI component
```

Preserve ordinary extension behavior where possible.

If an extension assumes Pi's stock `InteractiveMode` object/layout rather than public TUI/resource contracts, document the incompatibility rather than silently cloning the stock interactive mode.

## 10. Product identity

The final TUI must not look like stock Pi with one extra header.

XTRM owns:

```text
Frame projection
thin horizontal Frame tabs
selected-Frame-only viewport
Frame overview
conversation/fork presentation
non-destructive visual branch compression
compressed → normal → expanded tool policy
XTRM density/keymap/naming
later Specialists/ChainRun projections
```

The TUI should remain recognizable as XTRM if provider/model names are removed.

Use mostly monochrome/graphite presentation with one restrained accent family.

Avoid:

```text
box-heavy dashboard chrome
rainbow provider/tool coloring
permanent multi-panel clutter
unbounded vertical archaeology
```

## 11. Target component tree

Conceptual target:

```text
<XtrmAgentTui>
  <TopStatusBar />
  <FrameTabStrip />

  <FrameViewport>
    <IngressMessage />
    <ThinkingRow />
    <Activity />
    <AgentResponse />
  </FrameViewport>

  <Composer />
  <BottomHints />

  overlays
    <FrameOverview />
    <ConversationTree />
    <ToolTrace />
    <ModelPicker />
    <SessionSelector />
    <CommandPalette />
```

Use/adapt Pi's existing overlay, selector, editor/input, Markdown and terminal capability machinery where viable.

## 12. Tool display policy

Implement exact tri-state presentation:

```text
compressed
normal
expanded
```

Default mode: `compressed`.

### compressed

One physical row per completed tool call except unavoidable terminal wrapping.

Render only:

```text
action/tool label
shortened subject
status/error
count/diff stat where available
duration
payload/truncation marker only when useful
```

No output preview body.

Example:

```text
• Ran     git status --short                            2 lines · 1.3s
• Read    packages/.../xtrm-ui/index.ts                 1782 lines · 65KB · 0.8s
• Edited  README.md                                      +18 -3 · 0.4s
• Serena  find_symbol registerXtrmUiTools               3 hits · 0.9s
```

### normal

Preserve current XTRM bounded-preview behavior where appropriate.

### expanded

Expose the full renderable tool result within Pi/tool/terminal safety bounds.

Presentation mode must never mutate:

```text
model-facing tool result
provider transcript
persisted tool result
```

`Ctrl+O` may cycle `compressed → normal → expanded` after exact keymap collision testing.

## 13. Frame navigation

Implement:

```text
thin fixed Frame tab row
previous/next Frame navigation
selected-Frame viewport
Ctrl+E Frame overview overlay
Ctrl+B conversation-tree overlay
```

Suggested first-party keymap remains provisional until collision testing:

```text
Ctrl+O          cycle tool view
Shift+Ctrl+O    reverse tool view
Ctrl+E          Frame overview
Ctrl+B          conversation tree
Ctrl+T          thinking expand/collapse
Ctrl+Left       previous Frame
Ctrl+Right      next Frame
Alt+Enter       Pi follow-up semantics
Esc             interrupt / close active overlay
Ctrl+L          model picker
```

Do not force first-party shell keybindings through extension shortcut registration.

## 14. Conversation topology

Provider session history remains authoritative.

Use Pi's native tree:

```text
SessionManager.getTree()
        ↓
ConversationTreeProjector
        ↓
ConversationTree overlay
```

Keep these operations distinct:

```text
navigateTree / branch
  branch within current Pi session

AgentSessionRuntime.fork
  create independent session fork
```

Visual branch compression is UI-only and non-destructive:

```text
raw provider history unchanged
        ↓
XTRM UI state
        ↓
+N compressed
```

Reuse/adapt Pi tree traversal/folding logic where viable.

## 15. Persistence

Do not create a second authoritative transcript store.

Pi remains source of truth for messages, tool results, session identity, native topology and compaction history.

XTRM-owned state may persist:

```text
Frame projection/cache
Frame title
selected Frame
UI-compressed branch IDs
tool-view mode
layout/preferences
provider-independent graph metadata not recoverable from Pi
```

Restart/reconstruction must be proved from real Pi persisted sessions.

## 16. First vertical — prove ordinary Pi-backed work first

Do not start with Specialists, Channels or provider-to-provider coordination.

The first accepted vertical is:

```text
xt agent
  ↓
real Pi AgentSessionRuntime
  ↓
real DefaultResourceLoader/resources
  ↓
Frame 1
  ↓
real thinking/turns/tools
  ↓
compressed tools by default
  ↓
agent_settled
  ↓
Frame 2
  ↓
Frame switching
  ↓
Frame overview
  ↓
Pi tree/fork navigation
  ↓
restart/reconstruction
```

Prove the central product hypothesis:

> XTRM can provide a materially different interaction model without throwing away Pi's runtime and ecosystem.

Only after that substrate is stable should broader coordination integration begin.

## 17. Later coordination and Specialists integration

Design seams now; do not make them v0 dependencies.

Future interactive coordination may expose first-class capabilities backed by:

```text
Pi ↔ Pi        pi-intercom
Claude ↔ Pi    Pi/Claude link
Claude ↔ Claude native provider messaging
```

These are transports/capability adapters, not workflow authority.

When governed Specialists/ChainRun execution is integrated later:

```text
semantic coordination
    → XTRM Channels

provider/runtime delivery
    → Pi intercom / Claude link / provider-native transport
```

Do not define `Specialist == Pi subagent`.

A Specialist is a semantic/governed definition and activation. Pi children/sessions are possible execution mechanisms.

The later TUI may project Specialist activations into the same Frame/activity model without replacing the ordinary human↔agent UX.

## 18. Deferred rich final-response surface

The rich settled Markdown result-card idea is intentionally deferred.

Do not make it a v0 acceptance gate.

Preserve the design seam for a later mode where a settled Frame can promote its final response into a bounded, scrollable rich Markdown viewport with focus mode and copy-original-Markdown behavior.

Do not spend the first vertical polishing this before the Frame/session/tool model is proven.

## 19. Tests before visual polish

At minimum test:

```text
real Pi resource discovery
real extension tool + hook + command
real skill/prompt/context loading
multiple tool calls within one provider turn
multiple provider turns within one Frame
retry lifecycle
agent_end(willRetry=true) does not close Frame
agent_settled closes once
failed tool
streaming tool
external Serena/GitNexus-style tool
compressed/normal/expanded presentation invariants
width 80/120/160/220
Frame switching
session replacement subscription rebinding
same-session branch
independent fork
branch UI compression
restart/reconstruction
model/session selector behavior
keymap collision/input behavior
provenance tests for adapted upstream components
tmux
Kitty
Alacritty
plain Linux terminal path
```

Also prove:

```text
xt pi remains unchanged
ordinary pi remains unchanged
no Pi fork is required
xtrm-tui can launch without Specialists/Channels
an optional Pi extension absent does not break the TUI
```

## 20. Implementation order

Use this sequence unless real evidence requires a change:

```text
T0  cold-start + Bead + dependency/version inventory
T1  adoption/reuse matrix
T2  minimal xt agent command/entrypoint
T3  real AgentSessionRuntime + DefaultResourceLoader
T4  extract/consume xtrm-ui primitives
T5  InteractionFrame + FrameProjector over real events
T6  selected-Frame viewport + Frame tabs
T7  tri-state tool rendering
T8  Frame overview
T9  Pi session selector/reopen/reconstruction
T10 conversation tree + branch/fork
T11 extension/skill/prompt/context compatibility matrix
T12 terminal/keymap/width hardening
T13 package/CLI integration and release proof
```

Do not wait for GUI implementation. Once the shared semantic contracts stabilize, GUI work may proceed in parallel against the same event fixtures/contracts.

## 21. Stop/escalation conditions

Escalate only if evidence shows one of these:

```text
required Pi SDK/TUI semantics are not public/stable enough
required stock interactive components cannot be reused or boundedly adapted without broad private-internal coupling
existing Core/xtrm-ui package boundaries make reuse materially impossible without a package-level decision
Pi extension/resource compatibility requires a product-level behavior decision
a dependency/license materially constrains XTRM distribution
xt agent integration requires breaking xt pi or ordinary pi behavior
```

Do not escalate merely because Pi's stock interactive layout cannot express the XTRM design. The point of `xtrm-tui` is to provide a new first-party shell over Pi's public runtime/TUI primitives.

## 22. Final acceptance

The first TUI milestone is accepted only when:

1. `xt agent` opens the XTRM TUI.
2. `xt pi` remains unchanged.
3. ordinary upstream `pi` remains unchanged.
4. the TUI uses real Pi `AgentSessionRuntime`, not terminal scraping.
5. Pi resources/extensions/skills/prompts/context/models/auth/settings remain available through normal Pi machinery.
6. a normal idle submit creates one Frame.
7. all relevant turns/tools/retries/compaction remain in that Frame until `agent_settled`.
8. `agent_end(willRetry=true)` cannot close the Frame.
9. two real prompts produce two navigable Frames.
10. the normal viewport shows the selected Frame rather than an unbounded historical transcript.
11. tri-state tool presentation works without changing model-facing results.
12. Pi tree navigation and independent fork are both represented correctly.
13. restart reconstructs sessions/Frames without a competing transcript database.
14. the existing XTRM xtrm-ui visual/rendering work is reused or deliberately extracted rather than duplicated.
15. no Pi fork is required.
16. Specialists/Channels are not required for ordinary interactive operation.
17. the result is recognizably XTRM rather than stock Pi with cosmetic changes.

Repository ownership remains:

```text
xtrm-dev/xtrm/packages/xtrm-tui
  owns the product

xtrm-dev/core
  remains upstream owner of existing managed Pi/xtrm-ui machinery until shared primitives are deliberately extracted/consumed
```
