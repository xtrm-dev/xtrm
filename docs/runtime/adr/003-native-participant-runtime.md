# ADR-003 — Native participant runtime on Pi

> Status: ACCEPTED (direction settled by evidence; hardening gates remain) · Date: 2026-08-22
> Supersedes: neutral "retain-RPC vs adopt-native" framing of GATE-HARNESS-ADR
> Evidence: decision matrix Q7/Q8/Q12/Q17; lane D source verification.

## Decision

1. **Direct Pi AgentSession hosting is the product runtime path.** The SRE vertical-slice experiment proved on real infrastructure: direct `createAgentSession` hosting, custom XTRM tools via `noTools:"builtin"`, parallel reducer dispatch with persisted idempotency keys, crash/resume (retry only on killed step), Specialist JSON loading with fail-closed skill fingerprinting.
2. **Corrected RPC is demoted to compatibility/migration/rollback/headless transport.** The v0.84.1 atomic RPC remediation remains valid and shippable for those roles; it is not the product architecture.
3. **Identity separation.** `SpecialistDefinition ≠ participant ≠ activation ≠ AgentSession`. One activation may span attempts; an attempt maps to one AgentSession. Participant identity is stable per `(scope, role)`; session identity belongs to Pi.
4. **Result lifecycle.** Agent finished ≠ protocol completed. A result exists only after typed validation; evidence validation — not self-report — satisfies a step.
5. **PREPARE/FINALIZE are runtime-owned phases** (typed PLAN/EXECUTE remain agent work). Honest status: not yet present in experiment code; they are implementation milestones, not claimed capabilities.
6. **RLM/dynamic children** stay cognition-bound inside one approved step: research/inspect/compute/critique/synthesize yes; mutate ResolvedChain, self-grant, create canonical steps, bypass gates, decide Bead acceptance, or act as second scheduler no. Lineage records parent participant + parent activation + child activation + budget + grant + evidence output.

## Consequences

- R1.6/GATE-HARNESS-ADR reframed in the execution plan as production-parity/hardening evidence for the native path, not an open architecture coin-flip.
- ActivationSupervisor (ADR-006) becomes the owning component for this lifecycle.

## Rejected alternatives

- Remaining on RPC as product transport (loses proven direct-hosting evidence; keeps bridge complexity).
- Migrating merely because direct hosting is architecturally attractive without parity/hardening gates (v1 reconciliation D20 discipline retained).
