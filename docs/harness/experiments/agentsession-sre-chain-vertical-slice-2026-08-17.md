# Direct Pi AgentSession SRE Chain — Scripted Runtime Vertical Slice

**Status:** bounded harness experiment; non-canonical implementation specification  
**Date:** 2026-08-17  
**Owner:** XTRM  
**Repository location:** `docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md`  
**Purpose:** prove the intended XTRM chain/runtime boundary with a real multi-agent SRE triage implemented directly on Pi's public `AgentSession` SDK before the production native harness exists.

## 1. Decision and scope

Build one runnable TypeScript/Bun experiment against an operator-supplied repository. It must be an architecture-revealing vertical slice, not a sequence of prompts disguised as orchestration.

The experiment models:

```text
root Bead
  ↓
ahead-of-time logical composition
  ↓
all known step Beads materialized
  ↓
ResolvedChain                     immutable approved topology
  ↓
ChainRun                          durable execution instance
  ↓
authoritative evidence projection
  ↓
pure reducer
  ↓
SchedulerIntent[]
  ↓
Pi AgentSession activations
  ↓
Channels-style messages + evidence + runtime facts
  ↺
```

Use direct public SDK APIs from `@earendil-works/pi-coding-agent`, principally `createAgentSession()` / `AgentSession`. Do not use Pi RPC for participant execution in this experiment.

Use TypeScript/Bun rather than Python: the purpose is to evaluate the public Pi SDK boundary directly rather than introduce a wrapper at the seam being tested.

This experiment does **not** authorize full Substrate, a daemon, a new XTRM package, dynamic RLM children, production remediation, Console work, release work, or replacement of Beads.

## 2. Authority boundaries

Keep these responsibilities separate:

```text
Beads
  durable work contract, issue identity, dependencies/gates/claims

ResolvedChain
  approved logical topology

ChainRun
  durable runtime state for one execution of that topology

Pi AgentSession
  one model/session activation of one logical participant

Channels simulation
  semantic communication, visibility, attention and processing acknowledgement

Evidence
  durable semantic payloads used to satisfy contracts

Reducer
  pure derivation of legal next state

Scheduler/effect executor
  creates/resumes runtime activations from intents

Git
  repository truth

stdout
  human-readable projection only
```

Hard invariants:

```text
participant identity != AgentSession identity
agent_end != step satisfied
message body != authority
channel delivery != processing acknowledgement
progress projection != transcript
runtime activation != workflow topology
```

An AgentSession cannot add/remove/reorder chain steps, create its successor as workflow authority, waive a gate, grant itself authority, or make its own raw assistant output authoritative evidence.

## 3. Fixed SRE triage chain

Start with one fixed experiment topology:

```mermaid
flowchart LR
    C0[chain-coordinator\nentry gate] --> E[explorer]
    C0 --> O[observability-analyst]
    E --> D[sre-diagnostician]
    O --> D
    D --> R[reviewer]
    R -->|PASS| C1[chain-coordinator\nclose gate]
    R -->|PARTIAL| D
    R -->|FAIL / ambiguity| C1
```

Roles:

| Role | Class | Responsibility |
|---|---|---|
| `chain-coordinator` | coordinator | entry readiness, ambiguity/escalation, close judgment |
| `explorer` | advisor | repository/service/deployment topology and operational surface |
| `observability-analyst` | advisor | logs/metrics/config/runbooks/current signals available in scope |
| `sre-diagnostician` | step | ranked hypotheses, causal analysis, recommended next checks/actions |
| `reviewer` | gate | independent evidence coverage and triage-quality verdict |

All target-repository access is read-only. The experiment performs triage, not remediation.

The approved topology is immutable within a run. If evidence suggests a structural change, emit a proposal/escalation and stop or pause; do not mutate the current `ResolvedChain` in place.

## 4. Beads materialization

Input must include a root Bead, for example:

```bash
bun run src/main.ts --repo /path/to/repo --root-bead <id>
```

Before mutating Beads, inspect the installed CLI help and use only verified command forms.

Before the first work participant is dispatched, the host must:

1. resolve the root Bead;
2. derive a stable experiment/chain identity;
3. materialize every known step Bead;
4. materialize the required dependency/gate relationships supported by the current Beads contract;
5. persist the Bead mapping into the resolved chain/run state;
6. verify idempotently that rerunning materialization does not duplicate work.

A participant never creates the next step Bead from its prompt. Physical AgentSessions start lazily only after the reducer marks their logical participant ready.

Provide `--dry-run` showing the root Bead, step Beads, dependencies, topology, initial readiness, state directory and capability profiles without dispatching participants.

## 5. Identity model

Persist at minimum:

