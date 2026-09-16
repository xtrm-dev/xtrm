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

The package contains design docs, the executable Console v2 shell (`src/`), a
historical static prototype (`prototype/`), and starter runtime/provider
abstractions (`src/episode`, `src/runtime`, not yet wired). Read
[`docs/README.md`](docs/README.md) before implementation work.

## Console v2 executable shell

First vertical of [`docs/console-v2-shell-architecture.md`](docs/console-v2-shell-architecture.md) §13.1.

```bash
npm install
npm run dev        # http://127.0.0.1:5178
npm test           # reducer, adapters, bridge allow-list, shell/route/drawer DOM tests
npm run typecheck
npm run build
```

Layout:

```text
src/ui/          shared primitives (Surface, Row, IconButton, StatusDot, ContentPanel,
                 SidebarSection/Row, Drawer, InspectorSection, CommandMenu, ResizablePanel, …)
src/shell/       AppShell, layout reducer (drawer states, restore rules, URL codec),
                 context sidebar, inspector, global search/commands
src/adapters/    github | substrate | program — interface + live + typed fixture each
src/surfaces/    Issues, Activity, Program, Repositories, deferred placeholders
src/app/         TanStack Router routes, one TanStack Query layer
server/          dev-server bridge: read-only `sb … --json` allow-list
```

Data sources (select with `VITE_XTRM_GITHUB|SUBSTRATE|PROGRAM=live|fixture`):

| surface | default | source |
|---|---|---|
| GitHub / repository Activity, repository list | live | Console v1 backend (`XTRM_CONSOLE_URL`, default `http://127.0.0.1:3030`) via Vite proxy |
| Substrate Issues + issue drawer | live | installed `sb` CLI envelope `substrate-cli/v1`, read-only allow-list; never SQLite |
| Program | fixture | Console backend `/api/programme` is disabled by deployment policy (404); fixture uses the same `ProgrammeSnapshotResponse` mapper |

Known limits: list readiness is known only for dispatchable issues (XTRM-393);
the Substrate bridge exists only in the Vite dev/preview server; Program has no
typed reference to Substrate issues in snapshot v3 (the fixture's
`metadata.executable_refs` is a proposed field).

Screenshots: `docs/screenshots/console-v2-shell/`. Regenerate with
`PLAYWRIGHT_CORE=<playwright-core dir> node scripts/screenshots.mjs .receipts dark`.

Current direction is Linux-first, Tauri 2 + React/TypeScript unless packaging
evidence rejects it, with direct Pi `AgentSessionRuntime` as the first vertical
and a Claude adapter after the Pi path is proven.
