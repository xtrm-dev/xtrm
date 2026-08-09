# Prime Agent ↔ XTRM / Specialists / Hive Research

**Date:** 2026-08-09  
**Scope:** Architectural audit of `PrimeIntellect-ai/prime-agent` against XTRM, especially `xtrm-dev/specialists`, Hive Research, provenance, deterministic chains, and their shared `pi` substrate.

## Executive summary

`PrimeIntellect-ai/prime-agent` is one of the most directly relevant external reference implementations identified so far for the future XTRM/Hive runtime. Its relevance is unusually high because it is not merely another agent framework: like Specialists, it is built on the `pi` ecosystem. The two projects represent different architectural evolutions of the same underlying substrate.

Specialists deliberately treats `pi/rpc` as the canonical execution protocol and builds orchestration, job lifecycle, persistence, observability, Beads integration, deterministic specialist roles, governed chains, gates, and publication semantics around that boundary. Prime Agent goes deeper into the runtime: resident daemon/supervisor, per-root session workers, persistent agent trees, recursive child sessions, scheduling, direct agent-to-agent messaging, recovery, leases, mutation journals, replay cursors, persistent goals, bounded autonomous continuation, and persistent IPython.

The recommendation is **not** to replace Specialists with Prime Agent or adopt Prime Agent wholesale. Specialists solves a different and important problem: governed, deterministic, role-separated workflows with explicit contracts and evidence. Prime Agent is most useful as a reference implementation for runtime primitives that can sit underneath or alongside that workflow layer.

```text
Mercury policy / authority
        │
        ▼
Hive control plane / dispatcher
        │
        ├── identity + provenance
        ├── leases + claims
        ├── execution journal
        ├── bounded convergence
        ├── scheduling
        └── recovery / replay
        │
        ▼
Specialists workflow/governance engine
        │
        ├── Bead contracts
        ├── deterministic chain templates
        ├── SCRUTINY
        ├── writer / seconder / QA / reviewer gates
        └── structured publication evidence
        │
        ▼
pi execution substrate
```

Prime Agent should become an explicit reference implementation in Hive Research alongside Hermes, but for a different question: Hermes informs the broader control-plane/workflow comparison; Prime Agent informs runtime primitives that XTRM may otherwise independently reinvent.

## 1. Why Prime Agent is unusually relevant

Prime Agent explicitly states that its agent and TUI are built on `pi`. Its coding-agent package retains the `@earendil-works/pi-*` package structure and depends directly on Pi agent-core, AI, and TUI packages.

```text
pi
├── Specialists
│   └── pi/rpc → Specialists adapter → Supervisor → jobs/beads/chains/gates
│
└── Prime Agent
    └── AgentSession → worker → daemon → persistent agent tree
```

Specialists' boundary is deliberate: `pi/rpc` owns canonical commands, responses, events, JSONL framing, and correlation. Specialists owns the adapter, normalized timeline, liveness policy, Supervisor lifecycle, persistence, orchestration, and policy extensions. Prime Agent instead extends the execution substrate into a resident multi-session runtime.

## 2. Relationship to current Hive Research

The current Hive Research baseline asks for source-verified analysis of dispatch/queues/claims/leases, execution identity, execution profiles and budgets, bounded convergence, structured completion, cancellation/retry/resume/recovery, scheduling and collision boundaries, memory/skills/forensics, and Mercury↔XTRM ownership boundaries.

Prime Agent implements concrete versions of a large fraction of these primitives. It should therefore be incorporated into the Hive Research baseline rather than treated as unrelated ecosystem research.

## 3. Resident runtime: work does not belong to the terminal

Prime Agent separates presentation from execution. Normal sessions run through a daemon-backed architecture with a supervisor, resident worker processes, `AgentSessionRuntime`, root `AgentSession`, scheduler, persistent IPython kernel, and recursive child sessions. The TUI is a client: disconnecting it does not stop the work, and it can later reattach to an addressable resident execution.

This closely matches the direction emerging in XTRM and xtmux: execution should be a durable runtime object, while terminal panes, TUI views, web consoles, or other interfaces are merely views/controllers over it.

