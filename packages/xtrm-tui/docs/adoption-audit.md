# xtrm-tui — open-source adoption audit

**Status:** implementation guidance / adoption gate  
**Scope:** `packages/xtrm-tui`  
**Product:** XTRM-native human ↔ agent terminal interface

## 1. Governing decision

The TUI must be XTRM-native in product behavior without rebuilding terminal infrastructure that Pi already exposes publicly.

Use this boundary:

```text
reuse/adapt
├── pi-tui renderer and terminal abstraction
├── layout and overlays
├── editor/input primitives
├── model/session selectors
├── tree navigation mechanics
├── tool execution component patterns
├── markdown rendering
├── terminal capability handling
└── proven performance/input behavior

own
├── Episode projection
├── thin horizontal Episode tab strip
├── selected-Episode viewport
├── Episode overview overlay
├── XTRM conversation/fork presentation
├── visual branch compression
├── compressed → normal → expanded tool policy
├── XTRM keymap/presentation language
└── later XTRM runtime/ChainRun projections
```

Do not hard-fork Pi merely to obtain components that are already reusable through public source/package boundaries.

## 2. Adoption classes

Use the same explicit disposition vocabulary as `xtrm-app`:

```text
DEPEND    use maintained package/API
ADAPT     bounded source adaptation with provenance
REFERENCE study patterns and reimplement independently
REJECT    do not use
```

No silent vendoring.

## 3. Primary source: `@earendil-works/pi-tui`

License: MIT.

This should remain the rendering/input foundation unless a local spike proves a concrete blocker.

Reusable capabilities already include:

- differential line rendering;
- synchronized output;
- `Component` / `Focusable` contracts;
- `VStack` / `HStack` layout;
- `ScrollView`;
- overlay composition and focus;
- percentage/anchor positioning;
- terminal-width utilities;
- Kitty keyboard protocol support;
- buffered escape-sequence input;
- IME-aware cursor placement;
- image capability detection;
- markdown and selection components.

The first implementation must prove the Episode layout with these primitives before evaluating another TUI framework.

## 4. Pi interactive components — ADAPT/REFERENCE

DeepWiki/source analysis of Pi identifies existing interactive components that solve commodity TUI behavior:

```text
ChatContainer
EditorContainer
FooterComponent
SessionSelector
TreeSelector
ModelSelector
ScopedModelsSelectorComponent
LoginDialogComponent
OAuthSelectorComponent
AssistantMessageComponent
ToolExecutionComponent
BashExecutionComponent
```

### 4.1 `TreeSelector`

High-priority adaptation candidate.

It already supports:

- recursive session tree flattening;
- ASCII branch hierarchy;
- folding;
- filter modes;
- horizontal viewport clipping while preserving the tree gutter.

Use it as the implementation/reference base for the XTRM conversation-tree overlay.

Do not duplicate tree traversal/folding logic unless public API/source coupling makes adaptation materially unsafe.

### 4.2 `SessionSelector`

Use/adapt for:

- session browsing;
- fuzzy/recent/threaded filtering;
- rename/delete mechanics where product policy permits them.

XTRM Episode navigation is not a replacement for session selection. They are different levels:

```text
session
  └── conversation topology
       └── Episodes
```

### 4.3 `ModelSelector` / scoped models

Reuse/adapt instead of inventing another fuzzy model picker. XTRM may provide different chrome and naming while retaining the proven selection/search mechanics.

### 4.4 `ToolExecutionComponent`

Use its renderer-resolution and tool-definition integration patterns.

The XTRM-specific change is the visibility policy:

```text
Pi stock
  collapsed ↔ expanded

XTRM
  compressed → normal → expanded
```

Do not rewrite execution semantics. Extend presentation state.

### 4.5 assistant/thinking/markdown

Current Core `xtrm-ui` already customizes Pi thinking and tool presentation. Extract/reuse those XTRM-owned primitives instead of starting from Pi defaults again.

The target layering remains:

```text
Pi component/rendering primitives
        ↓
shared XTRM UI primitives from Core/xtrm-ui where useful
        ↓
xtrm-tui Episode shell
```

The package root stays `xtrm-dev/xtrm/packages/xtrm-tui`; Core is not the product owner.

## 5. Prime Agent — ADAPT/REFERENCE

License: MIT.

Prime Agent demonstrates how far a Pi-derived TUI can be pushed and is useful for:

- compact Pi-native presentation;
- overlays;
- navigable session/tree surfaces;
- alternate interaction chrome;
- product-specific extensions around Pi.

Do not begin by taking a full Prime Agent fork. Compare specific components or changes against current upstream Pi and adopt only bounded improvements that still make sense for XTRM.

Prefer:

```text
upstream Pi public packages
+ bounded component adaptation
+ XTRM shell
```

over:

```text
fork entire agent/TUI
+ inherit unrelated product decisions
```

## 6. OpenCode and Codex TUI — REFERENCE

These implementations reinforce several useful architecture patterns.

### OpenCode

