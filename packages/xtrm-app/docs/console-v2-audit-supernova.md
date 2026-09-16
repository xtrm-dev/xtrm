# Console v2 — Supernova audit (UI + runtime + Frame semantics)

**Status:** bounded research audit, no implementation
**Audited:** `mattiacerutti/supernova` @ `d0fa6869a950788045d5e10f6d500a75fe46e229` (2026-09-16)
**License:** MIT (`Copyright (c) 2026 Mattia Cerutti`) — VERIFIED (`LICENSE` head)
**XTRM refs at audit time:** `xtrm-dev/xtrm` worktree @ `fdf2951c2d45ef00b884ccf0437d2aee09d8c9d5`; PR #170 head `e1bc91236caf5fd95a4729da8ae8b6f5ee5eb35c` (CLOSED unmerged — decisions below reconcile against its head content, not its merged state)
**PRD:** `packages/xtrm-app/docs/xtrm-gui-prd.md` (local, 1541 lines, §§1–33)
**Prior audit:** PR #170 artifacts (Conar @ `d50f1d1`, DeepSeek Harness @ `c291e796`, Console v1 @ `4b0d9f57`, xtrm @ `9263f917`)

Tag legend: `VERIFIED` (read in source at the pinned SHA) / `INFERENCE` (derived) / `PROPOSAL` (decision requested) / `UNKNOWN` (not determinable).

## 1. Supernova UI primitive/pattern audit

Method: source reads only (`packages/web/src/**`, 179 files; `docs/internal/{web,icons,product}.md`; `packages/web/package.json`; root patch file). No screenshots.

### 1.1 Token / visual-language core — VERIFIED

- Token contract: Tailwind v4 `@theme inline` → `--theme-*` CSS vars — `packages/web/src/app/styles.css:37-70`.
- Resolver: 5-input seed → full runtime palette (`surface/deep/raised/control/sidebar/recessed/popover/drawer`, `ink/ink-muted/ink-faint`, `border/border-muted/border-strong`, overlay/accent/diff/danger roles, contrast curve) — `features/settings/lib/themes.ts:28-108`.
- Single bundled seed (dark surface `#111111`/ink `#fcfcfc`; light `#ffffff`/`#0d0d0d`; accent `#0169cc`; diff `#00a240`/`#e02e2a`) — `features/settings/data/themes/supernova.ts:1-37`; applied at runtime (`appearance-store.ts:44-58,106-119`).
- Typography: Inter 400/400i/500/600 + system fallback; `--text-sm: 0.85rem`; message body `text-sm leading-7`; code `0.8125rem/1.5rem`, mono system stack.
- Radius: `rounded-xl` + `corner-superellipse/1.3` on buttons/menus/inputs/panels/tabs; `rounded-2xl` user bubble; `rounded-3xl` composer — plugin `@toolwind/corner-shape@0.0.8-3`, license MIT — VERIFIED via npm registry metadata.
- Borders: hairline `border-border-muted`/`border-border`, `ring-1` composer, `border-l-[0.1px]` shell split. Depth = background shifts + overlays; **no shadows except** popover/composer/dialog. No cards for primary content.
- Doctrine matches code (`docs/internal/web.md:73-81`): dark minimal dev-tool, flat, muted, no brand accent, compact spacing, avoid solid-fill buttons.
- Light/dark from one seed (`resolveTheme` branches on variant); system/dark/light persisted with OS listener.

### 1.2 Reusable-idea table

Dispositions: DEPEND = consume package / ADAPT = port bounded code with attribution / REFERENCE = study only / REJECT = do not adopt.

