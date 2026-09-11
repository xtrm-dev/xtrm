# XTRM upstream runtime release watch

**Status:** operational context cache  
**Authority:** current default-branch code, tests, manifests, lockfiles, runtime contracts, released artifacts, and live compatibility evidence outrank this guide.

This file is the bounded cold-start map for the upstream runtime release watch. It is not a daily log.

## Repository ownership

| Repository | Default | Ownership |
| --- | --- | --- |
| `xtrm-dev/xtrm` | `main` | cross-repository architecture, shared runtime contracts, work-state / Beads→Substrate migration, release-watch ledger |
| `xtrm-dev/core` | `main` | `xt`, runtime launch, managed Pi packages, install/update policy, provider/runtime compatibility |
| `xtrm-dev/specialists` | `master` | `sp`, Specialist execution/runtime protocol, Pi RPC/TUI, MCP server surface |
| `Jaggerxtrm/xtmux` | `main` | tmux/fzf runtime, navigation, durable delivery/wake/wait state, Claude/Codex lifecycle hooks |

Route work to the repository that owns implementation. Use `xtrm-dev/xtrm` only for a shared contract or coordinated migration. Do not create a central issue plus redundant leaf issues for one implementation boundary.

## Work-state authority

`docs/substrate/README.md` is the current operator authority:

```text
Substrate owns durable work.
Git owns code truth.
bd is read/import compatibility only.
```

Beads and Dolt remain watched only while supported default-branch paths still execute `bd`/Dolt compatibility, hook, storage, import, rollback, or migration logic. A Beads release finding must not restore Beads as root work authority.

## Tier A — always check

| Upstream | Live surface |
| --- | --- |
| `gastownhall/beads` | transitional read/import/migration/hook compatibility; Dolt topology and failure semantics while executable `bd` paths remain. Search former `steveyegge/beads` naming during deduplication. |
| `earendil-works/pi` | XTRM `packages/xts`; Core managed extensions; Specialists RPC/TUI; xtmux Pi integration. There is no fleet-wide Pi version. |
| `tmux/tmux` | xtmux backend and Core worktree/session launch; identity, environment, popup/navigation, delivery, waits and hooks. |
| `junegunn/fzf` | xtmux picker/navigation. |
| `oven-sh/bun` | xtmux packaged/runtime tooling and Specialists build/test/runtime. |
| `nodejs/node` | Core/XTRM/xtmux runtime and build tooling. |
| official Claude Code | Core provider launch and xtmux lifecycle/delivery hooks. Missing hook evidence is never proof of terminal state. |
| `openai/codex` | Core live launch/resume, xtmux lifecycle hooks, XTRM Codex hooks, Specialists command-outcome consumption. `xtrm#86` owns compatibility characterization. |

## Tier B — check while directly present

| Upstream/package | Consumer / hazard |
| --- | --- |
| `modelcontextprotocol/typescript-sdk` / `@modelcontextprotocol/sdk` | Specialists MCP server/transports/schema. |
| `tintinweb/pi-gitnexus` / `pi-gitnexus` | Core adapter; recursively check GitNexus. |
| `abhigyanpatwari/GitNexus` / `gitnexus` | Core bootstrap/MCP/hooks/skills and Specialists re-index/review. `xtrm#116` owns live-index/process/freshness decisions. |
| `gotgenes/pi-packages` / `@gotgenes/pi-subagents` | Core required native-subagent primitive. XTRM grants and Specialist completion remain higher-level authority. `core#622` owns version/settlement characterization. |
| `ismailsaleekh/pi-background-tasks` / `pi-background-tasks` | Core managed package; provider registration makes auth/history/cache/compaction a runtime-security boundary. `core#623` owns the decision. |
| `zenobi-us/pi-worktrees` / `@zenobius/pi-worktrees` | Core managed package; subordinate to Core worktree authority. |
| `robhowley/pi-userland` / `@robhowley/pi-structured-return` | Core managed package; use package-specific monorepo release provenance. |
| `aliou/pi-guardrails` / `@aliou/pi-guardrails` | Core managed security/tool boundary. |
| `aliou/pi-processes` / `@aliou/pi-processes` | Core managed process-lifecycle package. |
| `nicobailon/pi-mcp-adapter` / `pi-mcp-adapter` | Core managed MCP adapter; `core#602` owns mutable resolution/runtime identity. |
| `narumiruna/pi-extensions` / `@narumitw/pi-goal` | Core optional package. Do not infer impact from unrelated `@narumitw/*` releases. |
| `DietrichGebert/ponytail` / Git selector | Core optional unpinned Git input; inspect default-branch movement when releases are absent. |
| `tintinweb/pi-tasks` / `@tintinweb/pi-tasks` | Core optional task package; upstream `@tintinweb/pi-subagents` integration is not assumed compatible with XTRM's `@gotgenes` fork. |
| `nicobailon/pi-intercom` / `pi-intercom` | Core required Pi↔Pi transport; XTRM multiplexing remains higher-level authority. |
| `alonw0/pi-claude-link` / Git selector | Core required Pi↔Claude transport; watch commit identity when releases are absent. |
| `Fadouse/pi-ast-grep` / `pi-ast-grep` | Core required read-only structural search; only runtime/compatibility/security changes are actionable. |
| `pi-mermaid-viewer` | Core optional renderer. Canonical upstream/publication identity is not established; record `SOURCE_UNAVAILABLE` until exact source is proven. Never substitute a similarly named package. |
| `orhun/git-cliff` / `git-cliff` | Core/xtmux release tooling; actionable only when invocation/format semantics affect release execution. |
| `dolthub/dolt` | transitional Beads storage where still supported; `core#612` owns standalone Dolt version authority and `xtrm#107` owns coordinated Beads migration compatibility. |

