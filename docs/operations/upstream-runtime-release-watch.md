# Upstream runtime release watch

This guide is the discovery cache for the XTRM upstream runtime release watch. It is not a release log. Re-read current default-branch code, manifests, lockfiles, runtime contracts, and tests before every disposition; current implementation overrides this guide when they disagree.

## Repository ownership

| Repository | Release-watch ownership |
| --- | --- |
| `xtrm-dev/xtrm` | Cross-repository architecture, shared contracts, Substrate/Beads migration boundary, coordinated upgrades, ledger, this guide. |
| `xtrm-dev/core` | `xt`, managed Pi packages/extensions, runtime compatibility, Claude/Codex launch integration, hooks and preflight. |
| `xtrm-dev/specialists` | `sp`, specialist activation/orchestration, Pi SDK/RPC, Specialists MCP and packaged Claude plugin. |
| `Jaggerxtrm/xtmux` | tmux/fzf runtime, provider hooks, delivery/wait/runtime observation, Claude/Codex integration. |

Historical evidence belongs in `xtrm-dev/xtrm#58` (`Upstream runtime release watch ledger`), not in this file.

## Live dependency registry

Tier A is checked every run. Tier B is checked only while present on a current runtime/tooling path.

| Upstream / package | Tier | Current discovery authority | Principal surface |
| --- | --- | --- | --- |
| `gastownhall/beads` | A | XTRM/Core remaining hook/import/storage compatibility; Specialists optional `bd` compatibility after repo-local `.beads`/hook cutover | legacy import/hooks/storage/sync; not durable work authority |
| `earendil-works/pi` / `@earendil-works/pi-*` | A | XTRM Pi manifests; Core runtime/managed-package policy; Specialists Pi activation/container; xtmux package/runtime code | AgentSession/RPC, lifecycle, extensions, TUI, provider/tool/compaction/input contracts |
| `tmux/tmux` | A | xtmux runtime/tests; Core launch/session integration | pane/session identity, popup/navigation, delivery/waits, supervisor |
| `junegunn/fzf` | A | xtmux picker/install surface | picker/navigation/terminal state |
| `oven-sh/bun` | A | Specialists container/lock; xtmux package; repo manifests | runtime/build/subprocess behavior |
| `nodejs/node` | A | Core runtime compatibility; Specialists/xtmux engines | runtime/loaders/subprocess/security/performance |
| `anthropics/claude-code` | A | Core launcher/plugin registry; XTRM Substrate plugin; Specialists packaged plugin; xtmux Claude hooks | hooks, lifecycle/resume, plugins, worktrees, transport |
| `openai/codex` | A | Core Codex runtime; xtmux Codex hooks/tests | hooks, launch/resume, worktrees, app-server/session lifecycle |
| `modelcontextprotocol/typescript-sdk` | B | live manifests/locks + MCP code | MCP protocol/client/server |
| `orhun/git-cliff` | B | xtmux package/release workflow | release tooling |
| GitNexus / `npm:pi-gitnexus` | B | Core managed registry + XTRM owner issue + live Core/Specialists call sites | indexing, MCP freshness, native FTS/embedding performance |
| `npm:@robhowley/pi-structured-return` | B | Core managed registry/docs | structured return/tool contract |
| `npm:@aliou/pi-guardrails` | B | Core managed registry | guardrail authority |
| `npm:@narumitw/pi-goal` | B | Core managed registry | goal/settled lifecycle |
| `git:github.com/DietrichGebert/ponytail` | B | Core managed registry | engineering guidance package |
| `npm:@tintinweb/pi-tasks` | B | Core managed registry | task UI/storage |
| `npm:pi-background-tasks@latest` | B | Core managed registry | background jobs/delegation; mutable selector hazard |
| `npm:pi-mcp-adapter` | B | Core managed registry | MCP discovery/auth/lifecycle |
| `npm:pi-intercom` | B | Core managed registry | Pi↔Pi live coordination |
| `git:github.com/alonw0/pi-claude-link` | B | Core managed registry | Pi↔Claude transport |
| `npm:pi-ast-grep` | B | Core managed registry | structural search |
| `npm:pi-mermaid-viewer` | B / unresolved | Core managed registry only | Mermaid TUI rendering; no release disposition until canonical source is proven |
| Dolt / DoltLab | B | live Beads storage/migration compatibility only | transitional SQL-server/storage/recovery |

Core no longer manages `npm:@gotgenes/pi-subagents`, `npm:@zenobius/pi-worktrees`, or `npm:@aliou/pi-processes`. Do not keep release-checking them from historical docs alone. Re-add only if current manifests, install policy, or runtime code makes them live again.

XTRM-owned packages such as `npm:@jaggerxtrm/pi-extensions` and `npm:@jaggerxtrm/pi-service-knowledge` use XTRM/Core release processes rather than this external-upstream watch.

