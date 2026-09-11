# XTRM Agentic Operating Environment PRD

> **Note:** Console v2 base-UI migration and the current external-reference audit are now tracked in:
>
> - `console-v2-migration-plan.md`
> - `external-reference-audit-scope.md`
> - `console-v2-local-audit-dispatch.md`
>
> Jira portfolio tracking: `ISSUE-140`.
>
> The immediate implementation priority is the base Console shell, repository/GitHub preservation, Substrate Issues, the global Inspector Drawer, and Program/governance. Full Agent/Frames runtime implementation remains a separate later tranche.

## Product thesis

XTRM is an agent-native operating environment for planning, executing, coordinating and inspecting work across repositories, projects and products. Frames are its primary interaction unit; executable work contracts are its planning unit.

The product does not treat planning, agent interaction, multi-agent coordination and observability as separate products. They are projections of the same governed work substrate.

## Primary interaction model

```text
MAIN SURFACE
  work

DRAWER
  inspect / control / traverse

COMPOSER
  instruct / reference / coordinate
```

Planning, execution, repository/code state, governance and observability must remain connected without creating duplicate authorities.

## Base Console v2 shell

The target shell uses four spatial layers:

```text
persistent global icon rail
+ contextual collapsible sidebar
+ primary work surface
+ inspector rail / global drawer
```

The persistent global rail owns application-level modes and never collapses. The contextual sidebar owns repository/mode-specific hierarchy and search. When collapsed it becomes a narrow rounded reopen rail rather than disappearing or becoming a second icon menu.

The Inspector rail and global Drawer are the mirrored secondary surface on the right. The Drawer may maximize, but must not obscure the persistent global rail. If maximize collapses the contextual sidebar, restoring the Drawer restores the prior sidebar state.

## Immediate migration priority

The current Console is visually stale but contains valuable working integration. Console v2 therefore follows this migration rule:

```text
reuse proven adapters / fetchers / caches / data readers
replace stale shell / domain state / page-specific UI architecture
```

The first implementation tranche is:

1. shared XTRM visual primitives and shell;
2. persistent global icon rail;
3. contextual collapsible repository/work sidebar;
4. preserve current repository tracking and GitHub functionality;
5. canonical Inspector Drawer;
6. Substrate-backed Issues;
7. Program/governance projection;
8. Graph/Observability placement required by the base shell.

Full Agent/Frames runtime work is deferred to a separately scoped tranche, although the shell/domain model must remain compatible with it.

## Repository and GitHub

Repository context is first-class. Preserve current useful Console behaviors for repository discovery/selection, activity ordering, pull requests, commits, GitHub Issues, releases, README/changelog/report content and useful cache/fetch semantics.

Do not conflate GitHub Issues with XTRM executable Issues.

Target repository information architecture:

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

## Issues as executable planning

Issues are executable work contracts, not generic TODOs. The UI should project current Substrate semantics for identity/revision, outcome, scope/non-goals, constraints, inputs/outputs, validation, authority/ownership, typed dependencies, readiness, execution binding and evidence/provenance.

A tracked work item should not become executable until its contract is sufficiently complete for the applicable Substrate readiness rules.

Console v2 must integrate Substrate through its typed service/projection seam rather than direct SQLite access. No dual-write.

## Program without issue duplication

Program owns cross-repository purpose, workstreams, assignments, portfolio authority, decisions, evidence and reconciliation. Program may reference executable Substrate Issues but must not mirror their hierarchy or mutable implementation state.

Program is therefore a governance/intention projection, not another task tracker.

## Agent domain

Every durable execution participant is an Agent. Coordinator, executor, reviewer, researcher, validator and specialist are roles/capability profiles rather than separate entity species.

Future first-class entities include:

```text
Agent
AgentSession
Frame
AgentRelation
ChainRun
TelemetryEvent
Evidence
```

`AgentRelation.kind` includes at least:

```text
fork
dispatch
chain
peer
```

A conversation fork must later be representable as a new durable AgentSession/Agent presence with lineage to its parent. Specialists ultimately project into the unified Agents domain.

## Frames and conversation history

The accepted direction is:

```text
current Frame
  foreground work

recent Frames dock below composer
  immediate history

expanded Frames view
  interaction history

Tree view
  fork/branch topology
```

The Tree is a projection of provider-native topology, not permanent chrome. The current Frame remains dominant.

## Typed references and commands

The composer should eventually resolve typed references such as:

```text
@issue:<ref>
@epic:<ref>
@agent:<id>
@frame:<id>
@artifact:<id>
@program:<id>
```

and commands such as:

```text
/plan
/work
/message
/dispatch
/review
/run-chain
```

These should resolve to structured context objects rather than becoming decorative prompt text.

## Agents presence and Open session

Agent presence is inspected in the Drawer; agent work is performed in the Agent surface.

The future Agents view should be list-first, grouped by repository/work/parent/chain, with topology as a secondary projection. Selecting an Agent should open its Inspector; `Open session` promotes it into the primary Agent surface.

This enables parent/child comparison without permanent split panes.

## Global Inspector Drawer

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
- support navigation stack/back;
- expose entity-specific actions according to authority;
- bridge planning, execution, coordination and evidence;
- support future `Open session` promotion;
- integrate typed references/actions with the composer;
- use one canonical shell across surfaces;
- never obscure persistent global repository/application context when maximized.

It must not become another permanent navigation sidebar, duplicate the primary surface, create per-feature drawer shells, or invent a separate execution/telemetry authority.

## Observability and evidence

Observability should be projected into the work itself as well as available globally. Agent, Chain, Issue and Frame inspectors may show runtime/model, duration, context pressure, tool calls, retries, compactions, children, gates and evidence. The global Observability surface provides fleet/repository analysis.

Durable evidence and live status must remain distinct concepts. Existing XTRM forensic/AgentOps authority should be reused rather than replaced by GUI-local truth.

## External adoption gate

Before commodity UI/runtime primitives are implemented from scratch, evaluate approved external references and classify each relevant component as:

```text
DEPEND
ADAPT
REFERENCE
REJECT
```

The current detailed audit scope includes:

- `wannabespace/conar` for UI craftsmanship, double-sidebar hierarchy, icons, menus, command/search primitives, panels, motion, virtualization and underlying permissive dependencies;
- `deepseek-ai/deepseek-harness` for Agent lifecycle, durable/live event separation, parent/fork lineage, projections, teams/mailbox, liveness, logs and observability architecture.

Do not import another product's task authority, shell identity or transcript authority merely because its implementation is convenient.

## Delivery phases

### Base Console v2 tranche

- visual primitives;
- global rail + contextual sidebar;
- repository/GitHub preservation;
- global Inspector Drawer;
- Substrate Issues;
- Program/governance;
- Graph/Observability shell placement.

### Agent/Frames tranche

- Pi-native Agent surface;
- Frames;
- history dock / Frames / Tree projections;
- composer typed references;
- unified Agents presence;
- Agent relations and `Open session`;
- coordination/ChainRun projections;
- telemetry/evidence integration.

Do not pull the second tranche into the first merely because Agent is visible in navigation.

## Acceptance principle

A fresh implementation worker must be able to build Console v2 without rediscovering:

- what is preserved from Console v1;
- what Substrate owns;
- how Program avoids duplicating executable work;
- how the global/context sidebars and Inspector behave;
- what external primitives may be reused;
- where base-shell work ends and detailed Agent runtime work begins.
