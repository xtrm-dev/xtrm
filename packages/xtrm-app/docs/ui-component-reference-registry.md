# UI component reference registry

**Status:** canonical index of **external** UI and agent-UI references for `packages/xtrm-app`
(created 2026-09-16; boundary stated 2026-11-23).
**Purpose:** one durable place that lists every external UI source an implementation agent must consult before building a component. Dispositions follow `adoption-audit.md` §2 (`DEPEND` / `ADAPT` / `REFERENCE` / `REJECT`). Audit evidence for each entry stays in the linked audit file.

**This file is not the console's component registry.** It indexes sources outside the repository. The
as-built catalogue of the console's own components — their props, geometry, tokens, the one component
per concept, and the migration table of removed idioms — is
[`design/console-ui-system.md`](design/console-ui-system.md) (XTRM-940). A question of the form "which
component renders this?" is answered there; a question of the form "which external kit may I consult?"
is answered here.

## How agents use this registry

1. Before you build a primitive or surface, find the matching row below.
2. If an MCP server is listed, use it to search and view the source. The servers are configured in the repository `.mcp.json`. Restart Claude Code after the configuration changes.
3. Registry installs (`npx shadcn@latest add @<registry>/<item>`) land in `packages/xtrm-app/src/components/registry/` (see `components.json`). That directory is quarantine: adapt the code to Base UI, XTRM tokens, and `src/ui` primitives before any feature code imports it.
4. XTRM primitives stay on `@base-ui/react` (`adoption-audit.md` §15.1). A registry component built on Radix is an `ADAPT` source for markup, motion, and interaction, not a second primitive layer.

## MCP servers (repository `.mcp.json`)

| server | transport | what it does |
|---|---|---|
| `shadcn` | stdio, `npx -y shadcn@latest mcp --cwd packages/xtrm-app` | search, view, and install from every registry in `packages/xtrm-app/components.json` (`@shadcn`, `@spectrumui`, `@agents-ui`) |
| `spectrum-ui` | stdio, `npx -y @spectrumui/mcp` | Spectrum UI catalog: `list_components`, `search_components`, `get_component`, `list_categories`, `install_component` |
| `livekit-docs` | http, `https://docs.livekit.io/mcp` | LiveKit docs, including Agents UI: `get_docs_overview`, `get_pages`, `docs_search`, `code_search` |

`install_component` from `spectrum-ui` targets a Next.js project root. In this repository, prefer `shadcn` MCP view/install with `--cwd packages/xtrm-app`, then adapt.

## Foundations

| reference | URL | license | good for | disposition | XTRM surfaces | audit status |
|---|---|---|---|---|---|---|
| Base UI | https://base-ui.com | MIT | unstyled accessible primitives: menu, popover, dialog, tooltip, select, tabs | **DEPEND** (`@base-ui/react`) | all | audited (`adoption-audit.md` §12, §15) |
| shadcn/ui | https://ui.shadcn.com | MIT | source-owned component foundation; registry + MCP; blocks such as `sidebar-*`, `data-table`, `dashboard-01` | **ADAPT** (registry source into `src/components/registry`, restyled onto Base UI and XTRM tokens) | sidebar, tables, forms, field editors | registry verified 2026-09-16; component-level audit pending |
| Spectrum UI | https://ui.spectrumhq.in (source `arihantcodes/spectrum-ui`) | Apache-2.0 (NOTICE obligations apply) | 250+ shadcn-registry components on Radix + Motion. Relevant: `animated-drawer`, `sidebar-navbar`, `tree-nav`, `command-palette`, `command-search`, `data-table`, `kanbanboard`, `multiple-selector-*`, `expandable-action-bar`, `inline-edit`, `agent-plan` | **ADAPT** selectively (interaction/motion recipes; restrain decorative animation to the §15 visual standard) | drawer, sidebar tree, command/search, issue table, board view, multi-select fields | registry verified 2026-09-16. Audited 2026-09-16 via MCP: `kanbanboard` (sample data, no ARIA, native drag, shadcn Card/Badge/Avatar + lucide), `tree-nav` (flat link list with a decorative spring marker), `data-table` (~2000 lines, no virtualization), `animated-drawer` (vaul) are **REFERENCE** only; the Issues board was built on XTRM primitives from the `kanbanboard` interaction recipe. Remaining components pending |

## Agent UI