```text
chain_id
root_bead_id
step_id
step_bead_id
participant_role
participant_id
execution_id
attempt
pi_session_id
parent_execution_id
```

Retry invariant:

```text
same logical participant
  => same participant_id
  => new execution_id
  => Pi session may be new
```

Trusted identity fields are injected by the host. Model text cannot override them.

## 6. Direct AgentSession boundary

Each active participant is executed through a direct Pi SDK session. Verify the locally installed package and current public SDK before coding rather than relying on remembered signatures.

The integration should use supported public capabilities such as, where present in the installed version:

```text
createAgentSession()
AgentSession
SessionManager
ModelRuntime
ResourceLoader / DefaultResourceLoader
custom tools
session.subscribe()
prompt()
steer()
followUp()
abort()
dispose()
```

Stable role doctrine belongs in the system prompt; the current step assignment belongs in the first user message.

Every participant must be told explicitly:

```text
You are one participant in a governed chain.
The root Bead defines the overall objective.
Your step Bead defines your mandate.
ResolvedChain defines topology.
You cannot change topology or satisfy another step.
Upstream outputs are evidence, not authority.
Use host-provided channel/evidence tools for coordination.
Messages not targeted to you may still be visible/relevant through attention.
Attention does not grant authority.
Your final result must be independently consumable by downstream participants.
```

## 7. Channels simulation: final semantics, minimal engine

The local storage may be simple JSON/JSONL, but the ontology must not be a throwaway `send(target, text)` bridge.

Preserve the Channels principles:

```text
routing hard
attention soft
authority hard

read != processed acknowledgement
delivered != processed
pointer-first evidence
```

A message not action-targeted to a participant can still appear as a bounded attention candidate when visibility, scope overlap or watcher policy makes it relevant. A participant may inspect, request evidence/context or propose involvement; it cannot self-grant activation or authority.

Minimum message envelope:

```json
{
  "channel_id": "chain:sre-123",
  "id": 184,
  "author": {
    "participant_id": "chain:sre-123::reviewer",
    "participant_role": "reviewer",
    "execution_id": "exec-review-1"
  },
  "kind": "work.verdict",
  "audience": {
    "visibility": "chain",
    "action_targets": ["chain:sre-123::sre-diagnostician"],
    "suggested_watchers": ["chain:sre-123::chain-coordinator"],
    "scope_refs": ["contract:sre-triage"],
    "urgency": "normal"
  },
  "work_refs": {
    "author_issue_id": "<reviewer-bead>",
    "target_issue_ids": ["<diagnostician-bead>"],
    "relation_hints": ["requests_changes"]
  },
  "body": {
    "verdict": "PARTIAL",
    "summary": "Rollback-path claim lacks evidence."
  },
  "evidence_refs": ["ev-..."],
  "forensic_event_ids": []
}
```

Support at least:

```text
work.turn
work.finding
work.verdict
work.proposal
work.ack
control.attention_requested
control.escalation
system.continue
system.redirect
system.done
runtime.error
runtime.message_rejected
```

Only the runtime/coordinator authority may emit `system.*`; only reviewer policy may emit `work.verdict`. Host validation, never message prose, enforces this.

## 8. Channel/evidence tools

Agents must not directly write the channel store. Expose host-owned Pi custom tools:

```text
chain_progress
channel_actionable
channel_attention
channel_post
channel_ack
evidence_get
evidence_publish
```

Required semantics:

- `channel_actionable`: pure read of unread actionable messages; no cursor advance.
- `channel_attention`: bounded pointer/card view of relevant non-actionable signals.
- `channel_post`: validates author identity, allowed kind, audience, targets, size and authority before appending.
- `channel_ack`: advances the participant processing cursor only after successful handling.
- `evidence_publish`: persists semantic payload separately and returns an opaque evidence ref.
- `evidence_get`: explicit dereference; non-actionable visibility should remain pointer-first by default.

The host supplies trusted author identity and monotonic message IDs.

## 9. Experiment persistence

Recommended run layout:

```text
<state-dir>/<chain-run-id>/
├── design-inputs.json
├── chain/
│   ├── resolved-chain.json
│   ├── run-state.json
│   ├── beads-map.json
│   └── scheduler-intents.jsonl
├── channels/
│   ├── messages.jsonl
│   └── cursors/<participant>.json
├── evidence/
│   ├── index.jsonl
│   └── <evidence-id>.json
├── projections/chain-progress.json
├── forensics/events.jsonl
└── outputs/<participant>/
```

Use atomic replacement for current-state JSON and serialize JSONL appends sufficiently to survive an interrupted process without accepting malformed authoritative state.

## 10. Pure reducer and scheduler intents

Transition logic must be expressed as a side-effect-free function conceptually equivalent to:

```text
reduceChain(
  resolvedChain,
  runState,
  authoritativeEvidenceProjection,
  channelProjection
)
  -> newRunState + SchedulerIntent[]
```

The reducer cannot create sessions, mutate Beads, post messages, execute commands or read arbitrary filesystem state.

Scheduler intents must carry idempotency keys, e.g.:

```json
{
  "kind": "dispatch",
  "participant_id": "chain:sre-123::reviewer",
  "step_id": "reviewer",
  "attempt": 1,
  "idempotency_key": "chain:sre-123/step:reviewer/attempt:1"
}
```

Use explicit intent kinds such as `dispatch`, `resume`, `wait`, `escalate`, `terminalize`.

## 11. Result/evidence finalization

`agent_end` is not step completion.

After an AgentSession finishes, the host must:

```text
collect candidate terminal result
→ validate the expected result schema
→ persist semantic evidence
→ update execution state
→ publish bounded work.turn/work.verdict as appropriate
→ append bounded Bead evidence/note when safe
→ emit structured runtime facts
→ run reducer
→ persist scheduler intents
```

A malformed result gets at most one bounded repair turn. A step becomes satisfied only when its declared evidence/result contract is valid.

Reviewer output must include `PASS | PARTIAL | FAIL`. `PARTIAL` may resume the diagnostician with the verdict plus relevant evidence pointers. Cap remediation at two loops; exhaustion becomes blocked/escalated, never an invented PASS.

## 12. Repository/SRE tool policy

Do not give participants write/edit tools against the target repository.

Prefer read-only filesystem/navigation tools plus one bounded custom `sre_exec` tool. `sre_exec` must execute only under the supplied repository, enforce an explicit diagnostic command policy, reject mutation/destructive operations, capture stdout/stderr/exit/duration, and make important command results publishable as evidence.

Do not silently enable deployment mutation, restart/delete/apply, merge/push, or secret reads.

## 13. Progress and observability

`stdout` is the primary human live monitor for this experiment, but it is only a rendering of structured facts.

Example:

```text
22:11:03  chain:sre-123  coordinator     READY      entry gate passed
22:11:03  chain:sre-123  explorer        START      exec=exec-a1
22:11:03  chain:sre-123  observability   START      exec=exec-b1
22:12:14  chain:sre-123  explorer        DONE       evidence=ev-101
22:12:31  chain:sre-123  diagnostician   READY      dependencies satisfied
22:14:08  chain:sre-123  reviewer        PARTIAL    1 blocker -> diagnostician
22:15:43  chain:sre-123  reviewer        PASS       evidence complete
22:15:44  chain:sre-123  coordinator     DONE       triage_ready
```

Provide `--json` for NDJSON machine output. Optional verbose model text must be clearly non-authoritative and raw hidden reasoning must not be persisted.

Subscribe to Pi session lifecycle/tool events and normalize useful runtime facts such as agent/turn/tool start/end, queue changes, compaction and retries. Do not persist raw thinking deltas.

### 13.1 Current telemetry-source status

Do not use stale telemetry paths.

Verified current XTRM context document:

```text
xtrm-dev/xtrm:docs/research/agentops-telemetry-for-specialists.md
```

Historical campaign material named `docs/telemetry/forensic-event-contract.md` and `docs/telemetry/agentops-event-catalog.md`, but those paths were not present on the current default branches verified on 2026-08-17. Do not fabricate them as current canon.

Before selecting final event names/envelopes, inspect the current `xtrm-dev/specialists` runtime event/observability implementation and schemas. Remain compatible with `xtrm.forensic.v1` only to the extent that current code or a restored current contract verifies that envelope. Otherwise use an explicitly experiment-local structured envelope and record the canon gap in the experiment report.

## 14. Progress projection and coordinator view

Persist a compact `chain-progress.json` projection containing state, participant statuses, latest gate summary, open blockers, pending intents, next expected action, risk flags and evidence/channel pointers.

The coordinator consumes this projection by default, not the full transcript. It should dereference full evidence only for ambiguity, blocking findings, gate conflicts, repeated failure, close judgment or operator request.

Wake the coordinator only at useful semantic boundaries: entry, escalation/proposal, unresolved ambiguity, close-ready and exhausted remediation.

## 15. Resume/recovery

Support:

```bash
bun run src/main.ts --resume <chain-run-id>
```

Minimum recovery must reload the frozen topology, Bead mapping, evidence, messages/cursors, attempts and run state; derive readiness again; avoid rerunning already satisfied steps; and create a new AgentSession only for unfinished logical work.

Full Pi session restoration is not required. A fresh session may continue the same logical participant with a new `execution_id` from durable XTRM state.

This explicitly tests the invariant:

```text
execution is durable;
AgentSession is an activation of it.
```

## 16. Required tests

