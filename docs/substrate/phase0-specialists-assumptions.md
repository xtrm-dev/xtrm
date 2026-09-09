# Phase 0 — Specialists Bead-authority assumptions (frozen)

**Bead:** `xtrm-7wc.1` · **PRD freeze:** `ca3ae04` (merge #121) · **Date:** 2026-09-09
**Lane:** B, native explorer on `opencode/muse-spark-1.3-contributor-free`, read-only.
**Format:** `file | section | Bead-authority assumption`.

## Main PRD — `docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md` (em-dash filename verbatim)

- §3 Goals ¶6 | tracked dispatch requires real dispatchable Bead; beadId mandatory.
- §3 Goals ¶7 + §5 Principles | free-form prompt text must not supplement incomplete Bead; Bead is authoritative tracked work; StepContract is not a second durable item; Substrate step-issues deferred.
- §10 Primary Pi dispatch API | `specialist_delegate({specialist, bead})` — `bead` is dispatch authority; `task` text forbidden for tracked work; fix the Bead if incomplete.
- §11 Dispatch request | `ActivationRequest.beadId: string` required; readiness gate downstream in §12.
- §12 Bead dispatch gate | readiness gate before AgentSession creation: resolve Bead → read contract state → validate ready → validate seven sections + SCRUTINY; reject `contract:draft`, missing sections, TBD placeholders, invalid SCRUTINY.
- §13 Dispatch refusal | refusal is forensic, cites `bead` + `reason: contract_not_ready` + missing sections; AgentSession not created.
- §14 No prompt smuggling | Bead incomplete → update Bead → dispatch; never delegate anyway with tool-arg prose.
- §15 StepContract | compilation input is ready root Bead; `provenance.sourceBeadRevision?` is an optional pin, not a hard gate.
- §17 Deferred Substrate step-issues | ready Bead → derived StepContract → Activation; no native Substrate step-issues created.
- §37 ActivationResult | `beadId` retained for lineage (pin only, no revision gate).
- §49 Lease acquisition | validate Bead precedes Specialist/workspace/lease resolution and AgentSession start.
- §60 Model override | `bead:` stays dispatch key; model override is activation-scoped.
- §72 Observability | Bead correlation is a required forensic field.
- §76 Dispatch-gate forensics | every rejected dispatch persists participant + bead + Specialist + gate + reason.
- §85 What the skill must teach | coordinator learns Bead readiness + seven-section contract + SCRUTINY as dispatch preconditions.
- §86/§88 Bead guidance | "The Bead is the task. The delegation call is not a second task prompt." Incomplete → update Bead, no hidden prose.
- §89 Clarification guidance | durable-work change → update Bead + refresh activation context + reply.
- §99–100 Claude dispatch | same `specialist_delegate({specialist, bead})` authority from Claude adapter.
- §117 System prompt | full Bead contract preserved as ROOT WORK CONTRACT layer.
- Phase 3 — Bead hard gate | ready + 7-section + SCRUTINY validation + structured forensic refusal.
- Test K / O / AK | K: coordinator updates Bead before revised instructions; O: draft/incomplete cannot dispatch; AK: forensic query recovers originating Bead.
- §133 Final invariants #2–5 | tracked work requires ready Bead; free-form cannot replace durable work; StepContract creates no second work graph; Substrate step-issue creation deferred.

## Amendment — `docs/specialists/PRD-Native-Specialists-Subagents-for-Pi-amendment-2026-09-08.md`

- §4 Expanded /specialists view | display assumption only: row shows `work item / Bead / future Substrate issue`; assumes beadId-addressable work survives Substrate; no dispatch/readiness/revision gate.

## `docs/specialists/deterministic-xtrm-runtime.md`

- Lines 2–3 | end-of-job runtime check only (beads marked OK/NOK, escalate, never fail the job); no dispatch gate.
- Lines 7–8 | proposal only: owner section on bead records executor/agent id for lineage; no dispatch gate.

## `docs/specialists/specialists-execution-protocol.md`

- **No items.** Zero `bead/dispatch/gate/authoritative/ready/revision` matches (verified by search).

## `docs/specialists/xt-pi-role-context-integration-brief.md`

- §5 CLI surface + flag table | `--bead <id>` is the durable work contract; required for task-bound sessions, optional for unbound interactive role sessions.
- §6 Launch flow + render contract | `task: beadId ? {kind:'bead', …}`; session metadata `@agent_bead`; contract via `bd show/update`; Beads = durable contract.

## Gap

- `docs/specialists/handoff-schema.md` (referenced by mandatory rules) **does not exist** in this worktree — role-specific handoff fields unverifiable; Phase 9 (.10) must resolve.