Useful ideas:

- independent UI state projected from runtime events;
- reducers between raw event stream and view;
- leader-key approach to reduce terminal shortcut conflicts;
- command IDs for session fork/compact/timeline/navigation;
- split-footer/direct-mode design where mutable UI is isolated from immutable scrollback;
- subagent tab/focus concepts.

Do not adopt Bubble Tea/OpenTUI merely because the product has similar features. `pi-tui` is already aligned with our Pi-first runtime.

### Codex TUI

Useful ideas:

- event bus between runtime and UI;
- committed history cells plus mutable streaming cell;
- stacked bottom-pane overlays;
- explicit input routing/focus;
- transcript overlay separate from main live surface.

These are architecture references, not a request to copy Ratatui code into the TypeScript TUI.

## 7. XTRM TUI personality

The TUI should not look like stock Pi with an extra row.

The defining screen is:

```text
XTRM · repo · branch                      model · context · thinking
EPISODES  recover work │ review │ renderer
──────────────────────────────────────────────────────────────────

selected Episode only
  ingress
  thinking/activity
  compressed tools
  final response

──────────────────────────────────────────────────────────────────
› composer
──────────────────────────────────────────────────────────────────
small context-sensitive hints
```

### Density

- fixed chrome should be roughly two lines above and two lines below content;
- avoid decorative box borders around the whole interface;
- tool calls should be one physical row in compressed mode when terminal width permits;
- metadata should be dim and subordinate;
- error state must remain legible without making successful runs visually noisy.

### Color

Use mostly terminal foreground/dim semantics with one restrained XTRM accent family.

Do not assign a unique bright color to every provider/tool/status.

### Navigation

Episodes are first-class horizontal units even though the terminal is text-based.

```text
Ctrl+Left / Ctrl+Right   adjacent Episode
Ctrl+E                   Episode overview
Ctrl+B                   conversation tree
Ctrl+O                   tool detail cycle
```

Keybindings remain subject to collision testing against Pi and terminal standards.

### Product invariant

If the model/provider label is hidden, the TUI must still be recognizable as XTRM because of Episodes, density, navigation, tool policy, and conversation topology.

## 8. Required adoption spikes

### TUI-SPIKE-1 — Pi component reuse map

Against the exact installed/current Pi version, classify each candidate:

```text
TreeSelector
SessionSelector
ModelSelector
ToolExecutionComponent
AssistantMessageComponent
Editor/Input
Overlay primitives
```

For each record:

```text
public import available?
private/internal source only?
license
API stability
adaptation cost
DEPEND / ADAPT / REFERENCE / REJECT
```

Do not write replacements until this matrix exists.

### TUI-SPIKE-2 — Episode shell with stock pi-tui

Build only:

- top status row;
- thin Episode tabs;
- selected Episode viewport;
- composer;
- `Ctrl+E` overlay.

Feed fixture data first, then one real Pi `AgentSession`.

Acceptance: no Pi interactive-mode fork required.

### TUI-SPIKE-3 — TreeSelector adaptation

Render actual `SessionManager.getTree()` through the adapted selector.

Prove:

- folding;
- deep tree;
- fork labels;
- current branch highlight;
- UI-only `+N compressed` representation;
- widths 80/120/160/220.

### TUI-SPIKE-4 — tri-state tools

Use current XTRM renderer data and prove:

```text
compressed
  one-line semantic summary

normal
  current bounded xtrm-ui preview

expanded
  full renderable result
```

The same tool result object must survive all modes unchanged.

### TUI-SPIKE-5 — keymap and input compatibility

Test under at least:

- tmux;
- Kitty;
- Alacritty;
- plain Linux terminal path.

Verify `Ctrl+O`, `Ctrl+E`, `Ctrl+B`, Episode navigation, paste, multiline editing, Kitty keyboard negotiation and overlay focus.

## 9. License and provenance gate

Before source adaptation:

1. record exact upstream repository and commit/version;
2. verify current license;
3. preserve notices as required;
4. keep source-adapted units small enough to track upstream meaningfully;
5. prefer imports from public Pi packages over copied internals;
6. document when an internal Pi component had to be adapted because it was not exported;
7. avoid source from non-permissive projects unless used only as architectural reference.

Pi and Prime Agent are currently MIT references. Verify again at adoption time.

## 10. Definition of successful reuse

Good:

```text
Pi owns terminal mechanics
Core/xtrm-ui supplies existing XTRM renderer knowledge
xtrm-tui owns the Episode interaction model
```

Bad:

```text
copy Pi interactive mode wholesale
rename it XTRM
then maintain a permanent fork for commodity selectors/rendering
```

## 11. Implementation rule

Before creating a selector, overlay, input component, tool renderer or tree utility, inspect current Pi and the approved references first.

Custom implementation requires a written reason tied to one of:

- missing public capability;
- incompatible state ownership;
- unacceptable coupling;
- required XTRM-specific semantics;
- performance/accessibility issue;
- license constraint;
- proven maintenance advantage.
