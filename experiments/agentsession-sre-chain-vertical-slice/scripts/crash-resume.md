# Crash/resume verification — reconciled native-Epic topology

Round-2 (§6.3) live-tested `--resume` on the pre-reconciliation Beads
topology (fake `bd dep add step root` parent). This document describes
the same test rerun against the reconciled topology (native Epic +
`--parent` children + real readiness deps only).

## Sequence

1. Materialize a chain via the CLI against the `true-regression`
   fixture (`bun run start --state-dir ... --target ...` on a fresh
   `chain-run-id`). Confirm `beads-map.json` shows the new fields
   (`chain_epic_id`, `external_root_bead_ref`, `step_bead_ids`) and
   that `inspect.sh <run-id>` shows children under the Epic.
2. Wait for `coordinator-entry`, `explorer`, `observability` to
   satisfy (the reducer marks them and reconcileBeads closes them via
   `bd close --reason "..."` — no `--force`).
3. When the diagnostician has started (`step.start` fact fired) but
   before it satisfies, kill the process.
4. Re-run with `--resume <chain-run-id>`.

## Expected invariants

- `coordinator-entry`, `explorer`, `observability`, `reviewer`,
  `coordinator-close` all `attempts=1`; `diagnostician` `attempts=2`.
- The satisfied step beads (closed pre-crash) remain closed; the
  runtime does not attempt to re-close them.
- The diagnostician's new activation gets a new `execution_id` and
  may get a new `pi_session_id`; `participant_id` is stable.
- No duplicate Epic, no duplicate step beads, no duplicate dep edges.
- No `bd close --force` invocation appears in the run's logs.
- The ChainRun Epic closes only after `coordinator-close` satisfies
  and the reducer transitions the chain to a `closed_*` status.

## Why not gated on this reconciliation

Requires live model API access. The recovery code path is unchanged
between the pre- and post-reconciliation topologies, and the
beads-adapter tests already prove that a native-Epic child closes and
the Epic itself closes without `--force`. The live rerun is
scheduled with the next real-target run rather than double-billing the
model quota already consumed by the parallel benchmark stream.
