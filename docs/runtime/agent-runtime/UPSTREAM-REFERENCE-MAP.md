# Upstream Reference Map

Canonical tracker: XTRM-91.

This is the quick implementation map; `ADOPTION-CREDITS.md` is the normative attribution ledger.

| Upstream | Borrowed/adopted area | XTRM target |
|---|---|---|
| `nicobailon/pi-intercom` | mature Pi session communication, roster, ask/reply, receipts, mailbox, cancellation/supersede, scoped routing, attachments | `xtrm-intercom` core + Pi transport |
| `alonw0/pi-claude-link` | Claude Code cross-session registry/socket compatibility and Pi↔Claude communication | `xtrm-intercom` Claude transport |
| `ismailsaleekh/pi-background-tasks` | background shell process lifecycle only | `xtrm-background` |
| `tintinweb/pi-tasks` | task tool grammar, persistent task widget, dependencies, active-form/progress UX | Substrate Issue Task Plan + XTRM task strip/manager |
| `earendil-works/pi` | AgentSession, prompt/resource seams, session/runtime semantics, Pi TUI foundations where retained | XTRM managed agent runtime |
| `tmux/tmux` | choose-tree interaction grammar / focus language | issue/task/intercom terminal browsers |
| `github/TUIKit` | semantic tokens, stable responsive terminal regions, hint/accessibility guidance | shared XTRM terminal design system |
| `clig.dev` | human-first composability, output/error/prompt discipline | CLI/operator behavior |
| `clispec.dev` | structured/non-interactive/AI-friendly CLI semantics | machine/agent surfaces |

Implementation should cite the relevant row and update the normative ledger when the adoption boundary changes.