| Primitive / pattern | Source path | Dependency / version | License | Disp. + reason | XTRM consumer |
|---|---|---|---|---|---|
| Seed→runtime theme resolver (5 inputs → `--theme-*`, contrast curve) | `features/settings/lib/themes.ts` + `features/settings/data/themes/supernova.ts` + `stores/appearance-store.ts` | none (CSS `color-mix`, Tailwind v4 `^4.2.4`) | MIT | **ADAPT** — port resolver shape + token list, not verbatim curves; XTRM keeps own palette/violet | shell, timeline, composer, inspector |
| Flat surface scale (deep/sidebar/recessed/raised/control/popover/drawer) + overlay-hover/pressed, no-shadow depth | `app/styles.css:37-70` | `tailwindcss ^4.2.4` | MIT | **REFERENCE** — adopt the scale idea; values are Supernova-specific | shell, inspector |
| Superellipse rounding (`rounded-* + corner-superellipse/1.3`) | `styles.css:3`; `components/ui/button.tsx`, `ui/menu.tsx:24,89`, `composer/session-composer.tsx:318` | `@toolwind/corner-shape ^0.0.8-3` | MIT — VERIFIED (npm) | **DEPEND** — consume plugin directly; trivial to drop | shell, composer, menus, dialogs |
| Offline curated icon registry (typed names, xs–lg sizes, multi-collection pinning) | `components/ui/icon.tsx:17-155` | `@iconify/react ^6.0.2`, `@iconify/utils ^3.1.3`, `@iconify-json/lucide ^1.2.108` (+ bx/cuida/fluent/iconoir/mdi/mingcute/stash/tabler/material-symbols sets) | registry code MIT; icon sets mixed OSS (verify per set) | **ADAPT** — copy registry pattern + size scale (`xs=size-3.5, sm=4, md=5, lg=6`); re-pick glyph sets per XTRM needs. Does NOT overturn PR #170 HugeIcons DEPEND (glyph choice is identity; registry pattern is mechanism) | shell, sidebar, timeline, composer, inspector |
| Ghost/primary/bare button + IconButton, no solid fills by default | `components/ui/button.tsx`, `components/ui/icon-button.tsx` | none | MIT | **ADAPT** — 1-file port | composer, timeline rows, inspector |
| Base-UI menu/dialog shells (hover-pressed rows, drawer-surface popover) | `components/ui/menu.tsx`, `components/ui/dialog.tsx` | `@base-ui/react ^1.4.1` | MIT | **DEPEND** — strengthens PR #170 Base UI direction; copy only class recipes | composer pickers, menus, dialogs |
| Message-scroller wrapper (auto-follow, edge button, hidden thumb while following) | `components/ui/message-scroller.tsx` | `@shadcn/react ^0.2.1` | UNKNOWN (verify at adoption) | **DEPEND if license OK, else REFERENCE** | timeline |
| Scroll-fade + no-scrollbar utilities | used repo-wide; defined in imported `shadcn/tailwind.css` | `@shadcn/react ^0.2.1` | UNKNOWN | **DEPEND or vendor 2 utilities with attribution** | timeline, sidebar, inspector, composer |
| Sidebar layout (translucent rail + rounded content card + drag resize, `--sidebar-width` var) | `features/sidebar/components/sidebar-layout.tsx:23-87` | none | MIT | **ADAPT** — port layout skeleton + width-var technique | shell |
| Collapsible section headers, hover-only chrome | `features/sidebar/components/sidebar.tsx:84-134` | CSS grid-rows (+ framer-motion for siblings) | MIT | **ADAPT** | sidebar |
| Compact session row (pin affordance, timestamp↔spinner↔dot swap, hover actions, prefetch, inline rename) | `features/projects/components/project-list/project-session-list-item.tsx` + `project-list-item.tsx:135-246` | `@tanstack/react-router ^1.169.1`, `@tanstack/react-query ^5.90.0`, `@formkit/auto-animate ^0.9.0` | MIT | **ADAPT** — highest-value sidebar idea; strengthens TanStack Router direction | sidebar |
| Timeline item model (`user/assistant/work/compaction`, `spacing`, `collapsible`, `durationMs`, `live`) + turn→items builder | `features/sessions/types/session-timeline-item.ts`, `features/sessions/lib/timeline/build-session-timeline.ts` | none | MIT | **ADAPT** — core timeline idea; per-turn `user` row + collapsible `work` group + `assistant` row; `spacing=work` compacts gaps | timeline |
| Centered `max-w-3xl` frame, message/work spacing (`pb-8`/`pb-4`) | `features/sessions/components/timeline/session-timeline-item-frame.tsx` | none | MIT | **ADAPT** — copy directly | timeline |
| User bubble (right, `bg-surface-raised`, inline code chips, accent `@`/`$` references) | `timeline/items/user-message.tsx:83-104` | none | MIT | **ADAPT** | timeline |
| Restrained markdown overrides (leading-7, muted quote/rule, bordered tables) | `timeline/items/assistant/assistant-message-content.tsx:134-195` | `react-markdown ^10.1.0`, `remark-gfm ^4.0.1` | MIT | **ADAPT** — port component map selectively | timeline |
| `ContentPanel` almost-card for code/diff/output (`max-h-72` scroll, `.scroll-fade`) | `timeline/items/assistant/content-panel.tsx:10-23` | none | MIT | **ADAPT** — standard container for inspector too | timeline, inspector |
| Hover-only message actions (copy/revert/timestamp) | `timeline/items/actions/message-actions.tsx` | none | MIT | **ADAPT** — defines chrome discipline | timeline |
| Collapsible "Worked for Xs" activity group (grid-rows expand, lazy-mount details) | `timeline/items/assistant-work.tsx:60-88`, `assistant/tools/tool-event.tsx:14-65` | none (CSS) | MIT | **ADAPT** — signature activity-group idea; cheap title always, expensive details lazy-mount on first expand | timeline |
| Tool title one-liners (+diff stat chips, `.shimmer` while pending) | `timeline/items/assistant/tools/tool-title.tsx:28-171` | none | MIT | **ADAPT** — port verb map + stat chip | timeline |
| Tool details per kind (shell transcript, filename+diff, read window, URL) | `timeline/items/assistant/tools/tool-details.tsx` | `@pierre/diffs ^1.1.0` (diff only) | MIT / Pierre Apache-2.0 — VERIFIED (npm; NOTICE obligations apply) | **ADAPT** (layout) / **DEPEND** (diff renderer; both Supernova + PiChamber converge on Pierre) | timeline, inspector |
| Cached Shiki highlighting (shared highlighter, Suspense fallback, LRU 500/50MB + in-flight dedupe) | `lib/code-highlighting.ts:16-115`, `lib/diff/diff-viewer-options.ts`, `components/diff-viewer.tsx` | `@pierre/diffs ^1.1.0`, `@pierre/trees 1.0.0-beta.4`, `lru-cache ^11.3.5`, `imurmurhash ^0.1.4` | Pierre Apache-2.0; rest MIT | **DEPEND if Apache-2.0 NOTICE acceptable, else REFERENCE** cache/dedupe recipe | timeline, inspector |
| Virtualized timeline (anchor-end, follow-on-append, est 86px, overscan 3, per-session measurement cache cap 16, patched virtual-core) | `features/sessions/components/timeline/session-timeline.tsx:171-226`; `patches/@tanstack%2Fvirtual-core@3.17.0.patch` (fixes `getVirtualDistanceFromEnd` via `getLogicalScrollOffset`) | `@tanstack/react-virtual ^3.14.2` / core `3.17.0` | MIT | **DEPEND** — strengthens PR #170 TanStack Virtual direction; carry the patch rationale (upstream or vendored) | timeline |
| Expandable virtual list (animated tree expand inside absolute rows) | `features/workspace/components/file-tree/expandable-virtual-list.tsx` | `@tanstack/react-virtual`, `framer-motion ^12.40.0` | MIT | **ADAPT** for file trees / long lists | sidebar, inspector |
| `Marker` separator/bordered-row primitive | `components/ui/marker.tsx:8-12` | `@base-ui/react ^1.4.1` | MIT | **ADAPT** — tiny | timeline, inspector |
| Streaming footer (MatrixLoader dot-wave + shimmer, 160-char tail-chunk fade, `aria-busy`) | `components/ui/matrix-loader.tsx`, `session-timeline.tsx:414-430`, `styles.css:157-183` | `framer-motion ^12.40.0` | MIT | **ADAPT** — port loader + tail-fade constants | timeline |
| Composer shell (Tiptap + atomic `composerReference` node + suggestion ext, round control, toolbar row, round send/stop) | `features/sessions/components/composer/session-composer.tsx:240-346` | `@tiptap/{core,react,pm,suggestion} ^3.23.4` | MIT | **ADAPT** — port chrome + reference-node idea; keep XTRM editor choice open (no composer decision exists to overturn) | composer |
| Suggestion popover + model picker + context ring + undone (redo-stack) drawer | `composer/suggestions/composer-suggestion-menu.tsx`, `composer/pickers/model-picker.tsx`, `composer/session-context-indicator.tsx`, `composer/undone-turns-drawer.tsx` | `@base-ui/react` (menus), `framer-motion` (drawer) | MIT | **ADAPT** — context ring is inspector-ready | composer |
| `virtua@0.49.1` (declared, no imports in `src`) | `packages/web/package.json:67` | `virtua 0.49.1` | MIT | **REJECT** — no evidenced use | — |

