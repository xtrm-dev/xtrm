# ADR amendment — Specialists CLI surface vs execution backend

**Status:** PROPOSED amendment to `ADR-specialists-documentation-vnext-and-xtrm-system-integration-2026-09-15.md`  
**Date:** 2026-09-16  
**Tracks implementation:** XTRM-93  
**Tracks documentation:** XTRM-92

## Decision update

The Documentation vNext ADR originally grouped the `sp` CLI together with the legacy Supervisor/RPC/Beads execution architecture under one `LEGACY / MAINTAINED` label.

That grouping is now too coarse.

The accepted direction is to distinguish the **CLI/operator surface** from its **current execution backend**.

The target architecture is:

```text
sp CLI UX
    ↓
canonical native activation input
    ↓
NativeActivationHost
    ↓
Pi AgentSession + Substrate + Fleet + settlement/provenance
```

The intended migration is **not** to preserve the subprocess/RPC Supervisor runtime indefinitely and refactor it from Beads to Substrate in parallel with the native runtime.

Instead, the useful CLI UX should converge on the same native execution core after a capability inventory and acceptance pass.

This makes the CLI another frontend over one Specialist runtime, alongside:

```text
Pi Specialist extension
Claude Specialists plugin / MCP
sp CLI vNext
incoming Chains
        │
        └── NativeActivationHost
```

## Revised status vocabulary for Specialists

Documentation must distinguish four states during the migration:

### CURRENT / PRIMARY

Native Specialist activation:

```text
Substrate Issue / readiness / claim
→ ExecutionBinding
→ NativeActivationHost
→ Pi AgentSession
→ Fleet / interactions / resume / retry
→ ActivationResult
→ Journal result / WorkReceipt / provenance
```

### TRANSITIONAL LEGACY BACKEND

The still-existing implementation behind legacy job commands:

```text
SpecialistRunner
→ Pi subprocess / RPC mode
→ Supervisor
→ legacy jobs/feed/result persistence
→ Beads-backed lifecycle/worktree behavior
```

This execution implementation is maintained only while required capabilities remain unmigrated.

### MAINTAINED CLI UX

Commands such as `sp run`, `sp result`, `sp resume`, `sp retry`, `sp stop`, `sp feed`, `sp ps`, configuration/catalog commands and related operator surfaces are not automatically deprecated merely because their current backend is legacy.

Each command must be classified during XTRM-93 as:

- reimplemented as a native frontend;
- retained as config/catalog tooling;
- moved to Core/`xt` ownership;
- replaced by Chains/Fleet/future TUI;
- temporarily retained on the legacy backend;
- intentionally retired.

### INCOMING

Chains remain the incoming deterministic orchestration layer and must reuse the same native execution core rather than depend on legacy RPC/Supervisor semantics.

## Documentation consequence

README/docs must no longer state simply:

> `sp CLI = legacy`

The correct statement during migration is:

> The current `sp run` job backend is legacy-maintained. The CLI surface itself is being evaluated command-by-command for convergence on the native Specialists runtime. New orchestration should target native Specialists + Substrate now; after XTRM-93 cutover, surviving `sp` commands become native frontends rather than a second execution architecture.

Documentation must not present that post-cutover state as already shipped before XTRM-93 acceptance evidence exists.

## Schema and configuration consequence

The remaining Beads-oriented config vocabulary exists because the legacy execution backend still consumes it, not because it belongs to the future Specialist definition model.

Examples include:

```text
beads_integration
beads_write_notes
Beads-specific notes/lifecycle configuration
```

During transition:

- keep fields required by the live legacy backend;
- mark them structurally and editorially as legacy-only;
- ensure native activation ignores them;
- prevent them from appearing as native work-authority concepts.

After XTRM-93 proves that no surviving CLI/native path consumes them, remove them from:

```text
src/specialist/schema.ts
generated user.json
canonical config/specialists/*.specialist.json definitions
legacy-only override documentation
mandatory-rules injection where applicable
current README/reference material
```

Do **not** replace `beads_write_notes` with `substrate_write_notes`.

Native settlement publication is an execution-runtime responsibility:

```text
settle
→ validate ActivationResult
→ persist raw settlement
→ Journal result
→ WorkReceipt / provenance
```

It is not a Specialist role preference or user override.

## Mandatory-rules consequence

The existing mandatory-rules corpus must be classified by ownership:

### Keep in Specialists

Generic bounded-execution doctrine, capability rules, output requirements, role-specific execution constraints and safety requirements.

### Legacy-only while backend exists

Beads-specific workflow/lifecycle instructions genuinely needed by legacy `sp` job execution.

### Do not recreate in Specialists

Substrate work-authority/planning doctrine. Canonical Issue/Journal/readiness/Closure/provenance methodology belongs to Substrate/XTRM planning and should be consumed or cross-referenced rather than copied into a second ruleset.

Do not mechanically rename `Beads Workflow Quick Rules` into `Substrate Workflow Quick Rules`.

## Worktree/session ownership consequence

A CLI rewrite must not automatically port the legacy per-job worktree model.

The current XTRM ownership boundary is:

```text
Core / xt
  owns interactive worktree + branch + session topology

Specialists
  owns bounded Specialist execution in the admitted workspace

Substrate
  owns durable work authority
```

Compatibility flags such as `--worktree` must therefore be evaluated against Core ownership rather than used to preserve duplicate workspace management by default.

## Parity-testing consequence

Today SPECIALISTS-55 protects two execution implementations by comparing their compiled execution profiles.

The target after XTRM-93 is simpler:

```text
CLI input
MCP input
Pi tool input
Chain materialization
        ↓
canonical ActivationRequest / activation service
        ↓
one execution implementation
```

At that point the primary cross-surface contract should test **frontend request equivalence**, not permanent legacy-vs-native execution-profile parity.

The current parity guard remains load-bearing until cutover and must not be weakened prematurely.

## Documentation tree consequence

The ADR's `legacy/` documentation namespace remains useful during migration, but it should contain documents for the **legacy backend and genuinely legacy commands**, not automatically every page about `sp`.

After XTRM-93, surviving native-backed CLI documentation should move back into current guides/reference.

For example:

```text
before cutover
  docs/legacy/jobs.md
  docs/legacy/beads-workflow.md
  docs/legacy/cli-runtime-architecture.md

post cutover
  docs/guides/run-a-specialist-from-cli.md
  docs/reference/cli.md
  docs/architecture/native-runtime.md

historical
  docs/archive/legacy-supervisor-rpc-runtime.md
```

## Acceptance impact on XTRM-92

Documentation vNext is not complete merely when current pages are reorganized.

It must also be capable of representing the migration cleanly:

1. current native runtime is primary;
2. legacy backend is visibly transitional;
3. maintained CLI UX is not falsely equated with that backend;
4. schema/mandatory-rules cleanup follows actual runtime cutover;
5. post-cutover docs remove Beads authority vocabulary from current surfaces;
6. historical Supervisor/RPC material remains available but clearly historical.

## Non-goals

This amendment does not itself:

- implement XTRM-93;
- remove the current legacy backend;
- remove stable CLI commands before capability inventory;
- rename stable flags without a compatibility decision;
- implement Chains;
- move Core-owned workspace/session functionality into Specialists.

It updates the architectural/documentation target so implementation and documentation converge on one Specialist execution runtime instead of treating two runtimes as permanent.