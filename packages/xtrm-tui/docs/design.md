# xtrm-tui — design and implementation packet

Status: implementation-ready design/starter, not a claim that the CLI is built.

## Decision

Build the first-party TUI in `xtrm-dev/xtrm/packages/xtrm-tui` over Pi's public SDK and `@earendil-works/pi-tui`. A later Core integration may expose it as `xt agent`, but the product implementation lives here.

Do **not** fork Pi's interactive mode for v0.

Keep:

```text
xt pi
  low-level Pi/worktree launcher and provider escape hatch

xt agent
  XTRM-native interactive human ↔ agent TUI
```

`xt agent` owns interaction presentation but delegates model execution, tools,
session history, branching, retries, compaction and provider support to Pi.

## Existing Core surface to consume and preserve

Current Core already provides:

```text
cli/src/commands/pi.ts
  `xt pi`
  sandbox/worktree launch
  role/bead metadata
  model/thinking/skills
  Pi runtime setup and drift checks

packages/pi-extensions/extensions/xtrm-ui
  XTRM themes
  CustomEditor
  custom header
  collapsed thinking row
  native built-in tool renderers
  external tool renderer patch
  user preferences

packages/pi-extensions
  managed @jaggerxtrm/pi-extensions package
```

The new TUI must reuse this machinery rather than create a second theme/rendering
implementation.

## Target component tree

```text
<XtrmAgentTui>
  <TopStatusBar />
  <EpisodeTabStrip />

  <EpisodeViewport>
    <IngressMessage />
    <ThinkingRow />
    <Activity>
      <ToolRow />
      <ToolRow />
    <AgentResponse />
  </EpisodeViewport>

  <Composer />
  <BottomHints />

  overlays
    <EpisodeOverview />
    <ConversationTree />
    <ModelPicker />
    <ToolTrace />
    <CommandPalette />
```

The normal screen shows only the selected Episode. It does not render every old
Episode as a single unbounded transcript.

## Runtime boundary

```text
xt agent
  createAgentSessionRuntime()
    AgentSession
      AgentSessionEvent
        ↓
      EpisodeProjector
        ↓
      XtrmAgentTui
```

Use `agent_settled`, not `agent_end`, as the end of one Episode.

### Episode input rule

```text
idle + Enter
  → new Episode
  → session.prompt()

streaming + explicit steer
  → same Episode

agent_settled + next Enter
  → next Episode
```

## xtrm-ui refactor

Do not delete the extension. Make it a thin Pi adapter over reusable first-party
UI primitives.

Target layout:

```text
packages/pi-extensions/
├── src/
│   └── xtrm-ui/
│       ├── prefs.ts
│       ├── theme.ts
│       ├── thinking.ts
│       ├── tool-render.ts
│       ├── tool-view.ts
│       └── editor.ts
│
└── extensions/
    └── xtrm-ui/
        └── index.ts          # Pi extension adapter
```

The new `xt agent` TUI imports the reusable xtrm-ui primitives directly. The
ordinary upstream `pi` CLI continues to receive them through the existing
extension adapter.

## Tool display: three levels

Current `xtrm-ui` has effectively:

```text
collapsed  <-> expanded
```

The product target is:

```text
compressed → normal → expanded
```

### compressed

One physical row per completed tool call.

Examples:

```text
• Ran    git status --short                            2 lines · 1.3s
• Read   packages/pi-extensions/.../xtrm-ui/index.ts  1782 lines · 65KB · 0.8s
• Edited README.md                                     +18 -3 · 0.4s
• Serena find_symbol registerXtrmUiTools              3 hits · 0.9s
```

Rules:
- no result body;
- preserve error state;
- preserve subject;
- preserve count/diff stats;
- preserve duration;
- preserve truncation indicator when material;
- preserve a way to inspect that single call.

### normal

The current XTRM bounded rendering is the baseline:
- bash: latest bounded lines;
- read/find/grep/ls/new write: first bounded lines;
- edit/update write: bounded rich diff;
- external tools: bounded normalized renderer;
- metadata footer when hidden content exists.

### expanded

Full renderable result for that tool call, still bounded by Pi/tool payload
contracts and terminal safety. Expansion is a presentation choice only.

## Keybindings

Recommended first-party bindings:

