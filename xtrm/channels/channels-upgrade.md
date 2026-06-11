---
created: 2026-06-09T01:36
updated: 2026-06-11T05:12
---
# Channels, Substrate Graph & Coordinator Projections — Consolidated Design Notes

> Status: consolidated working draft from design session  
> Date: 2026-06-08  
> Scope: refine the canonical shape of `channels` for specialists, clarify the boundary with `substrate`, `forensics`, `evidence`, `metrics`, AgentOps proposals, and coordinator progress projections.  
> Intended use: copy into the repo as a design note, then split into canonical docs if useful.
> **Doc role: decision-log / rationale (non-normative).** The normative contract is canonicalized in `channels.md`; sections canonicalized there carry a pointer. Where this doc and `channels.md` differ, `channels.md` wins.

---

## 1. Core thesis

The channel system should not be designed as a temporary bridge or a chat transcript. It should be designed as a stable operational contract from v0, with only a minimal execution path enabled initially.

The central rule is:

```text
Ship minimal behavior.
Do not ship a misleading ontology.
```

A v0 may leave fields nullable, validators permissive, and advanced features inactive. It should not introduce names, identities, or message semantics that contradict the target model.

The right framing is:

```text
v0 = canonical contract, minimal engine
```

not:

```text
v0 = temporary bridge schema
```

Channels should therefore ship early with the final-ish shape: `audience`, participant identity, refs, evidence refs, forensic ids, work refs, proposal class, read/ack separation, and authority lanes. Later versions should activate more of the contract; they should not redefine it.

---

## 2. Layer boundaries

The system needs a strict separation between delivery, awareness, semantic memory, audit, and metrics.

```text
channel_message
  = operational append-only record used for delivery and coordination

delivery
  = offering an actionable message or intent to one or more participants

progress_projection
  = compact current state of a chain/node; not a transcript

attention_signal
  = non-actionable but potentially relevant signal for a participant

evidence
  = durable semantic payload, citable and recoverable

forensic_event
  = audit trail and drilldown fact

metric
  = low-cardinality aggregate projection, never primary truth

work_graph_edge
  = durable causal relation between issues, participants, messages, evidence
```

The invariant:

```text
Channels deliver work.
Substrate derives durable work graph edges.
Evidence preserves meaning.
Forensics record facts.
Metrics project aggregates.
Projections give awareness.
Subscriptions decide automatic action, not reality.
Attention can be soft; authority stays hard.
```

Channels should not become forensic events. Forensics should be emitted in parallel for important facts. Evidence should store semantic payloads that must survive beyond live delivery. Metrics should never depend on high-cardinality channel identifiers.

---

## 3. Routing is not cognition

The system must not behave as:

```text
message not addressed to me => message does not exist
```

That makes the agent team stupid. But the system also must not inject every message into every participant.

The right model:

```text
routing hard
  who is automatically woken or assigned action

attention soft
  who may notice, inspect, request evidence, or propose involvement

authority hard
  who may mutate state, write files, decide, close, redirect, swap, or apply config
```

A participant may notice a relevant signal without being automatically activated. It may request context or propose involvement. It may not self-grant authority.

---

## 4. Audience replaces single target as the canonical model

`target_key` or `target_job_id` may remain as v0 bridge fields, but they should not be the mental model.

Canonical message addressing should use `audience`:

```json
{
  "audience": {
    "visibility": "chain",
    "action_targets": ["executor"],
    "suggested_watchers": ["reviewer", "api-reviewer"],
    "scope_refs": ["src/public-api", "contract:foo.v1"],
    "urgency": "normal"
  }
}
```

Field meanings (`visibility`, `action_targets`, `suggested_watchers`, `scope_refs`, `urgency`) are canonicalized in **channels.md §5.4**.

> **Q2 — still open.** The enumeration of `visibility` *values* and the per-kind defaults below are a working *proposal*, not yet settled (forensic-attention §5 Q2). Retained here until decided; do not treat them as canonical.

Suggested `visibility` values:

```text
private
  author, target, coordinator/runtime

targets
  action targets plus coordinator/runtime

chain
  all authorized participants in the chain

node
  all authorized participants in the node

operator
  human/operator and coordinator

public_audit
  redacted drilldown-visible fact
```

