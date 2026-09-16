# XTRM Agent Runtime / Work UX

This directory is the durable design home for the cross-cutting XTRM agent-runtime work that spans native `xt pi`, `xt claude`, the proprietary XTRM TUI/GUI, Substrate, Specialists, and first-party Pi extensions.

## Canonical documents

- [`xtrm-agent-runtime-design.md`](./xtrm-agent-runtime-design.md) — canonical design/implementation contract.
- [`xtrm-agent-runtime-substrate-work-ux-v2.html`](./xtrm-agent-runtime-substrate-work-ux-v2.html) — visual design artifact / implementation map.
- [`ADOPTION-CREDITS.md`](./ADOPTION-CREDITS.md) — upstream adoption and attribution ledger.

## Related XTRM canon

- [`../../substrate/sb-cli-ux-design.md`](../../substrate/sb-cli-ux-design.md) — terminal-native `sb` UX contract introduced by PR #188.
- [`../../substrate/substrate-issues-v0-prd.md`](../../substrate/substrate-issues-v0-prd.md) — durable Issue authority, claims, Journal, execution and provenance.
- `packages/xtrm-tui/docs/xtrm-tui-prd.md` — proprietary TUI product contract.
- Specialists runtime / APPEND-SYSTEM guidance in `xtrm-dev/specialists` — governed activation-specific system context.

## Goal

An agent launched through an XTRM-native surface must understand the XTRM system without a manual `using-xtrm` or `multiplexing` bootstrap. XTRM owns the default agent profile and first-party interaction layer while Pi/Claude remain execution providers.

The work includes:

1. global XTRM system-awareness and prompt composition;
2. first-party `xtrm-intercom`, adopting the mature communication behavior of `pi-intercom` and `pi-claude-link`;
3. first-party background process execution, borrowing only the backgrounding subset of `pi-background-tasks`;
4. stronger default guidance for the persistent Python kernel;
5. migration of load-bearing `using-xtrm` / `multiplexing` guidance into default runtime behavior;
6. a Substrate-backed Issue Task Plan that adopts the useful `pi-tasks` interaction model without creating a second work authority;
7. consistent terminal UX across `sb`, `xt pi`, XTRM TUI and related browsers/overlays;
8. an explicit upstream credit and watch policy.

## Authority rule

```text
Substrate Issue          WHAT work is authorized
Issue Task Plan          HOW the current Issue is executed
Journal                  WHAT happened / continuity
Provenance               WHAT execution durably produced
Specialists / Chains     governed role and orchestration
Channels                 governed semantic communication
xtrm-intercom            direct/provider communication transport + interactive collaboration
xtrm-background          asynchronous local process execution
TUI / GUI / CLI          presentation and operator interaction
```

A local task is not a hidden Issue. A task completion does not close an Issue. A process exit does not complete a task. A peer message does not become user authority.

## Tracking

The corresponding XTRM Jira item is the programme-level implementation tracker for this directory and must reference these files and the upstream adoption ledger. Implementation PRs should cite that Jira item and update `ADOPTION-CREDITS.md` whenever an upstream behavior is newly adopted, rejected, or materially diverged.