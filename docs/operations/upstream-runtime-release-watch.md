# Upstream runtime release watch

This guide is the discovery cache for the XTRM upstream runtime release watch. It is not a release log. Re-read current default-branch code, manifests, lockfiles, runtime contracts, and tests before every disposition; current implementation overrides this guide when they disagree.

## Repository ownership

| Repository | Primary release-watch ownership |
| --- | --- |
| `xtrm-dev/xtrm` | Cross-repository architecture; shared runtime contracts; Substrate/Beads migration boundary; coordinated upgrades; release-watch ledger and this guide. |
| `xtrm-dev/core` | `xt`, managed Pi packages/extensions, runtime compatibility, Claude/Codex launch integration, hooks and operator/runtime preflight. |
| `xtrm-dev/specialists` | `sp`, specialist activation/orchestration, Pi SDK/RPC integration, Specialists MCP and packaged Claude plugin. |
| `Jaggerxtrm/xtmux` | tmux/fzf runtime surface, provider hooks, delivery/wait/runtime observation, Claude/Codex hook integration. |

The canonical historical ledger is `xtrm-dev/xtrm#58` (`Upstream runtime release watch ledger`). The ledger is evidence, not implementation backlog.

## Live dependency registry

Tier A means check every run. Tier B means check while the dependency is present on a live runtime/tooling path; promote only when repeated evidence shows architecture-critical coupling.

| Upstream / package | Tier | Current XTRM discovery authority | Principal affected surface |
| --- | --- | --- | --- |
| `gastownhall/beads` | A | XTRM migration/import compatibility source, Specialists optional `bd` prerequisite, current Beads/Dolt compatibility work | legacy issue import/hooks/storage/sync compatibility; not XTRM durable work authority |
| `earendil-works/pi` / `@earendil-works/pi-coding-agent` | A | `xtrm/packages/xts/package.json`; Core managed-package docs/runtime; Specialists `src/activation/pi-sdk.ts`, `Dockerfile`, Pi compatibility docs; xtmux `package.json` | AgentSession/RPC, lifecycle, extensions, TUI, providers, compaction, steering/follow-up, tools |
| `tmux/tmux` | A | xtmux install/runtime code and tests; Core launch/session integration | terminal/session identity, panes, popup/navigation, delivery/waits, runtime observation |
| `junegunn/fzf` | A | xtmux picker/install surface | session picker/navigation and terminal state |
| `oven-sh/bun` | A | Specialists `Dockerfile`/lockfile; xtmux `package.json`; repo manifests | runtime/build behavior and Bun-specific subprocess/test paths |
| `nodejs/node` | A | Core `docs/runtime-compatibility.json`; Specialists/xtmux package engines; runtime code | process/runtime compatibility, loaders, subprocesses, security/performance boundaries |
| `anthropics/claude-code` | A | Core Claude launcher/plugin registry; XTRM Substrate Claude plugin; Specialists packaged Claude plugin; xtmux `hooks/claude/` | hooks, plugin delivery/cache, lifecycle/resume, MCP, worktrees, provider transport |
| `openai/codex` | A | Core `cli/src/core/codex-runtime.ts`; xtmux `hooks/codex/` and distribution tests | provider hooks, launch/resume, worktrees, app-server/session lifecycle |
| `modelcontextprotocol/typescript-sdk` | B | live package manifests/locks and MCP server/client code | MCP protocol/server/client compatibility |
| `orhun/git-cliff` | B | xtmux `package.json` plus changelog workflow/config | changelog/release tooling when runtime release flow depends on it |
| GitNexus / `npm:pi-gitnexus` | B | Core managed-package registry and current XTRM integration/issue owner | code graph indexing, MCP freshness, native FTS/embedding performance |
| `npm:@robhowley/pi-structured-return` | B | Core `docs/pi-managed-packages.md` / `cli/src/core/pi-runtime.ts` | structured return/tool contract |
| `npm:@aliou/pi-guardrails` | B | Core managed-package registry | policy/guardrail authority boundary |
| `npm:@narumitw/pi-goal` | B | Core managed-package registry | session goal/settled-lifecycle behavior |
| `git:github.com/DietrichGebert/ponytail` | B | Core managed-package registry | engineering/reduction guidance package behavior |
| `npm:@tintinweb/pi-tasks` | B | Core managed-package registry | task UI/storage; optional external subagent RPC must not be assumed compatible with the approved fork |
| `npm:pi-background-tasks@latest` | B | Core managed-package registry | durable background jobs/delegation; mutable `@latest` selector is a version-discovery hazard |
| `npm:@gotgenes/pi-subagents` | B | Core managed-package registry and compatibility issue owner | in-process subagents, typed lifecycle/service behavior |
| `npm:pi-mcp-adapter` | B | Core managed-package registry and compatibility issue owner | MCP discovery/negotiation/auth/lifecycle |
| `npm:pi-intercom` | B | Core managed-package registry | Pi↔Pi targeted live coordination transport |
| `git:github.com/alonw0/pi-claude-link` | B | Core managed-package registry | Pi↔Claude cross-session transport |
| `npm:pi-ast-grep` | B | Core managed-package registry | read-only structural code search |
| `npm:@zenobius/pi-worktrees` | B | Core managed-package registry | Pi worktree lifecycle |
| `npm:@aliou/pi-processes` | B | Core managed-package registry | process lifecycle |
| `npm:pi-mermaid-viewer` | B / unresolved source | Core managed-package registry only | Pi TUI Mermaid rendering; do not disposition releases until canonical package/upstream identity is proven |
| Dolt / DoltLab | B | only while live Beads storage/migration compatibility depends on them | transitional Beads SQL-server/storage/recovery behavior |

