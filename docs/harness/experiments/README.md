# XTRM Harness Experiments

This directory contains bounded, non-canonical executable experiments used to validate XTRM harness/runtime design decisions against real runtime behavior.

Experiments may model target architecture before the production harness exists, but they do not override the canonical execution plan, Channels contract, Specialists execution protocol, Beads authority, or later accepted architecture decisions.

## Current experiments

- [`agentsession-sre-chain-vertical-slice-2026-08-17.md`](./agentsession-sre-chain-vertical-slice-2026-08-17.md) — direct Pi `AgentSession` multi-participant SRE-triage chain exercising ahead-of-time topology, Beads materialization, `ResolvedChain`/`ChainRun`, Channels-style semantic communication, evidence-driven reduction, progress projection and restart/resume behavior.

## Source discipline

Each experiment must record the exact repository/runtime inputs it used. Repository paths in an experiment must be verified against the current default branches before execution. Missing or superseded canon must be reported as a gap rather than replaced by an invented path.