Default examples:

```text
work.turn                 -> chain
work.finding              -> chain
work.verdict              -> chain
control.steer from human  -> targets
control.redirect          -> targets
system.done               -> chain
system.epoch_bump         -> chain
runtime.error             -> targets + coordinator
```

---

## 5. Channel message shape

The v0 message contract should be semantically rich even if only part of it is executed.

```json
{
  "channel_id": "chain:7f3a",
  "seq": 184,
  "author": {
    "kind": "specialist",
    "participant_id": "chain:7f3a::reviewer",
    "participant_role": "reviewer",
    "job_id": "job_review_42"
  },
  "kind": "work.verdict",
  "audience": {
    "visibility": "chain",
    "action_targets": ["executor"],
    "suggested_watchers": ["api-reviewer"],
    "scope_refs": ["src/public-api", "contract:foo.v1"],
    "urgency": "normal"
  },
  "work_refs": {
    "author_issue_id": "unitAI-step-reviewer",
    "target_issue_ids": ["unitAI-step-executor"],
    "spawned_issue_ids": [],
    "relation_hints": ["requests_changes"]
  },
  "body": {
    "verdict": "PARTIAL",
    "summary": "Scope mostly satisfied, but public API compatibility is not proven.",
    "evidence_refs": ["ev_123"],
    "forensic_event_ids": ["fe_456"]
  },
  "refs": {
    "result_id": "res_789",
    "files": ["src/foo.ts"],
    "diff_ranges": []
  }
}
```

Important points:

```text
audience decides visibility/action/watch hints
work_refs allow substrate graph derivation
refs point to operational artifacts
evidence_refs point to semantic payload
forensic_event_ids point to audit/drilldown facts
body does not grant authority
```

---

## 6. Message families and proposal classes

> **Canonicalized.** The full family table (`work.*` / `control.*` / `system.*` / `runtime.*` with authors, body shapes and wake behavior), the short CLI aliases, and the `proposal_class` discriminator now live as the normative source in **channels.md §5.3**. This section keeps only the rationale.

The principle to preserve: avoid a single flat namespace — use families. `proposal` is not a flat body shape: keep the storage kind stable (`work.proposal`) and discriminate by `proposal_class` (`self_activation | terminate | redirect | skill_patch | template_set_patch | evaluation_request`). A proposal may create work, request attention, or request evaluation — but **never** grant authority or apply a config change.

---

## 7. v0 schema: canonical contract, minimal engine

A pragmatic v0 should still preserve the target ontology.

```sql
CREATE TABLE channel_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,

  author_kind TEXT NOT NULL,
  author_participant_id TEXT,
  author_participant_role TEXT,
  author_job_id TEXT,

  kind TEXT NOT NULL,
  message_family TEXT NOT NULL,

  target_participant_ids_json TEXT,
  target_job_ids_json TEXT,

  audience_json TEXT NOT NULL,

  work_refs_json TEXT,
  body_json TEXT NOT NULL,
  refs_json TEXT,
  evidence_refs_json TEXT,
  forensic_event_ids_json TEXT,
  provenance_json TEXT,

  ts INTEGER NOT NULL
);
```

Implementation in v0 can be small:

```text
one table
ChannelClient.post()
ChannelClient.pollActionable()
ChannelClient.ackProcessed()
ChannelClient.capture()
human steer
reviewer -> executor verdict wake
basic forensic write
basic sp tail
no judge
no node supervisor integration
no freeform
no optimization automation
```

Fields may be partially populated, but the names and concepts should be stable.

---

## 8. Delivery semantics

Delivery should be at-least-once and idempotent.

```text
read is pure observation
ack is effectful
cursor advances only after successful processing
receivers dedupe by (channel_id, message_id)
side effects are gated by idempotency keys
```

The wake loop should not treat “read” as “processed”.

Preferred conceptual API:

```ts
client.post(message)

client.pollActionable({
  channelId,
  participantId,
  sinceId
})

client.getProgressProjection({
  containerId,
  participantId
})

client.listAttentionCandidates({
  channelId,
  participantId,
  sinceId,
  limit
})

client.requestEvidence({
  evidenceRef,
  reason,
  scopeRefs
})

client.ackProcessed({
  channelId,
  participantId,
  throughMessageId,
  processedIntentIds
})
```

`readSince` may exist internally, but the public API should express whether the participant is reading actionable messages, projection state, or attention candidates.

---

## 9. Participant policy

Do not overload `subscribes` with every meaning. Separate visibility, subscription, wake, inspect, and authority.

> The `attention_policy` sub-block (opportunistic attention / self-activation, bounds, and the canonical `self_activation_mode: off|attention|proposal` enum) is canonicalized in **channels.md §5.10**. The example below is the broader participant-policy shape, kept as rationale.

Example default specialist policy:

```json
{
  "channel": {
    "awareness": {
      "receives_projection": true,
      "projection_kinds": ["chain.progress", "system.done", "system.epoch_bump"],
      "max_recent_items": 8
    },
    "subscriptions": {
      "actionable": ["control.steer:me", "work.verdict:me", "system.redirect:me"],
      "relevance": ["work.finding:scope-overlap", "work.proposal:scope-overlap"],
      "system": ["system.done", "system.epoch_bump"]
    },
    "wakes_on": [
      "control.steer:me",
      "work.verdict.PARTIAL:me",
      "work.verdict.FAIL:me",
      "system.redirect:me"
    ],
    "attention_policy": {
      "can_request_evidence": true,
      "can_request_context": true,
      "can_self_activate_on": [
        "scope-overlap",
        "blocked-next-step",
        "contract-risk",
        "dependency-risk",
        "repeated-failure"
      ],
      "self_activation_mode": "proposal",
      "max_attention_requests_per_epoch": 2
    },
    "authority": {
      "emits": ["work.turn", "work.finding", "work.ack", "control.escalation", "work.proposal"],
      "cannot_emit": ["work.verdict", "system.done", "system.swap"],
      "can_mutate_worktree": true,
      "can_steer_peers": false
    }
  }
}
```

Coordinator policy is broader for observation, but authority must still be explicit.

---

## 10. Attention and dereference policy

Default should be pointer-first.

```text
Participants do not receive full payloads for non-actionable messages.
They receive pointers or compact cards.
Full evidence is dereferenced only by relevance, authority, or operator request.
```

Allowed dereference conditions:

```text
message is addressed to the participant
subscription matches
step contract lists that evidence as input
coordinator authorizes redirect/context
attention policy allows a relevance request
human/operator requests drilldown
```

Useful levels:

```text
pointer
summary/card
full evidence
```

This avoids both extremes: blind agents and firehose context.

---

## 11. Substrate work graph edges

The missing link between channel stream and continuous visualization is:

```text
channel_message -> work_graph_edge
```

A channel message may be ephemeral delivery. A work graph edge is durable causality.

Channels own ordered operational messages. Substrate owns the durable graph of work.

> **Canonicalized.** The `work_graph_edges` table, the edge-kind catalog with directions, and the full derivation contract — input = `work_refs` (never the body); deriver as dispatch table keyed by `(kind, proposal_class, verdict)`; the live/dormant/no-edge mapping; after-hook ordering; endpoint validation; and decisions D1–D4 — now live as the normative source in **channels.md §5.8**. This section keeps only the rationale.

The mental model to preserve: only *semantically relevant* messages become edges (a plain `work.turn` stays stream-only unless it carries a relation hint such as `responds_to`); every edge points back to its source message, evidence, and forensic event; edges — not raw messages — explain cross-issue causality. Channels own ordered operational messages; substrate owns the durable graph.

---

## 12. Stream, graph, and progress views

The console should expose three complementary views:

```text
stream view
  what happened in temporal order

graph view
  which issues, participants, findings, and proposals influenced each other

progress view
  compact current state of the chain/node
```

A good continuous visualization can be built by joining:

```text
channel_messages
work_graph_edges
evidence
forensic_events
runtime state
issue state
```

Example narrative reconstructed from stream + graph:

```text
executor step
  -> submitted turn
  -> reviewer step reviewed it
  -> verdict PARTIAL created requests_changes edge
  -> executor remediation responded_to verdict
  -> reviewer PASS closed blocker
```

The channel stream explains order. The work graph explains causality. Evidence explains meaning. Forensics explains auditability.

---

## 13. Coordinator projections

Coordinators should not monitor full payload by default.

Rule:

```text
Coordinator sees state, not transcript.
Coordinator receives summaries, not payloads.
Coordinator dereferences evidence only on exception, gate decision, or ambiguity.
```

Always visible to coordinator:

```text
state
phase
participant statuses
latest verdict summaries
blockers
pending intents
budget
next expected action
risk flags
graph edges
```

Pointer-visible:

```text
evidence refs
result refs
channel message ids
forensic event ids
issue ids
```

Dereferenced only on demand:

```text
full result
full diff
raw logs
full finding payload
full specialist output
full evidence payload
```

Full dereference triggers:

```text
verdict conflict
gate regression
blocking finding unclear
repeated failure
budget spike
member crash/replacement
coordinator must write redirect
human asks drilldown
```

---

## 14. Chain coordination projection

A chain coordinator monitors a single linear or semi-linear workflow: executor -> reviewer/seconder -> remediation -> final gate.

Typical fields:

```json
{
  "projection_kind": "chain_coordination",
  "container_id": "chain:7f3a",
  "state": "working | waiting_review | remediation_required | blocked | done | aborted",
  "epoch": 3,
  "current_owner": "executor",
  "current_step": {
    "issue_id": "unitAI-step-executor",
    "participant": "executor",
    "status": "waiting",
    "expected_next": "executor remediation"
  },
  "latest_gate": {
    "gate": "seconder",
    "verdict": "PARTIAL",
    "scope_verdict": "PASS",
    "quality_verdict": "PARTIAL",
    "blocking_count": 2,
    "evidence_refs": ["ev_123"],
    "channel_message_id": 184
  },
  "open_blockers": [
    {
      "kind": "quality",
      "summary": "Missing regression proof for retry path.",
      "owned_by": "executor",
      "evidence_ref": "ev_123"
    }
  ],
  "next_expected": {
    "participant": "executor",
    "action": "remediate",
    "reason": "verdict.PARTIAL"
  },
  "budget": {
    "turns_used": 5,
    "turns_limit": 12,
    "tokens_estimate": 48000
  },
  "risk_flags": ["repeated-failure"],
  "pointers": {
    "latest_channel_message_id": 184,
    "latest_forensic_event_id": "fe_456"
  }
}
```

The chain coordinator normally monitors:

```text
current step
last accepted turn summary
latest gate verdict
open blockers
owner of next action
whether remediation is required
whether the chain can close
budget
repeated failure
idle state
```

---

## 15. Node coordination projection

A node coordinator monitors multiple members, phases, quorum, lateral wakeups, and supervisor intents.

Typical fields:

```json
{
  "projection_kind": "node_coordination",
  "node_run_id": "node:n1",
  "state": "phase_running | phase_blocked | waiting_quorum | done | aborted",
  "phase": {
    "name": "review",
    "status": "active",
    "started_at_ms": 1780870000000,
    "expected_completion": "all_required_verdicts"
  },
  "members": [
    {
      "participant_id": "node:n1::reviewer-a",
      "role": "reviewer",
      "status": "done",
      "latest_output": {
        "kind": "work.verdict",
        "verdict": "PASS",
        "evidence_ref": "ev_a"
      }
    },
    {
      "participant_id": "node:n1::reviewer-b",
      "role": "reviewer",
      "status": "waiting",
      "latest_output": {
        "kind": "work.finding",
        "severity": "blocking",
        "summary": "API compatibility not established."
      }
    },
    {
      "participant_id": "node:n1::executor",
      "role": "executor",
      "status": "waiting_on_supervisor",
      "pending_intents": 1
    }
  ],
  "phase_gates": {
    "required": ["reviewer-a", "reviewer-b"],
    "satisfied": ["reviewer-a"],
    "unsatisfied": ["reviewer-b"]
  },
  "pending_intents": [
    {
      "intent_kind": "resume_requested",
      "target": "executor",
      "source_message_id": 184,
      "reason": "verdict.PARTIAL",
      "requires_phase_check": true
    }
  ],
  "quorum": {
    "strategy": "all_required",
    "pass_count": 1,
    "partial_count": 1,
    "fail_count": 0
  },
  "budget": {
    "turns_used": 18,
    "turns_limit": 40,
    "idle_ticks": 2
  },
  "risk_flags": ["phase_blocked", "contract-risk"],
  "pointers": {
    "latest_channel_message_id": 184
  }
}
```

