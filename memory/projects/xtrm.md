# Project: xtrm

## What it is
Closed-source umbrella **monorepo** for the xtrm product family — a daemon-backed system for
orchestrating agent ("specialist") work over a shared state engine. v0.1.0, on `main`, mid-migration:
per-package history is being grafted from upstream repos (`specialists`, `xtrm-tools`, …) via
`git filter-repo --to-subdirectory-filter <pkg>` + `git merge --allow-unrelated-histories`.

## Architecture (canonical ownership)
| Package | CLI | Role |
|---|---|---|
| `packages/core` | `xt` | `xt daemon` + state engine + `state.db` + Unix socket protocol; bootstrap/worktree/install/update |
| `packages/substrate` | `sb` | domain layer: issues, containers, plans, collisions, validator, memory |
| `packages/channels` | — | cross-container channel primitives |
| `packages/specialists` | `sp` | specialist runtime |
| `apps/console` | — | xt-console (gitboard descendant) + materializer |

Invariant: domain packages hard-import `@xtrm/core` `StateClient` and speak to the daemon over the
socket — they **never** open `state.db` directly. Single-scheduler invariant: only the daemon schedules
resumes; the mailbox is a control/audit channel, not a scheduler.

## Cross-cutting systems
- **devops** — spans xt+sp+sb; NOT a package. Canonical: `xtrm/devops/devops-system.md`. Open decisions in §14. Lands late.
- **telemetry/forensic** — `xtrm.forensic.v1` envelope. Canonical (to create): `telemetry/forensic-event-contract.md`. Bead `60w93.1`.
- **chains** — chain primitive; design inside substrate. Chain-templates as `.formula.json` (15 canonical, repo).
- **shepherd/tether** — always-on context injection sidecar (design `xtrm/tether.md`, sequenced v0→v2).

## Source-of-truth map (from xtrm-MOC.md, 2026-06-01)
- **substrate** → canonical `xtrm/substrate/substrate_design_it.md` (IT). `substrate_design_en.md` = **STALE**.
- **channels** → canonical `xtrm/channels/channels.md` (⚠️ repo copies still exist).
- **chain-templates** → `xtrm/substrate/chain_templates.md` (⚠️ duplicated with repo; `.formula.json` stay in repo).
- **devops** → `xtrm/devops/devops-system.md` (sources moved to `xtrm/archive/`).
- **execution roadmap** → `repo:specialists-roadmap.md` (canonical for `kj651`).

> Vault = thinking/deliberation/cross-repo. Repo = frozen SSOT that CI/agents/executors validate against.
> When in doubt about which copy is authoritative, check the MOC.

## Active work
> **Two trackers, by actor:** agent/robot work → **beads** (`bd`, below). Human work (mine + my
> one collaborator's) → **Jira**. Keep them distinct; don't fold Jira items into beads or vice versa.

| Bead | Status | What |
|---|---|---|
| `xtrm-h9hqg` | **P0, IN_PROGRESS** | bd auto-stage config flip + pre-commit shim (B-A1/A2/A3); hooksPath cases; bd/gitnexus version+migration verify. Does NOT cover B-A4 orphan-worktree cleanup, B-A5 test-runner `.worktrees/` excludes, B-A6 osv-scanner wrapper. |
| `kj651` | active (other agent) | specialists-runtime cleanup + substrate alignment; chain identity |
| `60w93.1` | open | create forensic event contract → forensic v0 |
| `eoqxp`, `eoqxp.1/.2/.5`, `infra-bnh` | later | devops beads |
| `xtrm-tools`, `xtrm-store`, `xtrm-memory`, `xtrm-native`, `sfwe1.*` | referenced | other work streams |

> Open question on record: **what lands first, substrate or channels?** (from `improvements.md`).

## Roadmap doc of note
`xtrm/temp_roadmap.md` — "Specialists Runtime — Architectural Critique, Friction Audit, and
Substrate-Aligned Patch Roadmap." Canonical, consolidated source for the specialists cleanup effort
(absorbed the old friction-audit + alignment docs). Decisions closed in its §0. Reviewed vs substrate rev10.

## Key docs (in `xtrm/` vault unless noted)
- `xtrm-MOC.md` — map of content / index (read this first)
- `substrate/substrate_design_it.md` — substrate spec (canonical, IT)
- `channels/channels.md` — channel primitive
- `specialists/` — `specialists.quant.md`, `specialists.scheme.md`, `agentops-suite.md`
- `console/console-product-contract.md` + `console/architecture/*`
- `telemetry/forensic-event-contract.md`, `telemetry/agentops-event-catalog.md`
- `devops/devops-system.md`
- `research/*` — AWS AgentCore/DevOps observability, SRE telemetry, terraform, post-aws-summit
- `improvements.md` — running idea inbox (post-AWS-summit explorations)
