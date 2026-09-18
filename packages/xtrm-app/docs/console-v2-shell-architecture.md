# Console v2 — shell, double-sidebar and Inspector Drawer architecture

**Status:** **canonical** Console v2 shell contract (reconciled 2026-09-16). Product-level decisions live in `xtrm-gui-prd.md` §34; this document owns shell mechanics.
**Scope:** `packages/xtrm-app` base UI shell; migration from `Jaggerxtrm/console`
**Inputs:** `console-v2-audit-conar-ui.md`, `console-v2-audit-console-v1-preservation.md`, `console-v2-audit-substrate-issues-contract.md`, `console-v2-audit-deepseek-harness.md`, `console-v2-audit-console-program-graph-drawer.md`, `console-v2-audit-supernova.md`, `console-v2-audit-pichamber.md`, `adoption-audit.md` §10–15
**Deferred:** full Agent/Frames runtime (wave H)
**Pinned source revisions:** `Jaggerxtrm/console` @ `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d`; `xtrm-dev/xtrm` @ `9263f917c232db266f27468f558861f86a5e5cb0` (Substrate facts re-verified @ `fdf2951c2d45ef00b884ccf0437d2aee09d8c9d5`); `wannabespace/conar` @ `d50f1d12790a5e3e32b16baaae46c732bd36ff35`; `deepseek-ai/deepseek-harness` @ `c291e7961a515f6d7af9304e7fd1d257929aef26`; `mattiacerutti/supernova` @ `d0fa6869a950788045d5e10f6d500a75fe46e229`; `RyderAsKing/PiChamber` @ `87fe511db5ebcee2a44f9f4ea08aebe0b219fde6`.

Tag legend: `VERIFIED` (read in source at the pinned revision), `INFERENCE` (derived from cited facts), `ACCEPTED` (operator decision recorded 2026-09-16, `adoption-audit.md` §15), `PROPOSAL` (decision still requested), `UNKNOWN` (not determinable from audited source).

Precedence: where a `PROPOSAL` below was later accepted, the `ACCEPTED` note in the same section wins. Where this document and `xtrm-gui-prd.md` §34 disagree, the PRD wins and this document is the defect.

---

## 1. Placement and host tier — resolved

`ACCEPTED` — **P1**. Console v2 base UI is implemented in `xtrm-dev/xtrm/packages/xtrm-app`. The current `Jaggerxtrm/console` host remains a reusable backend (`/api/*`, realtime, GitHub runtime) during migration. The Supernova audit independently strengthens P1 (`console-v2-audit-supernova.md` §4). P2 is rejected. The evidence below is kept as the decision record.

Original analysis (`UNKNOWN` at the time):

Conflicting authorities at the pinned revisions:

- `packages/xtrm-app/docs/implementation-packet.md:338-340` — "Canonical implementation root: `xtrm-dev/xtrm/packages/xtrm-app`. Do not recreate this work under Core, Specialists, or a separate repository."
- `packages/xtrm-app/README.md:3` — xtrm-app is the "Linux-first desktop application workspace for XTRM's Episode-based human ↔ agent interface" (Tauri 2 + React + Node sidecar).
- `Jaggerxtrm/console/docs/architecture/console-architecture.md:5-7` — "`apps/console` is both the production host and UI package", and `docs/console/architecture/console-architecture.md` (xtrm) declares that document the owning authority: "Console is a read/control projection over upstream authorities."
- `docs/monorepo-migration.md:12,275` (xtrm) — an earlier exploration draft that folds `gitboard` (console) into the umbrella monorepo as `apps/console/`. Not landed: `apps/` in the audited xtrm revision contains only `.gitkeep`.

Two candidate readings:

- **PROPOSAL P1 (recommended)** — Console v2 base UI is implemented in `xtrm-dev/xtrm/packages/xtrm-app`; the current `Jaggerxtrm/console` host keeps serving `/api/*`, realtime, terminal, and the GitHub runtime, and is consumed as the backend during migration. The proven server-side integration moves later, under a separate decision, once `xtrm-app` owns the shell.
- **PROPOSAL P2** — Console v2 is implemented inside `Jaggerxtrm/console/apps/console` and `packages/xtrm-app` remains product documentation plus the desktop Episode concept. This contradicts the stated canonical implementation root but is the only reading consistent with `Jaggerxtrm/console/docs/architecture/console-architecture.md`.

Resolved as P1 on 2026-09-16. §9 (route/state) assumes a client-side SPA shell inside `packages/xtrm-app`.

---

## 2. Spatial model

Four spatial layers, one shell:

```text
GLOBAL ICON RAIL           48px, persistent, never collapses
CONTEXTUAL SIDEBAR         264px expanded  /  44px rounded reopen rail
PRIMARY WORK SURFACE       fill
INSPECTOR RAIL + DRAWER    44px rail  /  360px+ contextual or pinned drawer
+ BOTTOM DOCK              optional adjunct: terminal / logs  (see §7.6)
```

Product rule unchanged: `MAIN = work`, `DRAWER = inspect / control / traverse`, `COMPOSER = instruct / reference / coordinate`.

### 2.1 Layout mechanism

`ACCEPTED` — one XTRM-owned shell adapter module wraps `motion-panels` (`MIT`, pinned `0.4.0`; latest `0.5.1`) and is the only module in the codebase that imports it (`adoption-audit.md` §12.1).

- `ResizableGroup orientation="horizontal"` holds the contextual sidebar, the main region, and the inspector panel; the main region is the unsized fill panel.
- The global rail and the collapsed reopen rails are **not** `motion-panels` panels. `motion-panels` collapses a panel to extent `0` and has no `collapsedSize` (`console-v2-audit-conar-ui.md` §6). The XTRM rounded reopen rail therefore needs a reserved element.
- `ACCEPTED` **B1** — the collapsed contextual rail is a sibling fixed-width element outside the resizable group; expanding swaps it for the sized panel. This makes "reserved, rounded, reopen-only" explicit and directly testable.
- Fallback **B2** — the sidebar panel is never `collapsed`; at rail width it renders only the reopen affordance, and drag-out is handled by the library separator. Use B2 only if B1 cannot satisfy the restore rules in §4.3; record the reason.

`VERIFIED` from console v1: the current layout is a plain flex/absolute shell (`apps/console/src/dashboard/components/shell/MainPane.tsx`, `Sidebar.tsx`, `BottomDrawer.tsx`), not a resizable-panel group, and panel sizes are partially persisted in a monolithic zustand store under legacy `forge-*` keys (`apps/console/src/dashboard/stores/shell.ts:18-28`). That store is classified `REPLACE`.

---

## 3. Global icon rail

XTRM-owned. Conar supplies **no precedent** — `console-v2-audit-conar-ui.md` §2.1 proves the element is absent there, so nothing in this section may be justified as "Conar does it".