`oraios/serena` is not a live default-branch dependency. Re-promote it only if current executable code/config makes it live again.

Core-owned `@jaggerxtrm/pi-extensions` and `@jaggerxtrm/pi-service-knowledge` are internal release boundaries, not external upstreams.

## Core managed-Pi discovery

Cold-read these on every run:

```text
xtrm-dev/core
  cli/src/core/pi-runtime.ts
  docs/pi-managed-packages.md
  package.json#pi.packages
  .xtrm/config/pi/install-schema.json
  .xtrm/config/pi/settings.json.template
```

Current external selectors include `pi-gitnexus`, `@robhowley/pi-structured-return`, `@aliou/pi-guardrails`, `@narumitw/pi-goal`, `DietrichGebert/ponytail`, `@tintinweb/pi-tasks`, `pi-background-tasks@latest`, `@gotgenes/pi-subagents`, `pi-mcp-adapter`, `pi-mermaid-viewer`, `pi-intercom`, `alonw0/pi-claude-link`, `pi-ast-grep`, `@zenobius/pi-worktrees`, and `@aliou/pi-processes`.

Unqualified npm selectors, `@latest`, Git head, `releases/latest`, Homebrew latest, and PATH lookup are mutable executable authority. Establish exact resolved identity before making compatibility claims.

## Version-divergence hazards

These are orientation signals only; re-read current manifests/lockfiles before each material disposition.

```text
XTRM packages/xts
  pi-coding-agent ^0.84.2
  pi-tui          ^0.84.2
  Node            >=24
  exact local resolution: packages/xts/package-lock.json

Core
  Node >=24
  managed packages: package.json#pi.packages + cli/src/core/pi-runtime.ts + .xtrm/config/pi/*

Specialists
  pi-tui 0.75.5
  MCP SDK 1.29.0
  independent Bun/runtime-image compatibility

xtmux
  Pi integration 0.80.6
  Bun 1.3.14
  Node >=20
  independent Claude/Codex hook runtime

Core runtime compatibility
  Specialists >=3.21.0 <4
  xtmux       >=0.1.0 <0.3
```

Never infer one global Pi, Bun, Node, or provider baseline.

## Canonical pointers

```text
xtrm-dev/xtrm
  docs/substrate/README.md
  docs/shared/xtrm-current-execution-plan.md
  docs/shared/xtrm-v1-completion-ledger.md
  docs/shared/native-chain-runtime-audit-2026-08-19/source-and-authority-register.md
  docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md
  packages/xts/package.json
  packages/xts/package-lock.json
  .codex/hooks.json

xtrm-dev/core
  package.json
  docs/runtime-compatibility.json
  docs/pi-managed-packages.md
  .xtrm/config/pi/install-schema.json
  .xtrm/config/pi/settings.json.template
  .xtrm/config/pi.mcp.json
  cli/src/core/pi-runtime.ts
  cli/src/core/codex-runtime.ts
  cli/src/utils/codex-worktree-session.ts
  cli/src/core/machine-bootstrap.ts
  cli/src/commands/init.ts
  cli/src/core/init-verification.ts
  cli/src/tests/pi-runtime-safeguards.test.ts
  scripts/check-runtime-compatibility.mjs
  scripts/check-pi-extension-manifest.mjs

xtrm-dev/specialists
  package.json
  bun.lock
  Dockerfile
  docs/design/pi-v0.84.1-compatibility-audit.md
  config/mandatory-rules/gitnexus-required.md
  src/pi/session.ts
  src/specialist/supervisor.ts
  src/cli/launch-outcome.ts

Jaggerxtrm/xtmux
  package.json
  docs/INSTALL.md
  scripts/install.mjs
  bin/tmux-session-picker
  extensions/
  hooks/claude/
  hooks/codex/
  src/domains/deliveries/
  test/nav-contract.sh
  test/contract.sh
```