Specialists already approximates this with DB-backed jobs, background processes, keep-alive sessions, `steer`, `resume`, `feed`, `result`, and its Supervisor. Prime Agent demonstrates how the concept can become first-class in the underlying runtime.

**Recommendation:** do not immediately replace the Specialists Supervisor. Define a stable XTRM execution abstraction independent of the terminal/client and evaluate whether future implementation should use Pi `AgentSession` directly rather than implementing all lifecycle semantics around spawned RPC subprocesses.

## 4. Execution identity and lineage

Prime Agent assigns stable identities to active sessions and recursive child sessions. Child handles expose identifiers, names, session directories, and model identity; the child registry survives compaction, kernel restart, and parent restoration.

A useful XTRM hierarchy would be:

```text
assignment_id
    └── execution_id
          ├── actor_id
          ├── attempt
          ├── parent_execution_id
          ├── lease
          ├── runtime_session_id
          └── mutation_command_ids
```

This remains distinct from external credentials. Mercury already needs separation between credentialed `principal_id` and logical `actor_id`. Prime Agent provides a useful model for runtime actor/session identity, but does not replace Jira/GitHub principal provenance.

**Recommendation:** actor identity, parent lineage, and execution identity should be injected or validated by the dispatcher/runtime, never trusted from model-generated text.

## 5. Direct agent-to-agent communication

Prime Agent allows active agents and retained subagents to communicate directly. Parent, child, sibling, and other addressable sessions can exchange messages through the daemon. Delivery can steer active work, enqueue a follow-up, or reach an idle target. Sender identity is derived by the daemon rather than trusted from model-generated text.

**Recommendation:** introduce direct messaging as a runtime primitive with explicit routing and provenance, not as an alternative workflow engine. Messages should carry immutable sender execution identity and be constrained by assignment/family/authority boundaries. A Specialists chain remains governed even if its participants can communicate directly.

## 6. Leases and exclusive ownership

Prime Agent protects persisted sessions using process-safe leases keyed by canonical session storage. A worker must acquire the lease before opening a session; concurrent opens resolve to the existing owner rather than creating competing writers.

**Recommendation:** formalize leases as first-class execution records, with owner, scope, acquisition, renewal/expiry where appropriate, and recovery semantics. This provides a cleaner foundation for preventing collisions among local dispatchers, host coordinators, web closure supervision, schedulers, and manual operator actions.

## 7. Mutation idempotency and the `uncertain` state

One of Prime Agent's strongest patterns is its mutation journal. Mutating commands are keyed by stable client and command identifiers and journaled before dispatch. Repeating a completed command returns the recorded result. If a command was durably received but completion cannot be established after failure, the outcome is **uncertain** and the side effect is not blindly replayed.

Recommended XTRM state machine:

```text
not_seen
   │
   ▼
received
   ├──► completed
   └──► uncertain
```

`uncertain` must be a real reconciliation state. External mutations such as Jira/GitHub comments, PR creation, merges, releases, deployments, and credential operations cannot always be safely replayed after timeout or crash.

**Recommendation:** make mutation idempotency and uncertain-outcome handling a high-priority Hive primitive.

## 8. Replay cursors, generations, and recovery snapshots

Prime Agent events belong to a worker generation and carry sequence ordering. Clients reconnect with a cursor conceptually equivalent to `{ generation, sequence }`. If replay is unavailable, the runtime supplies a coherent recovery snapshot. A generation change explicitly invalidates old sequence comparisons.

Specialists already has strong DB-backed timeline, feed, log, and forensic surfaces. Preserve them, but strengthen the synchronization contract.

Recommended event identity:

```text
execution_id
generation
sequence
event_id
```

**Recommendation:** add generation-aware replay and authoritative recovery snapshots to the future XTRM execution protocol. This is particularly valuable for xtmux/Console clients that must disconnect and reconnect without reconstructing truth heuristically from logs.

## 9. Scheduling and crash-safe tick semantics

Prime Agent persists scheduled work per session. A due tick is claimed and advanced before prompt delivery. A crash therefore does not replay a prompt whose delivery status is uncertain. Missed ticks are coalesced instead of accumulating into an unbounded backlog.

