# XTRM Console v2 — first implementation scope

This file is intentionally narrow. It converts the accepted product direction into the first implementation boundary without expanding into the full Agent/Frames runtime.

## In scope

- XTRM visual primitives and base shell;
- persistent global icon rail;
- contextual collapsible sidebar with narrow reopen rail;
- repository discovery/context and current GitHub functionality preservation;
- current GitHub Activity / Pull Requests / GitHub Issues / Releases / repository-content surfaces;
- one canonical Inspector Drawer and Inspector rail;
- Substrate Issues UI integration through the typed service/projection seam;
- removal/adaptation plan for Beads-specific materializer/UI code;
- Program/governance projection without executable-work duplication;
- Graph/Observability placement needed for the shell;
- migration/compatibility tests against current Console behavior.

## Explicitly deferred

- complete Pi-native Agent surface;
- Frames runtime/projector;
- conversation history dock/tree implementation;
- durable agent presence service;
- fork/dispatch/chain/peer relationship runtime;
- full ChainRun UI/control;
- typed composer references and slash-command execution;
- detailed agent telemetry/streaming implementation.

The shell must remain compatible with those concepts, but this tranche must not implement them opportunistically.

## Migration invariant

Do not rewrite a working backend solely to match a new component hierarchy.

For each Console v1 capability classify:

```text
PRESERVE
EXTRACT
ADAPT
REPLACE
DELETE_AFTER_CUTOVER
```

The implementation worker must preserve current useful GitHub behavior before deleting the old surface.

## Work authority

Jira `ISSUE-140` tracks portfolio/product intent and acceptance. Repository-local executable decomposition belongs in XTRM's current local work authority. Do not reproduce that task hierarchy in Jira.
