## Phase 1 - Initial Analysis

Node-coordinator underwrites too much. Participant SDK, capability model, `autonomy_json`, pulse emitter, identity layers all assume autonomous reader exists.

Sequencing hides risk. 13 stages never give node-coordinator own delivery gate. Chain-only runtime ships first; node remains future semantic layer.

## Phase 2 - Devil's Advocate

Maybe node not needed for v1. Orchestrator can fake scheduling. Human can approve child containers. Daemon can own mechanical scheduling.

Problem: then architecture sells autonomy but ships bureaucracy. Dead abstractions stay because future node “will need them.” Users pay complexity now for entity absent later.

## Phase 3 - Synthesis

Failure mode: not technical impossibility alone. Governance failure. Design made node-coordinator load-bearing, then omitted near-term proof. Every abstraction got accepted as “for autonomy,” while autonomy never passed one end-to-end scenario.

Real test: one long-running coordinator reads pulses, evaluates policy, opens child container, journals why, survives restart, respects denial. If absent by Stage 4, stop expanding SDK/capability/identity surface.

## Final Answer

### The Failure Story

June–July went into Stage 0 and Stage 1: `xt daemon`, `state.db`, Unix socket, issue schema, validator. To avoid blocking, implementer kept node-coordinator out of scope and said chain containers would prove runtime shape first. By August, Stage 4 shipped chain lifecycle and fresh-context chain coordinator behavior, but only orchestrator read state. `participant_id`, `job_id`, `can_open_containers`, `autonomy_json`, and pulse idempotency landed as schema/API commitments without one process using them to autonomously open child containers.

September–October exposed semantic scheduling as real product work, not plumbing. Every concrete node use case needed policy exceptions: when can coordinator open child wave, invite advisor, escalate issue, mutate plan artifact, or lease worktree? `autonomy_json` became permission DSL without owner, tests, or UX. Milestones kept moving node to “next quarter” while stages 7–12 added collision matrix, epic/wave containers, advisor rules, tether relevance, reconciler, and console feed. Each feature assumed future autonomous reader, but production still had orchestrator plus human convention.

By December, Substrate had one source of truth and one real reader: orchestrator. Human used console as passive dashboard. Node-coordinator never existed as long-running actor. Participant SDK became wrappers for scripts and specialists. Pulse emitter became logging. Capability model became dead schema. Team learned new runtime vocabulary but still coordinated by tribal judgment, now with more tables and stricter gates.

### The Underlying Assumption

Designer assumed autonomous semantic scheduling could be postponed because surrounding runtime contracts would make node-coordinator implementation straightforward later.

### Early Warning Signs

- No executable demo by Stage 4 where node process reads pulse, evaluates `autonomy_json`, opens child container, records journal entry, survives restart, and denies forbidden action.
- PRs keep adding `participant_id`, `job_id`, `can_open_containers`, emitter/pulse, or SDK surfaces while every production caller remains orchestrator-owned.