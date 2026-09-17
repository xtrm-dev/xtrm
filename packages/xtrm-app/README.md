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
src/issues/      Jira-style Issues: list, issue page, shared IssueView, field editors, normalization, create dialog
src/surfaces/    Activity, Program, Repositories, deferred placeholders
src/app/         TanStack Router routes, one TanStack Query layer
server/          dev-server bridge: read-only `sb … --json` allow-list
```

Data sources (select with `VITE_XTRM_GITHUB|SUBSTRATE|PROGRAM=live|fixture`):

| surface | default | source |
|---|---|---|
| GitHub / repository Activity, repository list | live | Console v1 backend (`XTRM_CONSOLE_URL`, default `http://127.0.0.1:3030`) via Vite proxy |
| Substrate Issues list, issue page, issue drawer, Jira-style editing | live | installed `sb` CLI envelope `substrate-cli/v1` through an allow-listed bridge; reads plus writes via `sb issue edit/state/note/create` (`XTRM_SUBSTRATE_WRITES=0` for read-only, `XTRM_SB_DB=<path>` for a dev database); never SQLite |
| Program | fixture | Console backend `/api/programme` is disabled by deployment policy (404); fixture uses the same `ProgrammeSnapshotResponse` mapper |

UI references and MCP servers (shadcn, Spectrum UI, LiveKit docs): `docs/ui-component-reference-registry.md`.

## GitHub App sign-in (operators)

Attributed GitHub actions need a per-user login, not the shared workspace
credential. Console v2 signs in through the **xtrm-console GitHub App**
(owner: the `xtrm-dev` org, installable on any account) using the OAuth device
flow against the App's `client_id`: the app shows a code, the operator enters
it at `github.com/login/device`, and the backend polls GitHub itself until the
flow completes. The browser never receives or stores tokens and xtrm-app never
calls `api.github.com` directly.

1. **Install the app.** Open Settings → GitHub in Console v2 (or go to
   `https://github.com/apps/xtrm-console/installations/new`) and install
   xtrm-console on the accounts whose repositories you work in. Per-installation
   repository access and fine-grained permissions (Pull requests, Issues,
   Contents, Checks, Actions, Metadata read) keep the grant least-privilege;
   user tokens expire (default 8 h) and the backend refreshes them.
2. **Configure the backend (XTRM-404).** The Console backend holds the App's
   `client_id`, authenticates the device flow, and keeps user tokens in the
host OS keychain (or a file store where no keychain exists). See the backend
   issue (XTRM-404) for the exact environment variables and secret handling —
   never paste App secrets or user tokens into xtrm-app source, `.env` files
   checked into git, or chat logs.
3. **Sign in.** Top bar → Sign in with GitHub, or Settings → GitHub →
   Sign in. Until the backend lands, the live adapter degrades to
   `not_configured`; reads fall back to the shared `GITHUB_TOKEN` /
   `gh auth token` credential (read-only) or fail closed with an inline
   notice that links Settings.

Auth states surfaced inline (top bar, Settings → GitHub, Pull requests and
repo views): `not_configured`, `signed_out` (read-only via shared token, or
sign-in required), `pending` (device code), `signed_in`, `expired`, `error`,
plus a per-repository Install callout when the app is missing there.
For local UI work without a backend, `VITE_XTRM_GITHUB=fixture` serves a
controllable fixture covering every state (`createFixtureGithubAuth`).

Known limits: list readiness is known only for dispatchable issues (XTRM-393);
the Substrate bridge exists only in the Vite dev/preview server; Program has no
typed reference to Substrate issues in snapshot v3 (the fixture's
`metadata.executable_refs` is a proposed field).

Screenshots: `docs/screenshots/console-v2-shell/`. Regenerate with
`PLAYWRIGHT_CORE=<playwright-core dir> node scripts/screenshots.mjs .receipts dark`.

Current direction is Linux-first, Tauri 2 + React/TypeScript unless packaging
evidence rejects it, with direct Pi `AgentSessionRuntime` as the first vertical
and a Claude adapter after the Pi path is proven.
