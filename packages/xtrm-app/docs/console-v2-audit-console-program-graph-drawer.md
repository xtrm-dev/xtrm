# Console v1 → Console v2 audit — Beads materializer, issue feed, drawer, Program, Graph, Observability, Specialists

> **Console v2 / ISSUE-140 audit artifact.** Read-only source inspection at a pinned revision.
> Audited source: `Jaggerxtrm/console` @ `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d` (clean worktree `/home/dawid/dev/console-wt/audit-main`)
> Every load-bearing claim carries a `path:line` reference and is tagged `VERIFIED` (read in source), `INFERENCE` (derived from cited facts), or `UNKNOWN`.
> Companion artifact: `console-v2-audit-console-v1-preservation.md` covers the shell frame and the repository/GitHub half; this document covers Beads materializer + feed + views, drawer/right-sidebar/bottom-drawer, Program (governance), Graph, Observability, and Specialists.
> Consumed by `adoption-audit.md`, `console-v2-migration-plan.md`, `console-v2-shell-architecture.md`, and `xtrm-gui-prd.md`.

---

**Audited SHA:** `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d` (verified via `git rev-parse HEAD` in `/home/dawid/dev/console-wt/audit-main`)
**Audit date:** 2026-09-12 (UTC)
**Mode:** read-only. No repository source file was modified. This report is the only artifact written.
**Repository:** `Jaggerxtrm/console` (xtrm monorepo: `apps/console`, `packages/core`, `packages/api-client`, `packages/ui`, `packages/html-preview`)

## Scope split

| Audit | Owns | Explicitly out of scope here |
|---|---|---|
| **This audit** | Beads materializer + issue feed + Beads views; drawer / right-sidebar / bottom-drawer behavior; Program (governance); Graph; Observability; Specialists | — |
| **Companion audit (not duplicated here)** | Shell frame (TopBar / Sidebar / MainPane tab routing), repository + GitHub half (poller, store, `/api/github/*`, GitHub timelines, repo tree) | Repo rail, GitHub adapter, GitHub issue feed |

Shared files (e.g. `apps/console/src/dashboard/stores/shell.ts`, `MainPane.tsx`) are cited here only where they carry drawer/panel state that this audit owns. They are not re-characterized as a shell audit.

**Verification tags used throughout:** `VERIFIED` (read directly from the pinned SHA), `INFERENCE` (derived from verified structure, not directly observed at runtime), `UNKNOWN` (could not be established from the pinned tree).

---

## 1. Executive summary

1. **The Beads materializer is a single-writer SQLite projection and is already the correct shape for Console v2.** `packages/core/src/materializer/beads-adapter.ts:51` is the only writer to `substrate_issues` / `substrate_dependencies` / `substrate_issue_edges` in production code (`VERIFIED` by exhaustive grep). It is an incremental snapshot-diff adapter with an explicit resync path and an explicit comment documenting the cross-project wipe bug it avoids. **Disposition: EXTRACT_REUSE.**
2. **Beads terminology is load-bearing at every layer below the UI.** `BeadsAdapter`, `BeadsProject`, `BeadIssue`, `beads:<projectId>` source keys, `sources.kind = 'beads'`, `BeadsReader`, `DoltClient`, `beads-watcher`, `beads-parity`, `bd` CLI subprocess, `/api/substrate/projects/:projectId/issues` — the leakage is not cosmetic. The `substrate_*` tables and read-model functions are already Beads-neutral; the storage *key* `repo_slug` and the source *key prefix* `beads:` are not.
3. **`packages/core/src/state/read-models/substrate.ts` and `feed-read-model.ts` are the reusable read layer.** They are pure SQL over durable tables with no HTTP or app types. **Disposition: EXTRACT_REUSE.**
4. **The Console violates "one canonical global drawer" in five independent ways, and two of the five are additionally unreachable or stale.** Three concurrent, independently-resizable, portal-mounted drawers exist (`BeadSideDrawer`, `ProgrammeEntityDrawer`, `OperationsDrawer`), plus one orphaned shell panel (`RightSidebar`), plus one full modal (`IssueOverlay`). z-index layering is inconsistent (40 / 49 / 50 / 50 / 55 / 900 / 901 / 1000).
5. **`RightSidebar` is dead production UI.** `useShellStore.openSidebar()` has **zero production callers** — only its own tests call it (`apps/console/tests/dashboard/components/shell/RightSidebar.test.tsx:44`). It is nonetheless mounted in the shell (`apps/console/src/dashboard/App.tsx:57`) and can rehydrate open from `localStorage` (`forge-70el:sidebarState`). **Disposition: DELETE_AFTER_CUTOVER.**
6. **The bead inspector's data contract is bound to the Issue Feed being mounted.** `projectId`, `issueById`, and `memories` only exist inside `useBeadSideDrawer` after `BeadsRepoView` calls `setContext` (`BeadsRepoView.tsx:294-296`). Opened from Graph (`Graph.tsx:356`), Specialists (`Specialists.tsx:96`), Operations (`Operations.tsx:217`), or the BottomDrawer specialists tab (`SpecialistsTabPanel.tsx:42`), the drawer receives `projectId = null`, so it never fetches detail (`BeadSideDrawer.tsx:54-67`) and the Lineage tab fabricates data (`BeadSideDrawer.tsx:368-385`). **This is the single highest-value defect in the drawer surface.**
7. **Program does not duplicate executable work state — it explicitly disclaims it.** Every snapshot carries `evidence_boundary.beads = "not inferred: repository-local Beads require a fresh local read or governed board-audit transport"` (`apps/console/src/server/programme/read-model.ts:1003`). Program is a commit-pinned, read-only projection of an **external** GitHub repo (`mercuryintelligence/program@master`, `source.ts:11-13`). **Disposition: PRESERVE_AS_IS with a hard boundary assertion.**
8. **The Graph is a Beads-issue graph, not an xtrm-neutral execution graph.** It is project-scoped via `repo.beadsProjectId` (`Graph.tsx:38-45`), joins `substrate_issues` + `substrate_job_link` (`read-models/graph.ts:77`), and opens the Beads drawer on node click. Rendering is `@xyflow/react` 12 + `@dagrejs/dagre` 1.1, one `ReactFlow` instance per connected component (up to N instances on one page). **Disposition: ADAPT (data layer EXTRACT_REUSE, renderer ADAPT).**
9. **Observability is a metrics read model over materialized specialist tables plus a Beads Dolt repair table — it does not hold durable evidence, it holds rollups.** `Observability.tsx:50-61` renders 12 fixed aggregate tables from `/api/console/observability/summary`; `Observability.tsx:72-99` renders a `Beads Dolt repair` table. **Disposition: ADAPT (metrics EXTRACT_REUSE; Beads Dolt repair rows REPLACE).**
10. **Specialists are surfaced as a page-level two-pane cockpit plus four cross-surface entry points into the Bead drawer.** There is no specialist-specific drawer shell — this is correct and should be preserved.

---

## 2. Area A — Beads materializer, issue feed, Beads views

### A.1 Where Beads data is read

Three distinct read paths exist. They must not be conflated.

| # | Path | Entry | Source of truth | Tag |
|---|---|---|---|---|
| R1 | **Dolt wire protocol** | `apps/console/src/server/runtime-lifecycle.ts:201-221` — `readIssues(project)` uses `DoltClient` (`packages/core/src/state/dolt-client.ts:16`, `mysql2/promise`) when `project.doltPort` is set; pages 1000 rows at a time up to 10 000 | live `bd` Dolt SQL server | `VERIFIED` |
| R2 | **JSONL fallback** | `runtime-lifecycle.ts:222-226` — `readBeadsIssuesFromJsonl(project.beadsPath)` (`packages/core/src/state/beads-jsonl-reader.ts:21`) | `<repo>/.beads/issues.jsonl` | `VERIFIED` |
| R3 | **Durable SQLite projection** | `packages/core/src/state/read-models/substrate.ts:91,97,114,120,152,163` — pure SQL over `substrate_issues` / `substrate_dependencies` / `substrate_issue_edges` | `xtrm.sqlite` | `VERIFIED` |

R1/R2 feed the **materializer** only. Every HTTP read in the Console serves R3. `readIssues` (`runtime-lifecycle.ts:201-227`) returns `[]` for the JSONL fallback when neither path resolves and swallows errors (`runtime-lifecycle.ts:222-226`), which is a silent-degradation defect: a missing `.beads` directory is indistinguishable from an empty project at the materializer boundary, though `readBeadsSourceFacts` + `materialization_state.last_status` partially recover the signal for source health (`apps/console/src/server/routes/substrate.ts:54-68`).

**Beads-specific readers still live in `packages/core` and are still used at runtime for non-issue data:**
- `packages/core/src/state/beads-reader.ts:28` `BeadsReader` — used by `/api/substrate/projects/:projectId/memories` and `/interactions` against `<beadsPath>/knowledge.jsonl` and `<beadsPath>/interactions.jsonl` (`substrate.ts:98,116`). These are **not materialized**; they are read live from the filesystem on every request with a per-project "logged once" dedupe (`substrate.ts:166-178`).
- `packages/core/src/state/beads-jsonl-reader.ts:21` — JSONL materializer input.
- `packages/core/src/runtime/project-scanner.ts:18` `ProjectScanner` — filesystem discovery of `.beads` and Dolt port config.
- `packages/core/src/runtime/beads-watcher.ts` — `fs.watch` on `issues.jsonl` + 30 s active / 60 s idle poll (`beads-watcher.ts:18-22`), 1 s debounce, 1.5 s coalesce, max batch 50.
- `packages/core/src/runtime/beads-parity.ts:39` `createBeadsParityHarness` — Dolt-vs-projection field parity sampler, gated behind `XTRM_ENABLE_PARITY=1` / `GITBOARD_ENABLE_PARITY=1` (`runtime-lifecycle.ts:43-44`).
- `packages/core/src/runtime/unified-scanner.ts:43` `UnifiedScanner` — merges `beads` and `observability` source discovery into `sources`.
- `packages/core/src/state/substrate-project-service.ts:32,63,138,145` — Dolt connection probing, repair-action catalogue (`start_dolt_server`, `restart_dolt_server`, `recover_port_config`, `remove_dead_pid_file`), repo-path resolution.

### A.2 Materializer input / output

**Input.** `readSnapshot: () => readIssues(project)` — an array of `BeadIssue` (`runtime-lifecycle.ts:174`), structurally narrowed to `MaterializerBeadIssue` (`beads-adapter.ts:15-35`).

