# ADR-006 — Runtime supervision boundaries

> Status: ACCEPTED · Date: 2026-08-22 · Absorbs: proposed RuntimeSupervisor ADR (packet matrix line 122)
> Evidence: decision matrix Q13/Q14/Q15/Q30; lane G (shipped-status verified against xtmux source/docs).

## Decision

Three supervision roles, strictly separated:

| Supervisor | Supervises | Must never do |
|---|---|---|
| **ChainReducer / Scheduler** | workflow progression: which node is next, gate routing, convergence, chain-level recovery | host processes; touch terminal/tmux |
| **ActivationSupervisor** | exactly one XTRM-owned direct participant activation: start/settlement, session identity, heartbeat/progress, timeout/stall, retry-eligibility signal, cancel/abort, disposal, activation metrics | decide chain order |
| **xtmux RuntimeSupervisor** (evolved V2) | external/interactive runtime execution hosted through terminal backends: instance registry, delivery attempts/receipts, waits/wakes, monitors, handoffs, turn records, reconciliation | become workflow authority; spawn a second store |

## Runtime classes

| Class | Path today | Target owner |
|---|---|---|
| Direct Pi AgentSession (native) | experiment-proven, RPC bridge in production runners | ActivationSupervisor — **not routed through xtmux** |
| Interactive Pi / Claude / Codex in tmux | xtmux hooks + SQLite V2 (shipped) | xtmux substrate via provider adapters |
| tmux topology/terminal UI | tmux live authority; xtmux projects `topology.v1` | unchanged; one terminal backend among several |
| Future Herdr-like backend | none | new terminal backend behind ADR-006 adapter seam; no semantic authority change (changing tmux as session authority requires a new ADR) |
| Subprocess lifecycle | monitors + `command_runs.owner_pid` (tmux-hosted) | ActivationSupervisor for directly spawned activations |

**tmux is an optional operational/UI backend for native AgentSession executions — never their correctness boundary.** Headless activations produce zero xtmux facts unless deliberately adapted; nothing in the runtime requires them to have any.

## What already ships vs what is new

Shipped (xtmux V2): registry, receipts/obligations, waits/wakes, monitors, handoffs, turns/episodes, restart recovery, audit. New work: provider-adapter seam and pluggable terminal backends so direct activations and future backends plug in without tmux.

## Consequences

- Retry/stall/cancel policy for directly hosted activations lives in ActivationSupervisor; xtmux keeps pane-level interrupt/kill only.
- Console's "runtime lifecycle" vocabulary (its own data-plane services) is unrelated and must not be conflated with this boundary.

## Rejected alternatives

- Forcing direct AgentSessions through xtmux for supervision (adds mandatory hop without correctness value).
- Porting the legacy Specialists Supervisor as chain supervisor (mixed concerns; decomposition lands in participant runtime instead).