Recommended semantic pattern:

```text
due → claim → advance schedule → deliver
```

rather than:

```text
due → deliver → advance schedule
```

**Recommendation:** adopt this scheduling semantic and add XTRM authority scopes and cross-actor mutexes on top.

## 10. Dynamic RLM children versus deterministic Specialist chains

Prime Agent exposes recursive subagents through `rlm(...)`. A parent can spawn independent child `AgentSession`s, retain them, message them later, and operate asynchronously.

This solves a different problem from Specialists chain templates. Specialists deliberately created named, reusable, versionable chain shapes because ad-hoc multi-agent dispatch produced inconsistent execution. The canonical production path is approximately:

```text
writer
  → seconder
  → test-engineer
  → test-runner
  → security-auditor?
  → obligations-scanner
  → reviewer
```

Therefore:

```text
Prime rlm()  = dynamic delegation primitive
Specialists  = governed workflow semantics
```

Recommended integration:

```text
Hive dispatcher / chain reducer
            │
            ▼
     Specialists chain
            │
     ┌──────┴──────┐
     ▼             ▼
 executor        reviewer
     │
     └── optional dynamic research/advisor children
```

Dynamic children can be useful for research, exploration, advisory, and parallel evidence gathering, but must not silently rewrite or bypass the canonical chain.

## 11. Persistent goals versus Beads

Prime Agent distinguishes persistent goals from autonomous continuation policy. A goal stores the durable objective; autonomous mode decides whether another continuation should occur based on gates and resource limits.

XTRM already has Beads as the durable contract layer. Do not duplicate it.

```text
Bead / assignment contract
    = what must become true

Execution / convergence policy
    = how long and under what evidence the runtime may continue trying
```

A future execution policy could contain:

```yaml
max_attempts: ...
max_fix_loops: ...
max_tokens: ...
max_wall_time: ...
required_gates: ...
terminal_states: ...
```

**Recommendation:** keep objective state in Beads and make convergence a host/runtime policy rather than burying autonomy entirely in prompts.

## 12. Bounded autonomous convergence

Prime Agent can continue until quality gates pass or configured continuation, turn, token, or wall-clock limits are reached. It avoids blindly rerunning the same failed gate when the workspace has not changed.

**Recommendation:** formalize bounded convergence in XTRM. Chain fix loops need explicit ceilings and terminal conditions. Reaching a limit is never success. Passing a gate means only that the property checked by that gate has been verified. SCRUTINY selects structural defenses; convergence policy bounds attempts to satisfy them.

## 13. Continual Harness and self-modifying operating knowledge

Prime Agent's Continual Harness can refine supplemental prompts, memories, skill descriptions, and reusable subagent specifications through evidence-backed updates, while keeping the base system prompt immutable and retaining rollback history.

The mechanism is interesting, but unrestricted autonomous adoption conflicts with XTRM provenance and deterministic policy.

Recommended governed path:

```text
observation
   → proposed learning
   → candidate artifact diff
   → evidence
   → review
   → versioned publication
```

**Recommendation:** use refinement machinery, if at all, to generate candidate changes or session-local adaptation. Durable shared skills, prompts, memories, and policy remain reviewable artifacts.

## 14. Persistent IPython as model-facing control environment

Prime Agent makes persistent IPython its principal built-in model tool. File operations, shell commands, transformations, skills, and child dispatch can be composed programmatically. Python state survives tool calls and context compaction.

This is particularly attractive for research, quantitative analysis, scientific workflows, repository investigation, and long-running exploratory work. It is less obviously appropriate as the default for production Specialists, where explicit tool permissions and auditable capability boundaries are valuable.

**Recommendation:** treat RLM/IPython as an execution profile, not the universal default.

```yaml
profile: deterministic-specialist
capabilities: explicit-bounded-tools
runtime: pi

profile: research-rlm
capabilities: persistent-ipython
runtime: pi-agent-session
dynamic_children: allowed

profile: reviewer
capabilities: read-only-explicit-tools
dynamic_children: advisors-only
```

This maps naturally onto Hive requirements for execution profiles, model/provider configuration, permissions, and budgets.