**Write path.** `Materializer.runOnce` (`materializer.ts:75-113`) executes one `BEGIN IMMEDIATE TRANSACTION`, calls `adapter.write`, then `upsertMaterializationState`, then a forensic event, then `COMMIT`. Cursor JSON is stored per `source_key` in `materialization_state.cursor`.

**Delta semantics.** `BeadsAdapter.changesSince` (`beads-adapter.ts:60-73`) reads the full external snapshot, reads the current projection rows for that `repo_slug`, runs `snapshotDiff`, and emits upserts + tombstones. Cursor is a content `snapshot_hash`, not a timestamp — so a snapshot-hash equal to the stored hash is an idempotent no-op delta.

**Two write paths with deliberately different tombstone behavior (this is correct and must survive migration):**
- `write()` (`beads-adapter.ts:79-89`) — delta-shaped. Deliberately does **not** call `tombstoneMissing`. Comment at `:83-88` records that calling it here caused the cross-project wipe fixed in `forge-eorh.70`.
- `writeFull()` (`beads-adapter.ts:96-101`) — full resync. Calls `tombstoneMissing` (`:131-139`), which flips active rows for that `repo_slug` missing from the snapshot to `deleted_at = CURRENT_TIMESTAMP, state = 'deleted'`. Invoked only by `Materializer.resync` (`materializer.ts:115-129`).

**Normalization performed by the adapter (all Beads-schema-specific, all belongs in an adapter not a domain model):**
- `normalizeIssue` (`:167-200`) maps `BeadIssue` → `MaterializedIssue`.
- `deriveRuntimeKind` (`:222-227`) infers `chain_molecule` / `step` / `organizational_epic` / `root` from `issue_type` and `kind:` labels.
- `extractContract` (`:229-233`) regex-extracts `<change-contract>` / `<step-contract>` XML out of the issue **description string** into `contract_kind` + `contract_xml`.
- `buildMetadataJson` (`:240-246`) hoists `edge:` labels into `metadata.edge_labels`.
- `materializeEdges` (`:202-220`) expands `dependencies[]` into rows and synthesizes a `parent-child` edge from `parent_id` if absent.

**`repo_slug` is populated from the Beads project id**, not from a GitHub repo slug (`beads-adapter.ts:176`, `ports.projectId` from `runtime-lifecycle.ts:172`). This is a naming collision that will cause confusion during the Substrate migration (`INFERENCE` — the value is the `beads:<projectId>` suffix, i.e. the `.beads` project name, while `sources.kind='observability'` rows use a real repo slug for the same column).

### A.3 Resulting models

Two parallel Beads-domain type definitions exist and are **not** the same file:

| File | Type | Difference |
|---|---|---|
| `packages/core/src/types/beads.ts:31` | `BeadIssue` | no `pid_alive`, no `BeadsRepairAction` |
| `apps/console/src/types/beads.ts:33` | `BeadIssue` | copy of the above; app version adds `BeadsRepairAction`/`BeadsRepairActionsResponse` (`:131-145`) and `pid_alive` on `BeadsConnectionStatus` (`:125`) |

The app copy is a drifted superset. `apps/console/src/dashboard/lib/beads.ts:1-21` re-exports the app copy as the single UI import surface. `VERIFIED` defect: two `BeadIssue` definitions with the same name and no shared source; any field added to one silently diverges.

The durable tables (`packages/core/src/state/database.ts:148-191`) are typed by `MaterializedIssue` / `MaterializedDependency` in `packages/core/src/materializer/types.ts:5-29,57-63` — a **third** representation, already Beads-neutral except the enum-ish `runtime_kind`, `formula_name`, `template_name`, `contract_kind`, `contract_xml` columns, which the repo's own `read-models.ts:50` already flags as `droppableBridgeFields`.

### A.4 Refresh / query path

**Trigger chain.** `BeadsWatcherRuntime` (`runtime-lifecycle.ts:74-82`) → `registerAndTrigger(project, true)` → `materializer.trigger("beads:<id>")` → `SourceQueue` with `COALESCE_MS = 1500` (`queue.ts:1,91-103`) → `BoundedMaterializerScheduler` with `MATERIALIZER_MAX_CONCURRENCY = 2`, `MATERIALIZER_MAX_PENDING = 8` (`queue.ts:2-3,38`).

**Realtime fan-out.** `publishHint` (`materializer.ts:131-154`) for `beads:` source keys emits event `substrate:sync_hint` on channels `substrate:changes` and `substrate:project:<projectId>` (`materializer.ts:161-164`). The client subscribes via `useWebSocket("substrate:changes", ...)` (`BeadsRepoView.tsx:266`) and treats `substrate:sync_hint` as a refetch trigger with a 1 500 ms coalesce (`BeadsRepoView.tsx:240-247,271-274`).

**Query path.** `substrateApi.*` (`apps/console/src/dashboard/lib/substrate-api.ts:65-212`) → `/api/substrate/*` (`apps/console/src/server/routes/substrate.ts:31-43`) → core read models (`substrate.ts:73-131`) → SQLite. **No caching layer.** `useDashboardResource` caches only graph and programme (`hooks/useGraphData.ts:5`, `hooks/useProgrammeData.ts:6`); the Beads feed re-fetches on every invalidation.

### A.5 API routes

| Method | Route | Handler | Backing |
|---|---|---|---|
| GET | `/api/substrate/projects` | `substrate.ts:31` | `sources WHERE kind='beads'` + `readBeadsSourceFacts` + `countSubstrateIssues` |
| GET | `/api/substrate/projects/:id/issues` | `substrate.ts:32` | `readSubstrateIssues` |
| GET | `/api/substrate/projects/:id/issues/closed` | `substrate.ts:33` | `readSubstrateClosedIssues` |
| GET | `/api/substrate/projects/:id/issues/:issueId` | `substrate.ts:34` | `readSubstrateIssueDetail` + `readSubstrateIssueDependents` |
| GET | `/api/substrate/projects/:id/memories` | `substrate.ts:38` | `BeadsReader.getMemories(<beadsPath>/knowledge.jsonl)` — **live fs read** |
| GET | `/api/substrate/projects/:id/interactions` | `substrate.ts:39` | `BeadsReader.getInteractions(<beadsPath>/interactions.jsonl)` — **live fs read** |
| GET | `/api/substrate/projects/:id/runtime-graph` | `substrate.ts:40` | `readSubstrateRuntimeGraph` |
| GET | `/api/substrate/projects/:id/stats` | `substrate.ts:41` | `readSubstrateStats` |
| GET | `/api/substrate/projects/:id/connection` | `substrate.ts:42` | Dolt probe |
| GET | `/api/substrate/projects/:id/repair-actions` | `substrate.ts:43` | `readSubstrateProjectRepairActions` |
| POST/PATCH/POST/POST/DELETE/POST/POST/POST/POST | `/api/substrate/projects/:id/issues[/:issueId][/close\|/reopen\|/comments\|/notes\|/dependencies\|/priority]` | `beads-write.ts:80,107,171,191,206,237,255,273,292` | **`bd` CLI subprocess** |
| GET | `/api/feed` | `feed.ts:8-13` | `readFeedPage` |
| GET | `/api/internal/substrate/schema` | `internal-substrate.ts:8` | `PRAGMA table_info(substrate_issues)` + column-fill counts |
| GET | `/api/internal/dolt-health` | `internal-dolt-health.ts:9` | static liveness stub |

**Write path is Beads-native and is the sharpest coupling.** Every mutation spawns `bd` (`beads-write.ts:67` `BD_BIN = process.env.GITBOARD_BD_BIN || "bd"`; `:59` forces `--json --actor console --dolt-auto-commit on`), serialized per-repo-path with depth limit 16 (`:70`, `:442-457`), 30 s timeout (`:71`), 1 MiB stdout cap (`:69`). Authorization is `assertWriteAllowed` → `isAllowedConsoleWriteRequest` (`console-write-policy.ts:45`) plus `x-console-write-token` / `x-gitboard-sources-admin-token` and a trusted-peer-address header.

**`VERIFIED` write-after-read hazard:** `runIssueMutation` (`beads-write.ts:313-357`) responds with the issue parsed from `bd` stdout when present, else re-reads `substrate_issues` via `createIssueReader` (`:409-441`). The fallback re-read races the materializer, which is only triggered by the fs watcher or the next poll — `beads-write.ts` never calls `triggerMaterialization`, and there is no `materializer.trigger` in the write route at all.

### A.6 UI views consuming Beads data

| View | Path | Tab | Notes |
|---|---|---|---|
| `BeadsRepoView` | `components/beads/BeadsRepoView.tsx:141` | `feed` / `triage` / `memories` | loads ALL data for the project once (`:214-222`), 3000-row closed history (`:24`), maintains `issueById` map, pushes context into the drawer store |
| `IssueFeed` | `components/beads/IssueFeed.tsx:72` | `feed` | virtualized (`@tanstack/react-virtual`), inline dossier on selection (`:385`), dependency/parent tree grouping, `Cmd/Ctrl+K` search |
| `IssueDossier` | `components/beads/IssueFeed.tsx:385` | shared | description / specialist activity / notes / labels / related / audit log / dependency tree |
| `TriagePanel` | `BeadsRepoView.tsx:620` | `triage` | top picks / quick wins / stale / velocity |
| `MemoriesPanel` | `BeadsRepoView.tsx:540` | `memories` | from `/api/substrate/projects/:id/memories` |
| `IssueOverlay` | `components/beads/IssueOverlay.tsx:19` | `triage`/`memories` selection | **modal dialog**, not a drawer; focus trap, body scroll lock, `z-index: 1000` |
| `BeadSideDrawer` | `pages/console/BeadSideDrawer.tsx:28` | any | global portal drawer; 7 tabs |
| `BeadNode` | `pages/console/graph/nodes/BeadNode.tsx:69` | graph | opens the drawer |
| `Graph` | `pages/console/Graph.tsx:27` | graph | `substrate_issues` + specialist join |
| `Specialists` | `pages/console/Specialists.tsx:16` | specialists | joins chains to graph issues |
| `ChainDetailPane` | `pages/console/specialists/ChainDetailPane.tsx:217` | specialists | opens the drawer |
| `Observability` | `pages/console/Observability.tsx:72` | observability | Beads Dolt repair table |
| `BeadCard` / `StatusColumn` / `KanbanBoard` | `components/beads/{BeadCard,StatusColumn,KanbanBoard}.tsx` | — | **dead**: no production importer (`VERIFIED`); only `BeadCard.test.tsx` exists |

### A.7 Beads vs GitHub Issues vs neutral `Issue`

