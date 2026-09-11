# Console v2 audit context

This file records the immediate operator-approved product boundary for the current audit.

- The current UI mock remains draft reference only.
- The base user interface should be finalized before full Agent implementation.
- First implementation priorities are repository/GitHub preservation, Substrate Issues, the Inspector Drawer and Program/governance.
- The current Console is a source of proven behavior, not the target UI architecture.
- Full Agent/Frames implementation is intentionally deferred for a separately scoped pass.
- Conar should be audited deeply for UI primitives, iconography, double-sidebar hierarchy, menus, density and underlying permissive dependencies.
- DeepSeek Harness should be audited deeply for future Agent/observability architecture, durable/live event separation, projections, fork/parent identity, teams/mailbox and logs/telemetry.
- The persistent global icon rail + contextual collapsible sidebar + main surface + Inspector rail/drawer is the current shell hypothesis.
- When collapsed, the contextual sidebar remains as a narrow rounded reopen rail; it does not disappear completely.
- Jira `ISSUE-140` is the portfolio tracker for this work.