## 15. Skills

Prime Agent supports instruction-oriented Agent Skills and extends them with Python-backed executable skills. Only skill metadata needs to be in the startup prompt; full instructions/APIs can be loaded when relevant.

XTRM already has substantial skill and service-knowledge infrastructure. The lesson is not to replace it, but to consider whether selected XTRM skills should expose typed executable capabilities while retaining governed discovery and documentation.

**Recommendation:** evaluate executable skills selectively, especially for research and deterministic utility operations. Do not collapse policy/instruction skills and privileged executable capabilities into an indistinguishable surface.

## 16. RPC versus direct `AgentSession`

This comparison materially changes the existing question about whether Specialists should continue using Pi primarily through RPC or move closer to `packages/agent` / direct `AgentSession` integration.

Prime Agent's own RPC documentation notes that Node.js/TypeScript applications should consider using `AgentSession` directly rather than spawning a subprocess. Prime Agent itself demonstrates how much richer lifecycle functionality becomes possible when the runtime owns AgentSession rather than treating Pi only as an external JSONL process.

This does **not** prove that Specialists should immediately migrate. The existing Pi/RPC boundary is clean, operationally useful, and deliberately documented. A direct integration would increase coupling to Pi internals and could blur ownership boundaries.

However, the question is no longer merely an optimization such as "RPC versus JSON overhead." It is architectural:

> Should XTRM continue to treat Pi as a subprocess protocol endpoint, or should a future XTRM runtime become a first-class Pi AgentSession host and expose its own stable protocol upward?

**Recommendation:** run a focused architectural spike. Compare direct AgentSession and current RPC on lifecycle ownership, event fidelity, cancellation, session restoration, extensions/policy hooks, child sessions, daemon compatibility, failure isolation, upgrade coupling, and testability. Do not migrate until the ownership boundary is explicitly resolved.

## 17. Prime daemon should not simply replace Specialists Supervisor

There is substantial overlap: both systems have supervision, background work, persistence, event streams, resume/steer semantics, and long-lived sessions. But their semantic responsibilities differ.

Prime's daemon is primarily an agent-runtime/lifecycle coordinator. Specialists' Supervisor participates in governed specialist job semantics, normalized evidence, policy enforcement, Beads relationships, and publication workflows.

**Recommendation:** separate concerns before considering consolidation:

```text
Runtime supervisor
    owns processes, sessions, transport, recovery, leases

Workflow supervisor / reducer
    owns chain state, contracts, gates, verdicts, fix loops, publication
```

If future Pi/Prime-derived primitives can own the former, Specialists can become simpler and more focused on the latter.

## 18. UI / xtmux implications

Prime Agent's resident, addressable session model strongly validates the XTRM UI direction previously discussed: the UI should wrap durable executions rather than own terminal processes.

A future xtmux/Console surface could display:

```text
Orchestrator / root execution
├── specialist chain
│   ├── executor
│   ├── seconder
│   ├── test-engineer
│   └── reviewer
├── dynamic research children
└── scheduled / waiting work
```

Each node can expose status, identity, lineage, current model, authority profile, bead/assignment, live event cursor, result/evidence, workspace/worktree, and controls such as attach, steer, resume, stop, or inspect.

With generation-aware snapshots, UI state becomes a projection of the runtime rather than a fragile representation of tmux panes.

## 19. Recommended adoption matrix

| Prime Agent primitive | XTRM/Specialists analogue | Recommendation |
|---|---|---|
| Resident root worker | Specialists background job | Study/adopt concept |
| Stable active-session identity | `job_id` + Bead | Generalize into execution identity |
| Child session registry | Specialist jobs/chains | Adopt as runtime primitive, not workflow |
| Parent/child/sibling messaging | steer/resume/orchestration | Adopt with runtime-derived identity |
| Session lease | partial ownership concepts | Adopt |
| Mutation command journal | no complete equivalent | High priority |
| `uncertain` mutation outcome | not clearly formalized | High priority |
| generation/sequence replay | DB event timeline | Integrate |
| coherent recovery snapshot | feed/recovery surfaces | Integrate |
| claim-before-delivery scheduling | distributed scheduler work | Adopt semantics |
| persistent goals | Beads | Do not duplicate |
| bounded autonomous continuation | chain fix loops/SCRUTINY | Formalize separately |
| `rlm()` dynamic children | `sp run` roles | Complementary, not replacement |
| Python-backed skills | XTRM skills/service skills | Evaluate selectively |
| continual `/refine` | governed memory/skill artifacts | Do not adopt directly |
| persistent IPython | explicit Pi tools | Research execution profile |
| Prime daemon wholesale | Specialists Supervisor | Do not replace wholesale |