The Console currently holds **three unrelated issue concepts** with no common abstraction:

1. **Bead (Substrate work item)** — `substrate_issues`, `BeadIssue`, opaque string ids (`forge-eorh.70`, `BD-12`), priority `0..4`, `issue_type ∈ {bug,feature,task,epic,chore,molecule}`, `runtime_kind`, `contract_xml`, parent/dependency edges, plus XTRM-execution metadata (`formula_name`, `template_name`).
2. **GitHub Issue** — `github_issues` table (`database.ts:103-120`), `GithubIssue` in `packages/core/src/github/store.ts:598` and a duplicated `apps/console/src/types/github.ts:199`, numeric `number`, repo-scoped, rendered by `components/github/IssueTimeline.tsx`.
3. **Neutral `Issue`** — **does not exist.** There is no shared `Issue` interface, no shared id, no shared state enum. The only de-duplication is graph-local: `IssuePrLink` / `OpenPr` (`substrate-api.ts:19-28`) cross-links a bead to a GitHub PR by string match, and the drawer's `github` tab is a permanent stub (`BeadSideDrawer.tsx:233`).

`VERIFIED` defect: the drawer's `github` tab renders `EmptyTab title="No linked GitHub evidence"` unconditionally with the comment "will appear here when the materialized evidence refs include this bead" — but the materializer never writes GitHub↔bead links into `xtrm_evidence_refs` (that table is written only by `observability-adapter.ts:488`).

### A.8 Every Beads-specific terminology / schema dependency

| Layer | Beads-specific surface | Path |
|---|---|---|
| Table | `substrate_issues`, `substrate_dependencies`, `substrate_issue_edges`, `substrate_job_link` | `database.ts:148-191,270-278` |
| Column | `repo_slug` (actually a Beads project id) | `beads-adapter.ts:176` |
| Source key | `beads:<projectId>` prefix | `runtime-lifecycle.ts:167,190`; `materializer.ts:161-164,185` |
| Source kind | `sources.kind = 'beads'` | `runtime-lifecycle.ts:169`; `substrate.ts:50`; `read-models/graph.ts:63-72` |
| Runtime | `BeadsWatcherRuntime`, `BeadsParityRuntime`, `ProjectScanner`, `UnifiedScanner` | `runtime-lifecycle.ts:74-100` |
| Adapter | `BeadsAdapter`, `MaterializerBeadIssue`, `BeadsAdapterPorts` | `materializer/beads-adapter.ts:10-54` |
| Reader | `BeadsReader`, `readBeadsIssuesFromJsonl`, `DoltClient` | `state/beads-reader.ts:28`; `state/beads-jsonl-reader.ts:21`; `state/dolt-client.ts:16` |
| Types | `BeadIssue`, `BeadDependency`, `BeadIssueDetail`, `BeadsProject`, `BeadsStats`, `BeadsConnectionStatus`, `BeadsRepairAction(sResponse)` | `packages/core/src/types/beads.ts` (all); `apps/console/src/types/beads.ts:18-156` |
| CLI | `bd` subprocess, `--dolt-auto-commit on`, `GITBOARD_BD_BIN` | `beads-write.ts:59,67,442-500` |
| Log events | `beads.normalizeIssue`, `beads.feed.*`, `bead.*`, `right_sidebar.*` | `beads-adapter.ts:148`; `BeadsRepoView.tsx` (9 events); `shell.ts:192-219` |
| CSS/class names | `bead-*`, `ide-beads-pane`, `beads:mutated` (DOM event) | `globals.css:3455-4590`; `BeadsRepoView.tsx:279` |
| API prefix | `/api/substrate/*` (neutral name, Beads-shaped payloads) | `routes/index.ts:54` |
| Bridge manifest | `beads-substrate-projection` temporary bridge | `state/bridge-retirement.ts:38-46` |

---

## 3. Area B — Drawer / right-sidebar / bottom-drawer

### B.1 Inventory

| # | Shell | Path | Mount | Portal | Resizable | State owner | z-index | Reachable |
|---|---|---|---|---|---|---|---|---|
| P1 | `BottomDrawer` (global bottom) | `components/shell/BottomDrawer.tsx:13` | `MainPane.tsx:91`, inside `.shell-main` flow | no | yes, vertical mouse drag (`:57-76`) + maximize toggle (`:78-93`) | `useShellStore.drawerOpen/drawerHeight/drawerTab` (`shell.ts:159-177`) | 40 | yes (`Ctrl/Cmd+J`, `MainPane.tsx:30-39`; tab bar) |
| P2 | `RightSidebar` | `components/shell/RightSidebar.tsx:9` | `App.tsx:57` | no (fixed overlay) | yes (`:171-205` pointer capture) | `useShellStore.sidebar` (`shell.ts:185-222`) | scrim 49 / panel 50 | **no** — `openSidebar()` has zero production callers |
| P3 | `BeadSideDrawer` | `pages/console/BeadSideDrawer.tsx:28` | `App.tsx:58` | **yes** (`createPortal` → `document.body`, `:132,192`) | yes (`:90-110`), width local `useState` (`:49`) | `useBeadSideDrawer` zustand (`hooks/useBeadSideDrawer.ts:33`) | backdrop 50 | yes (7 call sites) |
| P4 | `ProgrammeEntityDrawer` | `pages/console/programme/ProgrammeEntityDrawer.tsx:25` | inside `Programme.tsx` | **yes** (`createPortal`) | yes (pointer capture `:64-76`) | `useProgrammeDrawer` zustand (`programme-drawer.ts:27`) | backdrop 900 / panel 901 | yes (programme graph/list) |
| P5 | `OperationsDrawer` | `pages/console/Operations.tsx:200` | `Operations.tsx:182` | no | no | local `useState<DrawerTarget>` (`Operations.tsx:80`) | backdrop 55 | yes |
| P6 | `IssueOverlay` | `components/beads/IssueOverlay.tsx:19` | `BeadsRepoView.tsx:457` | **yes** | no | local props | backdrop 1000 | yes (triage/memories selection) |
| P7 | `RepoDossier` | `components/github/RepoDossier.tsx:2,59` | github surface | **yes** | no | local | — | out of scope (GitHub half) |

### B.2 States and stacking

- P1 is the only panel that participates in **layout flow** (`.ide-main > .bottom-drawer { flex: 0 0 auto }`, `globals.css:4890`). Every other shell is a fixed/absolute overlay. P3, P4, P6, P7 all portal to `document.body`; P3 and P6 therefore escape `.ide-shell[data-theme]` DOM scoping — theme is inherited only because `data-theme` is on a wrapper that the portal does **not** sit inside (`VERIFIED` for P3: `App.tsx:52` sets `data-theme` on `.ide-shell`, `BeadSideDrawer.tsx:192` appends to `document.body`). This is a latent theming defect compensated by the body-level rule at `globals.css:5119`.
- P3's backdrop is `pointer-events: none` (`globals.css:4527`) — the drawer does **not** modal-block the page, so a user can interact with the feed and switch repos while the inspector is open. That is intended for an inspector but means P3 and P1 can both be open and both mutate shared scroll state.
- **Three concurrent overlays are reachable at once**: bottom drawer (P1) + Bead drawer (P3) + Operations drawer (P5) from `/console/operations`. `VERIFIED` by call graph: `Operations.tsx:217` calls `beadSideDrawer.open(...)` while P5 is open; P1 is always mounted in `MainPane`.
- Layering is **not** a single ordered scale: `40 → 49 → 50 → 50 → 55 → 900/901 → 1000`. P3's backdrop and P2's panel share `z-index: 50` — the P2 panel wins by DOM order alone (`App.tsx:57` before `:58`). `INFERENCE`: if P2 were ever made reachable while P3 is open, stacking would be DOM-order-dependent and fragile.

### B.3 Resize implementations are duplicated five times

| Shell | Mechanism | Clamping | Cancel handling |
|---|---|---|---|
| P1 | `mouse` on document (`BottomDrawer.tsx:57-76`) | `setDrawerHeight` clamps `[120, innerHeight-24]` (`shell.ts:165-171`) | none; only `mouseup` once |
| P2 | `pointer` + pointer capture + 4 cancel listeners (`RightSidebar.tsx:171-205`) | `setSidebarWidth` clamps `[320, min(740, vw-56)]` (`shell.ts:214-222`) | full cleanup |
| P3 | `pointer` + pointer capture + document fallback (`BeadSideDrawer.tsx:90-110`) | `clampDrawerWidth` → `[min(420,vw), vw*0.78]` (`:201-206`) | only `mouseup`/`pointerup`; no cancel |
| P4 | `pointer` capture (`ProgrammeEntityDrawer.tsx:64-76`) | `setWidth` clamps `[360,720]` (`programme-drawer.ts:45`) | none |
| P5 | none | — | — |

Every one of these is a hand-rolled re-implementation. There is no shared `useResizable` hook anywhere in the tree.

### B.4 Keyboard handling

| Shell | Key | Scope | Handler |
|---|---|---|---|
| P1 | `Ctrl/Cmd+J` toggle | `window` | `MainPane.tsx:30-39` |
| P2 | `Escape` | `window`, only while `sidebar.open` | `RightSidebar.tsx:15-22` |
| P3 | `Escape` | `document`, registered whenever `beadId` set | `BeadSideDrawer.tsx:75-88` |
| P4 | `Escape` | `window`, while `nodeId` set | `ProgrammeEntityDrawer.tsx:46-52` |
| P5 | none | — | `OperationsDrawer` has no key handler (`Operations.tsx:200-237`) |
| P6 | `Escape` + `Tab` focus trap | `document` + `body` scroll lock | `IssueOverlay.tsx:23-57` |

`VERIFIED` defect: P3's and P4's `Escape` handlers are **uncoordinated**. If both are open, both fire on one keypress; there is no top-of-stack arbitration. P5 has no `Escape` at all. `VERIFIED` defect: only P6 implements a focus trap and `aria-modal`; P3 declares `role="complementary"` (`:134`) rather than `role="dialog"`, while P4 declares `role="dialog"` without `aria-modal` (`ProgrammeEntityDrawer.tsx:83`).

### B.5 Where drawer state is stored

| State | Location | Persisted |
|---|---|---|
| `drawerOpen` / `drawerHeight` / `drawerTab` / `drawerSpecialistsScope` | `stores/shell.ts:54-60,159-183` | `localStorage` — `forge-gud9:*` |
| `sidebar.open/beadId/jobId/width` | `stores/shell.ts:61-62,185-222` | `localStorage` — `forge-70el:*` |
| Bead inspector target, tab, back stack, `issueById`, `memories`, `projectId` | `hooks/useBeadSideDrawer.ts:33-83` | in-memory (module zustand) — **resets on reload** |
| Programme drawer target / width | `programme-drawer.ts:27-47` | in-memory |
| Operations drawer target | local `useState` | in-memory |
| IssueOverlay | local props | in-memory |

