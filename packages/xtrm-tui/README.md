# xtrm-tui

First-party terminal workspace for XTRM's human ↔ agent interface.

**Status:** product workspace / implementation in progress. The canonical design
is `docs/xtrm-tui-prd.md`; older Episode terminology in prototypes is historical.
The current interaction unit is **Frame** (`InteractionFrame`).

## Product boundary

```text
Pi AgentSessionRuntime
  ↓
InteractionFrame / activity projection
  ↓
xtrm-tui
  ├─ thin Frame navigation
  ├─ selected-Frame conversation viewport
  ├─ compressed / normal / expanded tool views
  ├─ overview / branch overlays
  └─ XTRM status and agent-system integration
```

The TUI must not become a second provider runtime or transcript store. It uses
Pi's public runtime/session model and reuses XTRM UI semantics rather than
terminal scraping.

## Current assets

The package contains canonical design docs, prototypes and implementation
building blocks. Read [`docs/xtrm-tui-prd.md`](docs/xtrm-tui-prd.md) before
coding; [`docs/local-worker-dispatch.md`](docs/local-worker-dispatch.md) records
the local-worker execution direction.

The product direction preserves low-level `xt pi` while allowing a higher-level
XTRM agent/TUI entry to evolve over the same runtime.
