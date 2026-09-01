# xtrm-tui

First-party terminal UI workspace for XTRM's Episode-based human ↔ agent interface.

This package is the canonical home for the TUI concept and implementation assets. It is intended to run directly over Pi's public SDK and `@earendil-works/pi-tui`, while reusing the XTRM UI language already proven by Core's `xtrm-ui` Pi extension.

## Product boundary

```text
Pi AgentSessionRuntime
  ↓
Episode projection
  ↓
xtrm-tui
  ├─ thin Episode tab strip
  ├─ selected-Episode viewport
  ├─ compressed / normal / expanded tool views
  ├─ Episode overview overlay
  └─ conversation branch/fork overlay
```

The TUI must not become another provider runtime or transcript store.

## Current assets

```text
xtrm-tui/
├── docs/
│   ├── design.md
│   └── local-worker-dispatch.md
├── prototype/
│   └── index.html
└── src/
    ├── tool-view.ts
    └── agent-command-sketch.ts
```

Open `prototype/index.html` in a browser to exercise the terminal-layout mock and its keyboard simulation.

## Initial implementation direction

- Direct Pi `AgentSessionRuntime`; no terminal scraping.
- `@earendil-works/pi-tui` for rendering and overlays.
- Default tool view: `compressed`.
- Tool views: `compressed → normal → expanded`.
- `agent_settled`, not `agent_end`, closes an Episode.
- Preserve `xt pi` as the low-level provider/worktree launcher; this package may later back a higher-level `xt agent` entrypoint.

See `docs/design.md` before implementation.