The node coordinator normally monitors:

```text
current phase
member statuses
phase gate satisfaction
quorum/consensus state
pending supervisor intents
cross-member blockers
budget
idle/runaway risk
whether to continue, redirect, swap, or close
```

Inside nodes, the supervisor must remain the single scheduler.

```text
pair/chain channel:
  channel -> runner wake allowed

node channel:
  channel -> supervisor intent -> supervisor schedules member
```

A node member must not wake directly from channel bypassing the node supervisor.

---

## 16. Supervisor inbox

For node channels, messages addressed to members should become supervisor intents.

```json
{
  "intent_id": "intent_456",
  "source": {
    "channel_id": "node:n1",
    "message_id": 184
  },
  "target_participant_id": "node:n1::executor",
  "intent_kind": "resume_requested",
  "reason": "work.verdict.PARTIAL:me",
  "resume_payload_ref": "payload_abc",
  "requires_phase_check": true,
  "dedupe_key": "node:n1:184:executor"
}
```

Supervisor resolution:

```text
allowed
  enqueue resume

blocked_by_phase
  keep pending or ask coordinator

duplicate
  drop

stale_epoch
  reload roles and re-evaluate
```

This prevents split brain between channel runtime and node-supervisor.

---

## 17. AgentOps and skill-patch proposals

AgentOps introduces a new legitimate channel use: a specialist may report prompt-level friction and propose an improvement. It may not apply the improvement.

A skill-patch proposal is more sensitive than a normal proposal because it targets future system behavior, not only the current chain.

Example:

```json
{
  "kind": "work.proposal",
  "proposal_class": "skill_patch",
  "audience": {
    "visibility": "chain",
    "action_targets": ["coordinator"],
    "suggested_watchers": ["prompt-optimizer", "specialists-creator"],
    "scope_refs": ["config/specialists/executor.specialist.json"],
    "urgency": "low"
  },
  "body": {
    "specialist": "executor",
    "optimization_unit": "prompt.system",
    "friction_kind": "ambiguous_instruction",
    "offending_instruction_ref": {
      "source": "config/specialists/executor.specialist.json",
      "quote": "..."
    },
    "observed_failure": {
      "summary": "The rule caused a wasteful remediation loop.",
      "trajectory_refs": ["job_abc", "result_123"],
      "evidence_refs": ["ev_789"],
      "kpi_refs": ["kpi_456"]
    },
    "proposed_patch": {
      "operation": "replace",
      "target": "prompt.system.section.delivery_discipline",
      "candidate_text": "..."
    },
    "apply_policy": {
      "may_auto_apply": false,
      "requires": ["human_review", "specialists_creator", "golden_set_ab"]
    }
  }
}
```

Forensic event:

```json
{
  "event_family": "optimization",
  "event_name": "optimization.skill_patch.proposed",
  "correlation": {
    "channel_id": "chain:7f3a",
    "job_id": "job_abc",
    "issue_id": "current-bead"
  },
  "body": {
    "specialist": "executor",
    "optimization_unit": "prompt.system",
    "friction_kind": "ambiguous_instruction",
    "proposal_bead": "sp-improve(executor): clarify remediation rule",
    "evidence_refs": ["ev_789"],
    "may_auto_apply": false
  }
}
```

Governance invariant:

```text
No specialist may edit any .specialist.json, least of all its own.
Optimization always terminates in a proposal, never a write.
```

Flow:

```text
rollout
  -> reflect
    -> proposal artifact
      -> escalation + human/review gate
        -> specialists-creator applies approved patch
          -> golden-set A/B validates before/after
```