| Property | Specification |
|---|---|
| Width | 48px fixed; never collapses, never resizes |
| Placement | Leftmost shell column, outside the resizable group |
| Contents | Destinations (see §8.1) + a separator + utility actions |
| Icon size | 20px glyph in a 40×40 hit target; 8px vertical gap between items |
| Labels | None. Tooltip on hover (delay 100ms, matching Conar's tooltip provider default) and on keyboard focus |
| Selected state | `aria-current="page"`, filled accent left-edge marker + elevated surface; must be distinguishable in both themes without colour alone |
| Hover / focus | Hover = surface elevation only; focus-visible = shared `focus-ring` utility (`ring-3` at 50% accent) |
| Toggle buttons | `aria-pressed` (e.g. theme, dock) |
| Accessibility | Every icon-only control carries an explicit `aria-label`; the rail is a `nav` with an accessible name |
| Keyboard | Sequential tab order through modes; `Mod+<n>` selects `MODES[n-1]` in the rail (`AppShell.tsx`) — six modes today (Work, Agent, Agents, Program, Research, Observability), so `Mod+1…Mod+6`; `Mod+K` search palette, `Mod+Shift+K` command palette (§4.4) |
| Scope | Application-level only. The rail must never reflect repository-specific state; repository context lives in §4 |
| z-index | Rail is shell chrome. It must not rely on z-index to stay visible — see §7.2 for the geometric guarantee |

`INFERENCE`: because the rail is the only always-present navigation, its destination set is the product's top-level information architecture and changing it later is a breaking UX change. Lock the set in wave B before building surfaces.

---

## 4. Contextual sidebar

### 4.1 Expanded

- Width: default 264px, min 220px, max 360px (`PROPOSAL`; Conar's 280/220/50% is a DB-client budget, not an XTRM budget).
- Structure, top to bottom (`ACCEPTED`; these elements were lost in later visual mocks and are restored here):
  1. **Repository selector** — the persistent working-context control (PRD §5). It shows the selected repository and opens a searchable repository list ordered by activity. It is never replaced by generic navigation.
  2. **Search field** — full sidebar width, always visible when the sidebar is expanded. It is the inline entry point of the global search in §4.4.
  3. **Contextual hierarchy** — grouped lists with the `Work` / `Code` / `System` / `Governance` labels from §8.2.
  4. **Footer** — secondary actions (for example repository settings, refresh, source health).
- The sidebar is a rich navigation surface: rows may carry counts, status dots, and hover-only row actions (§15.3). It is not a plain link list.
- Hierarchy groups and their labels come from §8.2.
- Rows: one row primitive, `h-7`, `rounded-md`, hover `accent`, active `accent + medium`, `focus-visible` ring. `REJECT` the duplicate second row primitive found in Conar (`console-v2-audit-conar-ui.md` §3) — one row spec only.

### 4.2 Collapsed

- 44px reserved, rounded (12px) rail. Not zero width. Not a second icon menu.
- Contents: exactly one strong reopen affordance (chevron-right or panel glyph) anchored to the collapse edge, plus at most a vertical position marker for the selected group. No destination icons, no repository rows.
- Reopen paths: the affordance button, `Mod+B`, and dragging the hairline separator out (the library's `pixels < min/2` threshold handles drag-to-collapse and drag-to-reopen).

### 4.3 State and restore

`PROPOSAL` — a dedicated layout reducer owns:

```text
sidebar:  { open: boolean, width: number, lastExpandedWidth: number }
inspector:{ state: CLOSED|CONTEXTUAL|PINNED|MAXIMIZED, width: number,
            restoreWidth: number|null, collapsedSidebarForMaximize: boolean }
dock:     { open: boolean, height: number, activeTab: string }
```

Rules:

1. `lastExpandedWidth` survives collapse; restoring returns to it, never to the default.
2. `collapsedSidebarForMaximize` records whether the maximize action — not the user — collapsed the sidebar. Only then does un-maximize re-expand it.
3. Persistence is namespaced and schema-validated (`seitu` + `arktype`, `adoption-audit.md` §12). Console v1's `forge-*` keys are **not** reused; a one-shot migration reads the old key, maps what it can, writes the new key, and never writes `forge-*` again (`console-v2-audit-console-v1-preservation.md` hazard 6).

### 4.4 Global search, command palette, and options

`ACCEPTED` — the shell keeps a prominent global search and explicit command/options affordances. There is one search system with several entry points, not one search per surface.

| affordance | placement | behaviour |
|---|---|---|
| Inline search | full-width field at the top of the expanded contextual sidebar (§4.1) | searches all entity kinds (XTRM Issues, pull requests, GitHub Issues, releases, repositories, Program items, later Agents/Frames). The default scope is the selected repository; one control widens the scope to the workspace. Results open on the primary surface or in the drawer. |
| Search palette | `Mod+K`, and a Search entry in the global rail utilities | the same search index and result rows as the inline field, in a `cmdk` dialog. It works when the contextual sidebar is collapsed. |
| Command palette | `Mod+Shift+K` or `>` prefix inside the palette | commands and navigation (go to destination, toggle sidebar, pin drawer, switch theme). Commands respect authority exactly like drawer actions (§7.4). |
| Options menu | `⋯` icon button in the primary surface header and in the drawer header | surface- or entity-scoped actions (view options, sort/group, copy link, open on GitHub). It is a Base UI menu, not a toolbar. |

Rules:

1. Search and commands are one `cmdk` component tree with two modes. Do not build a second search component inside a feature surface.
2. Surface-local filter inputs (for example an Issues list filter) are allowed. They filter the visible collection only and are visually distinct from global search.
3. Search results come from the typed adapters (§9.3). The search layer does not read any source directly.
4. The affordances are accepted. The key bindings above are defaults and may change during implementation if they collide with platform or Pi bindings.

---

## 5. Primary work surface

- Fill panel. Owns the current mode/repository/entity work.
- URL-addressable in Console v2 (Console v1 could not address the GitHub surface at all: `console-v2-audit-console-v1-preservation.md` §2). See §9.
- Repository context preserves the Console v1 GitHub surfaces unchanged in behaviour: Activity, Pull requests, GitHub Issues, Releases, README, changelog, reports (`console-v2-audit-console-v1-preservation.md` §3b and §4 reuse list).
- `XTRM Issues` and `GitHub Issues` are different destinations with different labels; the identical `"Issues"` label collision in Console v1 is a defect to fix, not to preserve (`.../types/shell.ts:27` vs `:35`/`:41`).

---

## 6. Inspector rail

The right-edge mirror of the contextual sidebar's collapsed treatment.

- 44px reserved rounded rail with a single reopen affordance, symmetric with §4.2.
- Shown in `CLOSED` and `CONTEXTUAL` states; hidden when the drawer is `PINNED` (the drawer itself occupies the column).
- `PROPOSAL` — the inspector rail is the only right-edge affordance. Console v1 has **five drawer-shaped shells** plus one in-flow dock; none of them may survive as a separate shell:

| v1 shell | evidence | disposition |
|---|---|---|
| `BeadSideDrawer` (portal side drawer) | `apps/console/src/dashboard/pages/console/BeadSideDrawer.tsx:28` | `ADAPT` → the canonical drawer |
| `ProgrammeEntityDrawer` (portal drawer, own z-band 900/901) | `apps/console/src/dashboard/pages/console/programme/ProgrammeEntityDrawer.tsx:25` | `REPLACE` shell, `ADAPT` content |
| `OperationsDrawer` (no resize, no Escape, `z-index: 55`) | `apps/console/src/dashboard/pages/console/Operations.tsx:200` | `REPLACE` |
| `RightSidebar` (dead: `openSidebar()` has zero production callers, yet mounted) | `apps/console/src/dashboard/components/shell/RightSidebar.tsx:9`; `apps/console/src/dashboard/App.tsx:57` | `DELETE_AFTER_CUTOVER` |
| `IssueOverlay` (modal, `z-index: 1000`) | `apps/console/src/dashboard/components/beads/IssueOverlay.tsx:19` | `REPLACE`; extract its focus trap first |
| `BottomDrawer` (in-flow dock) | `apps/console/src/dashboard/components/shell/BottomDrawer.tsx:13` | `ADAPT` as the docked mode of the shared primitive (§7.6) |

`VERIFIED` additional defects this contract must fix: `Escape` is registered independently by four shells with no top-of-stack arbitration; two shells share `z-index: 50` and resolve by DOM order; only the modal overlay implements a focus trap / `aria-modal`; and the bead drawer silently no-ops when opened from Graph, Specialists, Operations, or the dock because its `projectId` is only supplied by the feed view (`console-v2-audit-console-program-graph-drawer.md` §B.4, §8.1).

---

## 7. Global Inspector Drawer contract

### 7.1 States

```text
CLOSED        only the inspector rail is visible
CONTEXTUAL    overlay over the main region; primary surface preserved and still usable
PINNED        real layout column; the main region reflows; survives navigation
MAXIMIZED     fills the main region; never covers the global rail
FOLLOW_LIVE   orthogonal flag on any open state (not a fifth state)
```

State transitions are explicit and owned by the reducer in §4.3:

| From | Action | To |
|---|---|---|
| CLOSED | inspect an entity | CONTEXTUAL |
| CONTEXTUAL | pin | PINNED |
| CONTEXTUAL / PINNED | maximize | MAXIMIZED (records `collapsedSidebarForMaximize`) |
| MAXIMIZED | un-maximize | previous state, sidebar restored iff it was collapsed by maximize |
| any | Escape / scrim / close | CLOSED (stack cleared) |

### 7.2 Rail protection — geometric, not z-index

`PROPOSAL` — the drawer renders **inside the main region** (`position: absolute; inset: 0` of a `position: relative` main region), not portalled to `document.body`. The shell is a flex row `[rail][sidebar][main]`; therefore a drawer inside `main` is structurally incapable of covering the rail, regardless of any z-index value.

This is chosen over a z-index contract because:

- `VERIFIED`: Conar's drawer portals to a `fixed inset-0 z-50` viewport with a 75%-wide popup and therefore covers everything, including any rail (`console-v2-audit-conar-ui.md` §6).
- `INFERENCE`: a z-index-only guarantee is one overlay library upgrade away from regression; the geometric guarantee is testable as a DOM containment assertion.

`UNKNOWN` — whether the pinned `@base-ui/react` Drawer supports a portal `container` override. Verify in wave D; if it does not, use a non-portalled `absolute` panel or a shell-owned panel instead of Base UI's Drawer for the MAXIMIZED state.

### 7.3 Navigation stack

- The drawer owns a typed stack of entity references (`DrawerRef = { kind, ref }` for issue, pull request, release, graph node, agent, program item, log record).
- Back/forward, breadcrumb, and a **promote** action that opens the entity on the primary surface.
- Closing the drawer clears the stack; pinning may preserve it.
- `PROPOSAL` — `DrawerRef` must be the same typed-reference vocabulary the composer will later consume (`@issue:<ref>`, `@agent:<id>`, …). Building the vocabulary now is what makes the later composer bridge cheap; it does not require building the composer.

### 7.4 Authority-scoped actions

The action list is computed from the entity's authority, never a generic toolbar:

- Substrate issue — actions only where the current holder/lease/readiness permits; `claim`, `release`, `state`, `dispatch` appear according to `ReadinessReport` and the active claim (`console-v2-audit-substrate-issues-contract.md` §4.1).
- GitHub entity — mutations only through the existing same-origin/admin write gate (`console-v2-audit-console-v1-preservation.md` §4 write-gate row).
- Program item — governance actions only; never executable-work mutation (§10).
- Agent — `Open session` promotion is deferred (wave H); the drawer may show agent identity and lineage read-only.

### 7.5 FOLLOW_LIVE

`PROPOSAL` — adopt the two-stream shape observed in DeepSeek Harness (`console-v2-audit-deepseek-harness.md` §8): a durable history stream that opens with a complete snapshot and then appends ordered increments, and a separate live-control stream that also opens with a complete baseline and replaces rather than patches. On reconnect, replace from a fresh baseline. When `FOLLOW_LIVE` is off, freeze at the last cursor and show a resume affordance instead of silently jumping.

### 7.6 Relationship to the bottom dock

`PROPOSAL` — one `Drawer` primitive with two modes, not two shells:

- **DRAWER (overlay / pinned)** — the right-side inspector. States in §7.1.
- **DOCK (`docked` mode, in-flow)** — terminal, logs, and specialist activity, occupying real layout height.

Both mount the same primitive (portal/geometry, resize, `Escape` arbitration, focus handling) and the same store shape; they differ only in placement and dismissal semantics. This resolves the `UNKNOWN` in the companion audit §11 Q5. `VERIFIED` evidence for the dock mechanics: Console v1's `BottomDrawer` is the only Console v1 panel that participates in layout flow (`apps/console/src/dashboard/styles/globals.css:4687`), and its maximize/restore-height pattern is correct but stores the restored height in component-local state, so maximize is lost on unmount (`apps/console/src/dashboard/components/shell/BottomDrawer.tsx:20-27,78-93`) — move that into the persisted layout reducer (§4.3).

---

## 8. Final double-sidebar recommendation

### 8.1 Global rail destinations

```text
Agent              first-class even while deferred
Work               cross-repository work queue
Repositories       repository discovery / selection
Agents             fleet presence (read-only until wave H)
Program            portfolio governance
Observability      fleet-level analysis
--- utilities ---
Search             search palette (Mod+K), §4.4
Command            command palette (Mod+Shift+K), §4.4
Theme              light/dark
Settings/Profile
```

`Repositories` opens the repository directory on the primary surface. Day-to-day repository switching uses the repository selector in the contextual sidebar (§4.1).

### 8.2 Repository-context hierarchy (contextual sidebar)

```text
Work
  XTRM Issues                    Substrate-backed
  Agent                          deferred (wave H)
  Agents                         deferred (wave H)
Code
  Activity
  Pull requests
  GitHub Issues                  explicitly distinct from XTRM Issues
  Releases
  Repository content             README / CHANGELOG / reports
System
  Graph
  Observability
Governance
  Program
```

`PROPOSAL` addition over the dispatch: explicit `System` and `Governance` group labels. Without them, `Program` and `Observability` read as peers of `XTRM Issues` in the same list and the Program/executable-work boundary (§10) becomes a visual ambiguity rather than an architectural one.

### 8.3 Recommendation

1. Adopt the operator's four-layer model with the Conar correction: the previous "double sidebar" reference is left navigator + right chat in a DB client, not rail + sidebar. The XTRM global rail is new work, not an adaptation.
2. Keep the contextual sidebar's collapsed state as a **reserved rounded reopen rail** (44px), never zero width, with the affordance at the collapse edge (`PROPOSAL B1`).
3. Mirror that treatment on the right as the inspector rail.
4. Use `motion-panels` for the expanded sidebar, the inspector panel, the main fill, and the dock — behind one XTRM shell adapter.
5. Protect the rail geometrically (§7.2).
6. One drawer, one dock, one row primitive, one icon family.

---

## 9. Route and state architecture

### 9.1 URL contract

Console v1 has no client router and cannot address repositories (`console-v2-audit-console-v1-preservation.md` §2). `PROPOSAL` — a stable URL contract, whose implementation may be a router dependency or hand-rolled parsing:

`ACCEPTED` URL contract. `packages/xtrm-app` owns the whole SPA, so the Console v1 `/console` prefix is dropped. If the app is mounted under a base path, the router `basepath` adds it; route definitions do not.

```text
/agent                                   global destination (deferred placeholder until wave H)
/work                                    cross-repository work queue
/repositories                            repository directory
/agents                                  fleet presence (deferred placeholder until wave H)
/program                                 Program — cross-repository governance (global)
/observability                           fleet-level analysis (placeholder in the first vertical)

/rep/:owner/:repo/work/issues            XTRM Issues (Substrate)
/rep/:owner/:repo/code/activity          repository activity (GitHub)
/rep/:owner/:repo/code/pulls
/rep/:owner/:repo/code/issues            GitHub Issues
/rep/:owner/:repo/code/releases
/rep/:owner/:repo/code/content
/rep/:owner/:repo/system/graph           placeholder in the first vertical
/rep/:owner/:repo/system/observability   placeholder in the first vertical
/rep/:owner/:repo/governance/program     Program filtered to this repository
/rep/:owner/:repo/agent/:sessionId       reserved for wave H
```

Shorthand used in planning notes (`/work/issues`, `/program`, `/code/activity`) refers to these routes with the selected repository applied.

Drawer state is not a route. It is encoded as search parameters (`?inspect=<kind>:<ref>&drawer=contextual|pinned|maximized`) so a shared link restores the inspected entity.

`ACCEPTED` — `@tanstack/react-router` (MIT) is the router. Route search parameters are validated with typed schemas.

### 9.2 State ownership

Console v1's defects to avoid: a single monolithic shell store mixing GitHub state, terminal output, and the bead inspector target (`apps/console/src/dashboard/stores/shell.ts:67-98`), and three overlapping GitHub caches with different eviction rules (module singleton, zustand store, server maps).

`PROPOSAL` state split:

| domain | owner | rule |
|---|---|---|
| Shell layout (rail/sidebar/inspector/dock) | layout reducer (§4.3) | persisted; the only writer of layout state |
| Drawer navigation stack | drawer store | typed `DrawerRef[]`; cleared on close |
| Repository list + activity order | one query layer | single cache; server contract unchanged |
| Entity data (issues, PRs, releases, files) | one query layer per domain | no module-singleton caches |
| Realtime | existing WS client contract | unchanged channel/event names |

Freeze, do not redesign, the server DTO/route contract in this tranche (`console-v2-audit-console-v1-preservation.md` §4 server list and hazard 8).

### 9.3 Typed data adapters

`ACCEPTED` — UI components never know where data comes from. All data reaches the UI through three typed adapters:

```text
UI components / routes / search
        │  (typed view models only)
        ▼
adapters/github      adapters/substrate      adapters/program
        │                    │                       │
Console v1 backend   Substrate typed service   Program read model
(/api/*, realtime)   + projections              (commit-pinned source)
```

| adapter | source | rules |
|---|---|---|
| `adapters/github` | Console v1 backend routes and realtime channel | Preserve the proven fetch, cache, and backend behaviour (`console-v2-audit-console-v1-preservation.md` §3b, §4). One query layer; no module-singleton caches. Mutations only through the existing same-origin/admin write gate. |
| `adapters/substrate` | `@jaggerxtrm/substrate` typed service (`IssueService`, readiness, claims, journal, provenance) and projections | Call the typed service only. Writing SQL against `~/.xtrm/state.db`, or reading its tables directly, is forbidden (`console-v2-audit-substrate-issues-contract.md` §4.2). No dual-write. New code uses neutral `Issue` / `IssueContract` terms, not `Bead`. |
| `adapters/program` | Program read model (commit-pinned, `fresh | stale | degraded` snapshot) | Governance projection only (§10). It may emit typed references to Substrate Issues. It never returns issue lifecycle, claim, or readiness state. |

Each adapter exposes an interface plus at least two implementations: the live implementation and a typed development fixture. The fixture satisfies the same interface and is selected by configuration, never by a component.

**Substrate integration blocker (re-`VERIFIED` @ `fdf2951`).** `packages/substrate/package.json` now declares `main: ./src/index.ts` but still has no `exports` or `types`; `src/domain/readiness.ts` is still not root-exported; `IssueService.listIssues(projectId)` still resolves one full `view()` per issue with no filter, pagination, or cursor; readiness is still per-issue (`getReadiness`), so a list with readiness is N+1; there is still no change feed. Consequence for the executable prototype:

1. Build the Issues surface against `adapters/substrate` with the typed fixture when a bounded project listing with readiness is not available through the typed service.
2. The live implementation may call `listIssues` + `getReadiness` for a bounded project (small N) and must record the query cost.
3. Report the exact missing API (batched listing with readiness, pagination/cursor, root-exported readiness types, change feed) as a Substrate issue. Do not work around it by reading SQLite.

---

## 10. Program / governance boundary

Program owns cross-repository intent and governance: workstreams, assignments, portfolio authority, decisions, evidence, reconciliation. Executable work stays in Substrate Issues.

`PROPOSAL` shell consequence: `Program` is a global-rail destination and a `Governance` group item, never a leaf under `Work`. A Program item in the Inspector Drawer may reference an issue by typed reference; it must not display issue lifecycle, claim, or readiness state as if Program owned it. If a Program surface needs to show that a referenced issue is blocked, it renders a link and the authority is the Substrate projection, not a Program copy.

`VERIFIED` — the current Console Program already satisfies this boundary and must be preserved: it is a commit-pinned, read-only projection of an external GitHub repository (`mercuryintelligence/program@master`), and every snapshot carries an explicit refusal to infer executable-work state (`apps/console/src/server/programme/read-model.ts:1003`, `.../source.ts:11-13`). Disposition: `PRESERVE_AS_IS` for the model and boundary; `REPLACE` for its drawer shell and `ADAPT` for its 1 043-line regex parser. Reusable governance primitives from it are the commit-pinned source contract (`ProgrammeSource`), the `fresh|stale|degraded` snapshot cache, the build-integrity gate (`assertNoDanglingEdges`), and the evidence-class / precedence doctrine (`read-model.ts:949-967,1019-1025`). See `console-v2-audit-console-program-graph-drawer.md` §4, §9.

---

## 11. Graph and Observability shell placement

- **Graph** is a `System` group item inside repository context, and may also appear in the Inspector Drawer as a node's neighbourhood view. It consumes the existing graph read model; the renderer is Console v1's `@xyflow/react` (`MIT`) plus `@dagrejs/dagre` layout (`VERIFIED` in `apps/console/package.json`). No graph rewrite in the base tranche.
- **Observability** is both a global-rail destination and a `System` group item. Durable evidence and live status remain distinct; the GUI must not become a second telemetry authority (`xtrm-gui-prd.md` §Observability).

`VERIFIED` — the current Console equivalents are a Beads-issue graph, not an xtrm-neutral execution graph: the Graph reads `substrate_issues` + `substrate_issue_edges` + a specialist join (`apps/console/src/dashboard/pages/console/Graph.tsx:38-45`; `apps/console/src/server/routes/graph.ts:56`), renders one `@xyflow/react` instance per connected component, and re-lays-out/remounts on every edge toggle. It also opens the inspector without project context, so graph-initiated inspection renders no detail. Dispositions: read model `EXTRACT_REUSE`, renderer `ADAPT` (one canvas, explicit project scope, no "first active source" fallback), drawer wiring `ADAPT` (resolve context from the entity).

Observability in Console v1 is a rollup read model over materialized specialist tables plus a Beads Dolt repair table. It holds **no durable evidence** — raw evidence stays in `xtrm_forensic_events` / `xtrm_evidence_refs` and is reachable only through the specialists feed routes. Required changes: add the missing auth gate on `/api/console/observability`, move the Dolt repair table (which currently renders operator shell command strings) to a source-health surface, and add evidence drilldown. Durable evidence and live status remain distinct; the GUI must not become a second telemetry authority (`xtrm-gui-prd.md` §Observability). See `console-v2-audit-console-program-graph-drawer.md` §5, §10.

---

## 12. Agent scope boundary (deferred — wave H)

The base shell must be compatible with, but must not implement:

`Agent`, `AgentSession`, `Frame`, `AgentRelation` (`fork | dispatch | chain | peer`), `ChainRun`, `TelemetryEvent`, `Evidence`.

What the base tranche must do to preserve compatibility:

1. Reserve `/rep/:owner/:repo/agent/:sessionId` and the `Agent`/`Agents` destinations (they may render an explicit "deferred" state, not a broken route).
2. Emit `DrawerRef` typed references (so the composer bridge is cheap later).
3. Keep the rail's keyboard model extensible to more destinations.
4. Do not add a permanent split pane for parent/child comparison (`xtrm-gui-prd.md` §Agents presence).
5. Do not create a second transcript/session store. Provider session authority remains with Pi.

Adopt-as-specification list for wave H is in `adoption-audit.md` §11.2.

---

## 13. Implementation waves

Ordered by dependency. Each wave names a gate that must pass before the next begins.

| wave | scope | gate |
|---|---|---|
| **A. Visual primitives + shell skeleton** | token layer, typography/radius/space scale, one row primitive, button/menu/tooltip/tabs primitives on `@base-ui/react`, shell adapter over `motion-panels`, empty four-layer shell | a static shell renders both themes, resizes, and passes keyboard/AX checks; `motion-panels` is imported in exactly one module |
| **B. Global rail + contextual sidebar** | rail destinations, contextual hierarchy, expanded/collapsed rail mechanics, layout reducer + persistence + `forge-*` migration, hotkeys | collapse/expand/restore round-trips exactly; rail never collapses; sidebar reserved at 44px when collapsed; `Mod+B` works |
| **C. Repository tracking + GitHub surfaces** | repo discovery/selection/activity ordering, Activity, PRs, GitHub Issues, Releases, repository content, one query layer, WS subscription | every Console v1 GitHub capability in `console-v2-audit-console-v1-preservation.md` §3b behaves identically; the v1 defect register is explicitly resolved or carried |
| **D. Inspector Drawer + inspector rail** | states, typed stack, authority-scoped actions, geometric rail protection, FOLLOW_LIVE, dock adaptation | drawer cannot overlap the rail (DOM containment test); maximize auto-collapse/restore is exact; no second inspector shell exists |
| **E. Substrate Issues** | typed-service adapter, `IssueContract` projection, Beads read-only compatibility, no dual-write | `console-v2-audit-substrate-issues-contract.md` §4.1 seam is used; no direct SQL from UI/backend; parity test against the v1 issue feed |
| **F. Program/governance projection** | Program surface as a read model that references, never duplicates | a Program item shows no executable-work state that it does not read from the issue authority |
| **G. Graph/Observability shell integration** | graph node → drawer, observability placement, source-health surfacing | existing read models reused; no new telemetry authority |
| **H. Agent/Frames tranche (separate)** | everything in §12, under its own contract | NOT started because the shell exposes an Agent route |

### 13.1 First executable vertical (Phase 2)

`ACCEPTED` — the first product-code delivery is one executable React vertical inside `packages/xtrm-app`, not another static mock. It cuts across waves A–F at reduced depth:

| wave | depth in the first vertical |
|---|---|
| A | full: tokens, shared primitives (§15.2), shell adapter |
| B | full: global rail, contextual sidebar with repository selector and search, collapsed reopen rail, layout reducer + persistence |
| C | Activity surface (`/rep/:owner/:repo/code/activity`) through `adapters/github`; other Code routes may be placeholders |
| D | full state machine: `CLOSED` / `CONTEXTUAL` / `PINNED` / `MAXIMIZED` + `FOLLOW_LIVE` flag, typed stack, geometric rail protection; dock mode may be deferred |
| E | Issues surface through `adapters/substrate` (live for a bounded project or typed fixture, §9.3) |
| F | Program surface through `adapters/program` |
| G, H | explicit placeholder routes only |

Acceptance for the vertical: routes above resolve; shell/route/drawer behaviour has automated tests (collapse/restore, maximize auto-collapse/restore, drawer containment, deep-link restore of `?inspect=`); screenshots or a runnable receipt exist; the delivery lists which surfaces are live and which are fixture-backed.

Wave C may start in parallel with B only if the query layer is settled first; wave E may start in parallel with C/D because it is a distinct adapter. Do not reorder E before D solely to make the drawer useful — the drawer contract must be fixed before entity panels are written into it.

---

## 14. Risks and unknowns

| id | item | tag | mitigation |
|---|---|---|---|
| R1 | ~~Placement P1 vs P2 unresolved~~ — resolved: P1 `ACCEPTED` 2026-09-16 | `ACCEPTED` | §1 |
| R2 | `packages/substrate/package.json` has `main` (added since the audit) but no `exports`/`types`; readiness types are not root-exported | `VERIFIED` @ `fdf2951` | export `domain/readiness.ts` and add `exports`/`types`; until then `adapters/substrate` deep-imports inside the monorepo and the Issues UI may run on the typed fixture (§9.3) |
| R3 | Console `resolveStateDaemonPaths` resolves `~/.xtrm/state.db`, identical to Substrate's canonical path | `VERIFIED` | resolve ownership explicitly before activating any Console state daemon; two schemas in one file is data loss |
| R4 | Substrate has no bulk query, pagination, or change feed; `ready()` is N+1 | `VERIFIED` @ `fdf2951` | wave E reads a bounded project or the typed fixture; file a Substrate issue for a batched listing with readiness, cursor, and change feed before any large-fleet UI (§9.3) |
| R5 | `motion-panels` is `0.x`, single maintainer, no `collapsedSize` | `VERIFIED` | exact pin, single import site, recorded fallback (`adoption-audit.md` §12.1–12.2) |
| R6 | Console v1 ships two shells and duplicate GitHub UIs; deleting too early breaks pinned tests | `VERIFIED` | follow the ordered cutover in `console-v2-audit-console-v1-preservation.md` §9 |
| R7 | `openPRs`/`openIssues` chips are 24 h event counts, not open totals | `VERIFIED` | rename or implement real counts in wave C; do not display as "open" |
| R8 | Console v1's `docs/xtrm-console-visual-contract.md` locks "no rounded corners" and "one shell, one sidebar", contradicting this shell | `VERIFIED` | supersede that document's shell rules explicitly in the PRD amendment; do not let two visual contracts drift |
| R9 | AGPL contamination from Conar | `VERIFIED` | reference-only rule; all adopted packages are registry dependencies (`adoption-audit.md` §10.3) |
| R10 | ~~Program duplicating executable work~~ — resolved: Program explicitly refuses to infer executable-work state and shares no key with it | `VERIFIED` | preserve the boundary; do not add a join without a governed contract |
| R13 | Five drawer-shaped v1 shells with uncoordinated `Escape`, duplicated resize, and two shells at the same `z-index` | `VERIFIED` | build the one canonical primitive in wave D before any entity panel; do not port any v1 shell |
| R14 | The v1 bead inspector silently no-ops when opened from Graph/Specialists/Operations/dock because its context is feed-injected | `VERIFIED` | the canonical drawer resolves project context from the entity itself; add a regression test per entry point |
| R15 | `/api/console/observability` has no auth gate and the Dolt repair table renders operator shell commands | `VERIFIED` | gate the route and move repair output in wave G |
| R11 | Two primitive libraries (Radix + Base UI) during transition | `VERIFIED` | adopt Base UI for all new surfaces; migrate the three Radix usages at their surface cutover (`adoption-audit.md` §12.4) |
| R12 | ~~`Frame` semantics undefined~~ — core invariant resolved: a Frame belongs to exactly one AgentSession; cross-agent aggregation is not Frame identity | `ACCEPTED` | remaining contract details (optional response, provisional IDs, child refs, compaction-only units) are wave H inputs: `console-v2-audit-supernova.md` §3.3–3.6 |

---

## 15. Visual standard and shared primitive layer

`ACCEPTED` — Supernova is the primary visual benchmark (`console-v2-audit-supernova.md` §1, `adoption-audit.md` §13). The audit is implementation evidence, not permission to copy product identity: XTRM keeps its own palette, violet accent, typography, and radius family (`xtrm-gui-prd.md` §27).

### 15.1 Standard

```text
quiet · flat · restrained · professional · dense but readable
hairline borders · few surface levels · minimal shadows
hover/focus-revealed secondary actions · rare XTRM violet accent
no card soup · no dashboard aesthetic · no cyberpunk/terminal styling
```

Concrete rules derived from verified Supernova patterns:

| concern | rule | evidence |
|---|---|---|
| Surface ladder | at most five neutral surface roles: `deep` (app background), `sidebar`, `surface` (primary), `raised` (popover/menu/drawer), `control`. Depth comes from background shifts, not shadows. | Supernova `styles.css:37-70` |
| Borders | 1px hairline `border-muted` for structure; `border` for controls; `border-strong` only for focus-adjacent emphasis. | Supernova §1.1 |
| Shadows | only on floating layers (popover, menu, dialog, maximized drawer edge). Never on rows or panels in flow. | Supernova §1.1 |
| Cards | primary content is never a card grid. Collections are rows; code/diff/output uses `ContentPanel`. | Supernova §1.2 `ContentPanel` |
| Accent | XTRM violet only for selection marker, focus ring, typed references, and unread/attention dots. No filled accent buttons by default. | Supernova chrome discipline; PRD §27 |
| Status | ink and shape (dot, spinner, ring, muted text) before colour. Colour only for danger and diff. No rainbow badges. | Supernova §1.2 |
| Density | `text-sm` body with compact rows (28px sidebar rows, 32–36px collection rows as defaults tuned in wave A); readable line height for prose (`leading-7` equivalent). | Supernova §1.1 |
| Hierarchy | spacing and ink levels (`ink`, `ink-muted`, `ink-faint`) before boxes and dividers. | Supernova §1.1 |
| Actions | secondary row/message actions appear on hover and on keyboard focus (`:focus-within`), never only on hover. Primary action of a surface stays visible. | Supernova `MessageActions`, sidebar row menus |
| Activity | grouped and collapsed by default; cheap one-line title always rendered; expensive detail mounted lazily on first expand. | Supernova "Worked for Xs" group |
| Long lists | virtualized with `@tanstack/react-virtual`. | `adoption-audit.md` §15.1 |
| Reading column | prose and timeline content constrained to a readable column (`max-w-3xl` equivalent). | Supernova timeline frame |

### 15.2 Shared primitives — build before feature surfaces

Feature surfaces compose these primitives. A feature-local variant of a primitive is a defect unless the primitive gains the variant first.

| primitive | responsibility |
|---|---|
| `Surface` | surface role + hairline boundary; the only way to set a background role |
| `Row` | the single collection row (sidebar and main lists share anatomy, differ by density token); hover/focus action slot |
| `IconButton` | icon-only button with required `aria-label` and tooltip |
| `Search` | inline search field bound to the global search system (§4.4) |
| `CommandMenu` | `cmdk` dialog for search and command modes (§4.4) |
| `SidebarSection` | collapsible labelled group (`Work` / `Code` / `System` / `Governance`) |
| `SidebarRow` | `Row` preset for the contextual sidebar: icon, label, count, status dot, hover actions |
| `StatusDot` | ink/shape status indicator with accessible text |
| `ContentPanel` | bounded scroll container for code, diff, output, and long fields |
| `InspectorSection` | titled section inside the drawer |
| `Drawer` | the canonical drawer primitive (§7), including docked mode later |
| `ResizablePanel` | the shell adapter surface over `motion-panels` (§2.1); the only `motion-panels` import site |
| `EmptyState` | explicit empty and deferred-placeholder state |
| `LoadingState` | skeleton rows and inline spinner; no full-screen spinners |

---

## 16. Revision after the first executable review (2026-09-16)

Operator review of the first vertical against the v13/v15 mocks (`docs/mocks/` in PR #208) produced these accepted changes. Where §16 and earlier sections disagree, §16 wins.

### 16.1 Navigation model

- **Top bar** — full-width application header. The global search entry (§4.4) lives here, centred, not in the contextual sidebar. Command and theme affordances sit at its right edge.
- **Rail = modes.** The rail selects a workspace mode: Work, Agent, Agents, Program, Observability. `Repositories` is no longer a rail destination; the repository selector lists all repositories and links to the directory.
- **Sidebar = the active mode's context only.** Work mode shows the repository selector and `Work` / `Code` / `System` groups. Program mode shows Program sections. Deferred modes show a one-line deferral. No destination appears in both the rail and the sidebar.

### 16.2 Inspector rail, drawer, and sidebar geometry (v15 + Supernova)

- **The rail is the drawer's left edge.** The inspector rail is a floating rounded column with a centred arrow handle. Opening the inspector animates the same element wider (250 ms width transition): the rail stays as the left edge column and the drawer content appears to its right. Clicking the edge folds it back into the rail. `CONTEXTUAL` and `MAXIMIZED` grow leftwards over the content card; `PINNED` grows inside the layout so the card reflows. A drag strip on the drawer's left side resizes it.
- **Geometric bound.** The dock width is clamped to the measured content-card width (`dockWidth`, unit-tested): `CONTEXTUAL` leaves a 24 px margin, `MAXIMIZED` covers exactly the card. The dock can never reach the mode rail or the sidebar. This replaces the DOM-nesting guarantee in §7.2 for Console v2.
- **Plain sidebar.** Following Supernova (`packages/web/src/features/sidebar/components/sidebar-layout.tsx` @ `d0fa686`), the contextual sidebar has no enclosing box: it sits directly on the application background, and only the content card is rounded. Collapse is the `motion-panels` collapse animation with content kept mounted and `inert`.
- **Collapsed sidebar edge.** When collapsed, a very light edge sits immediately right of the mode rail: a thin pill that grows into an arrow handle on hover or focus. It replaces the 44 px reserved reopen rail (B1). The same edge sits on the open sidebar's right edge and collapses it; the sidebar footer has no separate collapse button.
- **Inspector rail width.** The inspector rail is 22 px in both collapsed and expanded states. The expanded drawer has no divider between the rail and its content, and no rule under the drawer header.
- The drawer header carries: back/forward, `Inspector`, `Open` (promote an issue to its full page), follow live, pin, maximize, options, close.

### 16.3 Substrate Issues are a Jira-style work surface

- **List** — table with Key, Summary (parent and readiness chips), Status, Priority, Children progress, Updated; views Open / Ready / Blocked / Deferred / Done / All; sortable columns; `New issue`.
- **Issue keys** — the hierarchical `locator` (for example `XTRM-252.13.1`) is the primary key everywhere: list, board, breadcrumb, lineage, details chips, search. It shows epic and parent lineage. The flat `humanRef` (`XTRM-344`) follows dimmed after ` / ` only when it differs, and remains the identity for URLs, `sb` writes, and `@issue:` references. The Key sort orders by locator, so epics group with their children.
- **Reference chips** — `src/refs/references.tsx` is the single component for a referenced entity: `ContextReference` (`{ kind: "issue", ref }`, PRD §10), serialized as `@issue:XTRM-3`. `ReferenceChip` renders status, the hierarchical key, and optionally the title; it resolves against the repository issue index and renders unresolved text unchanged. It is used in Details (Parent, Blocked by), list and board parent chips, and in all rendered Markdown, where a remark plugin turns `@issue:REF` and bare issue keys into chips (code spans and existing links are untouched). The host decides activation through `ReferenceActionsProvider` (drawer traversal in the inspector, page navigation on the issue page). The Agent composer's `@` mention is expected to insert the same `@issue:REF` text and render this chip as its node view; new kinds extend the union.
- **Board** — List/Board toggle on the same surface. Columns: Blocked and Ready are derived (dependencies, dispatchable set) and are not drop targets, because READY is an execution gate (PRD §8); To do, Deferred, and Done accept drops and write `sb issue state` (open / deferred / done). Every card also has a "Move to" menu so the write is keyboard-reachable. Each column renders at most 50 cards; the list view holds the rest. Cards: kind, key, priority, title, blockers, children progress, parent, updated. The text filter applies to both layouts.
- **Issue page** — `/rep/:owner/:repo/work/issues/:issueRef`. Main column: title, then one field per `WorkContract` field (Problem, Success, Scope, Non-goals, Constraints, Validation, Output, References), then Activity (journal), Lineage (parent, blockers, children), Provenance. Details panel: Status, Readiness with gaps, Priority, Scrutiny, Parent, Children progress, Blocked by, Claim, Created, Updated, Closure.
- **Drawer** — the same view in a single column with a compact details grid.
- **Editing** — click a field to edit; explicit Save / Cancel; `Ctrl+Enter` / `Esc`. Prose fields use a rich editor with a Markdown source tab. List fields are structured item editors. Status, Priority, and Scrutiny are menus that save on selection. The Console v1 inline mutation panel is rejected.
- **Markdown** — all contract prose and journal entries render as GitHub-flavoured Markdown (`react-markdown` + `remark-gfm`), without raw HTML.
- **Writes** — through the installed `sb` CLI verbs only (`issue edit`, `issue state`, `issue note`, `issue create`), allow-listed and validated in the dev-server bridge, with `--expected-revision` on contract edits and one field per write (`issue edit` applies metadata before the revision check). Same-origin only. `XTRM_SUBSTRATE_WRITES=0` makes the bridge read-only; `XTRM_SB_DB` targets a development database.
- **Lossless contracts** — writes patch known fields onto the contract exactly as read, so unknown keys and extra fields on validation/output entries survive. The rich editor persists the original string when a field was not changed, because the Markdown serializer adds escapes (measured on real contracts).
- **Imported-contract normalization** — Beads imports stored whole contracts as Markdown sections inside `problem`. The issue view detects them, previews the mapping into typed fields, and writes one new revision only after review. Sections move only into empty or placeholder fields.

### 16.4 Read model for the list

The list joins three typed reads without per-issue calls: `issue list` (hierarchical refs), `export project` (priority, scrutiny, timestamps, edges), `issue ready` (dispatchable set). Detail adds `issue show`, `issue resume`, `provenance trace`, `journal show`. The remaining read gaps are tracked in XTRM-393 (readiness for non-dispatchable issues, cursor, change feed; priority is absent from `show`/`list`/`resume` JSON).

### 16.5 Drawer parity with Console v1

Console v1's issue drawer tabs were Overview, Lineage, Activity, Evidence, GitHub, Memories, Followups. Console v2 now covers Overview (contract + details), Lineage (parent, blockers, children), Activity (journal), and Provenance (attestation, claims, bindings, receipts, commits, PRs). Not yet covered: specialist run activity/evidence, GitHub evidence references, project memories, and discovered-from/relates-to followups.

### 16.6 Pull requests surface and PR drawer (XTRM-396)

- **Route** — `/rep/:owner/:repo/code/pulls` is live (`PullsSurface`); the `pulls` destination is no longer deferred in `destinations.ts`.
- **Reads** — `GithubAdapter.listPulls` / `getPull` behind the Console v1 backend (XTRM-395 step 1: no auth changes, no direct `api.github.com` calls). Exact paths (`Jaggerxtrm/console` `apps/console/src/server/routes/github.ts`): `GET /api/github/prs?repo=&state=&limit=&offset=` → `{ data, limit, offset }` poller cache (`state` is an exact column match: `open` | `closed` | `merged`; `all` omits the param; adapter `closed` fans out to `closed` + `merged`); `GET /api/github/prs/:owner/:repo/:number` (unwrapped row); `GET …/detail` (unwrapped `PrDetailPayload`: reviews, files, commits; TTL 60s open / 10min closed). Rows carry no branches/draft/checks (neutral fallbacks); change totals fall back to the file summary when row counters are null. `GET …/checks` is a separate backend issue — 404 until it lands, degrading to checks `none` / mergeable null.
- **List** — Open / Merged / Closed views, text filter (title, author, branch, number), sort (updated, created, comments). Rows show author, branch, checks status, review state, updated time, and linked Substrate issue chips (keys mined from title/branch/body; `UTF-8` excluded).
- **Drawer** — `DrawerRef` gains kind `pr` with ref `owner/repo#N`, URL-restorable as `?inspect=pr:owner/repo%23N`. `PullPanel` shows overview (author, branch, checks, review, mergeability, change totals), linked Substrate issues, description, reviews, files-changed summary (first 30 rows; full diff stays on GitHub per non-goals), and GitHub links. Drawer-first: no PR modal or split pane.
- **References** — `ContextReference` gains `{ kind: "pr", ref: "owner/repo#N" }`, serialized `@pr:owner/repo#N`. The remark plugin links explicit `@pr:` refs (code spans and existing links untouched) and `ReferenceChip` renders PR chips that inspect the PR drawer. Substrate provenance PR strings (canonical refs, GitHub PR URLs, bare `#N`) resolve to the same chips, which the Provenance tab renders in place of the former comma-joined string.

### 16.7 GitHub login UI (XTRM-400)

- **Decision** — attributed GitHub actions need a per-user login through the **xtrm-console GitHub App** (owner `xtrm-dev`, installable on any account), not the shared `GITHUB_TOKEN` / `gh auth token` credential. The device flow is identical against a GitHub App `client_id`. The backend half (device flow, token store, auth status, installations, capabilities) is XTRM-404; this section owns the Console v2 UI that consumes it.
- **Adapter** — `GithubAuthAdapter` (`adapters/github/auth.ts`) consumes exactly the XTRM-404 SUCCESS shapes: `GET /api/github/auth/status` → `{ state: not_configured|signed_out|pending|signed_in|expired|error, auth_source: user|shared|none, user?, device?, store?, error? }`; `POST …/auth/device/start`, `POST …/auth/device/cancel`, `POST …/auth/signout` (no bodies; tolerate an empty 2xx or a status object, then refetch status); `GET …/auth/installations` → `{ installations: [{ account, repository_selection, permissions, html_url }], install_url }`; `GET /api/github/capabilities?repo=` → `{ auth_source, installed, permissions, can }`. The browser never receives or stores tokens and xtrm-app makes no direct `api.github.com` calls. Until XTRM-404 lands, the live adapter degrades to `not_configured` on 404 (capabilities/installations degrade silently so no misleading Install CTA appears); the fixture (`createFixtureGithubAuth`) covers every state plus per-repo capability overrides and a `__resolve` device-flow driver for tests.
- **Top bar** — `AccountControl`: Sign in with GitHub when signed out (also for `not_configured` / `expired` / `error`), an avatar menu with Settings and Sign out when signed in, an Enter-code entry while `pending`. The previously disabled Settings button now navigates to `/settings`.
- **Settings** — top-level `/settings` route (`SettingsSurface`, global not repo-scoped): connection state, identity, auth source, token store (`keychain|file`, optional until served), installations with Install/Configure links and permissions, sign in/out.
- **Drawer** — `DrawerRef` gains kind `github-auth` (ref `signin`, URL-restorable as `?inspect=github-auth:signin`). `DevicePanel` shows the `user_code` large monospace with copy (announced via a `role=status` note), an Open-`github.com/login/device` link, an expiry countdown that never steals focus, live status via 5 s `auth/status` polling that stops on settle, cancel, and error states with retry. Focus lands on the device code on open; all actions are real buttons.
- **Notices** — `GithubNotice` renders inline, actionable callouts on GitHub surfaces (Pull requests, Activity, Repositories) without touching their read paths: `not_configured` → setup callout linking Settings; `signed_out` → read-only-via-shared-token or sign-in-required; `pending` → in-progress; `expired` → sign-in-again; `error` → message with retry; per-repo `installed: false` → Install-xtrm-console callout. Silent when signed in with the app installed.

### 16.8 PR conversation threads and inspector polish (XTRM-421)

- **Conversation** — `PullRequestDetail` gains `conversationComments`, `reviewComments` (path/line/original_line/in_reply_to_id/html_url), and review `body`/`url`, mapped from the existing `GET …/detail` payload (`comments`, `reviews`, `review_comments`; no backend change). `PullPanel` adds a Conversation section: chronological conversation comments + non-empty review summaries (avatar initial, login, relative time, review-state badge, full Markdown via the shared `Markdown` component), then code-anchored threads grouped by the root's (path, line ?? original_line) with a compact `file:line` header, root, and replies. Same-line roots merge while the backend omits reply links (documented simplification in `PullConversation.tsx`). Verified live on `xtrm-dev/xtrm#209` (one conversation comment, one review summary, one `README.md:24` thread + reply).
- **Inspector motion (single driver)** — the sidebar, main fill, and inspector dock live in one `ResizableGroup` on motion-panels' default `TRANSITION` (250 ms, `cubic-bezier(0.32, 0.72, 0, 1)`, mirrored by `SHELL_MOTION`); no CSS width transitions on layout regions. The sidebar `ResizeHandle` stays mounted (hidden when collapsed) so Group children keys never change and no reorder FLIP pass delays the dock. The only other tween is the inspector frame's `--frame-min` CSS variable, started in a layout effect in the same commit, with its first step painted synchronously (motion writes one frame late otherwise). Measured on a production build (headless Chromium 1440×900, 5 runs per action): open, close, maximize, and restore start on the same frame for sidebar/main and the inspector frame. The Vite dev server is not a valid motion benchmark: React dev + StrictMode block the first frame after a layout toggle for 130–380 ms on the Issues surface, so panels that started before the block look like they jump.
- **Overlay by default, push the sidebar** — `CONTEXTUAL` (default open) floats over the main column: its dock reserves only the rail in flow (`dockWidth: RAIL`) and the visible frame is absolutely anchored to the dock's right edge, full height, with `min-width: RAIL + drawerWidth` (`frameMinWidth`), border + `shadow-float`, `variant: overlay`. Opening pushes the left sidebar to its rail in the same motion (`collapsedSidebarForInspector`, restored on close unless the user reopened it). `PINNED` is the only in-flow column (`dockWidth: RAIL + drawerWidth`, muted border, no shadow, `variant: column`). `MAXIMIZED` fills the group (`dockWidth: 100%`); the frame follows the dock (width 100%) so maximize/restore ride the panel motion.
- **Edges** — no mode-rail inspector toggle (the sidebar edge handle is the only left-edge affordance). The inspector rail carries two discreet vertical pills sharing the sidebar `group/edge` treatment (thin at rest, widen with a small `xs` chevron on hover/focus): open/close (`inspector-rail`, `Mod+I`) and maximize/restore (`inspector-maximize-rail`, `Mod+Shift+Enter`; left chevron to maximize, right chevron to restore).
- **Discoverability** — `Mod+I` stays open/close; new maximize/restore shortcut `Mod+Shift+Enter` (`INSPECTOR_MAXIMIZE_KEY`, `modShortcut`) with `Tip` + `Kbd` tooltips (`Maximize inspector`/`Restore inspector`). Both shortcuts are listed in the command palette (`Ctrl I`, `Ctrl Shift Enter` rendered with `Kbd` via `isShortcutHint`). Handlers keep `isShortcutSuppressed` guards (editable fields, dialogs, menus); the palette stays reachable everywhere.

### 16.9 Substrate Journal, Provenance, and Closure (XTRM-438)

- **Read path.** The adapter keeps every field of `sb --json issue show`, `provenance trace`, and `journal show` (`mapJournalEntry`, `mapTrace`, `mapClosure` in `src/adapters/substrate/live.ts`). Fields missing from an older `sb` map to explicit `null`, never to filler. One bounded journal read of up to 2000 full entries (`sb journal show` has no offset); `journalTotal` from `operationalContext.total` shows when the read was capped.
- **Journal tab** (`src/issues/IssueJournal.tsx`): kind badge, sequence, revision, relative time, stored identity (participant, session, activation, run) shown verbatim with copy, Markdown summary (semantic, else result summary), and collapsible Result, Checkpoint, Mechanical, and Execution context blocks. Checkpoint and compaction entries carry an accent marker. Entries render 50 at a time.
- **Provenance tab** (`src/issues/IssueProvenance.tsx`): attestation card, claims (current vs released/expired), execution bindings with named actors, receipts with the GitHub commit link and the settling checkpoint (jumps to and highlights the journal entry) or an explicit "Not linked", checkpoints, commits, PR chips, external bindings.
- **Closure card** above the tabs for closed issues: outcome, reason, actor, session, closed time, revision, contract hash, closure id. A closure made against an older contract revision is marked.
- Fixtures in `src/adapters/substrate/__fixtures__/` are captured `sb --json` output (XTRM-404, XTRM-421). Screenshots: `xtrm-438-{closure-journal,claims,receipts,journal-identity,inspector-receipts}.png` (production preview, live Substrate).

### 16.10 GitHub Issues, Releases and Repository content (XTRM-397)

- **Data path.** Unchanged rule: the Console v1 backend owns fetching, this package only maps (`src/adapters/github/live.ts`). Reads used here: `GET /api/github/issues?repo=` and `/issues/:owner/:repo/:number`, `/releases?repo=`, `/repo/:owner/:name/markdown?path=` (README.md and CHANGELOG.md only — the backend rejects any other path), `/repo/:owner/:name/reports` and `/reports/:filename`.
- **GitHub Issues** (`src/github/IssuesSurface.tsx`) is labelled "GitHub tracker, not XTRM Issues" in its header and uses its own drawer kind `gh-issue` with reference form `owner/repo#N` (`@gh-issue:owner/repo#N`). Issue state, labels and comment count come from the poller row; the row carries no label colour and no comment bodies, so neither is invented — the drawer states the count and links out.
- **Releases** (`src/github/ReleasesSurface.tsx`) is a timeline, newest first, with the latest release marked. A release without a name falls back to its tag; notes render through the shared Markdown component, so issue keys in them become reference chips.
- **Repository content** (`src/github/ContentSurface.tsx`) switches between README, CHANGELOG and session reports. Report YAML frontmatter renders as fields rather than prose (`splitFrontmatter`).
- **Markdown tables** now scroll inside their own box instead of squeezing every column (`src/ui/markdown.tsx`, `.xtrm-prose table`). This affects every Markdown surface, not only reports.
- **Live state, verified 2026-09-18:** the surface is live against real data — for example `ConardLi/easy-dataset` lists 68 open and 132 closed issues with labels, authors and comment counts. It first appeared empty because the backend poller ingested no issues at all (CONSOLE-1: the null-watermark sentinel `since=1970-01-01T00:00:00Z` makes the GitHub API return an empty array, and the ETag of that empty response was then persisted). Fixed in the Console v1 backend and verified end to end. Releases and content are verified against live data.
- Screenshots: `xtrm-397-{github-issues,github-issue-drawer,releases,content-readme,content-report}.png`; `xtrm-397-github-issues-empty.png` keeps the empty state for a repository with no issues.
