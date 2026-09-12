# Console v2 — shell, double-sidebar and Inspector Drawer architecture

**Status:** proposed architecture, ready for implementation waves A–D
**Scope:** `packages/xtrm-app` base UI shell; migration from `Jaggerxtrm/console`
**Inputs:** `console-v2-audit-conar-ui.md`, `console-v2-audit-console-v1-preservation.md`, `console-v2-audit-substrate-issues-contract.md`, `console-v2-audit-deepseek-harness.md`, `adoption-audit.md` §10–12
**Deferred:** full Agent/Frames runtime (wave H)
**Pinned source revisions:** `Jaggerxtrm/console` @ `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d`; `xtrm-dev/xtrm` @ `9263f917c232db266f27468f558861f86a5e5cb0`; `wannabespace/conar` @ `d50f1d12790a5e3e32b16baaae46c732bd36ff35`; `deepseek-ai/deepseek-harness` @ `c291e7961a515f6d7af9304e7fd1d257929aef26`.

Tag legend: `VERIFIED` (read in source at the pinned revision), `INFERENCE` (derived from cited facts), `PROPOSAL` (decision requested here), `UNKNOWN` (not determinable from audited source).

---

## 1. Placement and host tier — resolve before wave A

`UNKNOWN`, and the only item in this document that blocks implementation.

Conflicting authorities at the pinned revisions:

- `packages/xtrm-app/docs/implementation-packet.md:338-340` — "Canonical implementation root: `xtrm-dev/xtrm/packages/xtrm-app`. Do not recreate this work under Core, Specialists, or a separate repository."
- `packages/xtrm-app/README.md:3` — xtrm-app is the "Linux-first desktop application workspace for XTRM's Episode-based human ↔ agent interface" (Tauri 2 + React + Node sidecar).
- `Jaggerxtrm/console/docs/architecture/console-architecture.md:5-7` — "`apps/console` is both the production host and UI package", and `docs/console/architecture/console-architecture.md` (xtrm) declares that document the owning authority: "Console is a read/control projection over upstream authorities."
- `docs/monorepo-migration.md:12,275` (xtrm) — an earlier exploration draft that folds `gitboard` (console) into the umbrella monorepo as `apps/console/`. Not landed: `apps/` in the audited xtrm revision contains only `.gitkeep`.

Two candidate readings:

- **PROPOSAL P1 (recommended)** — Console v2 base UI is implemented in `xtrm-dev/xtrm/packages/xtrm-app`; the current `Jaggerxtrm/console` host keeps serving `/api/*`, realtime, terminal, and the GitHub runtime, and is consumed as the backend during migration. The proven server-side integration moves later, under a separate decision, once `xtrm-app` owns the shell.
- **PROPOSAL P2** — Console v2 is implemented inside `Jaggerxtrm/console/apps/console` and `packages/xtrm-app` remains product documentation plus the desktop Episode concept. This contradicts the stated canonical implementation root but is the only reading consistent with `Jaggerxtrm/console/docs/architecture/console-architecture.md`.

Decide P1 or P2 before wave A. Everything below is written to be placement-neutral except §9 (route/state), which assumes a client-side SPA shell in either repository.

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

`PROPOSAL` — one XTRM-owned shell adapter module wraps `motion-panels` (`MIT`, pinned `0.4.0`; latest `0.5.1`) and is the only module in the codebase that imports it (`adoption-audit.md` §12.1).

- `ResizableGroup orientation="horizontal"` holds the contextual sidebar, the main region, and the inspector panel; the main region is the unsized fill panel.
- The global rail and the collapsed reopen rails are **not** `motion-panels` panels. `motion-panels` collapses a panel to extent `0` and has no `collapsedSize` (`console-v2-audit-conar-ui.md` §6). The XTRM rounded reopen rail therefore needs a reserved element.
- `PROPOSAL B1 (recommended)` — the collapsed contextual rail is a sibling fixed-width element outside the resizable group; expanding swaps it for the sized panel. This makes "reserved, rounded, reopen-only" explicit and directly testable.
- `PROPOSAL B2` — the sidebar panel is never `collapsed`; at rail width it renders only the reopen affordance, and drag-out is handled by the library separator.

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
| Keyboard | Sequential tab order through destinations; `Mod+1…Mod+7` jump to destination N; `Mod+K` command palette |
| Scope | Application-level only. The rail must never reflect repository-specific state; repository context lives in §4 |
| z-index | Rail is shell chrome. It must not rely on z-index to stay visible — see §7.2 for the geometric guarantee |