Chrome discipline (INFERENCE grounded in VERIFIED patterns): no cards for primary content; actions hidden until hover (`MessageActions`, code Copy, sidebar row menus, tab close-X); single accent `#0169cc` used sparingly (references, unseen dot, links); status is ink/shape language (spinner, dot, ring, "Worked for 42s"), not color badges; density `text-sm`, tight rows, `max-w-3xl` column; chrome collapses (sidebar 0-width, workspace `inert`/0-width).

### 1.3 What NOT to take

- Supernova's exact token values, accent, Inter font — XTRM owns palette/violet/Geist (PRD §27). Mechanism transfers, values do not.
- `apps/desktop` contributes no UI primitives — Electron is "OS shell, not a second agent runtime" (`docs/internal/product.md:95-99`). No evidence against Tauri; see §7.6.
- No global icon rail exists in Supernova either — rail remains XTRM-owned new work (same finding as Conar).

## 2. Supernova runtime / session audit

Sources: `docs/internal/{session-runtime,checkpoint-system,agent-runtime,architecture,contracts}.md` + implementing source in `apps/server`, `packages/agent-runtime`, `packages/contracts`. All claims VERIFIED unless marked.

### 2.1 Ownership and state split

- Pi session owner/creator: server process. `PiAgentSessionFactoryLive.createAgentSession()` (`packages/agent-runtime/src/layers/session-runtime/internal/pi-agent-session-factory.ts:21-40`), called only from `PiSessionRuntime.getAgentSession()` (`internal/pi-session-runtime.ts:335-363`). Lives in-memory (`agentSession` field, line 54), one per Supernova session ID, lazily created, retained for server lifetime — "no idle eviction".
- Object taxonomy (doc `session-runtime.md:62-78` matches source 1:1): Pi session (durable tree, Pi `SessionManager` JSONL) / Runtime session (`PiSessionRuntime`, keyed by Supernova `sessionId`) / Committed session (`Session` contract, `buildSessionSnapshot`) / Active turn / Live turn / Session snapshot.
- Turn identity: `Turn.id = userMessage.id` (`layers/shared/lib/turns.ts:17-27`) — one human ingress opens exactly one Turn; durable ID, never synthetic.
- Persisted: Pi append-only entry tree; `supernova.checkpoint` + `checkpoint-cursor` custom entries; shadow-Git trees/refs + manifests; session title. In-memory only: `ActiveTurn` (`liveMessages`, `contextUsage`), frozen `committedSession`, monotonic per-session `revision`, publish queue, non-replaying event bus.
- Settlement boundary: `waitForPiSettlement()` = `await agentSession?.waitForIdle()` (`pi-session-runtime.ts:436-438`) → after-turn checkpoint → after-turn entry → cursor → `publishSessionSnapshot()` → `session.snapshot` event → browser replaces committed `Session`, clears `liveTurn`. `endWork()` releases the lock.
- Synthetic live entries (`createLiveBranchEntries`, `generateStableId("live", …)`) are display-only, never appended, never written — live `Turn.status = "streaming"`.