The mandatory-rules mechanism can capture self-proposals using a standardized bead:

```text
sp-improve(<specialist>): <one-line>
```

Those beads become telemetry:

```text
pending improvement work per specialist
friction histogram per rule/template set
trigger for prompt-optimizer evaluation
forensic trace back to run/job/evidence/KPI
```

---

## 18. Forensic event families

Add a dedicated `channel` event family for mechanical channel facts.

```text
channel.opened
channel.message.posted
channel.message.delivered
channel.message.consumed
channel.message.rejected
channel.member.joined
channel.member.left
channel.epoch_bumped
channel.closed
```

Domain events stay in domain families:

```text
work.verdict          -> review.verdict.*
work.finding          -> review.finding.created
control.steer         -> control.steer.requested
control.attention     -> control.attention_requested
proposal.skill_patch  -> optimization.skill_patch.proposed
system.done           -> chain.finalized + channel.closed
runtime.error         -> error.validation / channel.message.rejected
```

Mechanical delivery semantics and domain meaning should not be collapsed into one family.

---

## 19. Metrics policy

Prometheus or equivalent metrics should project low-cardinality aggregates only.

Allowed dimensions:

```text
service_name
service_component
participant_kind
participant_role
state
result
verdict
gate_kind
error_type
pulse_kind
```

Forbidden labels:

```text
channel_id
container_id
chain_id
issue_id
participant_id
job_id
message_id
forensic_event_id
evidence_id
raw path
raw diff
raw prompt
raw error text
raw command
raw URL
```

Drilldown should move from metric symptom to forensic/evidence/work-graph state, not from high-cardinality labels.

---

## 20. Suggested roadmap wording

> ⚠️ **SUPERSEDED.** The v0/v1/v2/v3 split below is **historical** and no longer the plan. The canonical phasing is the single-delivery **0.1 → 0.2** model in `channels.md` §11 (one delivery, two internal build phases; not separately-gated versions). Rough mapping: **v0 ≈ 0.1** (canonical contract, chain path live, incl. work-graph edges + projection); **v1–v3 ≈ 0.2** (activation of freeform / active judge / node_memory / consensus). Retained only as decision-log context. Do not implement against the wording below.

Keep a phased delivery roadmap, but make clear that later phases activate more of the canonical contract rather than redefining it.

Recommended wording:

```text
v0 ships the final channel contract with only the minimal execution path enabled.
Later versions activate more of the contract; they do not redefine it.
```

Suggested split:

```text
v0
  canonical message contract
  one channel_messages table
  reviewer -> executor verdict wake
  human steer
  basic forensic write
  basic work_graph_edge derivation for verdict/finding

v1
  audience canonical in runtime
  participant_id targeting
  pair-talk CLI
  real subscription resolver
  scope-overlap
  chain coordination projection

v2
  node channels
  supervisor inbox
  read-only judge
  system.done / system.redirect
  node coordination projection
  strict single-scheduler invariant

v3
  freeform topology
  active judge
  system.swap
  derived node_memory
  blackboard-like self-election
  budget/idle/consensus stop conditions
  optimization suite integration
```

---

## 21. Design decisions to carry into the repo

The following are the most important decisions to preserve when editing implementation docs:

```text
1. v0 is canonical contract + minimal engine, not a bridge schema.

2. audience is canonical; target_job_id is a delivery bridge.

3. channel stream is not the work graph. Substrate derives graph edges.

4. coordinators monitor projections, not transcripts.

5. chain and node projections are distinct.

6. node-supervisor is the only scheduler for node channels.

7. proposal is a controlled request, not authority.

8. skill_patch proposals are telemetry and require governed apply.

9. evidence is pointer-first and dereferenced by policy.

10. authority is never derived from body text.

11. every graph edge should point back to source message, evidence, and forensic event.

12. metrics are low-cardinality projections only.
```

---

## 22. Short canonical summary