## Affected-surface map

```text
Pi
  XTRM direct SDK/TUI
  Core managed packages
  Specialists RPC/TUI/runtime image
  xtmux Pi observation/extensions

GitNexus
  Core bootstrap + MCP + hooks/skills
  Specialists review/re-index
  direct CLI/index + long-lived MCP readers

Substrate / Beads / Dolt
  Substrate = durable-work authority
  Beads = read/import/migration/hook compatibility while executable paths remain
  Dolt = Beads storage compatibility where still supported

Claude Code
  Core launch/provider integration
  xtmux lifecycle/delivery hooks

Codex
  Core launch/resume/trust/outcome
  xtmux Stop/turn/reply hooks
  XTRM Codex hooks
  Specialists launch-outcome consumer

tmux/fzf
  picker/navigation + pane/session identity + delivery/wait semantics

MCP
  Specialists SDK/server/transports
  Core pi-mcp-adapter
  GitNexus MCP backend
```

Look for more than breakage. Upstream-native behavior is actionable when it can delete compatibility code, reduce polling/subprocesses, improve restart/recovery, strengthen authority/security, or simplify an accepted XTRM design.

## Known hazards

1. Pi versions are deliberately divergent.
2. Mutable acquisition is executable authority.
3. `required=false` changes health semantics; it does not sandbox an installed package.
4. Provider replacement requires auth, routing, history, cache, restart and negative proofs.
5. External child primitives do not own XTRM grants or durable completion.
6. Adapters can hide architecture-critical backends; track adapter and backend separately.
7. Ambient executable identity is not a compatibility claim.
8. Unpinned managed Git packages require commit-level watching when releases are absent.
9. Historical docs/residue do not keep retired surfaces in Tier B.
10. Work-state migration is one-way. Beads compatibility findings do not restore Beads authority over Substrate work.

## Minimum validation

```text
xtrm-dev/core
  npm run check:runtime-compat
  npm run check:pi-manifest
  npm run typecheck --workspace cli
  npm test --workspace cli

xtrm-dev/specialists
  bun run lint
  bun run test
  focused Pi RPC/compatibility lanes when relevant

Jaggerxtrm/xtmux
  bun run typecheck
  npm test
  provider-specific restart/hook smokes when required
```

For managed Pi packages, capture exact package identity, clean install/update/reload, and negative authority/security proofs. Presence in `pi list` is not compatibility evidence.

For GitNexus, capture direct executable identity separately from `pi-gitnexus`; verify single-writer ownership, truthful fresh/stale/diverged/unknown state, restart/teardown, DB locking, branch/worktree identity, cold/warm performance and peak RSS.

For Codex, separate launcher argv/safety authority, persisted thread identity, hook lifecycle, resume/restart behavior, and downstream `xtrm.command-outcome.v1` compatibility.

## Release-window and dedup rules

- Primary window: immediately preceding 24 hours.
- Recovery: at most 72 hours, only to repair missing durable evidence from an incomplete prior run.
- Do not re-process completed dispositions.
- Search open/closed issues and relevant PRs across all four repositories by upstream/package, release, changed symbol/capability, and proposed implementation topic.
- Fingerprint `upstream + release/version + normalized capability/contract + affected XTRM surface`.
- Extend an existing owner when new release evidence changes the recommendation but not the implementation boundary.
- Create an issue only for a bounded useful action, risk, decision, simplification, or spike.
- Keep run evidence in `xtrm-dev/xtrm#58`, not Git.
- Use explicit states: `VERIFIED_UPSTREAM_RELEASE`, `VERIFIED_XTRM_IMPACT`, `ACTIONABLE_ALREADY_TRACKED`, `ACTIONABLE_NEW_ISSUE`, `NO_ACTION_WITH_RATIONALE`, `SOURCE_UNAVAILABLE`, `NEEDS_BOUNDED_SPIKE`.
- Never claim compatibility/safety without exact affected-surface evidence.

## Discovery and demotion

Promote an upstream when a current manifest, lockfile, installer, runtime config, provider adapter, script, or active code path shows that it controls a protocol, provider, persistence format, process lifecycle, security boundary, compatibility contract, or performance-critical runtime path.

For Core managed Pi packages, diff the external selector set against this guide each run. If an unpinned Git source has no releases, inspect default-branch movement. If canonical registry/repository identity cannot be established, record `SOURCE_UNAVAILABLE`; never substitute a similarly named package.

Do not add ordinary transitive libraries. Demote an upstream when current default-branch code no longer executes or depends on it. For Beads/Dolt, confirm that no supported path still executes `bd`/Dolt for hooks, storage, import, rollback, or migration before demotion. Preserve historical ledger/issues instead of retaining dead surfaces in the live map.