## 20. Proposed target architecture

The useful synthesis is not "XTRM becomes Prime Agent." It is a cleaner layered architecture:

```text
┌─────────────────────────────────────────────────────────┐
│ Mercury authority / programme policy                    │
│ Jira, GitHub, operator approvals, external principals   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ Hive Control Plane                                      │
│ assignment IDs · actor IDs · provenance · leases        │
│ mutation journal · scheduler · budgets · reconciliation │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ Specialists Workflow Layer                              │
│ Beads · chain templates · SCRUTINY · gates · reducers   │
│ structured handoffs · review · publication evidence     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ Agent Runtime                                           │
│ Pi AgentSession / RPC · resident sessions · child tree  │
│ messaging · replay · recovery · process lifecycle       │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ Execution environment                                   │
│ worktrees · shell · tools · IPython profile · MCP       │
└─────────────────────────────────────────────────────────┘
```

The key design principle is that **dynamic agent capability belongs below governed workflow semantics, not instead of them**.

## 21. Recommended next work

First, update Hive Research so Prime Agent is an explicit reference implementation for the runtime portion of the baseline. The comparison should cover execution identity, leases, mutation journals, recovery/replay, scheduling, direct messaging, child lifecycle, bounded autonomy, and runtime/client separation.

Second, perform a dedicated `pi/rpc` versus direct `AgentSession` spike in Specialists. The output should be an ADR-quality decision, not an implementation-first migration.

Third, define an XTRM execution envelope that extends the existing provenance work with assignment, execution, attempt, parent lineage, runtime session, lease, mutation-command, generation, and sequence identities.

Fourth, define mutation semantics including `uncertain`, idempotency keys, reconciliation, and replay prohibition for unknown side effects.

Fifth, define the boundary between runtime supervision and workflow supervision. This determines whether future Pi/Prime-like runtime machinery can simplify the Specialists Supervisor without weakening deterministic chain governance.

Sixth, use Prime Agent as a reference for xtmux/Console synchronization: addressable executions, attach/detach, coherent snapshots, cursor replay, and agent trees should replace terminal-process identity as the conceptual UI substrate.

## 22. Final verdict

Prime Agent is not primarily interesting because it has more agent features. It is interesting because it demonstrates a mature alternative answer to the exact architectural question XTRM is now reaching: **what should exist below a deterministic multi-agent workflow once agent executions must become durable, addressable, recoverable, mutually communicative, and autonomous within explicit bounds?**

Specialists should remain the workflow/governance engine. Beads should remain the durable task-contract layer. Mercury should remain the authority and external provenance layer. Pi should remain the execution substrate.

What Prime Agent changes is our understanding of the missing runtime layer. We now have a concrete same-ecosystem implementation to study for resident executions, leases, lineage, messaging, idempotent mutations, uncertain outcomes, scheduling, replay, recovery, child sessions, and bounded continuation.

That should materially influence Hive Research before XTRM independently designs those primitives.

## Source references used in the audit

- `PrimeIntellect-ai/prime-agent` README and architecture documentation: `packages/coding-agent/docs/architecture.md`, `rlm.md`, `long-running-agents.md`, `daemon.md`, and `rpc.md`.
- `PrimeIntellect-ai/prime-agent/packages/coding-agent/package.json` for direct Pi package dependencies.
- `xtrm-dev/specialists` README, `docs/pi-rpc-boundary.md`, `docs/background-jobs.md`, package metadata, and XTRM canonical chain-template documentation.
- Mercury Jira Hive Research baseline (`ISSUE-76`) and identity/provenance work (`ISSUE-87`).