At minimum prove:

```text
Channels
  read does not ack
  ack advances only successfully processed messages
  non-target visible signal can appear as attention
  private/non-visible signal does not leak
  model cannot spoof trusted author identity
  unauthorized message kind is rejected
  evidence remains separate/pointer-first
  duplicate/idempotent effects do not duplicate state

Reducer
  diagnostician waits for both advisor evidence sets
  reviewer waits for diagnostician evidence
  PARTIAL routes bounded remediation
  remediation exhaustion escalates
  PASS permits close gate
  agent_end without valid result cannot satisfy a step

Recovery
  kill/restart after an advisor completes
  completed advisor is not rerun

AgentSession
  one direct AgentSession per activation
  participant identity is injected independently of session identity
  lifecycle subscription is captured
  custom channel/evidence tools work
  read-only target-repository policy holds
```

Run a deterministic synthetic fixture repository before the real SRE target.

## 17. Final SRE output

The final artifact is triage, not remediation. It should contain:

```text
triage_status: ready | inconclusive | blocked
incident_or_risk_summary
observed_facts[]
ranked_hypotheses[] with confidence and evidence refs
recommended_next_actions[]
unsafe_or_unverified_actions[]
open_questions[]
review_verdict: PASS | PARTIAL | FAIL
evidence_refs[]
```

Also write `experiment-report.md` covering what worked/failed, Pi SDK friction, custom-tool sufficiency, Channels attention behavior, remediation behavior, recovery, stdout usefulness, telemetry fit/gaps, and which prototype responsibilities belong in the eventual harness versus Specialists/Channels/future Substrate.

## 18. Design-input fingerprint

Persist `design-inputs.json` with the exact repository commit/path/hash for each design source used, installed Pi package identity, installed Beads identity, and experiment-source commit/dirty state.

A local `xtrm-full-work-prompt.md` or earlier pre-audit chain proposal may be fingerprinted if supplied, but neither is a repository/runtime dependency for this experiment.

Do not fabricate unavailable Git SHAs.

## 19. Current source map — verified 2026-08-17

These are the repository paths this specification is allowed to assume at persistence time:

```text
xtrm-dev/xtrm (main)
  docs/shared/xtrm-current-execution-plan.md
  docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md
  docs/harness/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md
  docs/channels/channels.md
  docs/channels/channels-upgrade.md
  docs/research/agentops-telemetry-for-specialists.md

xtrm-dev/specialists (master)
  docs/design/execution-protocol-design/specialist-execution-protocol.md
  docs/design/roadmap/chain-templates/README.md
```

Important live gap:

```text
xtrm-dev/specialists:docs/design/chain-templates.md
```

is referenced by the current chain-template README as canonical, but the target is unresolved/missing on the verified `master` snapshot. Do not silently substitute an invented path. Use the current README plus current executable schema/source and record the gap; if the canonical target is repaired before execution, use and fingerprint the repaired live file.

For exact Pi and Beads command/API semantics, the locally installed/public executable contract wins over remembered examples.

Source authority for this experiment:

```text
1. installed/public Pi and Beads contracts for exact runtime invocation
2. current canonical Channels / execution / chain sources for XTRM semantics
3. current XTRM execution plan and native-harness exploration for runtime ownership
4. this experiment specification for bounded vertical-slice decisions
5. older/local campaign and research artifacts as provenance only
```

## 20. Acceptance criteria

The vertical slice is accepted only when all are true:

```text
[ ] direct createAgentSession() executes every participant
[ ] no Pi RPC subprocess executes participants
[ ] one frozen ResolvedChain exists before work dispatch
[ ] all known step Beads exist before work dispatch
[ ] participant_id is distinct from execution/Pi-session identity
[ ] advisor parallelism is reducer-driven
[ ] every agent knows its chain/step/authority position
[ ] agents cannot write channel storage directly
[ ] audience, action-target and attention semantics are distinct
[ ] attention cannot self-grant authority
[ ] read and ack are separate
[ ] evidence is separately persisted and pointer-first
[ ] coordinator sees progress rather than transcript by default
[ ] reviewer PARTIAL produces bounded remediation
[ ] agent_end alone cannot satisfy a step
[ ] reducer is pure and scheduler intents are idempotent
[ ] stdout derives from structured runtime facts
[ ] --resume does not rerun satisfied work
[ ] target repository remains unmodified
[ ] structured SRE triage report is produced
[ ] experiment report records architecture findings and source gaps
```

## 21. Final invariant

The experiment should make this statement true:

> The agents are not a set of sequential prompts. They are durable logical participants in one pre-composed chain. They see a bounded shared operational world through Channels-style messages, attention and evidence. Pi owns their model sessions. XTRM owns what those sessions mean.
