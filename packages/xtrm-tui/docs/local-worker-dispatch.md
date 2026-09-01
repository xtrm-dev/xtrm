# Local worker dispatch — xtrm-tui Pi-native TUI

Implement the first XTRM-native human↔agent terminal UI in `xtrm-dev/xtrm/packages/xtrm-tui`. Do not move the product implementation into Core.

## Cold start

Read current:
- `cli/src/commands/pi.ts`
- `cli/src/core/pi-runtime.ts`
- `docs/xtrm-ui.md`
- `packages/pi-extensions/extensions/xtrm-ui/index.ts`
- `packages/pi-extensions/extensions/xtrm-ui/format.ts`
- `packages/pi-extensions/package.json`

Read current upstream Pi:
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/docs/tui.md`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/agent/src/types.ts`

Do not code against remembered APIs. Verify the exact installed/source Pi version.

## Product decision

Build `packages/xtrm-tui` as a first-party TUI over direct Pi SDK/AgentSession. A later bounded Core integration may expose this package as `xt agent`.

Do not replace or repurpose `xt pi`.

Do not fork Pi interactive mode in this phase.

## Required refactor

Extract reusable UI primitives from the current xtrm-ui extension so:

```text
upstream pi + xtrm-ui extension
        └─ thin adapter

xt agent native TUI
        └─ direct imports

both
        └─ same xtrm-ui renderer/theme/thinking/editor primitives
```

No duplicated renderer implementation.

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

`Ctrl+O` cycles modes.

Do not rewrite or truncate model-facing tool results.

## Episode behavior

A normal idle user submit allocates one Episode.

All Pi turns, tool calls, retry/compaction events until `agent_settled` belong to
that Episode.

Do not close on `agent_end`.

Implement:
- thin fixed Episode tab row;
- previous/next Episode navigation;
- selected-Episode viewport;
- `Ctrl+E` overview overlay;
- `Ctrl+B` Pi conversation-tree overlay.

The selected Episode view should not include all previous Episodes in one vertical
scroll.

## Branching

Consume Pi provider-native tree state. Do not invent another source transcript.

Expose:
- branch within current session;
- fork as independent session;
- UI-only compressed branches.

## UX

Aim for the supplied terminal screenshot density, but with less vertical tool
noise. Use mostly monochrome UI and one restrained accent.

Avoid box-heavy dashboards.

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
- restart/reconstruction.

## Stop conditions

Escalate only if:
- the required Pi SDK/TUI API is not public/stable enough for the target;
- direct first-party TUI would require importing private Pi internals;
- current Core build/package boundaries make the implementation materially
  impossible without a package-level decision.

Do not escalate merely because Pi's built-in interactive renderer cannot express
the design. `xt agent` is intentionally a custom shell over public Pi SDK/TUI.

Repository ownership: `xtrm-dev/xtrm/packages/xtrm-tui` owns the TUI product. `xtrm-dev/core` remains an upstream dependency for the existing managed Pi/xtrm-ui implementation until shared primitives are deliberately extracted or consumed.
