## Phase 1 - Initial Analysis

Stage 0 carries hidden product: daemon, IPC protocol, migration system, locking, identity, transactions, versioning, restart behavior. Not foundation. Whole runtime kernel.

Serial dependency makes delay fatal. Stages 1–13 wait. If Stage 0 slips, validators, chain containers, lifecycle, channels, tether, collision matrix all compress or build on unstable base.

Core risk: Substrate tries replacing tribal practices with runtime entities, but first ships invisible plumbing. Operators see no value until Stage 4 minimum. Calendar burns before feedback.

## Phase 2 - Devil's Advocate

Maybe robust daemon worth cost. Shared SQLite over socket prevents five packages corrupting state. Early shortcut could poison whole architecture.

Counterpoint: six-month window cannot absorb custom IPC plus schema governance plus multi-client semantics. Existing bd→Dolt lesson warns against networked-store complexity, but plan repeats pattern locally. Unix socket smaller than network, not simple.

Bigger critique: Stage 0 has no kill switch. No coexistence shim. No degraded mode. If daemon unstable, everything waits or patches around it.

## Phase 3 - Synthesis

Failure reason strong. Stage 0 not one stage; it is database server, migration coordinator, process supervisor, domain boundary contract, event deduper. Each concern crosses packages. Each needs tests before runtime entities can be trusted.

Most likely failure shape: either perfectionism delays visible substrate, or premature “good enough” leaks races into containers. Both end same: runtime entities never feel real. Operators keep using tribal sp+bd+GitHub flow because Substrate remains infrastructure project, not work system.

Recommendation: cut Stage 0 scope to smallest append-only local event log plus one write API, then ship Stage 1–4 behind it. Push schema registry, pulse idempotency, multi-domain transaction semantics, and restart-stable identity hardening until chain container proves daily value.

## Final Answer

### The Failure Story

June 2026 went into Stage 0 design closure: daemon lifecycle, file-lock launch, Unix socket framing, project registration, state.db ownership, schema registry. No operator-facing runtime entity shipped. By late July, schema migrations across core/substrate/channels/specialists/console became main blocker: each package wanted tables, but no FK cross-domain meant opaque IDs needed extra reconciliation rules. First “working” daemon could start and answer requests, but restart behavior orphaned active jobs and broke participant/job identity assumptions.

August became transaction month. Container open, emitter/pulse dedup, and channel writes all needed serialized writes with idempotency keys. Race tests found duplicate chain containers when two clients opened same worktree lease. Fixes pushed socket protocol versioning and migration locks into Stage 0. September forced bad choice: harden daemon through October, or declare it good enough. Team chose “good enough” to unblock stages 1–4.

October and November were patch months. Stage-1 validator stored issues, but daemon restarts required migration freezes. Chain container lifecycle existed, but `open → working` sometimes lost journal gaps after coordinator kill+respawn. Channels v0 wrote around transaction limitations with package-local retries. Tether v0 treated daemon state as eventually correct, so console showed stale jobs. By December, Substrate had infrastructure, not runtime trust. Operators stayed with sp+bd+GitHub because broken runtime entities cost more coordination than tribal practice.

### The Underlying Assumption

Designer assumed Stage 0 was neutral plumbing that could be built once, quickly, before real product feedback, instead of being hardest runtime product in system.

### Early Warning Signs

- Stage 0 consumes more than 4 calendar weeks before first real chain container can be opened, listed, advanced through lifecycle, killed, restarted, and recovered from daemon restart.
- More than 30% of Stage 1–4 implementation notes mention daemon workaround terms: “retry,” “restart required,” “migration lock,” “socket version,” “orphan job,” “race,” “idempotency gap.”