`VERIFIED` defect: **two separate bead inspector state models coexist** (`useShellStore.sidebar` for P2 and `useBeadSideDrawer` for P3) with disjoint fields and different persistence. Neither can open the other.

### B.6 Reusable drawer mechanics (with paths)

| Mechanic | Path | Reuse verdict |
|---|---|---|
| Back-stack + reopen-last + tab state machine | `hooks/useBeadSideDrawer.ts:33-88` | **EXTRACT_REUSE** — the shape is right; must be made project-context-independent |
| Portal + backdrop + width clamp + pointer-capture resize pattern | `pages/console/BeadSideDrawer.tsx:90-206` | **EXTRACT_REUSE** into one shared primitive |
| Focus trap + `aria-modal` + scroll lock + focus restore | `components/beads/IssueOverlay.tsx:17-57` | **EXTRACT_REUSE** — this is the only correct a11y implementation in the codebase |
| Local max/restore toggle without persisting maximized height | `components/shell/BottomDrawer.tsx:20-27,78-93` | **EXTRACT_REUSE** pattern |
| Horizontal pointer-capture resize with cancel listeners | `components/shell/RightSidebar.tsx:171-205` | **EXTRACT_REUSE** as the reference implementation (most complete cleanup) |
| Tab-bar + icon-button chrome | `components/shell/BottomDrawerTabBar.tsx:1-28` | **ADAPT** |
| Scoped specialists tab inside a drawer | `components/beads/SpecialistsTabPanel.tsx:13` | **ADAPT** |

---

## 4. Area C — Program (governance)

### C.1 What it is

Program is a **commit-pinned read-only projection of an external GitHub repository**, not a view over executable work.

- Source: `mercuryintelligence/program`, branch `master` (`apps/console/src/server/programme/source.ts:11-13`), fetched through the Contents + Commits REST API with a 3 s timeout (`source.ts:10,34-56`).
- Every snapshot build resolves the branch to one immutable SHA first (`source.ts:89-94,146-149`) and pins all reads (`read`, `listDir`, `recentCommits`, `timestamp`, `recentCommitsForPath`) to that SHA (`source.ts:108-138`).
- Parser: `read-model.ts` parses Markdown + YAML frontmatter into workstreams, assignments, governed items (`RESEARCH-*`, `ADR-*`, `PROP-*`), agents, a graph, state records, journals, and publication facts (`read-model.ts:216,256,321,353,383,441,468,969,1011`).
- Identity vocabulary is Mercury's, not xtrm's: `WS-\d+`, `OPS-\d+`, `EXP-\d+`, `RESEARCH-\d+`, `PROP-\d+`, `ADR-\d+`, `ISSUE-\d+` (`read-model.ts:82-84`).
- Route: `apps/console/src/server/programme/route.ts:58`, mounted at `/api/programme` (`routes/index.ts:139`), gated at runtime by `MERCURY_PROGRAMME_DASHBOARD_ENABLED === "1"` (`routes/index.ts:141`, `route.ts:63,166-169`).
- Caching: module-local `CacheEntry` with 5 min TTL, stale-while-revalidate background refresh, fail-closed to last-good with `freshness: "degraded"` (`route.ts:34,69-72,119-139,182-192`).
- UI: `pages/console/programme/Programme.tsx:9` with 14 views (`Programme.tsx:23-27`), graph shell `ProgrammeGraph.tsx`, drawer `ProgrammeEntityDrawer.tsx`, changes `ChangesView.tsx`, and an AI prompt-bundle builder `ContextBuffer.tsx`.

### C.2 Does it duplicate executable work state? — No.

| Executable concern | Program's stance | Evidence |
|---|---|---|
| Beads / board state | explicitly excluded from the model | `read-model.ts:1003` — `evidence_boundary.beads = "not inferred: repository-local Beads require a fresh local read or governed board-audit transport"` |
| Runtime / deployment state | explicitly excluded | `read-model.ts:1004` |
| Jira live status | build-time references only; live read optional and out of band | `read-model.ts:1005` |
| Specialist jobs / evidence refs | never referenced — no `specialist_jobs`, no `xtrm_evidence_refs` access | `VERIFIED` by grep |
| XTRM mutation receipts | declared absent | `read-model.ts:950-967` `provenance.current.xtrm_mutation_receipts: false`, with `live_receipt_gate: "ISSUE-87 plus an accepted canonical XTRM identity/provenance contract"` |
| Actor / principal identity | forced to `"UNKNOWN"` on every publication record | `read-model.ts:837-838,937-938` |
| Programme entity vs executive work item | distinct id spaces (`WS-008` vs `forge-eorh.70`); no join exists | `VERIFIED` |

`INFERENCE`: the only conceptual overlap is that both Program assignments and Beads issues describe "work". They share no key, no state enum, and no store. Program is therefore safe to keep as an independent read model.

### C.3 What Program currently owns vs what it should only reference

**Currently owns (correct):**
- The Mercury programme document graph and its identity space.
- The evidence-boundary doctrine for that external source.
- The `state` / `journal` / `publication` authority split (`read-model.ts:1019-1025` `state_history_semantics`) — this is a genuinely reusable governance primitive.
- The commit-pinned provenance envelope (`provenanceFrom`, `read-model.ts:949-967`).

**Currently owns but should only reference:**
- **`ProgrammeNode.source_path` → file revisions** (`route.ts:238-267`). The `/revisions` endpoint resolves entity-level change history through `recentCommitsForPath`, guarded so that only admitted source paths are accepted. This is a *GitHub* capability re-implemented inside the Program route. It should become a caller into the shared GitHub read adapter.
- **Repo-file reads** — `fetchRepoFile` / `listRepoDir` (`source.ts:5,109,114`) come from `packages/core/src/github/readme.ts`. Program already *references* the shared GitHub adapter for transport (`VERIFIED` — good, keep it) but owns a private caching/TTL/health layer (`route.ts:24-29,119-151`) that duplicates the shape of `useDashboardResource` on the client and `materialization_state` on the server.
- **The AI context bundle** (`ContextBuffer.tsx:280`) is generated client-side from programme nodes and hardcodes disclaimers about Beads/Jira/runtime. This is a presentation concern leaking a governance contract into a UI file.

**Should only reference (never own):**
- Beads / Substrate issue state → reference by an opaque external key only, never by duplicating rows.
- Specialist execution state → not referenced at all today; keep it that way unless a governed join table is introduced.
- GitHub repo file content → reference through the shared adapter.

### C.4 Reusable read model / projection

**EXTRACT_REUSE:**
- `ProgrammeSource` / `ObservableProgrammeSource` interface (`source.ts:21-32`) — a clean pin/atRef/commitAtOrBefore abstraction over an immutable snapshot source. This is the correct contract for any commit-pinned read model.
- Snapshot cache semantics (`route.ts:24-29,115-151`): `fresh` / `stale` / `degraded`, background refresh without blocking, fail-closed to last good, plus `assertNoDanglingEdges` (`read-model.ts:1036-1042`) as a build-integrity gate.
- `provenanceFrom` (`read-model.ts:949`) and `state_history_semantics` (`read-model.ts:1019-1025`) as a **generic evidence-class doctrine** — source-of-truth precedence, journal authority, publication separation, and unsafe-nested-relationship suppression. This is governance policy that Console v2 should apply to its own read models, not Program-specific trivia.

**REPLACE:**
- 1 043-line `read-model.ts` parsing Markdown/YAML by regex (`ISSUE_RE`, `STATUS_RE`, `FM_RE`, `WORDS`) — the parser is fragile (`INFERENCE`: regex-driven YAML frontmatter parsing with a hand-rolled `parseYaml` at `read-model.ts:98`), and it is coupled to Mercury's file layout. If Program survives Console v2, the parser should move to a typed schema plus a single fixture-backed contract test.
- `ContextBuffer.tsx` prompt assembly (`:280`) — belongs in a governance service, not a React component.

**`VERIFIED` minor defects:**
- `Programme.tsx:2` header comment says "13 views"; the `VIEWS` array at `:23-27` has 14.
- `/api/programme/changes` (`route.ts:197-207`) is process-local `previous` state; it is documented as *not* "last visit" (`route.ts:195-196`) but the client must reconstruct a browser last-visit baseline (`useProgrammeData.ts:27-49`), so two processes produce different change summaries.

---

## 5. Area D — Graph, Observability, Specialists

### D.1 Graph surface

| Aspect | Finding | Evidence |
|---|---|---|
| Implementation | Per-connected-component `ReactFlow` viewport inside a CSS-grid outer shell. Each `<ClusterPane>` mounts its own `ReactFlowProvider` + `ReactFlow`. | `Graph.tsx:153-230` |
| Libraries | `@xyflow/react` ^12.10.2 for rendering; `@dagrejs/dagre` ^1.1.4 for LR layout of structural edges | `apps/console/package.json:42,51`; `buildFlowGraph.ts:11,38-40` |
| Node shape | custom `beadNode`; 4 handles per node; fixed `NODE_W = 260`, `NODE_H = 44` | `Graph.tsx:33`; `buildFlowGraph.ts:16-17` |
| Edge shape | custom `custom` edge with relative-position handle selection | `Graph.tsx:34`; `buildFlowGraph.ts:4-6` |
| Data source | `GET /api/console/graph?project_id=…&include_closed=false` → `readXtrmGraphSnapshot` over `substrate_issues` + `substrate_issue_edges` + specialist job join | `useGraphData.ts:20`; `routes/graph.ts:59`; `read-models/graph.ts:77` |
| Project scoping | `selectedRepo.beadsProjectId` — **Beads-project-scoped, not a global execution graph** | `Graph.tsx:38-45` |
| Freshness | `fresh` / `stale` / `degraded` from `materialization_state`; stale triggers a 750 ms retry | `useGraphData.ts:6-7,11`; `read-models/graph.ts` source-health derivation |
| Cost / quality | **Cost is the main concern.** N `ReactFlow` instances, N `dagre` layout passes, and one `<Controls>` per pane. `Graph.tsx:143-160` deliberately packs ≤3-node clusters two per row and sizes each pane to `flow.height + 24` (floor 120) so the *page* scrolls. Toggling parent-child / related / deferred changes edge count and remounts the flow via `flowKey` (`:172`) to force `fitView` — meaning a full relayout + remount on every toggle. | `Graph.tsx:143-172`; `buildFlowGraph.ts:38` |
| Interaction | Node/orphan click → `beadSideDrawer.open` | `Graph.tsx:356`; `nodes/BeadNode.tsx:69` |
| Dead / hidden affordances | `Foot` advertises `p`/`r`/`d` keyboard hints (`Graph.tsx:427-434`) but no keydown listener implements them — only the header toggle buttons work. `Graph.tsx` has no `onKeyDown` handler. | `Graph.tsx:427-434` vs `Graph.tsx:96-107` |

