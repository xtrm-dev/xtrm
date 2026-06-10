---
created: 2026-06-09T01:36
updated: 2026-06-09T01:36
---
# Channels, Substrate Graph & Coordinator Projections — Consolidated Design Notes

> Status: consolidated working draft from design session  
> Date: 2026-06-08  
> Scope: refine the canonical shape of `channels` for specialists, clarify the boundary with `substrate`, `forensics`, `evidence`, `metrics`, AgentOps proposals, and coordinator progress projections.  
> Intended use: copy into the repo as a design note, then split into canonical docs if useful.

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

Meanings:

```text
visibility
  who may know that the event happened

action_targets
  who should act, and may be automatically woken

suggested_watchers
  who may care, but should not be forced to act

scope_refs
  structured hints for relevance matching

urgency
  helps decide whether soft attention may escalate
```

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

Avoid a single flat namespace for every kind. Use families:

```text
work.*
  work.turn
  work.finding
  work.verdict
  work.proposal
  work.ack

control.*
  control.steer
  control.redirect
  control.attention_requested
  control.escalation

system.*
  system.continue
  system.done
  system.swap
  system.idle
  system.budget
  system.epoch_bump

runtime.*
  runtime.error
  runtime.message_rejected
  runtime.member_joined
  runtime.member_left
  runtime.delivery_failed
```

In CLI or user-facing surfaces, short aliases can still exist: `verdict`, `finding`, `steer`, `proposal`.

`proposal` should not be a flat body shape. Keep the storage kind stable, but discriminate by `proposal_class`:

```json
{
  "kind": "work.proposal",
  "proposal_class": "self_activation | terminate | redirect | skill_patch | template_set_patch | evaluation_request"
}
```

Rule:

```text
A proposal may create work.
A proposal may request attention.
A proposal may request evaluation.
A proposal may never grant authority or apply a config change.
```

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

Suggested table:

```sql
CREATE TABLE work_graph_edges (
  id TEXT PRIMARY KEY,
  edge_kind TEXT NOT NULL,

  from_issue_id TEXT,
  to_issue_id TEXT,

  from_participant_id TEXT,
  to_participant_id TEXT,

  channel_id TEXT,
  channel_message_id INTEGER,
  forensic_event_id TEXT,
  evidence_refs_json TEXT,

  container_id TEXT,
  chain_id TEXT,
  node_id TEXT,

  summary TEXT,
  provenance_json TEXT,
  created_at_ms INTEGER NOT NULL,

  UNIQUE(edge_kind, from_issue_id, to_issue_id, channel_message_id)
);
```

Suggested edge kinds:

```text
reviewed
  reviewer_issue -> executor_issue

requests_changes
  reviewer_issue -> executor_issue

responds_to
  executor/remediation_issue -> reviewer/verdict/finding issue

blocks
  finding/reviewer_issue -> executor_issue

blocked_by
  executor_issue -> finding/reviewer_issue

discovered_from
  new_followup_issue -> source_issue

derived_from_message
  graph edge or issue -> channel_message

supported_by_evidence
  graph edge -> evidence
```

Direction convention:

```text
A discovered_from B
  A was discovered from B

A requests_changes B
  A asks B to change

A responds_to B
  A is a response/remediation to B

A blocks B
  A prevents B from progressing or closing
```

Automatic mapping examples:

```text
work.verdict PASS
  reviewer_issue reviewed executor_issue

work.verdict PARTIAL/FAIL
  reviewer_issue requests_changes executor_issue
  executor_issue blocked_by reviewer_issue
  edge supported_by evidence

work.finding blocking=true
  finding_issue discovered_from reviewer_issue
  finding_issue blocks executor_issue

control.redirect
  coordinator_issue redirects target_issue

proposal.self_activation
  proposal_issue discovered_from source_issue
  proposal_issue requests_attention coordinator_issue

proposal.skill_patch
  sp-improve issue discovered_from current_issue
  sp-improve issue supported_by channel_message/evidence/kpi
```

Do not create graph edges for every `work.turn`. A normal turn can remain stream-only unless it carries relation hints such as `responds_to`.

Rule:

```text
Only semantically relevant messages create graph edges.
Every graph edge must point back to its source message, evidence, and forensic event.
Edges, not raw messages, explain cross-issue causality.
```

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
