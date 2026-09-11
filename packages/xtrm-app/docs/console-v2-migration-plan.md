# XTRM Console v2 — base UI and migration plan

**Status:** draft implementation plan  
**Scope:** `packages/xtrm-app` + migration from `Jaggerxtrm/console`  
**Priority:** base shell, repository/GitHub surfaces, Substrate Issues, Inspector Drawer, Program/governance  
**Deferred:** full Agent/Frames runtime implementation

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

## 12. Acceptance for the base tranche

The base tranche is ready for broader Agent implementation only when:

- the new shell is usable without the legacy shell;
- repository and GitHub capabilities required by current Console users are preserved;
- contextual sidebar/global rail/Inspector behavior is stable and keyboard-accessible;
- Substrate Issues replace Beads-specific UI authority without dual-write;
- Program does not duplicate executable work state;
- old and new capability mapping is documented;
- external primitive/adoption decisions are recorded;
- a fresh worker can implement the next phase without relying on chat history.