**Quality defect (`VERIFIED`):** the graph opens the bead drawer with no `projectId` (`openGraphNode`, `Graph.tsx:353-363` → `beadSideDrawer.open({beadId, jobId, issue})`). `graphNodeToIssue` sets `project_id: ""` and blank timestamps (`:365-381`). Combined with `BeadSideDrawer.tsx:54` (`if (!beadId || !projectId) return;`), **every graph-initiated inspector open renders with no detail data.** The same applies to `GraphNode → Specialists → Operations` paths that pass no project context, while `BeadsRepoView` (feed tab only) is the sole supplier.

### D.2 Observability surface

| Aspect | Finding | Evidence |
|---|---|---|
| What it shows | 12 fixed aggregate tables: tokens, cache hit rate, per-specialist averages, active runtime, reliability, slowest jobs, tool usage, reviewer outcomes, context burn, stalls, chain histogram, plus a 12th `Beads Dolt repair` table | `Observability.tsx:50-61,72-99` |
| Data source | `GET /api/console/observability/summary?range=7d\|30d\|all` → `createMetricsDao(...).summary(range)` | `hooks/useObservabilitySummary.ts:8`; `routes/observability.ts:19-31` |
| Backing tables | `specialist_jobs`, `specialist_job_metrics`, `specialist_results` (presence-gated at `routes/observability.ts:58-64`), written by the **observability materializer** from per-repo DBs ATTACHed by `createAttachPool` | `observability-adapter.ts:434`; `attach-pool.ts`; `metrics-dao.ts` |
| Coverage / health | Reports `coverage.skipped[]`; any skips downgrade `source_health.status` to `degraded` | `routes/observability.ts:21-30,52-54` |
| Durable evidence? | **No.** It holds rollups only. Raw evidence lives in `xtrm_forensic_events` / `xtrm_evidence_refs` and is reachable only through `/api/specialists/jobs/:job_id/feed-events` and `/feed` | `feed-read-model.ts:79-121`; `read-models/specialists.ts:124` |
| Live status? | Only the shell-provider banner (`/api/console/shell/status`, `Observability.tsx:18`) and the Beads Dolt repair table (`:25-39`). Everything else is windowed historical aggregate. | `Observability.tsx:13-39` |
| Beads leakage | Table 12 is a Beads Dolt repair table driven by `/api/substrate/projects/:id/connection` + `/repair-actions` | `Observability.tsx:25-39,72-99` |
| Presentation | Styling is inline `CSSProperties` constants, not the shared stylesheet | `Observability.tsx:133-143` (11 inline style objects) |

**`VERIFIED` defects:**
- Table 12 renders `action.command` — an operator-facing shell command string — as a table cell (`Observability.tsx:92`). This exposes Dolt repair commands to any reader of the observability page; the actions are *described*, not executed, so this is disclosure rather than RCE.
- Table 12's `degraded` filter (`Observability.tsx:73`) falls back to rendering **all** rows when nothing is degraded, so the table silently changes meaning based on data.
- `/api/console/observability` is registered whenever `db` or `observabilityDao` exists (`routes/index.ts:130-132`) with **no auth gate**, unlike `/api/internal/*`.

### D.3 Specialists

| Aspect | Finding | Evidence |
|---|---|---|
| Primary surface | Page-level two-pane cockpit at `/console/specialists`: list pane of `ChainCard`s + `ChainDetailPane` detail pane | `Specialists.tsx:71-109` |
| Secondary surfaces | Bottom drawer tab (`BottomDrawerTabBar.tsx:10` → `SpecialistsTabPanel`), drawer Activity tab, drawer Evidence tab, `ChainDetailPane` links | `BottomDrawer.tsx:52`; `SpecialistsTabPanel.tsx:13`; `BeadSideDrawer.tsx:229,231` |
| Drawer? | **No specialist-specific drawer shell.** Navigating to a specialist chain opens the *bead* drawer with `tab: "activity"` | `Specialists.tsx:96-101`; `SpecialistsTabPanel.tsx:42` |
| Data model | `SpecialistJob` rows from `specialist_jobs` joined to `substrate_job_link` on `(repo_slug, job_id)`, with token usage; plus `xtrm_forensic_events` and `xtrm_evidence_refs` for activity/evidence | `read-models/specialists.ts:83,90,97,104,111,124` |
| Routes | `GET /api/specialists/jobs`, `/jobs/:id/result`, `/jobs/:id/feed-events`, `/jobs/:id/feed`, `/jobs/in-flight`, `/chains/:chain_id` | `routes/specialists.ts:116,135,145,156,167,207` |
| Control | `POST /api/console/specialists/jobs/:job_id/{stop,steer,resume}` | `routes/specialists-control.ts:45,59,72` |
| Config | `GET /api/specialists/config`, `PATCH /user`, `PATCH /console` | `routes/specialists-config.ts:86,126,160` |
| Chain aggregation | Client-side grouping of jobs into chains; `chainId` is the grouping key | `hooks/useChains.ts:11-30`; `Specialists.tsx:30` |
| Polling | 5 s poll for chains and activity; in-flight jobs poll fast-then-slow (`POLL_FAST_MS = 0`, `POLL_SLOW_MS = 5000`) | `useChains.ts:9`; `BeadActivityPane.tsx:23`; `useInFlightJobs.ts:12-13` |

**`VERIFIED` defect:** the drawer's `evidence` tab is labelled "Evidence" but renders only `history.jobs` (`BeadSideDrawer.tsx:297-323`). No `xtrm_evidence_refs` or forensic envelope is rendered anywhere in the drawer. The empty-state copy (`:299`) promises "Terminal feeds, run results, forensic events, and evidence refs" — only run results arrive.

---

## 6. Capability matrix