`INFERENCE`: because the rail is the only always-present navigation, its destination set is the product's top-level information architecture and changing it later is a breaking UX change. Lock the set in wave B before building surfaces.

---

## 4. Contextual sidebar

### 4.1 Expanded

- Width: default 264px, min 220px, max 360px (`PROPOSAL`; Conar's 280/220/50% is a DB-client budget, not an XTRM budget).
- Structure: surface title + count → search/filter input → contextual hierarchy (grouped lists) → footer actions.
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

---

## 5. Primary work surface

- Fill panel. Owns the current mode/repository/entity work.
- URL-addressable in Console v2 (Console v1 could not address the GitHub surface at all: `console-v2-audit-console-v1-preservation.md` §2.5). See §9.
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
Command            command palette (Mod+K)
Theme              light/dark
Settings/Profile
```

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

Console v1 has no client router and cannot address repositories (`console-v2-audit-console-v1-preservation.md` §2.5). `PROPOSAL` — a stable URL contract, whose implementation may be a router dependency or hand-rolled parsing:

```text
/console                                  global rail destination (Agent | Work | Repositories | Agents | Program | Observability)
/console/rep/:owner/:repo/work/issues     XTRM Issues
/console/rep/:owner/:repo/code/activity
/console/rep/:owner/:repo/code/pulls
/console/rep/:owner/:repo/code/issues     GitHub Issues
/console/rep/:owner/:repo/code/releases
/console/rep/:owner/:repo/code/content
/console/rep/:owner/:repo/system/graph
/console/rep/:owner/:repo/system/observability
/console/rep/:owner/:repo/governance/program
/console/rep/:owner/:repo/agent/:sessionId      wave H (reserved)
```

Drawer state is not a route; it may be encoded as a query parameter so a shared link restores the inspected entity.

`PROPOSAL` — `@tanstack/react-router` (MIT, already proven in the Conar stack) as the router, or a ~100-line route registry if the dependency is rejected. `UNKNOWN` which; but the URL contract above is required either way, because deep-linkability is the fix for a verified Console v1 defect.

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

1. Reserve `/console/rep/:owner/:repo/agent/:sessionId` and the `Agent`/`Agents` destinations (they may render an explicit "deferred" state, not a broken route).
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

Wave C may start in parallel with B only if the query layer is settled first; wave E may start in parallel with C/D because it is a distinct adapter. Do not reorder E before D solely to make the drawer useful — the drawer contract must be fixed before entity panels are written into it.

---

## 14. Risks and unknowns

| id | item | tag | mitigation |
|---|---|---|---|
| R1 | Placement P1 vs P2 unresolved | `UNKNOWN` | decide before wave A |
| R2 | `packages/substrate/package.json` has no `main`/`exports`/`types`; readiness types are not root-exported | `VERIFIED` | add a package entry point + export `domain/readiness.ts` before wave E; otherwise deep-import across repos |
| R3 | Console `resolveStateDaemonPaths` resolves `~/.xtrm/state.db`, identical to Substrate's canonical path | `VERIFIED` | resolve ownership explicitly before activating any Console state daemon; two schemas in one file is data loss |
| R4 | Substrate has no bulk query, pagination, or change feed; `ready()` is N+1 | `VERIFIED` | wave E reads a bounded project; file a Substrate-side bead for a batched query/change feed before any large-fleet UI |
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
| R12 | `Frame` semantics undefined (per-session fold vs cross-agent aggregate) | `UNKNOWN` | wave H prerequisite; do not build the projection registry before it is decided |
