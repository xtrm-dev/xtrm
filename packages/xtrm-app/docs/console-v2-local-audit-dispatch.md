# Local audit dispatch — Console v2 base UI, Substrate migration, Conar and DeepSeek Harness

Use this brief for the local audit before implementation.

## Scope

Audit current source in:

- `xtrm-dev/xtrm`
- `Jaggerxtrm/console`
- `wannabespace/conar`
- `deepseek-ai/deepseek-harness`

Primary XTRM docs:

- `packages/xtrm-app/docs/xtrm-gui-prd.md`
- `packages/xtrm-app/docs/adoption-audit.md`
- `packages/xtrm-app/docs/implementation-packet.md`
- `packages/xtrm-app/docs/console-v2-migration-plan.md`
- `packages/xtrm-app/docs/external-reference-audit-scope.md`

Primary issue implementation:

- `packages/substrate`

Jira portfolio tracker:

- `ISSUE-140`

## Mission

Finish the base Console v2 architecture before detailed Agent/Frames implementation.

Priorities:

1. repository tracking;
2. preserve all useful GitHub functionality from current Console;
3. Substrate-backed Issues and removal of Beads-specific UI authority;
4. canonical Inspector Drawer;
5. Program/governance;
6. base Graph/Observability integration;
7. Agent/Frames runtime later as a separately scoped tranche.

Do not start by implementing commodity UI/runtime infrastructure from scratch. Audit Conar and DeepSeek Harness first and classify every candidate as `DEPEND`, `ADAPT`, `REFERENCE`, or `REJECT`.

## Required investigations

### Current Console

Produce a preservation/migration matrix for repository discovery, repository activity ordering, PRs, commits, GitHub Issues, releases, README/changelog/reports, caches/fetchers, shell state, Beads materializer, issue feed, drawers, Graph, Program, Observability and Specialists.

Use the rule:

```text
reuse proven adapters / fetchers / caches / readers
replace stale shell / domain-state / page-specific UI architecture
```

### Substrate

Read current source/tests, not old summaries. Verify current DB authority/discovery, typed service, projections, Issue identity/revision/contracts, edges, readiness, claims/leases, journal/resume, provenance, integrations, compatibility, migration/import and dispatch gate.

Answer exactly how Console v2 should replace the Beads materializer. Prefer typed service/projections; do not query SQLite directly unless current Substrate source explicitly requires that integration seam. Do not dual-write.

### Conar

Focus on UI: double-sidebar architecture, persistent global icon rail, contextual collapsible sidebar, icons, menu hierarchy, controls, command/search/autocomplete, density, panel/dialog primitives, motion, virtualization, keyboard handling and underlying permissive dependencies.

Conar itself is reference-only absent an explicit license decision.

### DeepSeek Harness

Focus on future compatibility: Agent registry, durable session identity, lifecycle, parent/fork lineage, durable vs live events, projection seams, tool-call lifecycle, teams/mailbox, liveness/status, logs/telemetry and Web/Desktop architecture.

Do not import its team task authority and do not replace Pi/Substrate ownership.

## Base shell to evaluate

```text
persistent global icon rail
+ contextual collapsible sidebar
+ primary surface
+ inspector rail / global drawer
```

Context sidebar collapse must leave a narrow rounded reopen rail, not disappear entirely and not become another icon menu. Global rail remains persistent.

Drawer states:

```text
CLOSED
CONTEXTUAL
PINNED
MAXIMIZED
+ FOLLOW LIVE
```

Drawer maximize must not obscure the persistent global rail.

## Agent boundary

Keep the shell/domain compatible with future:

```text
Agent
AgentSession
Frame
AgentRelation
ChainRun
TelemetryEvent
Evidence
```

Future relation kinds:

```text
fork
dispatch
chain
peer
```

Do not implement full Agent/Frames behavior in this audit/first base-UI tranche.

## Deliverables

Return:

1. exact audited SHAs/licenses;
2. Conar adoption matrix;
3. DeepSeek Harness adoption matrix;
4. Console v1 preservation matrix;
5. Substrate integration contract;
6. Beads-materializer replacement plan;
7. Console v2 shell proposal;
8. double-sidebar recommendation;
9. Drawer refinements;
10. base-UI implementation waves;
11. Agent deferred boundary;
12. risks/unknowns;
13. exact PRD/adoption-audit amendments;
14. smallest implementation-ready tranche.

Every material claim must be `VERIFIED`, `INFERENCE`, `PROPOSAL`, or `UNKNOWN`.

Stop after the audit/proposed doc delta for operator review. Do not silently promote findings into accepted product decisions.