| capability | current owner path:line | backend/data source | quality/current defects | disposition | target Console v2 surface |
|---|---|---|---|---|---|
| Beads materializer (adapter) | `packages/core/src/materializer/beads-adapter.ts:51` | Dolt wire / `issues.jsonl` snapshot → `substrate_issues`, `substrate_dependencies`, `substrate_issue_edges` | Correct single-writer design; `repo_slug` column actually carries the Beads project id; `deriveRuntimeKind`/`extractContract` regex over description | `EXTRACT_REUSE` | Generic `MaterializerAdapter` registration keyed by source, with a Beads-specific adapter loaded as a plugin |
| Materializer engine / scheduler | `packages/core/src/materializer/materializer.ts:29`; `materializer/queue.ts:19,82` | in-process, one SQLite writer | Concurrency 2 / pending 8 may be low for many projects (`INFERENCE`); forensic-event write on every run; `sourceKey.startsWith` string parsing drives channel selection (`materializer.ts:105,156-166`) | `EXTRACT_REUSE` | Same engine; replace string-prefix channel dispatch with an adapter-declared channel map |
| Materializer health / cursor | `materialization_state` (`database.ts:290-299`) | SQLite | Per-source `last_status`/`last_error` drives source health (`substrate.ts:54-68`) | `PRESERVE_AS_IS` | Shared source-health panel |
| Issue feed API | `packages/core/src/state/feed-read-model.ts:43`; `routes/feed.ts:8` | union of `xtrm_forensic_events` + `substrate_issues` + `github_events` | Cursor pagination is sound; `readBeadsRows` orders ASC but the branch-limited `LIMIT` can starve newer rows beyond the window; severity is always `info` for beads rows | `ADAPT` | One global activity feed, source-agnostic, with per-source freshness pills |
| Issue feed UI | `components/beads/IssueFeed.tsx:72` | `/api/substrate/projects/:id/issues` + `/closed` | 1 017 lines; 3 overlapping filter/sort/group pipelines in one component; heavy `logClientEvent` instrumentation on every render path | `ADAPT` | Row/list primitive + shared dossier; filter/sort/group extracted to pure functions |
| Beads-specific UI views | `components/beads/BeadsRepoView.tsx:141`; `TriagePanel:620`; `MemoriesPanel:540` | `/api/substrate/*` | `BeadsRepoView` loads everything and owns drawer context; `TriagePanel`/`MemoriesPanel` live inside a 737-line file | `ADAPT` | Module views over a neutral work-item read model; context pushed to a shared inspector, not owned by the feed |
| Dead Beads views | `components/beads/{KanbanBoard,StatusColumn,BeadCard}.tsx` | — | zero production importers (`VERIFIED`) | `DELETE_AFTER_CUTOVER` | none |
| Beads issue-overlay modal | `components/beads/IssueOverlay.tsx:19` | props from `BeadsRepoView` | third inspector presentation for the same entity; correct focus-trap implementation to salvage | `REPLACE` | Fold into the canonical drawer; extract the focus trap first |
| Bead drawer | `pages/console/BeadSideDrawer.tsx:28`; `hooks/useBeadSideDrawer.ts:33` | `substrateApi.getIssue`, `useSpecialistOwnership`, `useSpecialistHistory` | Requires feed-mounted context (`projectId`); fabricates lineage data (`:368-385`); `github` tab permanently empty (`:233`); `evidence` tab renders jobs not evidence (`:297`); no focus trap; `role="complementary"` not dialog | `ADAPT` | The one canonical global drawer: entity-typed, context-independent, project resolved from the entity itself |
| Right sidebar (orphan shell) | `components/shell/RightSidebar.tsx:9`; `stores/shell.ts:185-222` | `BeadActivityPane` | **zero production openers**; mounted anyway (`App.tsx:57`); rehydrates from localStorage; second bead-inspector state model | `DELETE_AFTER_CUTOVER` | none |
| Bottom drawer | `components/shell/BottomDrawer.tsx:13`; `BottomDrawerTabBar.tsx:1` | logs WS, specialists, terminal WS | Parallel to the canonical drawer; `Ctrl/Cmd+J` only; maximize state not persisted (`:20-27`); `onClearLogs` is a no-op (`:49`) | `ADAPT` | One drawer with a docked/tabbed variant instead of a second independent shell |
| Programme entity drawer | `pages/console/programme/ProgrammeEntityDrawer.tsx:25`; `programme-drawer.ts:27` | `/api/programme` snapshot | Fourth drawer design, third resize impl, its own z-index band (900/901); read-only is correct | `REPLACE` (shell) / `ADAPT` (tab content) | Render programme entities through the canonical drawer with a programme tab set |
| Operations drawer | `pages/console/Operations.tsx:200` | local state | Fifth shell, no resize, no `Escape`, bespoke `z-index: 55` | `REPLACE` | Canonical drawer |
| Drawer resize/clamp mechanics | `BottomDrawer.tsx:57`; `RightSidebar.tsx:171`; `BeadSideDrawer.tsx:90`; `ProgrammeEntityDrawer.tsx:64` | — | Four hand-rolled implementations; two lack cancel handling | `EXTRACT_REUSE` | One `useResizablePanel` + one `<Drawer>` primitive |
| Graph — data read model | `packages/core/src/state/read-models/graph.ts:77`; `routes/graph.ts:56` | `substrate_issues` + `substrate_issue_edges` + specialist join | Tolerates missing cross-domain records (documented invariant); project resolution falls back to first active Beads source when the id is unknown (`read-models/graph.ts:58-76`) | `EXTRACT_REUSE` | Shared graph read model, project resolved from an explicit selector |
| Graph — rendering | `pages/console/Graph.tsx:27`; `graph/buildFlowGraph.ts:1` | `@xyflow/react` 12 + `@dagrejs/dagre` 1.1 | One ReactFlow instance per cluster; full relayout+remount on each toggle; advertised `p`/`r`/`d` keys unimplemented; opens drawer without project context | `ADAPT` | Rows/explicit project scope; free user-provided project ids must not become an implicit "first Beads source" |
| Program read model | `apps/console/src/server/programme/read-model.ts:969`; `source.ts:80`; `route.ts:58` | external GitHub `mercuryintelligence/program@master`, pinned SHA | 1 043-line regex Markdown/YAML parser; process-local `previous` snapshot makes `/changes` non-deterministic across processes; header comment vs 14 actual views | `PRESERVE_AS_IS` (data + contract) / `ADAPT` (parser) | Independent, commit-pinned governance read model; never merged with Substrate state |
| Program file-revision history | `route.ts:238-267` | GitHub commits-by-path | Re-implements a GitHub read capability inside a governance route | `EXTRACT_REUSE` (into shared GitHub adapter) | Shared repo-history service |
| Program context bundle | `programme/ContextBuffer.tsx:280` | programme nodes | Governance disclaimers hardcoded in a React component | `ADAPT` | Governance service producing the bundle |
| Observability metrics | `routes/observability.ts:14`; `packages/core/src/observability/metrics-dao.ts` | ATTACHed repo DBs → `specialist_jobs`, `specialist_job_metrics`, `specialist_results` | Unauthenticated route; coverage-driven degraded status is good; rollups only, no evidence drilldown | `EXTRACT_REUSE` | Shared metrics read model; add evidence drilldown via the cabinet/evidence tables |
| Observability Beads Dolt repair | `Observability.tsx:72-99`; `substrate-project-service.ts:63` | `/api/substrate/.../connection` + `/repair-actions` | Renders operator shell commands as table cells; all-rows fallback when nothing is degraded | `REPLACE` | Move to a source-health / operations surface, not the metrics page |
| Observability presentation | `Observability.tsx:133-143` | — | 11 inline style objects instead of shared tokens | `REPLACE` | Shared table primitive |
| Specialists page | `pages/console/Specialists.tsx:16`; `specialists/ChainDetailPane.tsx` | `specialist_jobs` + `substrate_job_link` + forensic + evidence tables | Client-side chain aggregation; 5 s polling; poll cadence depends on WS hints | `ADAPT` | Preserve two-pane cockpit; move chain grouping server-side |
| Specialists in drawer | `components/beads/SpecialistsTabPanel.tsx:13`; `BeadSideDrawer.tsx:229,231` | `useInFlightJobs`, `useSpecialistHistory` | No specialist drawer shell (correct); but "Evidence" tab misrepresents jobs as evidence | `ADAPT` | Drawer tab that renders real `xtrm_evidence_refs` + forensic envelopes |
| Specialist control | `routes/specialists-control.ts:45,59,72` | host control plane | stop / steer / resume | `PRESERVE_AS_IS` | same |

---

## 7. Beads → Substrate migration classification

