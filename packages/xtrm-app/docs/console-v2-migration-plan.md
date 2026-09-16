# XTRM Console v2 — base UI and migration plan

**Status:** canonical implementation plan (reconciled 2026-09-16)  
**Scope:** `packages/xtrm-app` + migration from `Jaggerxtrm/console`  
**Priority:** base shell, repository/GitHub surfaces, Substrate Issues, Inspector Drawer, Program/governance  
**Deferred:** full Agent/Frames runtime implementation  
**Shell contract:** `console-v2-shell-architecture.md` (canonical). **Product decisions:** `xtrm-gui-prd.md` §34.

## 1. Product direction

XTRM Console v2 is an agent-first operating environment. The immediate implementation tranche does **not** attempt the full Agent/Frames runtime. It establishes the shell and domain boundaries required for that later work while replacing the stale parts of the current Console safely.

Primary product primitives:

```text
GLOBAL RAIL
  persistent application-level navigation

CONTEXT SIDEBAR
  contextual repository/work navigation
  collapses to a thin reopen rail, not to another icon menu

MAIN SURFACE
  current work

INSPECTOR RAIL + DRAWER
  inspect / control / traverse
```

The `Agent` destination remains first-class and visually prominent even while its full implementation is deferred.

## 2. Migration principle

Do not refactor the existing Console in place merely to reach the new visual design.

Use this rule:

```text
reuse proven adapters / fetchers / caches / data readers
replace stale shell / domain state / page-specific UI architecture
```

The current Console remains a compatibility baseline until each capability is represented in v2.

Do not delete a working GitHub or repository capability until its v2 replacement is verified against the same source behavior.

## 3. Initial implementation order

1. shared XTRM visual primitives and shell;
2. persistent global icon rail;
3. contextual collapsible sidebar;
4. repository tracking and current GitHub functionality;
5. canonical Inspector Drawer;
6. Substrate Issues integration;
7. Program/governance projection;
8. Graph/Observability placement and shell integration;
9. full Agent/Frames runtime as a separate scoped tranche.

## 4. Left-side information architecture

### 4.1 Global rail

The global rail is durable chrome and does not collapse.

Candidate destinations:

```text
Agent
Work
Repositories
Agents
Program
Observability

--- utilities ---
Command
Theme
Settings/Profile
```

It uses one coherent icon family and minimal labels/tooltips. It is not repository-specific.

### 4.2 Context sidebar

The context sidebar owns the selected mode/repository hierarchy and can collapse independently.

Expanded: normal contextual panel with title, search/filter and domain-specific navigation.

Collapsed: a narrow rounded rail preserving only a clear reopen affordance, visually analogous to the Inspector rail. Do not turn it into a second icon navigation surface.

Drawer maximize may auto-collapse the contextual sidebar, but must never hide the persistent global rail. Restoring the drawer restores the previous sidebar state when the maximize action caused the collapse.

## 5. Repository and GitHub preservation

Preserve the current Console's useful repository/GitHub behaviors, including where currently supported:

- repository discovery;
- repository ordering by activity;
- PR counts and PR/activity surfaces;
- commit activity;
- GitHub Issues;
- releases;
- README/changelog/report content;
- caching/loading semantics;
- repository selection and context switching.

Target conceptual hierarchy:

```text
Repository
├─ Work
│  └─ XTRM Issues
├─ Code
│  ├─ Activity
│  ├─ Pull requests
│  ├─ GitHub issues
│  ├─ Releases
│  └─ Repository content
├─ Agent
├─ Agents
├─ Graph
└─ Observability
```

`XTRM Issues` and `GitHub Issues` are distinct concepts and must not be conflated.

## 6. Substrate Issues integration

Current Substrate is library-first. Console v2 must integrate through the typed Substrate service/projection seam rather than direct SQLite queries.

Target:

```text
Substrate typed service / projections
        ↓
Console adapter
        ↓
IssueContract UI projection
```

Do not introduce dual-write.

During migration, Beads compatibility may remain read-only only where required to avoid losing access to legacy work. New UI/domain code must speak in neutral `Issue` / `IssueContract` terms rather than `Bead`.

The Console migration audit must identify which current Beads materializer code can be removed, temporarily adapted, or retained read-only.

## 7. Issues as planning

Issues are executable work contracts, not generic TODOs.