### 2.2 Locking, concurrency, switching, recovery

- Command lock: `beginWork()` throws `"Session already has active work."` if `running` (`pi-session-runtime.ts:76-80`). Serializes sends, manual compaction, undo/redo/revert. Server lock authoritative; browser disables optimistically.
- Across sessions: fully concurrent (independent runtimes; "Session A may stream while session B compacts"). Within one session: one-active-turn; second command rejected → RPC rejection → optimistic turn removed.
- Session switching during work: route change does not interrupt subscription, dispose runtime, or abort provider work; work continues server-side; per-session `liveTurn` retained in Zustand keyed by session ID; frozen committed read makes refetch-while-streaming safe.
- Browser reload/reconnect: event bus does not replay; client invalidates committed queries → RPC repair; fresh browser mid-run may miss full active turn until next Pi event — durable replay explicitly deferred (non-goal).
- Server restart: in-memory turns/revisions/history lost; recovery from durable Pi JSONL + Git checkpoint objects; no startup recovery pass (INFERENCE: interrupted turn never settles); "no startup restore journal" (`checkpoint-system.md:588`).
- Checkpoints: before-turn capture → provider work → after-turn capture → cursor → snapshot. Capture best-effort (failure → `failed`/`disabled` boundary, turn continues). Undo/redo/revert: workspace restore+verify **before** Pi `branch()` + cursor + snapshot. Restore touches changed-path delta only, refuses on manual-change conflict unless `force`. New turn from undone position invalidates redo.

