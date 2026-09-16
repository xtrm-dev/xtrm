# XTRM Agent Runtime — Implementation Packets

Canonical tracker: XTRM-91.

These packets are intended for parallel work by the primary agent and collaborator without splitting architecture authority.

## P0 — prompt/profile composition

Owner area: `xtrm-dev/core`.

Deliver:
- XTRM kernel/profile composition for managed Pi sessions;
- equivalent Claude-native profile injection;
- capability-aware guidance generation;
- project SYSTEM/APPEND_SYSTEM/AGENTS layering that cannot silently erase XTRM identity;
- updated `using-xtrm` / `multiplexing` responsibilities.

Acceptance:
- fresh managed sessions understand XTRM without manual skill bootstrap;
- raw upstream Pi behavior remains available outside managed mode.

## P1 — xtrm-intercom

Owner area: `xtrm-dev/core`, consumers in `xtrm-dev/xtrm`.

Deliver mature parity with `pi-intercom` and `pi-claude-link` per `ADOPTION-CREDITS.md`.

Split internally into:
1. protocol/types/identity/receipt model;
2. Pi IPC transport;
3. Claude cross-session transport;
4. session roster/presence/aliasing;
5. send/ask/reply/pending/cancel/supersede;
6. attachments/scoped routing/mailbox;
7. TUI/CLI renderers and acceptance tests.

Do not make intercom a Chain/workflow authority.

## P2 — xtrm-background

Owner area: `xtrm-dev/core`.

Deliver only:
- start/status/logs/result/stop/rerun;
- bounded visible output + full output reference;
- completion event;
- optional wake/follow-up policy.

Explicit non-scope: Fusion, delegated agent workflows, provider override.

## P3 — Python-kernel guidance

Owner area: `xtrm-dev/core`.

Deliver capability-aware default prompt guidance and tests proving:
- persistence is explained;
- variables/imports are expected to be reused;
- output is bounded;
- durable results leave ephemeral kernel state;
- kernel is not described as a sandbox.

## P4 — Substrate Issue Task Plan

Owner area: `xtrm-dev/xtrm/packages/substrate`.

Deliver:
- TaskPlan domain/service;
- Issue-revision binding;
- local task lifecycle/dependencies;
- stale/reconcile semantics;
- resume/handoff persistence;
- task → child Issue promotion;
- OperationResult/read model;
- Pi + Claude tool adapters preserving familiar TaskCreate/List/Get/Update ergonomics.

Do not use `.pi/tasks` as canonical state for claimed XTRM Issues.

## P5 — TUI task strip + task manager

Owner area: `xtrm-dev/xtrm/packages/xtrm-tui`.

Deliver:
- stable task strip above composer;
- 80/120/160/220-column responsive behavior;
- completed-task collapse;
- active/next task projection;
- focused task manager;
- PR #188/tmux-style focus/navigation grammar;
- explicit promotion action;
- no duplicate task/readiness business logic.

## P6 — terminal/read-model convergence

Owner area: `xtrm-dev/xtrm`.

Deliver shared semantic tokens/read models for:
- `sb` Issue browser;
- task manager;
- intercom roster/browser;
- background-job view;
- future GUI adapters where practical.

## P7 — migration + upstream provenance

Owner area: cross-repo.

Deliver:
- reviewed upstream SHAs/tags in `ADOPTION-CREDITS.md`;
- parity matrices;
- migration from direct third-party runtime dependencies only after acceptance;
- reconciliation with the existing XTRM upstream-watch mechanism;
- contribution-back notes for generic bugs/fixes discovered during adoption;
- required license notices where source/tests/docs are adapted or copied.

## Integration order

Recommended dependency shape:

```text
P0 prompt/profile ───────────────┐
P1 intercom ─────────────────────┼─→ P6 convergence ─→ P7 migration
P2 background ───────────────────┤
P3 python guidance ──────────────┤
P4 TaskPlan ─→ P5 TUI task UX ──┘
```

P1 and P4 are the largest semantic packets and can proceed in parallel. P5 should depend on the TaskPlan read model rather than inventing temporary UI state.