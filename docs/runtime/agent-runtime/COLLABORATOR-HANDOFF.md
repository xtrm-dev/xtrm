# Collaborator Handoff — XTRM Agent Runtime Programme

Canonical Jira: **XTRM-91**.

Start here:

1. `README.md`
2. `xtrm-agent-runtime-design.md`
3. `ADOPTION-CREDITS.md`
4. `IMPLEMENTATION-PACKETS.md`
5. `xtrm-agent-runtime-substrate-work-ux-v2.html`

Then read the related canon:

- `docs/substrate/sb-cli-ux-design.md`
- `docs/substrate/substrate-issues-v0-prd.md`
- `packages/xtrm-tui/docs/xtrm-tui-prd.md`
- current `xtrm-dev/core/packages/pi-extensions`
- current `xtrm-dev/specialists` governed activation/system-prompt rules

## Do not redesign these decisions

- first-party communication capability is named `xtrm-intercom`;
- mature `pi-intercom` + `pi-claude-link` behavior should be adopted substantially in full;
- `xtrm-background` adopts only background process execution from `pi-background-tasks`;
- claimed XTRM Issues use Substrate-backed Issue Task Plans, not an independent `.pi/tasks` authority;
- local task != Issue, completed task != completed Issue, background job != task;
- global XTRM awareness must not depend on manual `using-xtrm` / `multiplexing` injection;
- active capabilities determine capability-specific prompt guidance;
- governed Chain communication remains Channels authority;
- Specialists remain governed role/capability authority;
- PR #188 terminal UX vocabulary is reused for task/intercom/background surfaces;
- upstream credits are a release/acceptance requirement.

## Collaboration rule

Before implementing a packet, post or record:

- packet ID from `IMPLEMENTATION-PACKETS.md`;
- repository/path ownership;
- upstream source(s) being borrowed;
- whether work is behavioral reimplementation, protocol compatibility, adapted code, or copied code;
- acceptance tests planned;
- any design conflict discovered.

Do not silently resolve a conflict by creating another source of authority. Escalate genuine architecture conflicts back to XTRM-91 and update the canonical design if the accepted decision changes.