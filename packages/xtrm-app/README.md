# xtrm-app

Linux-first desktop application workspace for XTRM's human ↔ agent interface.

**Status:** design/starter implementation, not a build-complete desktop app. The
canonical design is `docs/xtrm-gui-prd.md`; the current interaction unit is
**Frame** (`InteractionFrame`). This package is also the implementation root for
**XTRM Console v2** (PRD §34); start from [`docs/README.md`](docs/README.md).

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

The package contains design docs, a historical static prototype, and starter
runtime/provider abstractions. Read [`docs/README.md`](docs/README.md) before
implementation work.

Next delivery: an executable Console v2 React shell (global rail, contextual
sidebar, Inspector Drawer) with Substrate Issues, Program, and GitHub/repository
Activity as the first real surfaces. See
[`docs/console-v2-shell-architecture.md`](docs/console-v2-shell-architecture.md) §13.1.

Current direction is Linux-first, Tauri 2 + React/TypeScript unless packaging
evidence rejects it, with direct Pi `AgentSessionRuntime` as the first vertical
and a Claude adapter after the Pi path is proven.