### 2.3 Authority split and timeline projection

- Server owns: persisted tree, execution, active-turn projection, committed reads, revisions, event bus. Browser owns: React Query committed `Session` + Zustand ephemeral per-session `liveTurn`/status/revision/error — **no second committed Session**. Source of truth = server snapshot + server `session.turn` projections; full-replacement `session.turn`, never delta-merge.
- One shared mapper `buildPiTurns(branch, modelReference)` serves committed snapshots and live turns (live via synthetic entries). `PiTurnBuilder`: user message entry opens a `PiTurnDraft`; assistant/reasoning/tool/compaction accrete as `TurnEvent`s; tool call + result joined by `toolCallId`; partial streamed tool args stripped until validated. UI `buildSessionTimeline({turns, liveTurn, live})` → user item + collapsible `work` group + assistant messages + compaction markers. Pure function of server data.

### 2.4 Fork / lineage — VERIFIED ABSENT

- Pi `sessionManager.branch()` used only for checkpoint navigation. `undoneTurns` = redo-branch slice after cursor — derived, not a fork registry. No fork/clone-session RPC, no lineage/parent-session IDs, no child-agent session references. Child agents surface as in-turn `tool` events via `PiToolInvocationFactory`; no separate session/turn per tool call. Pi-subagent nesting behavior from Supernova's layer: UNKNOWN.

## 3. Frame semantics conclusion

Proposed invariant under test: *A Frame belongs to exactly one AgentSession — one human ingress, provider turns, tool activity, coordination events, child-agent references/results, final settled response. Other agents keep their own AgentSessions/Frames. Cross-agent aggregation belongs to Agents/ChainRun/Graph/Observability, not Frame identity.*

- **Does Supernova resolve the open Frame question? No — but it narrows it substantially.** VERIFIED: session-local, single-ingress interaction units with server-owned settlement, synthetic-live quarantine, and one-active-unit-per-session are proven in production-shaped code and directly reusable. Missing (all UNKNOWN against this repo): child-agent linkage, cross-agent aggregation, fork lineage — the multi-agent half.
- **VERIFIED support:** 1 runtime : 1 long-lived `AgentSession` : 1 lock : 1 active turn; Turn = one human ingress + all resulting agent activity (`Turn.id = userMessage.id`); tool activity folds into the owning turn (joined by `toolCallId`), never a sibling unit; coordination events (compaction, checkpoints, abort/error) scoped to session/turn; frozen-committed + snapshot-as-commit + synthetic-live quarantine is a direct precedent for a Frame commit boundary; server authority with UI-as-projection places Frame identity server-side.
- **Mismatches:** (1) no "final response" payload — `Turn` has no response field; settlement = `waitForIdle` + snapshot; a turn may end with tool events, compaction, abort, or error (`completed|error|streaming`). A mandatory response body over-constrains. (2) No nested provider-turn entity — one human message → N provider messages = one `Turn`; if XTRM "provider turns" means multiple model invocations per Frame, that matches (retries/compaction stay in one unit); nothing nests below `TurnEvent`. (3) Child-agent refs: unsupported, not contradicted — greenfield. (4) Compaction spans turns (attaches to current draft or pends to next; manual compaction is its own lock
...[truncated 10969 chars]