# xtrm-app

Linux-first desktop application workspace for XTRM's human ↔ agent interface.

**Status:** design/starter implementation, not a build-complete desktop app. The
canonical design is `docs/xtrm-gui-prd.md`; the current interaction unit is
**Frame** (`InteractionFrame`).

## Product boundary

```text
human input
  ↓
provider session (Pi first, Claude adapter later)
  ↓
InteractionFrame / activity projection
  ↓
xtrm-app
  ├─ Frame navigation
  ├─ selected-Frame conversation view
  ├─ zoomed-out Frame cards
  └─ branch/fork tree
```

Provider transcript/session state remains authoritative. The app owns
presentation metadata and projections, not another agent runtime or durable work
store.

## Current assets

The package contains design docs, prototype UI and starter runtime/provider
abstractions. Read [`docs/xtrm-gui-prd.md`](docs/xtrm-gui-prd.md) before
implementation work.

Current direction is Linux-first, Tauri 2 + React/TypeScript unless packaging
evidence rejects it, with direct Pi `AgentSessionRuntime` as the first vertical
and a Claude adapter after the Pi path is proven.