| # | Beads-specific code area | Path | Classification | Reason |
|---|---|---|---|---|
| 1 | Table names `substrate_issues` / `substrate_dependencies` / `substrate_issue_edges` / `substrate_job_link` | `packages/core/src/state/database.ts:148-191,270-278` | `RETAIN_TEMPORARILY` | Already Beads-neutral in name and shape. Renaming churns every read model for no semantic gain. |
| 2 | `repo_slug` column carrying a Beads project id | `beads-adapter.ts:176`; every `substrate_*` query | `ADAPT` | The column name is wrong for its content. Substrate should name the partition explicitly (`project_id` or `source_id`) so a Beads project and a git repo cannot be confused. |
| 3 | Source key prefix `beads:<projectId>` | `runtime-lifecycle.ts:167,190`; `materializer.ts:161-164,185`; `read-models/graph.ts:63-72`; `beads-adapter.ts:156` | `ADAPT` | Must become a declared, adapter-owned source identity rather than a hardcoded string prefix parsed by `startsWith` in five places. |
| 4 | `sources.kind = 'beads'` | `runtime-lifecycle.ts:169`; `substrate.ts:50`; `read-models/graph.ts:63-68` | `RETAIN_TEMPORARILY` | Value is consumed by source-health and project listing. Migrate to a typed `source_kind` enum with a Beads member; do not delete until Substrate declares its own kind. |
| 5 | `BeadsAdapter` + `MaterializerBeadIssue` + `BeadsAdapterPorts` | `materializer/beads-adapter.ts:10-54` | `ADAPT` | Correct adapter shape. Rename to a Substrate-neutral adapter contract, keep the Beads field mapping inside the adapter. |
| 6 | `normalizeIssue` — Beads→Substrate field mapping | `beads-adapter.ts:167-200` | `ADAPT` | This is exactly the right place for Beads knowledge. Must stay behind the adapter boundary. |
| 7 | `deriveRuntimeKind` / `extractContract` / `buildMetadataJson` — label+description heuristics | `beads-adapter.ts:222-246` | `ADAPT` | Inference from `kind:` labels, `edge:` labels, and `<change-contract>`/`<step-contract>` XML embedded in a description. `INFERENCE`: this is fragile string archaeology; it should be an explicitly-versioned extraction rule set with fixtures, not inline regex. |
| 8 | `changesSince` snapshot-hash cursor + `snapshotDiff` | `beads-adapter.ts:56-77`; `materializer/snapshot-diff.ts` | `PRESERVE_AS_IS` | Content-hash cursoring is source-agnostic and already correct. |
| 9 | `write` vs `writeFull` tombstone split | `beads-adapter.ts:79-101,131-139` | `PRESERVE_AS_IS` | The delta/resync split with an explicit anti-cross-project-wipe comment is the most valuable invariant in the file. Do not "simplify" it. |
| 10 | Dolt wire read (`DoltClient`, mysql2) | `state/dolt-client.ts:16`; `runtime-lifecycle.ts:201-221` | `READ_ONLY_COMPATIBILITY` | External system contract. Must remain read-only from Console's side. |
| 11 | JSONL fallback read | `state/beads-jsonl-reader.ts:21`; `runtime-lifecycle.ts:222-226` | `READ_ONLY_COMPATIBILITY` | Degraded-readable path. Keep; surface the swallowed error as source health instead of `[]`. |
| 12 | `BeadsReader` for memories + interactions | `state/beads-reader.ts:28`; `substrate.ts:98,116` | `ADAPT` | Live per-request filesystem reads of `knowledge.jsonl` / `interactions.jsonl`. These should be materialized like issues, or explicitly declared as a non-materialized live source, not silently read on each request. |
| 13 | `bd` CLI write path | `routes/beads-write.ts:73,442-500` | `ADAPT` | Correct architecture (Console never writes the Beads store directly). Two fixes required: never fall back to a possibly-stale `substrate_issues` read for the mutation response, and trigger materialization after a successful mutation. |
| 14 | `ProjectScanner` / `UnifiedScanner` / `beads-watcher` / `beads-parity` | `runtime/project-scanner.ts:18`; `runtime/unified-scanner.ts:43`; `runtime/beads-watcher.ts`; `runtime/beads-parity.ts:39` | `READ_ONLY_COMPATIBILITY` | All three are discovery/observation of an external system. They are Console-v2-compatible as adapters. Parity harness is debug-only and stays gated. |
| 15 | `packages/core/src/types/beads.ts` `BeadIssue` | `packages/core/src/types/beads.ts:31` | `ADAPT` | This is the external-system DTO. It must not be the UI's domain type. |
| 16 | `apps/console/src/types/beads.ts` duplicate `BeadIssue` | `apps/console/src/types/beads.ts:33` | `REPLACE` | Drifted duplicate of #15 with no shared source. Console v2 should define its own neutral work-item type and map from #15 at the adapter boundary. |
| 17 | `BeadDependency` relation string union | `packages/core/src/types/beads.ts:70`; `apps/console/src/types/beads.ts:70` | `ADAPT` | 12 relation names (`blocks`, `blocked_by`, `tracks`, `related`, `relates-to`, `parent`, `parent-child`, `discovered-from`, `until`, `caused-by`, `validates`, `supersedes`) are Beads vocabulary carried verbatim into `substrate_dependencies.relation`. Normalize to a Substrate edge-kind enum at the adapter. |
| 18 | UI type barrel re-exporting Beads types | `dashboard/lib/beads.ts:1-21` | `REPLACE` | The single UI import surface currently *is* the Beads domain. Replace with the neutral work-item surface. |
| 19 | `substrateApi` client | `dashboard/lib/substrate-api.ts:65` | `ADAPT` | Method names (`listIssues`, `createIssue`, `closeIssue`) are neutral already; the return types are not. Keep the client shape, retype the payloads. |
| 20 | `/api/substrate/*` route namespace | `routes/index.ts:54-59`; `routes/substrate.ts:31-43` | `PRESERVE_AS_IS` | Namespace is already neutral. Payload shape needs retyping (#16, #19), not renaming. |
| 21 | `/api/internal/substrate/schema` | `routes/internal-substrate.ts:8` | `RETAIN_TEMPORARILY` | Raw `PRAGMA table_info` + column-fill diagnostics. Operational tooling, localhost-gated. Keep until Substrate ships its own diagnostics. |
| 22 | `/api/internal/dolt-health` stub | `routes/internal-dolt-health.ts:9` | `RETAIN_TEMPORARILY` | Returns a static `ok` and points elsewhere. Harmless; retire with the Dolt repair surface. |
| 23 | Beads Dolt connection + repair actions | `state/substrate-project-service.ts:32,63` | `REPLACE` (surface) / `RETAIN_TEMPORARILY` (probe) | The probe is useful diagnostics. The operator-command table in the metrics page is not an Observability concern. |
| 24 | `bridge-retirement.ts` `beads-substrate-projection` bridge | `state/bridge-retirement.ts:38-46` | `ADAPT` | This manifest is the existing, authoritative retirement classification. Console v2 must update it rather than create a parallel migration list. |
| 25 | `read-models.ts` `droppableBridgeFields` for substrate | `state/read-models.ts:50` | `PRESERVE_AS_IS` | `runtime_kind`, `formula_name`, `template_name`, `contract_kind`, `contract_xml` are already flagged as droppable bridge fields. That is the correct disposition and the correct mechanism. |
| 26 | Dead Beads views (`KanbanBoard`, `StatusColumn`, `BeadCard`) | `components/beads/{KanbanBoard,StatusColumn,BeadCard}.tsx` | `DELETE_AFTER_CUTOVER` | Zero production importers. |
| 27 | `beads:mutated` DOM custom event | `BeadMutationPanel.tsx:11`; `KanbanBoard.tsx:68,76`; `BeadsRepoView.tsx:279` | `REPLACE` | A DOM-level global event bus for cache invalidation. Console v2 should use the store/query-cache invalidation primitive already present (`useDashboardResourceInvalidation`). |
| 28 | `beads.feed.*` / `bead.*` / `right_sidebar.*` client telemetry | `BeadsRepoView.tsx` (9 call sites); `shell.ts:192-219` | `ADAPT` | Useful observability, but it is one-shot "visible issue/chip" telemetry that references a component name. Rename against the Console v2 surface names. |
| 29 | `.bead-*` CSS class namespace in the single global stylesheet | `styles/globals.css:3455-4590,5119` | `ADAPT` | Class names are Beads-flavoured but tied to the shared drawer primitive. Rename on the drawer extraction. |

### Where dual-write must NOT be introduced

**Rule:** `substrate_issues`, `substrate_dependencies`, `substrate_issue_edges` have exactly one writer — `packages/core/src/materializer/beads-adapter.ts`. Do not add another.

Concretely, dual-write must **not** be introduced at any of these points:

1. **`apps/console/src/server/routes/beads-write.ts:313-357` (`runIssueMutation`).** Do not "optimistically" write the mutation result into `substrate_issues` to hide materializer latency. `VERIFIED`: today the only write is `bd` + a re-read (`:409-441`). Keep it that way; instead trigger materialization after success.
2. **Any Beads-native UI query path.** Do not add a second read that bypasses the projection. `VERIFIED`: `/api/substrate/*` reads only `substrate_*` for issues, plus live fs for memories/interactions (#12).
3. **`BeadsAdapter.write()` (`:79-89`).** Do not re-enable `tombstoneMissing` here. The comment at `:83-88` records a real cross-project data-loss bug.
4. **A future Substrate write API.** If Substrate becomes its own writer of executable work state, Beads must become a *source adapter* and the Console must never write both. The `bd` CLI write path (#13) is the pattern to generalize: Console mutates the authoritative system and then materializes.
5. **`substrate_job_link`.** Written only by the observability materializer. A Beads-side write of the same link would create a second authority for job↔bead correlation.

**`VERIFIED` single-writer evidence:** grep for `INSERT INTO substrate_issues|UPDATE substrate_issues|DELETE FROM substrate_issues|INSERT INTO substrate_dependencies|INSERT INTO substrate_issue_edges` across `apps/` and `packages/` returns exactly `packages/core/src/materializer/beads-adapter.ts` (lines 104, 116, 118, 135) plus one test fixture. No production dual-write exists today.

---

## 8. Drawer contract findings

**Rule under test (from the XTRM target, restated):** there must be **one canonical global drawer**. No feature-specific drawer shells.

### 8.1 Does the current Console violate it? — Yes, in five ways.

**V1 — Three independent, concurrently-mountable drawer shells.**
- `pages/console/BeadSideDrawer.tsx:28`
- `pages/console/programme/ProgrammeEntityDrawer.tsx:25`
- `pages/console/Operations.tsx:200`
Each has its own portal, its own resize logic, its own close semantics, and its own tab model. All three can be open simultaneously: P1 bottom drawer + P3 bead drawer + P5 operations drawer is reachable from `/console/operations`, because `Operations.tsx:217` opens P3 from inside P5 and P1 is always mounted (`MainPane.tsx:91`).

**V2 — A fourth drawer-shaped shell that is dead but still mounted.**
- `components/shell/RightSidebar.tsx:9`, mounted at `App.tsx:57`.
- `useShellStore.openSidebar()` has **zero production callers** (`VERIFIED` by grep over `apps/console/src`; the only hits are `apps/console/tests/dashboard/components/shell/RightSidebar.test.tsx:44,50,60` and `apps/console/tests/dashboard/stores/shell.test.ts:71-89`).
- It rehydrates `open: true` from `localStorage["forge-70el:sidebarState"]` (`shell.ts:61,109`), so it can render an Activity inspector nobody asked for.
- It is a **second bead-inspector state model** with disjoint fields from `useBeadSideDrawer`.

**V3 — Two competing inspector presentations for the same entity.**
- `BeadSideDrawer` (side drawer, non-modal, `pointer-events: none` backdrop)
- `IssueOverlay` (centered modal dialog, focus trap, body scroll lock, `z-index: 1000`)
`BeadsRepoView.tsx:403-405` opens the drawer on row click; `:457` opens the overlay on selection in `triage`/`memories`. The same bead therefore gets two different UIs depending on which tab is active.

**V4 — Fifth shell with a bespoke z-index band and no close semantics.**
- `OperationsDrawer` (`Operations.tsx:200-237`): `z-index: 55` (`globals.css:4668`), no resize, no `Escape` handler, backdrop click is the only dismissal.

**V5 — Incoherent stacking scale and uncoordinated keyboard handling.**
- `VERIFIED` z-index scale: `bottom-drawer 40` (`globals.css:4687`), `right-sidebar-scrim 49` (`:4701`), `right-sidebar 50` (`:4702`), `bead-side-drawer-backdrop 50` (`:4527`), `operations-drawer-backdrop 55` (`:4668`), `pd-drawer-backdrop 900` / `pd-drawer 901` (`programme.css:411,423`), `bead-overlay-backdrop 1000` (`globals.css:3463`).
- Two shells share `z-index: 50`, resolved by DOM order.
- `Escape` is registered independently by P2 (`RightSidebar.tsx:18`), P3 (`BeadSideDrawer.tsx:77`), P4 (`ProgrammeEntityDrawer.tsx:48`) and P6 (`IssueOverlay.tsx:24`). With two open, one keypress fires two handlers. There is **no stack arbitration** and no topmost-only rule.
- Only P6 implements focus trapping and `aria-modal`. P3 uses `role="complementary"`; P4 uses `role="dialog"` without `aria-modal`; P5 uses `aria-label` only; P1 uses `role="tablist"` on its tab bar but no dialog semantics.

### 8.2 Reusable drawer mechanics (with paths)

| # | Mechanic | Path | Why reusable |
|---|---|---|---|
| M1 | Target/tab/back-stack state machine with `reopenLast` | `hooks/useBeadSideDrawer.ts:33-88` | Correct shape for a global inspector; must lose the feed-injected `projectId`/`issueById`/`memories` coupling |
| M2 | Portal + backdrop + width clamp + pointer-capture resize | `pages/console/BeadSideDrawer.tsx:90-110,132-193,196-206` | Closest to the target primitive; clamp ratios (`420`, `0.5`, `0.78`) are sensible |
| M3 | Focus trap + `aria-modal` + scroll lock + focus restore | `components/beads/IssueOverlay.tsx:17-57` | The only correct a11y implementation; lift into the drawer primitive |
| M4 | Pointer-capture resize with full cancel cleanup | `components/shell/RightSidebar.tsx:171-205` | Most complete cleanup; the reference for `useResizablePanel` |
| M5 | Maximize/restore without persisting the maximized height | `components/shell/BottomDrawer.tsx:20-27,78-93` | Correct pattern for a docked drawer variant |
| M6 | Global drawer toggle hotkey | `components/shell/MainPane.tsx:30-39` | Keep; extend as the single drawer's shortcut |
| M7 | Drawer-scoped tab bar with icon buttons and maximize/close | `components/shell/BottomDrawerTabBar.tsx:1-28` | ADAPT into the drawer chrome |
| M8 | Read-only variant that explicitly excludes mutation controls | `pages/console/programme/programme-drawer.ts:1-2`; `ProgrammeEntityDrawer.tsx:1-4` | Correct precedent for a read-only entity type in the canonical drawer |
| M9 | Entity-typed drawer target contract | `hooks/useBeadSideDrawer.ts:6-12` (`BeadInspectorTarget`) | Extend to a discriminated union over entity kinds |

### 8.3 Recommended canonical drawer shape (evidence-based)

`INFERENCE`, derived from the union of M1–M9: one `useDrawerStore` holding `{ kind, targetId, tab, backStack, width, mode: "overlay" | "docked" }`, one `<Drawer>` primitive providing portal + backdrop + resize (M2/M4) + focus trap (M3) + `Escape` arbitration, and per-entity-kind tab registries (Bead, Programme entity, Specialist chain, Evidence ref). `BottomDrawer` becomes the `docked` mode of the same primitive rather than a second shell.

---

## 9. Program boundary findings

### 9.1 What Program currently owns

| Asset | Path | Verdict |
|---|---|---|
| Mercury programme document graph | `read-model.ts:969` `buildProgrammeSnapshot` | **Owns correctly.** Distinct identity space (`WS-*`, `OPS-*`, `ADR-*`, …), distinct source. |
| Commit-pinning + provenance envelope | `source.ts:89-149`; `read-model.ts:949-967` | **Owns correctly.** This is the model's defining property. |
| Evidence-class doctrine for its own source | `read-model.ts:1003-1005,1019-1025` | **Owns correctly, but should be generalized.** |
| Snapshot cache with `fresh`/`stale`/`degraded` + fail-closed | `route.ts:24-29,115-151` | **Owns correctly.** |
| Change sets between pinned snapshots | `changes.ts`; `route.ts:160-163,197-233` | **Owns correctly.** |
| File-revision history for programme source paths | `route.ts:238-267` | **Should reference the shared GitHub adapter, not own it.** |
| Repo file reads + dir listing | `source.ts:108-118` via `packages/core/src/github/readme.ts` | **Already references.** Keep. |
| Client-side AI context bundle | `ContextBuffer.tsx:280` | **Should not own.** Presentation layer is producing governance contract text. |

### 9.2 What Program should only reference

1. **Beads / Substrate issue state.** Reference by opaque external key at most. `VERIFIED`: no join exists today and `evidence_boundary.beads` explicitly refuses inference (`read-model.ts:1003`). Do not add a join without a governed contract; `provenance.rules[4]` (`read-model.ts:963-965`) requires a canonical XTRM identity/provenance contract first, gated on `ISSUE-87`.
2. **Runtime / deployment state.** Same boundary (`read-model.ts:1004`).
3. **Jira live status.** Currently build-time references only; a live read must go through an authorized server-side read-only adapter (`read-model.ts:1005`).
4. **Specialist execution state.** Not referenced at all. Keep the separation.
5. **GitHub file content and history.** Reference the shared adapter; move `route.ts:238-267` behind it.

### 9.3 What is reusable as a read model / projection

| Reusable | Path | Reuse shape |
|---|---|---|
| `ProgrammeSource` / `ObservableProgrammeSource` | `source.ts:21-32` | **Pin/atRef/commitAtOrBefore** contract. Adopt as the interface for any commit-pinned external read model. |
| Snapshot cache discipline | `route.ts:115-151` | `fresh`/`stale`/`degraded` + background refresh + last-good fallback. Adopt for Substrate-backed read models too. |
| Integrity gate before publish | `read-model.ts:1036-1042` `assertNoDanglingEdges` | Adopt: validate the projection before it is served. |
| `provenanceFrom` | `read-model.ts:949-967` | Adopt as the reusable **evidence-class registry**: which classes are established, which are explicitly not. |
| `state_history_semantics` | `read-model.ts:1019-1025` | Adopt as the reusable **precedence doctrine**: current-state precedence, journal-vs-authority separation, publication-facts separation, unsafe-nested-relationship suppression. |

### 9.4 Defects and drift

- `Programme.tsx:2` claims "13 views"; `VIEWS` has 14 (`:23-27`).
- `/api/programme/changes` depends on process-local `previous` (`route.ts:70,94,201`), so it is not stable across processes or restarts. Documented, but it means the endpoint is unsuitable for any durable "what changed" claim.
- `ProgrammeSource` is a 1 043-line regex parser. `parseYaml` (`read-model.ts:98`) is hand-rolled; `STATUS_RE`/`ISSUE_RE`/`ID_RE` are global regexes reused with `findAll` (`:185`) — `INFERENCE`: stateful `lastIndex` risk on `/g` regexes reused across calls. Not observed failing, but it is a latent hazard worth a fixture test.

---

## 10. Graph / Observability / Specialists placement recommendation

| Surface | Recommendation | Evidence |
|---|---|---|
| **Graph** | Keep as a **dedicated console view scoped to one explicit project**, not a global canvas. Reuse the read model (`read-models/graph.ts:77`) and the per-cluster layout idea (`Graph.tsx:143-172`), but: (a) stop resolving an unknown `project_id` to the first active Beads source (`read-models/graph.ts:58-76`); (b) require the caller to pass entity context so a node click yields a fully-populated inspector; (c) replace N `ReactFlow` instances with one canvas plus cluster framing if cluster count grows, since each pane currently remounts on toggle. **`ADAPT`.** | `Graph.tsx:38-45,143-172,356`; `read-models/graph.ts:58-77`; `package.json:42,51` |
| **Observability** | Split into two surfaces. (1) **Metrics**: keep the 12 aggregate tables and `createMetricsDao`/`attach-pool`, move them onto shared table primitives, add the missing auth gate on `/api/console/observability` (`routes/index.ts:130-132`), and add evidence drilldown into `xtrm_evidence_refs` / `xtrm_forensic_events`. (2) **Source health / repair**: move the Beads Dolt repair table (`Observability.tsx:72-99`) to the source-health surface and stop rendering operator shell commands as page content. **`ADAPT` + `REPLACE`.** | `routes/observability.ts:14-34,52-64`; `Observability.tsx:50-99,133-143`; `packages/core/src/observability/*` |
| **Specialists** | Keep the page-level two-pane cockpit. Do **not** introduce a specialist drawer shell — the current design correctly reuses the canonical inspector. Two changes: (a) implement a real Evidence tab reading `xtrm_evidence_refs` + forensic envelopes instead of relabelled job history (`BeadSideDrawer.tsx:297-323`); (b) move chain aggregation server-side so the client stops grouping jobs (`Specialists.tsx:30`; `useChains.ts:11-30`). **`ADAPT`.** | `Specialists.tsx:71-109`; `read-models/specialists.ts:83-144`; `routes/specialists.ts:116-207` |
| **Bead drawer ↔ Spec/Graph/Ops** | All four entry points (`Graph.tsx:356`, `BeadNode.tsx:69`, `Specialists.tsx:96`, `ChainDetailPane.tsx:217`, `SpecialistsTabPanel.tsx:42`, `Operations.tsx:217`) must resolve project context from the entity itself. This is a prerequisite for the canonical-drawer work. **`ADAPT`.** | `BeadSideDrawer.tsx:31-33,54`; `BeadsRepoView.tsx:294-296` |
| **Program** | Keep as an independent, feature-gated, commit-pinned governance read model. Do not merge it into the Substrate read models or the drawer's entity space; expose it through the same drawer *shell* with a programme tab set. **`PRESERVE_AS_IS`** for the model, **`REPLACE`** for the shell. | `route.ts:58-63,119-151`; `read-model.ts:969-1005`; `routes/index.ts:139-142` |

---

## 11. Open questions

| # | Question | Tag |
|---|---|---|
| Q1 | Is `MERCURY_PROGRAMME_DASHBOARD_ENABLED=1` set in the production Console deployment? If not, the entire Program surface is dead in production and its 5 944 lines of source (server + UI + CSS) may be DELETE_AFTER_CUTOVER rather than PRESERVE_AS_IS. | `UNKNOWN` |
| Q2 | Does Console v2 intend to keep `/api/substrate/*` as the public issue API name, or introduce a neutral `/api/work-items`? The route namespace decision determines whether items #16/#19/#20 in §7 are ADAPT or REPLACE. | `UNKNOWN` |
| Q3 | Are `memories` and `interactions` (`substrate.ts:38-39`, live fs reads of `knowledge.jsonl` / `interactions.jsonl`) part of the Console v2 product surface, or Console-v1 legacy? They are the only non-materialized Beads reads and the only consumers of `BeadsReader`. | `UNKNOWN` |
| Q4 | Is `RightSidebar` intentionally parked for a planned re-wire, or is it dead? Its tests still exercise `openSidebar`, so the test suite does not catch the orphaning. | `UNKNOWN` |
| Q5 | Does the XTRM "one canonical global drawer" rule permit a *docked* variant (the bottom drawer's terminal/logs/specialists) as the same primitive in a different mode, or must the dock be a separate concept? The answer changes whether `BottomDrawer` is ADAPT or PRESERVE_AS_IS. | `UNKNOWN` |
| Q6 | What is the intended Console v2 behaviour when a project has both Beads and GitHub Issues for the same work item? No neutral `Issue` type exists, so any cross-linking contract must be newly authored. | `UNKNOWN` |
| Q7 | Is the `substrate_job_link` join table (`database.ts:270-278`) still populated in production? `read-models/specialists.ts:165-166` LEFT JOINs it; if empty, all specialist→bead correlation degrades through the `bead_id` fallback path. Not verifiable from the pinned tree. | `UNKNOWN` |
| Q8 | The observability materializer attaches multiple repo DBs (`createAttachPool`). How many repos are attached in production, and does the `SQLITE_MAX_ATTACHED` limit hold? A skipped attach silently degrades coverage (`routes/observability.ts:27-29`). | `UNKNOWN` |
| Q9 | `ReadModelSourceKind` includes `"legacy-bridge"` (`read-models.ts:2`) but no contract in `createConsoleReadModelContracts()` uses it (`VERIFIED`). Is a legacy-bridge contract intended but unwritten, or is the enum member dead? | `UNKNOWN` |
| Q10 | The `ProgrammeSource` regexes are module-level `/g` patterns reused through `findAll` (`read-model.ts:82-84,185`). No fixture asserts `lastIndex` isolation across calls. Is there a latent cross-call state bug? | `UNKNOWN` (`INFERENCE` that it is a hazard) |

---

## 12. Appendix — verified facts used as load-bearing evidence

| Fact | How verified |
|---|---|
| Audited SHA is `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d` | `git rev-parse HEAD` in `/home/dawid/dev/console-wt/audit-main` |
| Only `beads-adapter.ts` writes `substrate_*` in production | exhaustive `grep -rn "INSERT INTO substrate_issues\|UPDATE substrate_issues\|DELETE FROM substrate_issues\|INSERT INTO substrate_dependencies\|INSERT INTO substrate_issue_edges" apps packages`, filtered to exclude `*.test.*` and `tests/` |
| `openSidebar` has no production caller | `grep -rn "openSidebar" apps/console/src` → only the definition in `stores/shell.ts:185`; every call site is under `apps/console/tests/**` (`RightSidebar.test.tsx:44,50,60`, `stores/shell.test.ts:71-89`) |
| `KanbanBoard` / `StatusColumn` / `BeadCard` are unreferenced in production | `grep -rn "KanbanBoard\|StatusColumn\|BeadCard" apps/console/src` → only self-references; only `BeadCard.test.tsx` in tests |
| z-index scale | `grep -n "z-index" apps/console/src/dashboard/styles/globals.css apps/console/src/dashboard/pages/console/programme/programme.css` |
| Drawer state persistence keys | `apps/console/src/dashboard/stores/shell.ts:18-28` |
| Program does not read any Substrate/Beads table | `grep -rn "substrate\|specialist_jobs\|xtrm_evidence" apps/console/src/server/programme/` → single hit at `read-model.ts:411` (a directory exclusion list) and the `evidence_boundary` strings |
| Graph/specialist/observability data sources | route registrations in `apps/console/src/server/routes/index.ts:123-158` cross-referenced with each hook's `fetch()` path |