XTRM-owned managed packages such as `npm:@jaggerxtrm/pi-extensions` and `npm:@jaggerxtrm/pi-service-knowledge` are part of the runtime registry but are not external upstreams for this watch. Track their compatibility through XTRM/Core release processes instead.

Do not substitute a similarly named package for an unresolved selector. In particular, the exact unscoped Core selector `npm:pi-mermaid-viewer` remains unresolved until its canonical publication/upstream identity is proven.

## Current version and compatibility authorities

Read these files on every affected release instead of copying their values into daily evidence:

```text
xtrm-dev/xtrm
  packages/xts/package.json
  packages/substrate/package.json
  plugin/substrate/.claude-plugin/plugin.json
  packages/substrate/docs/claude.md
  docs/substrate/claude-transport-constraints.md

xtrm-dev/core
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
  scripts/e5-packaged-plugin-e2e.mjs

Jaggerxtrm/xtmux
  package.json
  docs/INSTALL.md
  scripts/install.mjs
  src/tmux.ts
  hooks/claude/
  hooks/codex/
  tests/contracts/
```

Known divergence hazards at the time this guide was restored:

- XTRM `packages/xts` declares `@earendil-works/pi-coding-agent` `^0.84.2`.
- xtmux `0.2.5` pins Pi AI/coding-agent dev characterization to `0.80.6`, Bun to `1.3.14`, and requires Node `>=20`.
- Specialists `3.21.6` deliberately loads the operator-installed `@earendil-works/pi-coding-agent` dynamically rather than hard-depending on it. Its container currently defaults `PI_VERSION=latest`; treat that mutable selector as a characterization hazard, not as a stable pin.
- Core's compatibility contract requires Specialists `>=3.21.0 <4`, xtmux `>=0.1.0 <0.3`, and Node `>=24.0.0`. The launch preflight enforces sibling ranges; repair commands must remain usable on a drifted install.
- Core's managed Pi set mixes exact package identities with mutable selectors and Git sources. Re-resolve publication/source identity before claiming a release window.
- XTRM, Core, Specialists, and xtmux each have distinct Claude integration surfaces. A Claude release can therefore affect plugin packaging, launch behavior, MCP readiness, and hook/lifecycle observation independently.
- XTRM durable work authority is Substrate. Beads/Dolt findings must not silently restore legacy work authority while compatibility/import/migration paths remain in use.