```text
Ctrl+O          cycle tools: compressed → normal → expanded
Shift+Ctrl+O    reverse tool cycle

Ctrl+E          Episode overview overlay
Ctrl+B          Conversation tree overlay
Ctrl+T          existing thinking expand/collapse

Ctrl+Left       previous Episode
Ctrl+Right      next Episode

Alt+Enter       Pi follow-up semantics
Esc             Pi interrupt / close active overlay by normal focus rules
Ctrl+L          model picker
```

Do not force these through `pi.registerShortcut()` in `xt agent`; the first-party
TUI owns its keybindings directly.

For upstream `pi` + xtrm-ui extension compatibility, add a command such as:

```text
/xtrm-ui-tools compressed|normal|expanded
```

and only register a shortcut if conflict behavior is explicitly tested.

## Episode overview

`Ctrl+E` opens an overlay:

```text
┌ Episodes ───────────────────────────────────────────────────┐
│ Ep 12  recover work       Ep 13  review        Ep 14 live  │
│ 6t · 8 tools · 1m03       4t · 12 tools        3t · 5tools │
│                                                            │
│ feature/docs  +4 compressed   renderer-spike +3 compressed │
└────────────────────────────────────────────────────────────┘
```

Use `ctx.ui.custom(..., { overlay: true })` only in the compatibility extension
path. `xt agent` can use the same `@earendil-works/pi-tui` overlay primitives
directly.

## Branches

Project provider-native Pi topology:

```text
SessionManager.getTree()
        ↓
ConversationTreeProjector
        ↓
<ConversationTreeOverlay />
```

Keep:

```text
navigateTree
  same-session branch

AgentSessionRuntime.fork
  independent session fork
```

UI compression remains non-destructive:

```text
raw provider history unchanged
        ↓
app UI metadata
        ↓
+N compressed
```

## Header and footer

The current large xtrm-ui boxed header should not become the native shell header.

For `xt agent`, prefer two fixed, slim rows:

```text
XTRM · core · feature/foo                    gpt-5.6-sol · ctx 65% · high
EPISODES  recover work | review contract | implement renderer
```

The old boxed header remains valid for the ordinary upstream Pi extension path
until intentionally revised.

## Persistence

Provider session remains authority for transcript/branch history.

App-owned state may store:

```text
episode projection cache
episode title
selected episode
UI-compressed branch IDs
tool view mode
layout preferences
```

Do not duplicate the full Pi transcript.

## Proposed package file change

```text
packages/xtrm-tui/
├── src/
│   ├── app.ts
│   ├── keybindings.ts
│   ├── episode-projector.ts
│   ├── episode-tabs.ts
│   ├── episode-viewport.ts
│   ├── episode-overview.ts
│   ├── conversation-tree.ts
│   ├── composer.ts
│   └── tool-view.ts
├── docs/
└── prototype/

Core remains an upstream dependency for currently-owned xtrm-ui renderer/theme primitives.
Port or extract them through an explicit dependency/refactor; do not duplicate them silently.
```

## First vertical

```text
xt agent
  ↓
Pi session opens
  ↓
send prompt
  ↓
Ep 1 tab
  ↓
real thinking / turns / tools stream
  ↓
compressed tool rows by default
  ↓
Ctrl+O → normal
  ↓
Ctrl+O → expanded
  ↓
agent_settled
  ↓
send another prompt
  ↓
Ep 2
  ↓
Ctrl+Left / Ctrl+Right switches Episode viewport
  ↓
Ctrl+E overview
  ↓
fork earlier entry
  ↓
Ctrl+B branch tree
```

## Acceptance

1. `xt pi` behavior is unchanged.
2. `xt agent` uses real `AgentSession`, not RPC or terminal scraping.
3. `agent_end(willRetry=true)` cannot close an Episode.
4. `agent_settled` closes exactly once.
5. Compressed mode uses one row per tool call except unavoidable terminal wrap.
6. Normal mode preserves current xtrm-ui bounded previews.
7. Expanded mode reveals the complete renderer surface.
8. Error calls remain visible in all modes.
9. External Serena/GitNexus/etc. tools obey all three modes.
10. Tool mode changes do not mutate model-facing results.
11. Episode switch does not destroy or re-prompt provider history.
12. Conversation tree maps to Pi native `id/parentId` history.
13. UI branch compression is non-destructive.
14. Existing xtrm-ui Pi extension remains supported.
15. `xt agent` can launch with XTRM extensions disabled except required native UI
    primitives; optional product extensions remain optional.
16. Terminal widths 80, 120, 160 and 220 columns are exercised.
17. tmux, Kitty, Alacritty and a plain Linux console path are smoke-tested.
18. No new Pi fork is required.
