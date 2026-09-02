# Local worker dispatch — xtrm-tui Pi-native TUI

Implement the first XTRM-native human↔agent terminal UI in `xtrm-dev/xtrm/packages/xtrm-tui`. Do not move the product implementation into Core.

## Cold start

Read, in order:

1. `docs/adoption-audit.md`;
2. current Core:
   - `cli/src/commands/pi.ts`
   - `cli/src/core/pi-runtime.ts`
   - `docs/xtrm-ui.md`
   - `packages/pi-extensions/extensions/xtrm-ui/index.ts`
   - `packages/pi-extensions/extensions/xtrm-ui/format.ts`
   - `packages/pi-extensions/package.json`
3. current upstream Pi:
   - `packages/coding-agent/docs/sdk.md`
   - `packages/coding-agent/docs/tui.md`
   - `packages/coding-agent/src/core/agent-session.ts`
   - `packages/agent/src/types.ts`
   - interactive-mode implementations for `TreeSelector`, `SessionSelector`, `ModelSelector`, `ToolExecutionComponent`, assistant rendering and editor/input.

Do not code against remembered APIs. Verify the exact installed/source Pi version and current license before source adaptation.

## Adoption-first rule

Do not reimplement selectors, tree mechanics, terminal rendering, overlays, input handling, markdown, model selection, or tool-execution mechanics before inspecting current Pi.

Run the bounded spikes from `docs/adoption-audit.md` first:

```text
TUI-SPIKE-1  Pi component reuse map
TUI-SPIKE-2  Episode shell on stock pi-tui
TUI-SPIKE-3  TreeSelector adaptation
TUI-SPIKE-4  tri-state tools
TUI-SPIKE-5  keymap/input compatibility
```

Every candidate must receive:

```text
DEPEND / ADAPT / REFERENCE / REJECT
public import or internal-source status
exact upstream version/commit
license
adaptation cost
reason custom XTRM code is still needed
```

Prefer public Pi package APIs. If an internal Pi interactive component must be adapted, keep the copied/adapted unit bounded and record provenance.

Prime Agent, OpenCode and Codex are additional architecture/component references. Do not take a full downstream fork merely to obtain commodity TUI behavior.

## Product decision

Build `packages/xtrm-tui` as a first-party TUI over direct Pi SDK/AgentSession and `@earendil-works/pi-tui`. A later bounded Core integration may expose this package as `xt agent`.

Do not replace or repurpose `xt pi`.

Do not fork Pi interactive mode in this phase unless the adoption spikes prove that required behavior cannot be built through public Pi packages plus bounded component adaptation.

## Product identity

The final TUI must not look like stock Pi with one extra header.

XTRM owns:

- Episode projection;
- thin horizontal Episode tabs;
- selected-Episode-only viewport;
- Episode overview overlay;
- conversation/fork presentation;
- visual non-destructive branch compression;
- compressed → normal → expanded tool policy;
- XTRM density, naming and keymap decisions;
- later XTRM runtime/ChainRun projections.

The terminal shell should remain mostly monochrome with one restrained accent family. Avoid box-heavy dashboard presentation and rainbow provider/tool coloring.

## Required xtrm-ui refactor

Extract or consume reusable UI primitives from the current xtrm-ui extension so:

```text
upstream pi + xtrm-ui extension
        └─ thin adapter

xtrm-tui native shell
        └─ direct imports/adapted primitives

both
        └─ same XTRM renderer/theme/thinking/editor knowledge
```

No duplicated renderer implementation.

Where Pi already implements a generic mechanism, XTRM should extend presentation policy instead of cloning execution logic.

## Tool views

Implement exact tri-state:

```text
compressed
normal
expanded
```

Default `xt agent` mode: `compressed`.

`compressed` must render only:

- action/tool label;
- shortened subject;
- status/error;
- count or diff stat where available;
- duration;
- payload/truncation marker only when useful.

No output preview body.

`normal` must preserve current xtrm-ui preview semantics.

`expanded` must preserve full current expansion semantics.

`Ctrl+O` cycles modes after keymap collision testing.

Do not rewrite or truncate model-facing tool results.

## Episode behavior

A normal idle user submit allocates one Episode.

All Pi turns, tool calls, retry/compaction events until `agent_settled` belong to that Episode.

Do not close on `agent_end`.

Implement:

- thin fixed Episode tab row;
- previous/next Episode navigation;
- selected-Episode viewport;
- `Ctrl+E` overview overlay;
- `Ctrl+B` Pi conversation-tree overlay.

The selected Episode view should not include all previous Episodes in one vertical scroll.

## Branching

Consume Pi provider-native tree state. Do not invent another source transcript.

Expose:

- branch within current session;
- fork as independent session;
- UI-only compressed branches.

Use/adapt Pi's existing tree-selector traversal/folding mechanics when viable.

## UX

Aim for the supplied terminal screenshot density, but with less vertical tool noise.

Fixed chrome should be approximately:

```text
row 1  XTRM / repo / branch / model / context
row 2  thin Episode tabs
body   selected Episode
row N  compact composer
last   key hints/status
```

## Tests before polish

- tool batches and multiple Pi turns;
- retries;
- `agent_end(willRetry=true)`;
- `agent_settled`;
- failed tool;
- streaming tool;
- external Serena/GitNexus tool;
- width 80/120/160/220;
- episode switching;
- session replacement subscription rebinding;
- same-session branch;
- independent fork;
- branch UI compression;
- restart/reconstruction;
- provenance/adoption tests where adapted upstream components are materially changed;
- tmux, Kitty, Alacritty and plain Linux terminal input/keymap smoke.

## Stop conditions

Escalate only if:

- the required Pi SDK/TUI API is not public/stable enough for the target;
- the reuse matrix proves that necessary interactive components require broad private Pi internals rather than bounded adaptation;
- current Core build/package boundaries make the implementation materially impossible without a package-level decision;
- a dependency/license would materially constrain XTRM distribution.

Do not escalate merely because Pi's built-in interactive renderer cannot express the design. `xtrm-tui` is intentionally a custom XTRM shell over public Pi SDK/TUI primitives.

Repository ownership: `xtrm-dev/xtrm/packages/xtrm-tui` owns the TUI product. `xtrm-dev/core` remains an upstream dependency for the existing managed Pi/xtrm-ui implementation until shared primitives are deliberately extracted or consumed.
