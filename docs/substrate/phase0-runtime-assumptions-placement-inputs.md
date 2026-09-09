# Phase 0 — Runtime Beads assumptions + placement inputs (frozen)

**Bead:** `xtrm-7wc.1` · **PRD freeze:** `ca3ae04` (merge #121) · **Date:** 2026-09-09
**Lane:** C, native explorer on `opencode/muse-spark-1.3-contributor-free`, read-only.

## Part 1 — Runtime Beads work-authority assumptions (`docs/runtime/`)

Format: `file | section | assumption`. All paths verified to exist.

1. `docs/runtime/README.md` | Authority hierarchy §1 | Released code + Beads/Git evidence is authority #1.
2. `docs/runtime/README.md` | Conceptual model table | Work/evidence authority is `Beads + Evidence`; integration truth is `Git`.
3. `docs/runtime/prd/native-chain-runtime.md` | §3 R1 item 2 | Pure compiler emits persisted `ResolvedChain` with no Beads mutation during compile.
4. `docs/runtime/prd/native-chain-runtime.md` | §3 R1 item 5 | Beads materialization only after freeze; materializer must not invent a second dependency graph.
5. `docs/runtime/prd/native-chain-runtime.md` | §3 R6 item 20 | Beads is authoritative work/acceptance surface and durable external projection of ChainRuns; root Epic native parent, step beads children, `blocks` edges between steps only, cross-DB refs opaque.
6. `docs/runtime/prd/native-chain-runtime.md` | §3 R6 item 21 | Git is integration truth; evidence validation gates chain satisfaction; self-report never satisfies a step.
7. `docs/runtime/adr/001-chain-authoring-compilation.md` | Decision 4 Materialization | Beads materializes only after freeze (root Epic native parent, step children with `blocks`); planner path is `xt spec` change-contract → Pass-2 `recommended_template` → compile → freeze → pour.
8. `docs/runtime/adr/001-chain-authoring-compilation.md` | Rejected alternatives | Planners mutating Beads directly as the only representation is rejected.
9. `docs/runtime/adr/001-chain-authoring-compilation.md` | Decision 2 | `ChainDefinition` persisted/reviewable before freeze; drafts use `contract:draft` intake convention.
10. `docs/runtime/reconciliation/runtime-decision-matrix.md` | Q5 timing | Today nothing persists between resolution and `bd pour` and planner mutates Beads directly; target is materialize-only-after-freeze, projection derived never ontology.
11. `docs/runtime/reconciliation/runtime-decision-matrix.md` | Q6 boundaries | Beads = authoritative work/acceptance/durable external projection; root Epic native parent, step children, `blocks` between steps only, never cross-DB queried.
12. `docs/runtime/reconciliation/asset-absorption-matrix.md` | Core/planning | Direction change (documented, not implemented): intent → ChainDefinition → review/freeze → ResolvedChain → Beads materialization replaces intent → direct Beads mutation; `contract:draft` beads remain intake.
13. `docs/runtime/reconciliation/runtime-decision-matrix.md` | Still-open q5 | WP-id enforcement in Beads vs formal retirement of mapping duty is explicitly unresolved, non-blocking.
14. `docs/runtime/reconciliation/canonicalization-report-2026-08-22.md` | Model statement | Canonical model includes Beads work/evidence authority plus reducer/SchedulerIntent/effect-executor progression and supervision triad.
15. `docs/runtime/harness/native-adapters.md` | Entire doc (absence record) | Zero Beads work-authority assumptions; adapter thinness rule only.

No Beads work-authority statements in ADRs 002–006 beyond the no-second-store / no-workflow-authority boundaries above.

## Part 2 — Placement inputs (precedent facts, not decisions)

### A. Per-package layout precedent (existing paths)

- `packages/xts/package.json` | npm/Node precedent: `name @xtrm/xts`, `0.1.0`, `type module`, `bin xts → src/cli.mjs`, `files [src, README.md]`, `test: node --test`, `engines node >=24`, deps `@earendil-works/pi-coding-agent + @earendil-works/pi-tui ^0.84.2`, `publishConfig restricted`.
- `packages/xts/` | observed layout: `src/`, `scripts/`, `test/`, `plan/`, `README.md`, `package-lock.json`, per-package lockfile, no workspace linkage.
- `packages/mcpq/pyproject.toml` | Python precedent: `name mcpq`, `0.1.0`, setuptools src-layout, `requires-python >=3.10`, zero runtime deps, `test` extra pytest, script `mcpq=mcpq.cli:main`.
- `packages/mcpq/` | observed layout: `src/`, `tests/`, `skills/`, `README.md`, `CHANGELOG.md`, no npm manifest, no TS config.

### B. Root toolchain absence (verified)

- No root `package.json`; only under `packages/*/` and `experiments/agentsession-sre-chain-vertical-slice/`.
- No root `tsconfig*.json`; only under the same experiment.
- No `pnpm-workspace.yaml` / `bunfig.toml` / root `workspaces` config.
- Consequence: no umbrella workspace plumbing, no root TS base, no filtered-install setup exists today.

### C. `docs/monorepo-migration.md` package decisions (only migration design on file)

- §1 | Five packages: `core (xt)`, `substrate (sb)`, `channels (lib+ch)`, `specialists (sp)`, `console (web)`; DAG `specialists→{channels,substrate,core}`, `substrate→{channels,core}`.
- §2 | Fresh umbrella `0.1.0` + history-preserving per-package grafts.
- §3 | `xtrm-tools → packages/core/`, `specialists → packages/specialists/`, `gitboard → apps/console/`; greenfield `packages/channels/`, `packages/substrate/` at `0.1.0`.
- §3.0 | `packages/core/` owns state engine + daemon + socket; domain packages own namespaced tables via core API.
- §8 | Versioning: umbrella fresh `0.1.0`; channels/substrate `0.1.0`; changesets per-package bumps.
- §9 leaves open: bun-vs-pnpm, tag handling, skills layout, `.beads` migration, bead naming.

### D. PRD §6 + §51 (proposed, not existing paths)

- §6 | Proposed tree `packages/substrate/` with `src/domain|service|store/migrations|projections/github-jira-filesystem|compatibility/beads|exports`, plus `cli/`, `integrations/pi|claude-code/`, `hooks/`, `skills/using-substrate/`, `contracts/`, `tests/`.
- §6.1 | Library-first: `IssueService` consumed directly by sb CLI, Pi extension, Claude plugin/MCP, hooks, future Specialists/Chains/UI; `exec("sb …")` forbidden as normal architecture.
- §51 | Local-choice surface: exact TS module boundaries; one vs multiple npm artifacts; SQLite query-builder/migration library; semantic checkpoint model; UUIDv7 formatting; bundle sharding; retry backoff; terminal formatting.