```text
Channels produce ordered operational messages.
Substrate derives durable work-graph edges from semantically relevant channel messages.
Coordinators monitor compact projections, not transcripts.
Evidence stores semantic payloads.
Forensics record auditable facts.
Metrics project low-cardinality aggregates.
Audience decides visibility, action targets, suggested watchers, scope hints and urgency.
Attention may request context; authority alone may mutate state.
Proposals may create work or request evaluation, but never apply changes directly.
```


---

## 23. Progress Projection — resolved design

> Resolves the open questions in `channels-forensic-attention-proposal.md` §5: **Q4** (how much of the projection lives in channels vs substrate) and **Q7** (coordinator routing / cached progress handed to woken specialists).

### 23.1 Two projections, not one

The docs conflate two surfaces. Separate them:

- **Ambient awareness card** (`chain.progress`) — compact, pointer-only, visibility-filtered. The default awareness payload any non-coordinator specialist receives on wake so it is not stupid (~the shape in the forensic proposal §B5).
- **Coordinator projection** (`chain_coordination` / `node_coordination`, §14-15) — the rich monitoring superset a coordinator/judge reads to decide.

There is one underlying `container_progress` state and two renderings at different verbosity. The card is a visibility-filtered projection of the same state.

### 23.2 Ownership: substrate, because it is a join

The projection needs fields channels cannot know alone — `current_step_issue_id`, `next_expected`, `blocked_by` live in the issue/step graph. It is a **join** of four sources:

```text
latest-progress entries     channel-derived
work-graph edges            substrate
issue / step state          substrate / tracker
budget / idle / member status   runtime
```

Channels contribute the progress entries but do not own the projection. Channels own the ordered stream; **substrate owns and assembles the projection**, alongside `work_graph_edges`. *(Answers Q4.)*

### 23.3 Truth vs cache: event-sourced, reuses the existing reducer/after-hook

The projection is a **pure fold** over (`channel_messages` + `work_graph_edges`) for a `container_id`. The stream is truth; the projection is a materialized cache that is always recomputable from it — the same reducer-purity / event-sourcing discipline as the channels §11 invariants. The after-hook (effectful, idempotent by `(container_id, msg_id)`) updates the `container_progress` row. A crash mid-update rebuilds from the stream. No new mechanism.

### 23.4 Computed by the runtime after-hook, not the coordinator

The projector is runtime-owned, fired by the same after-hook that runs on every accepted `post()`. It **cannot** be the coordinator's job: pair/chain channels in 0.1 have no coordinator/judge, yet must still have an awareness surface. Coordinator and specialists are both *consumers*. *(Corrects the implicit assumption in Q7.)*

### 23.5 Delivery: push the card on wake, pull the detail

When a specialist is woken, its resume payload is augmented with the **visibility-filtered progress card** (pointer-only) — the cached "where is my workgroup" surface Q7 envisioned. Detail is pulled on demand: `getProgressProjection` for the full view, `requestEvidence` for a payload. This unifies the push model (cheap awareness on every wake) with pointer-first dereference (forensic §B6). The card handed to participant P is the container projection filtered to entries whose `audience.visibility` includes P. *(Answers Q7.)*

### 23.6 What mutates the projection

Broadly the same trigger-set as work-graph edges — only semantically-relevant messages: `work.verdict`, blocking `work.finding`, `work.proposal`, `system.redirect`, `system.done`, and the *latest accepted* `work.turn` (which replaces the previous one, it does not accumulate). `note`, `work.ack`, and mechanical system messages do not change the card. The projector and the graph-deriver are **siblings** — same after-hook and same relevance gate — but **not the same emission predicate**. They diverge at the margins: a plain accepted `work.turn` updates the card's current owner / last-turn summary (projector) yet creates **no** edge (deriver); a non-blocking `work.finding` may raise a risk flag (projector) yet creates no edge (deriver, D1). One updates current state, the other appends immutable causal edges. The deriver's exact predicate is the canonical contract in channels.md §5.8.

### 23.7 Canonical contract

> **Canonicalized.** The `container_progress` table and the projection invariants now live as the normative source in **channels.md §5.9**. The cache shape is canonical from the start; in 0.1 it may be computed on demand for chain-scale containers. This section keeps only the Q4/Q7 resolution narrative above.

This closes forensic Q4 and Q7.