Do not substitute similarly named packages. The exact unscoped Core selector `npm:pi-mermaid-viewer` remains `SOURCE_UNAVAILABLE` until its canonical publication/upstream identity is proven.

## Version and compatibility authorities

Read these current files on every affected release:

```text
xtrm-dev/xtrm
  packages/xts/package.json
  packages/xtprompt/package.json
  packages/substrate/package.json
  plugin/substrate/.claude-plugin/plugin.json
  packages/substrate/docs/claude.md
  docs/substrate/claude-transport-constraints.md

xtrm-dev/core
  package.json
  docs/runtime-compatibility.json
  docs/pi-managed-packages.md
  cli/src/core/pi-runtime.ts
  cli/src/core/codex-runtime.ts
  cli/src/core/claude-channel-status.ts

xtrm-dev/specialists
  package.json
  bun.lock
  Dockerfile
  src/activation/pi-sdk.ts
  docs/design/pi-v0.84.1-compatibility-audit.md
  docs/design/claude-mcp-integration-reference.md

Jaggerxtrm/xtmux
  package.json
  docs/INSTALL.md
  scripts/install.mjs
  src/tmux.ts
  hooks/claude/
  hooks/codex/
  tests/contracts/
```

Known divergence hazards:

- XTRM Pi packages use ranges around `0.84.x`; xtmux still characterizes exact Pi `0.80.6`; Specialists dynamically loads operator Pi while directly pinning `pi-tui 0.75.5` and its container can use mutable Pi selection. Treat each repository independently.
- Core requires Specialists `>=3.21.0 <4`, xtmux `>=0.1.0 <0.3`, and Node `>=24.0.0`; repair commands must remain usable on a drifted install.
- Core's managed Pi set mixes package identities, mutable selectors, and Git sources. Re-resolve source/publication identity each run.
- XTRM, Core, Specialists, and xtmux have independent Claude/Codex surfaces. Provider releases can affect them differently.
- Substrate is XTRM durable work authority. Beads/Dolt findings must not restore legacy authority while compatibility/import/migration paths remain.

## Impact and validation map

For a material release, establish in every affected repository: selector/range, runtime declaration, exact symbols/files, tests, and release/deployment consequence.

```text
Pi/runtime
  Core compatibility + managed-package tests
  Specialists activation/RPC tests
  XTRM/xtmux extension/tool/provider compatibility

Claude/Codex
  exact provider version/capability
  normal + restricted hook lanes
  resume/restart/worktree identity
  no false terminal state from missing evidence
  ambiguous mutation -> uncertain -> reconcile before replay

Beads/Dolt
  clean bootstrap + existing store
  topology/status + migration/import/export/sync
  restart/crash/recovery + single-writer authority
  rollback without changing Substrate authority

tmux/fzf
  real session/pane identity
  picker/navigation + terminal-state restoration
  wait/delivery/supervisor negative paths

MCP
  protocol/client/server matrix
  reconnect/readiness
  authorization + secret redaction
```

Measure subprocess count, wall time/latency, peak RSS, CPU/I/O, startup/re-index cost, and recovery cost when a release touches a performance-critical path.

## Deduplication and routing

Use the conceptual fingerprint:

```text
upstream + release/version + normalized capability/contract + affected XTRM surface
```

Search open/closed issues, PRs, the ledger, and current plans before creating work. Extend an existing issue when implementation target and acceptance boundary remain the same.

Route Core/xt/Pi/runtime compatibility to `xtrm-dev/core`; Specialists/orchestration/execution-protocol/MCP to `xtrm-dev/specialists`; xtmux/tmux/fzf/provider-hook/supervisor to `Jaggerxtrm/xtmux`; shared contracts/coordinated upgrades/Beads migration to `xtrm-dev/xtrm`.

Use explicit states: `VERIFIED_UPSTREAM_RELEASE`, `VERIFIED_XTRM_IMPACT`, `ACTIONABLE_ALREADY_TRACKED`, `ACTIONABLE_NEW_ISSUE`, `NO_ACTION_WITH_RATIONALE`, `SOURCE_UNAVAILABLE`, `NEEDS_BOUNDED_SPIKE`.

## Discovery rules

1. Cold-read default branches first; code/tests/manifests/runtime contracts override this guide.
2. Check Tier A primary sources for the preceding 24 hours. Use at most 72 hours only to recover missing durable dispositions.
3. Rediscover Tier B from live manifests, install docs, registries, provider adapters, scripts, lockfiles, and code paths.
4. Add/promote an upstream when it controls a runtime/security/protocol/persistence/performance boundary or can delete material compatibility code.
5. Remove/demote it when the live path disappears and no supported compatibility/migration surface remains.
6. Use releases/tags, changelog/migration/API docs, compare diffs, PRs, and implementation as primary evidence. Registry metadata may confirm version/time.
7. Do not create generic dependency-update issues.
8. Update this guide only when this dependency/context map materially changes. Put per-run evidence in `xtrm-dev/xtrm#58`.