The UI should make contract readiness visible and should support, as the underlying Substrate contract permits:

- identity and revision;
- problem/outcome;
- scope/non-goals;
- constraints;
- inputs/outputs;
- validation;
- authority/ownership;
- dependencies/typed edges;
- readiness;
- execution binding;
- evidence/provenance.

Planning is first-class, but the base UI tranche should not invent contract semantics beyond current Substrate authority.

## 8. Program/governance

Program is a cross-repository governance/intention projection. It must not become a second issue tracker.

Program may reference executable Substrate Issues but must not duplicate their hierarchy or mutable implementation state.

Target responsibilities:

- workstreams;
- assignments;
- portfolio authority;
- decisions;
- evidence/reconciliation;
- cross-repository state.

## 9. Inspector Drawer contract

The Drawer is the global secondary interaction surface.

States:

```text
CLOSED
CONTEXTUAL
PINNED
MAXIMIZED
+ FOLLOW LIVE
```

It must:

- inspect any first-class entity;
- preserve the current primary workspace;
- provide a navigation stack/back behavior;
- expose entity actions only when authority permits;
- bridge planning, execution, governance and evidence;
- support promotion actions such as `Open session` for Agents later;
- integrate typed references/actions into the composer later;
- remain one canonical shell across Issues, Program, Agents, Graph and other surfaces;
- never obscure the persistent global rail when maximized.

It must not:

- become permanent navigation;
- duplicate the entire primary surface;
- create page-specific drawer implementations;
- invent independent execution/telemetry truth.

## 10. Agent compatibility boundary

The base shell must remain compatible with the future domain:

```text
Agent
AgentSession
Frame
AgentRelation
ChainRun
TelemetryEvent
Evidence
```

Future relation kinds include:

```text
fork
dispatch
chain
peer
```

A conversation fork should later be representable as a new durable AgentSession/Agent presence with lineage to its parent. Specialists ultimately project into the unified Agents domain rather than remain a distinct permanent species in the UI.

Do not implement the full Agent/Frames runtime in this tranche.

## 11. External-reference audit gate

Before base-shell implementation is considered stable, update `adoption-audit.md` with detailed current-source audits of:

- `wannabespace/conar` — UI craftsmanship, double-sidebar hierarchy, icons, menus, command/search primitives, panels, motion, virtualization and underlying permissive dependencies;
- `deepseek-ai/deepseek-harness` — Agent lifecycle, durable/live event separation, session projections, fork/parent lineage, teams/mailbox, observability/logging and Web UI architecture.

Every candidate must receive one disposition:

```text
DEPEND
ADAPT
REFERENCE
REJECT
```

Conar itself is reference-only unless a license review explicitly authorizes more. Prefer its permissively licensed underlying dependencies where appropriate.

DeepSeek Harness concepts may be DEPEND/ADAPT/REFERENCE only after exact license/API review; do not import its task authority or replace Pi/Substrate ownership.

**Status (2026-09-12 audit round): completed.** The gate above is satisfied by:

- `console-v2-audit-conar-ui.md` — Conar @ `d50f1d1`, AGPL-3.0; primitive matrix and licensing.
- `console-v2-audit-deepseek-harness.md` — DeepSeek Harness @ `c291e79`, MIT; architecture matrix, `DEPEND` count 0.
- `console-v2-audit-console-v1-preservation.md` — Console @ `4b0d9f5`; preservation/migration matrix and defect register.
- `console-v2-audit-substrate-issues-contract.md` — xtrm @ `9263f91`; typed-service contract and read-projection gaps.
- `console-v2-audit-console-program-graph-drawer.md` — Console @ `4b0d9f5`; Beads materializer, drawer, Program, Graph, Observability, Specialists.

Normative adoption decisions are in `adoption-audit.md` §10–12; the refined shell architecture is in `console-v2-shell-architecture.md`.

**Status (2026-09-16 audit round): completed.** Supernova (`console-v2-audit-supernova.md`, primary visual benchmark) and PiChamber (`console-v2-audit-pichamber.md`, protocol/runtime reference) were added. Accepted decisions are in `adoption-audit.md` §15.

## 12. Refinements after the 2026-09-12 audit round

The section 3 implementation order stands. The following additions are required, all derived from verified source findings:

1. ~~**Placement must be decided before step 1.**~~ Resolved 2026-09-16: `packages/xtrm-app` is the implementation root (P1). See `console-v2-shell-architecture.md` §1.
2. **Shell mechanics changed the meaning of step 2.** The global icon rail is XTRM-owned new work, not an adaptation of Conar — Conar has no rail. See `console-v2-shell-architecture.md` §3.
3. **Step 3 depends on panel mechanics.** The collapsed contextual sidebar is a reserved 44px sibling element, not a zero-width panel, because the adopted panel primitive has no `collapsedSize`. See `console-v2-shell-architecture.md` §4.2.
4. **Step 4 must resolve the Console v1 defect register.** In particular the 24 h event counts presented as open PR/issue counts, and the identical `"Issues"` label for GitHub Issues and XTRM Issues.
5. **Step 5 must be geometrically protected, and the five v1 drawer shells must not be ported.** `BeadSideDrawer`, `ProgrammeEntityDrawer`, `OperationsDrawer`, the dead-but-mounted `RightSidebar`, and `IssueOverlay` each have their own portal, resize, `Escape` handler, and tab model. Build one primitive in wave D. See `console-v2-shell-architecture.md` §6, §7.2, §7.6.
6. **Step 6 live integration is gated on Substrate read-API readiness; the UI is not.** Re-verified @ `fdf2951`: `main` exists, but there are no `exports`/`types`, no root-exported readiness types, and no batched listing with readiness, cursor, or change feed. Build the Issues UI against `adapters/substrate` with a typed fixture where needed and report the exact missing API. Never read SQLite directly. See `console-v2-shell-architecture.md` §9.3 and `console-v2-audit-substrate-issues-contract.md` §4.3.
7. **Step 7 must carry group labels.** `Program` belongs under `Governance`; `Graph`/`Observability` under `System`; otherwise Program reads as a peer of executable work. See `console-v2-shell-architecture.md` §8.2.
8. **A latent database collision must be resolved.** Console's `resolveStateDaemonPaths` targets `~/.xtrm/state.db`, byte-identical to Substrate's canonical path. See `console-v2-shell-architecture.md` R3.
9. **The Beads materializer is already the correct shape and must keep its single writer.** `packages/core/src/materializer/beads-adapter.ts:51` is the only production writer of `substrate_issues` / `substrate_dependencies` / `substrate_issue_edges`, and its delta-vs-resync tombstone split is load-bearing (a naive `tombstoneMissing` in the delta path caused a cross-project wipe). Do not "simplify" it and do not add a second writer; the migration keeps the adapter and swaps the source, keyed by an adapter-declared source identity rather than a hardcoded `beads:` string prefix. See `console-v2-audit-console-program-graph-drawer.md` §2, §7.

Wave definitions and gates are in `console-v2-shell-architecture.md` §13. The base tranche ends after wave G; wave H (Agent/Frames) is a separately contracted tranche and must not start merely because the shell exposes an Agent destination.

## 13. Acceptance for the base tranche

The base tranche is ready for broader Agent implementation only when:

- the new shell is usable without the legacy shell;
- repository and GitHub capabilities required by current Console users are preserved;
- contextual sidebar/global rail/Inspector behavior is stable and keyboard-accessible;
- Substrate Issues replace Beads-specific UI authority without dual-write;
- Program does not duplicate executable work state;
- old and new capability mapping is documented;
- external primitive/adoption decisions are recorded;
- a fresh worker can implement the next phase without relying on chat history.

## 14. Delivery phases after reconciliation (2026-09-16)

1. **Phase 1 — canonical documentation baseline.** This reconciliation: PRD §34, canonical shell contract, merged adoption audit, audit pack, documentation index. No product code.
2. **Phase 2 — executable Console v2 prototype.** A real React application in `packages/xtrm-app`, not another static mock. Scope, depth per wave, and acceptance: `console-v2-shell-architecture.md` §13.1. Shared primitives come first (§15.2). First real surfaces: Substrate Issues, Program, GitHub/repository Activity. Other destinations are explicit placeholder routes.
3. **Phase 3 — Agent/Frames tranche.** Separately contracted. Uses Supernova and DeepSeek Harness as runtime/session references and starts from the accepted Frame invariant (PRD §34.8).

Do not produce further intermediate HTML mocks. `packages/xtrm-app/prototype/` is historical reference only.