## Impact and validation map

For a material upstream release, establish the baseline independently in every affected repository: exact selector/range, runtime declaration, call sites/symbols, tests, and release/deployment consequence. Never infer a shared Pi/Node/provider version from another repository.

Use the smallest relevant validation set, then add release-specific negative proofs:

```text
Pi/runtime
  Core runtime compatibility + managed-package tests
  Specialists activation/RPC/compatibility tests
  xtmux Pi extension/runtime tests

Claude/Codex
  real provider version/capability probe
  normal + restricted hook lanes
  resume/restart/worktree identity
  no false terminal state when hooks/events are absent
  ambiguous mutation -> uncertain -> reconcile before replay

Beads/Dolt
  clean bootstrap + existing store
  restart/crash/recovery
  import/export/sync/migration
  single-writer/concurrency boundary
  rollback without changing Substrate authority

tmux/fzf
  real tmux session/pane identity
  picker/navigation and terminal-state restoration
  wait/delivery/runtime-supervisor negative paths

MCP
  protocol/client/server matrix
  reconnect/startup/readiness
  authorization and secret-redaction boundary
```

Measure performance when the upstream change touches a critical path: subprocess count, wall time/latency, peak RSS, CPU/I/O, startup/re-index work, and recovery cost. A release note is not performance evidence.

## Deduplication and issue routing

Before creating an issue, search open and closed issues plus relevant PRs across all four repositories and inspect the ledger/current plans. Use this conceptual fingerprint:

```text
upstream + release/version + normalized capability/contract + affected XTRM surface
```

Extend an existing issue when the implementation target and acceptance boundary are unchanged. Create a new issue only for an independently actionable decision.

Route isolated Core/xt/Pi-extension/runtime compatibility to `xtrm-dev/core`; Specialists/orchestration/execution-protocol/MCP to `xtrm-dev/specialists`; xtmux/tmux/fzf/provider-hook/runtime-supervisor to `Jaggerxtrm/xtmux`; shared contracts/coordinated upgrades/Beads program-level migration to `xtrm-dev/xtrm`.

Every release-watch comment or issue must use explicit evidence states: `VERIFIED_UPSTREAM_RELEASE`, `VERIFIED_XTRM_IMPACT`, `ACTIONABLE_ALREADY_TRACKED`, `ACTIONABLE_NEW_ISSUE`, `NO_ACTION_WITH_RATIONALE`, `SOURCE_UNAVAILABLE`, or `NEEDS_BOUNDED_SPIKE`.

## Discovery rules

1. Cold-read default branches first. Code, tests, manifests, lockfiles, and runtime contracts override this guide.
2. Check Tier A primary sources for the immediately preceding 24 hours. Use at most a 72-hour recovery window only for missing durable dispositions.
3. Re-discover Tier B from live manifests, install docs, managed-package registries, provider adapters, scripts, lockfiles, and active code paths.
4. Add/promote an upstream when it controls a runtime contract, security boundary, provider/protocol, persistence format, performance-critical path, or can delete substantial compatibility code.
5. Remove/demote it when the live path is deleted and no supported migration/compatibility surface remains.
6. Use upstream releases/tags, changelog/migration/API docs, compare diffs, PRs, and implementation as primary evidence. Registry metadata may confirm package version/time.
7. Do not create generic dependency-upgrade issues. Open or extend work only for a concrete compatibility risk, bounded evaluation, simplification, measurable improvement, or architecture decision.
8. Update this guide only when this dependency/context map materially changes. Put per-run evidence in `xtrm-dev/xtrm#58`, never here.