| reference | URL | license | good for | disposition | XTRM surfaces | audit status |
|---|---|---|---|---|---|---|
| LiveKit Agents UI | https://docs.livekit.io/frontends/agents-ui/ (source `livekit/components-js/packages/shadcn`) | Apache-2.0 (verify at adoption) | shadcn registry on shadcn + AI Elements: `agent-chat-transcript`, `agent-session-provider`, `agent-session-view-01`, control bar; React 19 + Tailwind 4 | **REFERENCE** now, **ADAPT** candidate for the Agent/Frames tranche (transcript/session-state patterns; media controls out of scope) | Agent surface, Frame timeline, composer | registry verified 2026-09-16; not audited |
| `zvzuola/acp-components` | GitHub | see `adoption-audit.md` §3 | session/workspace state, tool UI, permissions, diff/file, composer, session CRUD/fork | per `adoption-audit.md` §3 | Agent tranche | audited earlier (`adoption-audit.md` §3) |
| ACP Kit (`AcpKit/acp-kit`) | GitHub | see `adoption-audit.md` | generic ACP runtime for non-Pi agents | per PRD §23 | runtime | referenced in PRD §23 |
| OpenCode session UI | GitHub | see `adoption-audit.md` §3 | projection, tool rendering, deferred rendering, virtualization, diff/review | **REFERENCE** (do not copy vertical transcript navigation) | Agent tranche | `adoption-audit.md` §3 |
| Panes | GitHub | see `adoption-audit.md` §3 | Tauri 2 + React architecture, sidecar lifecycle, lazy hydration | **REFERENCE** | desktop packaging | `adoption-audit.md` §3 |
| Prime Agent | internal research doc | — | runtime reference | **REFERENCE** | runtime | `docs/research/prime-agent-xtrm-runtime-reference-2026-08-09.md` |
| Hermes IDE | GitHub | restrictive (competing IDE use) | reference only | **REFERENCE** only | — | PRD §24 |

## Full product references

| reference | URL | license | good for | disposition | audit |
|---|---|---|---|---|---|
| Supernova | `mattiacerutti/supernova` | MIT | primary visual benchmark; timeline, activity groups, sidebar rows, composer, session runtime | **ADAPT** patterns (values rejected) | `console-v2-audit-supernova.md` |
| PiChamber | `RyderAsKing/PiChamber` | MIT (dual copyright) | protocol/runtime engineering: IPC, SSE budgets, idempotent send, paging | **ADAPT** protocols, **REJECT** UI stacks | `console-v2-audit-pichamber.md` |
| Conar | `wannabespace/conar` | AGPL-3.0 | panel mechanics and dependency selection only | **REFERENCE** only (no source copying) | `console-v2-audit-conar-ui.md` |
| DeepSeek Harness | `deepseek-ai/deepseek-harness` | MIT | agent lifecycle, durable/live event separation, projections | **REFERENCE** / specs for wave H | `console-v2-audit-deepseek-harness.md` |
| Console v1 | `Jaggerxtrm/console` | internal | proven GitHub backend, Program read model, rich issue drawer (tabs: Overview, Lineage, Activity, Evidence, GitHub, Memories, Followups) | backend **PRESERVE**; drawer information architecture is a **parity baseline**; its inline mutation panel is **REJECT** (broken UX) | `console-v2-audit-console-v1-preservation.md`, `console-v2-audit-console-program-graph-drawer.md` |

## Specialized

| reference | license | good for | disposition | status |
|---|---|---|---|---|
| `@tanstack/react-virtual` | MIT | virtualization | **DEPEND** | in use |
| `@tanstack/react-router`, `@tanstack/react-query` | MIT | routing, single query layer | **DEPEND** | in use |
| `motion-panels` | MIT | resizable shell panels | **DEPEND** (exact pin, one import site) | in use |
| `cmdk` | MIT | search and command palette | **DEPEND** | in use |
| HugeIcons (`@hugeicons/react`, `@hugeicons/core-free-icons`) | MIT | single icon family behind a typed registry | **DEPEND** | in use |
| `react-markdown` + `remark-gfm` | MIT | rendering contract prose and journal entries | **DEPEND** (proposed for the Jira-style issue editor) | pending |
| Tiptap (`@tiptap/*`) | MIT | rich markdown editing for contract fields; Supernova composer precedent | **ADAPT/DEPEND** candidate for the Jira-style editor | pending decision |
| Shiki / `@pierre/diffs` | MIT / Apache-2.0 | code and diff rendering | **DEPEND** candidate (NOTICE) | `adoption-audit.md` §15.2 |
