---
title: channels
date_created: Monday, June 1st 2026, 7:11:07 pm
date_modified: Monday, June 1st 2026, 7:11:18 pm
created: 2026-06-07T02:22
updated: 2026-06-11T05:12
---
# Channels: A Reusable Inter-Specialist Communication Layer

> Status: Design draft (single delivery, two build phases 0.1 → 0.2)
> Doc role: **canonical / normative spec.** Plain Italian reader guide: `channels_plain_it.md`. Design rationale & decision-log: `channels-upgrade.md`. Original forensics/attention proposal (Q3–Q5, Q7 resolved; Q1, Q2, Q6 open): `channels-forensic-attention-proposal.md`.
> Scope: Add a reusable inter-specialist communication layer that powers pair-talk, lateral wakeups, human-in-the-loop steer, and (eventually) self-managed nodes.
> Non-goal: Replace `specialist_results`, `node_memory`, or job lifecycle. This sits *between* them as connective tissue.
> Sequencing note: One canonical contract, built and debugged as a single module. 0.1 brings up autonomous chains (full operational contract, chain path live); 0.2 activates freeform / self-managed nodes through seams 0.1 already built. These are an internal bring-up order, **not** separately-shipped gated versions. See §11 Sequenced Implementation. The critique that produced this design lives on bead `unitAI-jzhim`.

## 1. Problem

Today's specialist runtime is point-to-point and orchestrator-mediated:
- Reviewer reads executor `result.txt`; executor cannot see reviewer findings until the orchestrator manually `sp resume`s it.
- Node coordinator is a *router* (drives `spawn-member` / `wait-phase`) not a *judge*. Members never talk laterally.
- Human participation is per-job (`sp steer <job>`), not per-channel.
- `node_memory` captures curated findings but has no notion of message ordering, addressing, or subscription.
- No reusable "two specialists talk until done" primitive — every chain reimplements the loop in the orchestrator's head.
This makes multi-agent collaboration ceremonial and brittle.

## 2. Goals

1. One primitive — **channel** — that powers: pair-talk, self-managed nodes, reviewer loops, parallel-review consensus, and human chat.
2. Lateral peer wakeups (reviewer → executor) without orchestrator round-trips.
3. Spec-declared participation: a specialist's `.json` says what it subscribes to and emits.
4. Machine-readable messages with a discriminated-union schema, so judges and routers can act deterministically.
5. Anti-spam by construction: messages are pointers + summaries, not raw turn output.
6. CLI ergonomics: ad-hoc channels from the command line (`sp ch open`), no node config required.
7. `sp steer` and `sp resume` are implemented on top of channels; their CLI surface is unchanged.

## 3. Non-Goals

- New IPC layer. Channels live in `observability.db`, polled by the existing waiting-loop tick.
- New transport for raw turn output. `specialist_results` remains canonical for verbose content.
- Replacing `node_events`. Events stay for lifecycle (job starting/done); messages carry content.
- Free-form prose protocols. Every actionable message kind has a typed shape.

## 4. Concepts

| Concept | Definition |
| --- | --- |
| Channel | Ordered, append-only stream of messages. Any number of participants can subscribe; bilateral pair-talk is just the degenerate N=2 case. Mental model: a Slack channel — persistent, subscribable, multi-party, joinable after open. Has participants, topology, stop conditions. |
| Participant | A specialist job, the coordinator/judge, the human user, or `system`. Each has a key, role, and subscription filter. |
| Message | Typed, structured payload. Carries pointers (`result_id`, `diff_range`) rather than raw blobs. |
| Subscription | Per-participant cursor over the message stream, filtered by `kind:target`. |
| Topology | How turns are taken: `turns` (round-robin), `reactive` (peer-driven), `freeform` (self-electing). |
| Judge | Optional coordinator that subscribes to terminal-candidate messages and decides done/continue. Non-blocking: if the judge does not respond within `judge_timeout_ticks`, the runtime auto-emits `system.continue` so members are never stalled. |
| Stop condition | Declarative termination: `judge.done`, `consensus`, `budget`, `idle:K`, `judge_timeout`, `manual`. |

## 5. Architecture
### 5.1 Storage (`observability.db`)
```sql
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- 'pair' | 'node' | 'epic'
  topology TEXT NOT NULL,            -- 'turns' | 'reactive' | 'freeform'
  bead_id TEXT,
  node_run_id TEXT,                  -- nullable: pair channels have no node
  judge_key TEXT,                    -- nullable: pair channels have no judge
  participants_json TEXT NOT NULL,   -- [{participant_id, participant_kind, participant_role, job_id, subscribe, emits}]
  stop_on_json TEXT NOT NULL,        -- ["judge.done","budget","idle:8"]
  max_turns_per_member INTEGER,
  status TEXT NOT NULL,              -- 'open' | 'draining' | 'closed' | 'aborted' (see §5.2)
  created_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER,
  close_reason TEXT,
  next_seq INTEGER NOT NULL DEFAULT 1  -- display ordinal allocator; not a delivery cursor
);
CREATE TABLE channel_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  seq INTEGER NOT NULL,              -- per-channel DISPLAY ordinal only; NOT the delivery cursor (use id)
  author_kind TEXT NOT NULL,         -- 'specialist' | 'user' | 'system' | 'gate' | 'judge'
  author_key TEXT NOT NULL,          -- participant_id (L3); legacy column name retained
  author_job_id TEXT,
  kind TEXT NOT NULL,                -- canonical family kind, see §5.3
  message_family TEXT NOT NULL,      -- 'work' | 'control' | 'system' | 'runtime'
  audience_json TEXT NOT NULL,       -- {visibility, action_targets[], suggested_watchers[], scope_refs[], urgency}
  target_key TEXT,                   -- 0.1 bridge alias for audience.action_targets[0]; nullable
  body_json TEXT NOT NULL,           -- discriminated union, validated on write; never grants authority
  refs_json TEXT,                    -- {result_id, diff_range, files[]}
  work_refs_json TEXT,               -- {author_issue_id, target_issue_ids[], spawned_issue_ids[], relation_hints[]} for graph derivation
  evidence_refs_json TEXT,           -- pointers to durable semantic payloads
  forensic_event_ids_json TEXT,      -- pointers to audit / drilldown facts
  provenance_json TEXT,              -- {sender_role_at_time, capability_scope, lineage_refs[]}
  ts INTEGER NOT NULL
);
CREATE TABLE channel_subscriptions (
  channel_id TEXT NOT NULL,
  participant_key TEXT NOT NULL,       -- participant_id; stable L3 cursor owner
  last_seen_id INTEGER NOT NULL DEFAULT 0,  -- delivery cursor = table-wide channel_messages.id (NOT seq)
  paused INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, participant_key)
);
CREATE INDEX channel_messages_channel_id ON channel_messages(channel_id, id);
```

**Cursor model (canonical).** The one delivery cursor is the table-wide autoincrement `channel_messages.id` — monotonic, allocated by SQLite (no `MAX(seq)+1` cursor, no multi-writer race). `seq` is a per-channel **display ordinal only** (for `sp tail` readability), allocated by incrementing `channels.next_seq` in the same single-daemon insert transaction. Correctness never depends on `seq` and within-channel order is authoritatively `ORDER BY id`. `channel_subscriptions.last_seen_id` holds the highest `id` *successfully processed* (cursor-through-N, §5.5). All `readSince` / `markSeen` operate on `id`; a `seq` collision is cosmetic, never a delivery fault.

#### Identity compatibility with substrate §2.7

Channels use the same 5-layer identity model as substrate and the forensic envelope:

| Channel field | Canonical layer | Meaning |
|---|---|---|
| `participant_id` / legacy `participant_key` / `author_key` / `target_key` | L3 | Stable member identity inside its scope. Used for subscriptions, addressing, authority checks. |
| `job_id` / `author_job_id` / 0.1-bridge `target_job_id` | L4 | Current activation/run of that participant. Changes when the participant respawns or resumes in a new process. |
| `participant_kind` | L1 | Bounded identity kind, label-safe. |
| `participant_role` | L2 | Bounded role, label-safe. Legacy `specialist` and `role` fields read as aliases only. |

Rule: channel authority is checked against `participant_id` plus current activation `job_id`. A message body cannot assert either. `target_job_id` in 0.1 is a bridge-era shortcut for direct wakeups; canonically a message addresses `audience.action_targets[]` (participant_ids) and the scheduler resolves the current job activation.

#### Workstream ID naming convention
| Prefix | Example | When used |
| --- | --- | --- |
| `chain:<id>` | `chain:abc123` | Single executor→reviewer chain |
| `node:<id>` | `node:node-run-xyz` | Node run (all members share one channel) |
| `pair:<uuid>` | `pair:d4e5f6` | Ad-hoc pair-talk, no node config |
| `node:<id>/sub:<uuid>` | `node:n1/sub:ab12` | Lateral sub-channel within a node phase |
Hierarchical IDs (`/`) make `sp ch list --node <id>` queries trivially implementable and map cleanly to the stream-path model: child channels live under their parent's namespace.
Existing tables unchanged. `node_memory` becomes a **derived view** seeded by `kind=finding` messages with `confidence >= threshold`.
### 5.2 Lifecycle
```
created -> open -> draining -> closed
              -> aborted
```
**Status vs drain.** `status` is the authoritative lifecycle state. `open` accepts writes. A terminal `system.done` (or a fired stop condition) moves the channel to `draining` **immediately**, even if participants still have unread messages: no new actionable writes are accepted, but receivers may still read and ack what remains. `closed` is set once all receivers have drained (or a close-grace elapses); `aborted` is abnormal termination. Terminal status is thus separate from the unread/running drain state — a channel can be `draining` with unread messages outstanding. Pruning excludes `open` and `draining` channels (§11).
### 5.3 Message Kinds (families + discriminated union)
The canonical namespace is **families**: `work.*`, `control.*`, `system.*`, `runtime.*`. Every message body validates against a schema keyed by `kind`. Malformed or unauthorized messages follow the outcome classes in §10.1 (validation-reject / authority-reject / note-downgrade); none trigger wakeups. Addressing is by `audience` (§5.1); `target_key` is the 0.1 bridge alias for `audience.action_targets[0]`. Short aliases (`turn`, `finding`, `verdict`, `steer`, `redirect`, `proposal`, `ack`, `escalation`, `error`) stay valid in the CLI and in this doc's prose/code for brevity.

| Family | Kind (alias) | Author | Body shape | Wakes |
| --- | --- | --- | --- | --- |
| work | `work.turn` (`turn`) | specialist | `{summary, refs}` | nobody by default |
| work | `work.finding` (`finding`) | specialist, judge | `{severity, file?, line?, rule?, summary, refs}` | subscribers matching `wakes_on` / `scope-overlap` |
| work | `work.verdict` (`verdict`) | reviewer, judge | `{verdict: PASS\|PARTIAL\|FAIL, summary, findings[]}` | `audience.action_targets` if subscribed |
| work | `work.proposal` (`proposal`) | specialist | `{proposal_class, summary, …}` — see below | judge / coordinator |
| work | `work.ack` (`ack`) | specialist | `{refs: [message_id…], display_refs?: [seq…], decision}` | proposal author (for quorum) |
| control | `control.steer` (`steer`) | user, judge, peer | `{instruction}` | `audience.action_targets` |
| control | `control.attention_requested` | specialist | `{reason, scope_refs, refs}` | coordinator |
| control | `control.escalation` (`escalation`) | any | `{reason, refs}` | judge |
| system | `system.continue` | judge | `{reason}` | all open participants |
| system | `system.done` | judge | `{reason, outcome}` | all (terminal) |
| system | `system.redirect` (`redirect`) | judge | `{instruction}` | `audience.action_targets` |
| system | `system.swap` | judge | `{out, in, reason}` | runtime (member swap) |
| system | `system.idle` | runtime | `{turns}` | judge |
| system | `system.budget` | runtime | `{tokens, threshold}` | judge |
| system | `system.epoch_bump` | runtime | `{reason}` | all participants |
| runtime | `runtime.error` (`error`) | system (ChannelClient) | `{error_code, likely_cause, rejected_body_hash}` | nobody |
| runtime | `runtime.message_rejected` | system | `{error_code, …}` | nobody |
| runtime | `runtime.member_joined` / `runtime.member_left` | runtime | `{participant_id, reason}` | coordinator |
| runtime | `runtime.delivery_failed` | runtime | `{target, reason}` | coordinator |
| runtime | `runtime.participant_died` | runtime | `{participant_id, job_id?, reason, refs?}` | reducer/runtime; coordinator only after recovery exhaustion |
| runtime | `runtime.gate_unresponsive` | runtime | `{participant_id, gate_kind?, timeout_ms?, refs?}` | reducer/runtime; coordinator only after recovery exhaustion |
| runtime | `runtime.worktree_diverged` | runtime | `{worktree?, base_ref?, reason, refs?}` | reducer/runtime |
| runtime | `runtime.evidence_ref_broken` | runtime | `{evidence_ref, reason}` | reducer/runtime |
| runtime | `runtime.pulse_delivery_failed` | runtime | `{pulse_ref?, reason, attempts?}` | reducer/runtime |
| runtime | `runtime.budget_exhausted_mid_step` | runtime | `{budget_kind, used?, limit?, participant_id?}` | reducer/runtime |
| runtime | `runtime.recursion_cap` | runtime | `{loop_kind?, count?, hard_cap?, refs?}` | reducer/runtime |
| chain | `chain.incident.opened` | runtime / authorized coordinator boundary | `{incident_kind, summary, refs, recovery_exhausted: true}` | chain coordinator |
| chain | `chain.incident.resolved` | chain coordinator / runtime | `{incident_ref, outcome, refs?}` | affected action targets / audit |
| — | `note` | any | `{text}` | nobody |

`runtime.error` / `runtime.message_rejected` messages are written to the stream (not just returned as API envelopes) so the channel log is self-contained for post-mortem: a replay reveals exactly where and why messages were rejected, without external logs.

**Runtime failures and chain incidents.** `runtime.*` records bounded mechanical failures observed during one ChainRun/Container execution. Deterministic classes are first consumed by the runtime reducer/recovery policy; they do not wake the chain coordinator merely because the notice exists. When deterministic recovery is exhausted, or the failure requires semantic/operator judgment, the effect layer emits one idempotency-keyed `chain.incident.opened`. The coordinator consumes that explicit incident, not every mechanical failure. Resolution emits `chain.incident.resolved`. Neither message body may grant authority, mutate ResolvedChain topology, or bypass the scheduler. This absorbs the failure-kind inventory previously present only in `channels_plain_it.md` §7 and aligns with Substrate §4.3 incident handling and the native runtime recovery ADR.

**`proposal` is not a flat body.** Keep the storage kind stable (`work.proposal`) and discriminate by `proposal_class`:
```json
{
  "kind": "work.proposal",
  "proposal_class": "self_activation | terminate | redirect | skill_patch | template_set_patch | evaluation_request"
}
```
A proposal may create work, request attention, or request evaluation. It may **never** grant authority or apply a config change.

**`work.verdict` is single-target.** The validator requires exactly one `audience.action_targets` entry and one `work_refs.target_issue_id` per verdict. Reviewing N executors produces N verdict messages (one per target), keeping quorum/consensus, replay, remediation ownership, and edge derivation per-target unambiguous.

**Anti-spam guarantee:** `work.turn` messages carry `{summary <= 500 chars, refs: {result_id, range}}`. Verbose reasoning lives in `specialist_results`. Peers dereference only when they need detail.
### 5.4 Subscription Model
**Audience is the canonical addressing model** (`target_key` / `target_job_id` are 0.1 bridge aliases for `action_targets[0]`). Fields: `visibility` (who may know the event happened), `action_targets[]` (who should act, may be auto-woken), `suggested_watchers[]` (who may care, not forced to act), `scope_refs[]` (structured hints for relevance matching), `urgency` (whether soft attention may escalate). **`visibility` values (canonical).** Who may *know* an event happened — awareness only, never authority:

```text
private       author, action_targets, coordinator/runtime
targets       action_targets + coordinator/runtime
chain         all authorized participants in the chain
node          all authorized participants in the node
operator      human/operator + coordinator
public_audit  redacted, drilldown-visible fact only
```

**Per-kind default visibility** (container default = `chain` for chain/pair channels, `node` for node channels):

```text
work.turn / work.finding / work.verdict / work.proposal  -> container default
control.steer / system.redirect                          -> targets
control.attention_requested                              -> targets + coordinator/judge
system.done / system.epoch_bump                          -> container default
system.swap                                              -> node
runtime.*                                                -> targets + coordinator/runtime
public_audit                                             -> redacted facts only
```

**Inclusion rule.** Participant P may know a message iff P ∈ resolve(`visibility`): `private`→{author, action_targets, coordinator}; `targets`→{action_targets, coordinator}; `chain`/`node`→all authorized participants of that container; `operator`→{operator, coordinator}. `suggested_watchers` widen *awareness* (card/pointer) only — never `action_targets`. **Interaction with `chain.progress` (§5.9):** the ambient card handed to P on wake is the projection filtered to entries whose `visibility` resolves to include P. Visibility governs awareness/card filtering only; dereferencing full evidence still requires §10.3 policy, and authority is never derived from visibility.

Each participant declares a subscription expression. Defaults are conservative (addressed messages + verdicts + system). Addressing resolves against `audience`: `:me` matches when `audience.action_targets` contains my `participant_id`; `:scope-overlap` matches when `audience.scope_refs` intersect my declared scope.

**`scope_refs` grammar (canonical).** `scope_refs` are substrate scope hints, not a channel-private taxonomy. Storage uses a typed union; CLI/prose may accept `kind:ref` aliases, but writers normalize before insert:
```json
{ "kind": "file | package | contract | issue | symbol", "ref": "string", "repo": "optional", "qualifiers": {} }
```
0.1 accepts `file`, `package`, `contract`, and `issue`. `file` refs are normalized repo-relative paths; overlap is exact path or explicit directory-prefix (`src/foo/**`). `package`, `contract`, and `issue` overlap by exact id, with `package` prefix matching allowed only when the substrate package/workspace graph can prove the relationship. Unknown kinds are validation errors. Unresolved known refs may remain as pointer/card hints, but they do not grant evidence dereference.

`symbol` is reserved for 0.2 because it requires GitNexus-backed graph semantics. 0.2 starts with exact fully-qualified-symbol match; graph adjacency (call/import/definition, capped depth) must be explicitly enabled by the substrate scope resolver. Channels only ask "do these normalized refs overlap?"; substrate owns normalization and ownership semantics.

Format: `kind[:target_filter]`
| Pattern | Meaning |
| --- | --- |
| `control.steer:me` (`steer:me`) | steers whose `action_targets` include my participant_id |
| `work.verdict:me` (`verdict:me`) | verdicts whose `action_targets` include me |
| `work.finding:scope-overlap` | findings whose `audience.scope_refs` intersect my scope |
| `work.turn:peer` | reviewer-style: every other participant's turns |
| `system.*` | all system messages (on by default) |
| `work.proposal` | unaddressed proposals (judge default) |
Runtime resolves subscriptions on channel open and stores them in `channel_subscriptions`. Cursor advances only on messages matching the filter. **Routing is hard, attention is soft:** a non-matching message can still be *noticed* by a participant via the progress projection and acted on through its `attention_policy` (request context / propose involvement) — it is simply not auto-woken. See `channels-upgrade.md` §3-4 and §10.
### 5.5 Runtime Integration
The existing waiting-loop tick gains one read. Read and ack are **separate operations** — read is pure observation and never advances the cursor; ack is effectful and advances only up to the highest *successfully processed* message.
**Reducer / after-hook split (mandatory).** Each tick performs two strictly separated passes:
1. **Reducer** (pure, synchronous, no I/O): derive channel state from new messages — current turn, stop-condition check, participant roles, subscription resolution. Must be idempotent over replay: if the job crashes and restarts it re-reads from `lastSeenId` and rebuilds state without re-triggering anything external.
2. **After-hook** (effectful, deduped by `(channel_id, msg_id)`): enqueue resumes, post `system.*` messages, trigger wakeups. Side effects gate on whether the action was already enqueued (idempotency key check before every external call).
Never mix state derivation and side effects in the same pass. Violating this means a crash between "enqueue resume" and `markSeen` re-triggers the LLM call on replay.
```ts
// One ChannelClient instance per participant (authority lane). Never share across jobs.
const newMessages = client.readSince(channelId, myId, lastSeenId);  // pure; cursor unchanged
let highestProcessed = lastSeenId;
for (const msg of newMessages) {
  // Re-read participant roles before any mutation when authority state may have changed.
  if (msg.kind === 'system.epoch_bump') { await reloadParticipantRoles(channelId); continue; }
  if (msg.kind === 'control.steer'   && addressed(msg, myId)) emitResumeIntent(msg);
  if (msg.kind === 'work.verdict'    && addressed(msg, myId)) emitResumeIntent(msg);
  if (msg.kind === 'system.done') terminate(msg);
  if (msg.kind === 'system.redirect' && addressed(msg, myId)) emitResumeIntent(msg);
  highestProcessed = msg.id;
}
// Ack only after all intended actions succeed. Cursor-through-N: advances to highest processed,
// not highest received. A message that fails to enqueue does not advance the cursor.
await client.markSeen(channelId, myId, highestProcessed);
```
`addressed(msg, myId)` = `msg.audience.action_targets.includes(myId)` (the `target_key` bridge is read-only sugar). `emitResumeIntent(msg)` writes a **scheduler intent**, never a direct `enqueueResume`: for chains the scheduler is a trivial 1:1 resume, for nodes `node-supervisor` consumes the intent (§11, seam 2). There is no direct wake path in either kind.
**Wake cycle contract (guaranteed execution order per tick):**
1. `readSince(lastSeenId)` — observe, never mutate cursor
2. Act only on messages addressed to this participant or matching subscription
3. Emit resume *intents* to the scheduler / terminations (never a direct resume)
4. `markSeen(highestProcessed)` — only after every intended action above succeeds
5. If nothing actionable: stay silent — no empty `turn` messages
**Idempotency keys (per side effect).** Each effectful after-hook action gates on a stable key before executing; replay re-checks the key and skips already-committed effects:
```text
resume intent      (channel_id, msg_id, target_participant_id)
system.* emission  (channel_id, trigger_msg_id, system_kind)
forensic write     forensic_event_id            // deterministic, caller-supplied
evidence write     evidence_id                  // content-addressed / deterministic
edge derivation    UNIQUE(edge_kind, from_issue_id, to_issue_id, channel_message_id)
projection update  (container_id, last_message_id)        // watermark; recompute if behind
judge timeout      (channel_id, last_actionable_msg_id)   // one system.continue per stall
```
### 5.6 Topologies
| Topology | Turn selection | Use case |
| --- | --- | --- |
| `turns` | Coordinator/runtime picks next in declared order | Phased nodes, reviewer-after-executor |
| `reactive` | Last poster's `action_target` wakes; otherwise judge picks | Pair channels, debugger↔test-runner |
| `freeform` | Every member evaluates `should_i_respond?` cheaply each tick | Self-managed nodes, brainstorming |
`freeform` requires per-author cooldown (no N turns in a row) and per-member turn cap to prevent runaway loops.
### 5.7 Stop Conditions
Declared as a list; first to fire wins.
| Condition | Trigger |
| --- | --- |
| `judge.done` | Judge posts `system.done` |
| `consensus:N` | N matching `verdict=PASS` from distinct authors |
| `budget:tokens=T` | Aggregate token usage across participants exceeds T |
| `budget:turns=N` | Total turn count reaches N |
| `idle:K` | K consecutive ticks without a `turn`/`finding`/`verdict` |
| `judge_timeout:N` | Judge has not posted within N ticks since last actionable message; runtime auto-emits `system.continue` and resets the counter. Prevents the judge from becoming a blocking before-hook. |
| `manual` | User runs `sp conv close <id>` |
Runtime evaluates after every message write; on trigger, writes `system.done` and marks channel `closed`.
### 5.8 Work-Graph Edge Derivation (substrate)
Channels own the ordered operational stream; **substrate owns the durable work graph**. Semantically-relevant channel messages are derived into `work_graph_edge`s — durable causality, not ephemeral delivery. A channel message may be transient; an edge is permanent. Edges land in 0.1 (see §11, 0.1 #6), not later. The deriver is the **sibling of the progress projector** (§5.9): same after-hook, same relevance gate, different emission.
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
  provenance_json TEXT,           -- includes {endpoint_status: 'verified'|'unverified_endpoint'}
  created_at_ms INTEGER NOT NULL,
  UNIQUE(edge_kind, from_issue_id, to_issue_id, channel_message_id)
);
```
**Edge kinds + direction** (`A edge_kind B` reads "A …s B"):
```text
reviewed             reviewer_issue   -> executor_issue
requests_changes     reviewer_issue   -> executor_issue        (A asks B to change)
responds_to          remediation_issue-> reviewer/verdict/finding issue (A is a response to B)
blocks               finding/reviewer -> executor_issue        (A prevents B from closing)
blocked_by           executor_issue   -> finding/reviewer_issue
discovered_from      new_followup     -> source_issue          (A was discovered from B)
redirects            coordinator_issue-> target_issue
requests_attention   proposal_issue   -> coordinator_issue
derived_from_message edge or issue    -> channel_message
supported_by_evidence edge            -> evidence
```
**Derivation contract.** The deriver's **input is `work_refs`, never the body** — a pure function of `(kind, proposal_class, verdict, work_refs, scope_refs, evidence_refs, forensic_event_ids)`. It never parses free-text `body_json` (same discipline as authority, §10.1: the body is not a source of truth). `work_refs` (`author_issue_id`, `target_issue_ids[]`, `spawned_issue_ids[]`, `relation_hints[]`) is supplied by the author at `post()` time. Edges are **descriptive; they never grant authority**, so author hints are acceptable — subject to endpoint validation below.

The deriver is a **dispatch table** keyed by `(kind, proposal_class, verdict)` — the same "canonical contract, minimal engine" shape as topology / stop-conditions / `decision_schema`. All mappings are registered; 0.1 *exercises* a subset, the rest are registered-but-dormant (a 0.1 seam — see §11 Seams, seam 8). Never inline `if kind == verdict`.
```text
LIVE in 0.1 (exercised on the chain path)
  verdict PASS                  -> reviewed (+ supported_by_evidence)
  verdict PARTIAL/FAIL          -> requests_changes + blocked_by (+ supported_by_evidence)
  finding blocking              -> discovered_from + blocks
  turn [relation=responds_to]   -> responds_to            (D4: core remediation link)
  system.redirect               -> redirects
  work_refs.spawned_issue_ids[] -> discovered_from (one edge per spawned issue)
  multi-target                  -> one edge per target, UNIQUE includes to_issue_id (work.verdict is single-target, §5.3)

DORMANT (registered in the dispatch, not exercised in 0.1)
  proposal.self_activation      -> discovered_from + requests_attention   (theme 2)
  proposal.skill_patch          -> discovered_from + supported_by (evidence/kpi)
  proposal.terminate|redirect|evaluation_request -> per the catalog above

NO EDGE (resolved)
  finding non-blocking  -> stream-only by default (D1). It may raise a risk flag in the
                           projection but creates no edge. Escape hatch: an edge is
                           created only if it carries an explicit relation_hint.
  control.steer / human steer -> forensic-only, no edge (D2). Steer is operator intent,
                           not an issue->issue causal relation; redirects are covered by
                           system.redirect, and the work that follows carries its own edges.
  work.turn (plain), work.ack, note, system.* / runtime.* mechanical -> none
```
**After-hook ordering (obligatory).** The edge must embed `forensic_event_id` and `evidence_id`, so within the after-hook:
```text
1. forensic dual-write  ->  2. evidence dual-write (verdict / finding)
->  3. edge derivation (reads the ids emitted by 1, 2)  ->  4. projection update (§5.9)
```
Each step is idempotent by its own key; the edge by `UNIQUE(edge_kind, from_issue_id, to_issue_id, channel_message_id)`. On replay no duplicate edge is produced.

**Endpoint validation (D3): degrade, never reject.** The deriver soft-checks `work_refs.author_issue_id` against the participant's current step issue (substrate issue/step state):
```text
endpoints resolvable + author_issue matches  -> full edge
author_issue mismatch                        -> full edge, provenance endpoint_status
                                                "unverified_endpoint"
target_issue not in action_targets / step    -> full edge, provenance "unverified_endpoint" (target side)
endpoints absent / unresolvable              -> no issue->issue edge; record on the
                                                message's forensic event
                                                derivation_skipped: missing_endpoints
```
The message is **never** rejected for a `work_refs` problem — derivation hygiene must not couple to delivery. A flagged edge preserves the causal record and makes the uncertainty queryable ("curious but not credulous", §10.1). `from/to_participant_id` come from author / `audience.action_targets`; `from/to_issue_id` from `work_refs`; multi-target verdicts fan out to one edge per `target_issue_id`.
**Rule.**
```text
Only semantically relevant messages create graph edges.
Every edge MUST link its source channel message and forensic event; it links evidence ONLY when the source is an evidence-producing message (verdict / finding). Non-evidence edges (e.g. redirects) carry message + forensic only.
Edges, not raw messages, explain cross-issue causality.
```
> Design rationale and the channel_message→edge thesis live in `channels-upgrade.md` §11 (decision log).
### 5.9 Progress Projection (substrate)
The projection is the compact current state of a chain/node — **not a transcript**. Substrate owns and assembles it (it is a *join* of channel-derived progress entries + `work_graph_edges` + issue/step state + runtime budget/idle/member status). Channels own the stream; the projection is a **recomputable cache** (truth is the stream). It is computed by the **runtime after-hook** on every accepted `post()` — *not* the coordinator (pair/chain channels in 0.1 have no coordinator, yet must still have an awareness surface). Coordinator and specialists are both consumers. **`container_id`:** chain/pair channels write `container_id=chain:<id>` (or `pair:<id>`); node channels and their sub-channels write the parent `container_id=node:<id>` while keeping a distinct `channel_id`, so one node projection aggregates its sub-channels.
```sql
CREATE TABLE container_progress (
  container_id TEXT PRIMARY KEY,        -- chain:… / node:…
  projection_kind TEXT NOT NULL,        -- 'chain_coordination' | 'node_coordination'
  state TEXT NOT NULL,
  current_step_issue_id TEXT,
  next_expected_json TEXT,
  open_blockers_json TEXT,
  latest_progress_json TEXT NOT NULL,   -- ordered, pointer-only entries (visibility-tagged)
  budget_json TEXT,
  risk_flags_json TEXT,
  pointers_json TEXT,                   -- latest channel_message_id, forensic_event_id, evidence refs
  last_message_id INTEGER NOT NULL,     -- cache watermark; recompute if behind the stream
  updated_at_ms INTEGER NOT NULL
);
```
Two renderings of the one `container_progress` state: the **ambient awareness card** (`chain.progress`) — compact, pointer-only, visibility-filtered, the default awareness payload a non-coordinator specialist gets on wake — and the **coordinator projection** (`chain_coordination` / `node_coordination`, see `channels-upgrade.md` §14-15), the rich monitoring superset.

**Delivery: push the card on wake, pull the detail.** A woken specialist's resume payload is augmented with the visibility-filtered progress card (pointer-only); detail is pulled on demand (`getProgressProjection` for the full view, `requestEvidence` for a payload). The card handed to participant P is the projection filtered to entries whose `audience.visibility` includes P.

**What mutates it.** The same relevance gate as the edge-deriver (§5.8), but a **different emission predicate** — they are siblings, not twins. Trigger-set: `work.verdict`, blocking `work.finding`, `work.proposal`, `system.redirect`, `system.done`, and the *latest accepted* `work.turn` (which replaces the previous one, it does not accumulate). They diverge at the margins: a plain `work.turn` updates the card's current owner / last-turn (projector) yet creates no edge (deriver); a non-blocking `work.finding` may raise a risk flag (projector) yet creates no edge (deriver, D1).
**Invariants.**
```text
Substrate owns the projection; channels own the stream.
Truth is the stream; the projection is a recomputable cache.
The runtime after-hook computes it, not the coordinator.
Specialists get a visibility-filtered pointer card on wake; detail is pulled.
The projection mutates on the same gate as work-graph edges (different emission predicate).
```
> Design rationale and the Q4/Q7 resolution narrative live in `channels-upgrade.md` §23 (decision log).
### 5.10 Opportunistic Attention & Self-Activation (runtime)
Routing is hard, attention is soft, authority is hard (§5.4, §10). A participant must not behave as "a message not addressed to me does not exist": it receives the ambient progress card (§5.9) and may *notice* a relevant signal. But noticing is not activation — **opportunistic attention is always a request, never a self-grant.** Activation authority stays with the coordinator / judge / scheduler. *(Resolves forensic Q3.)*

**Two rungs, both requests.** The escalation ladder, chosen by intent:
```text
RUNG 1 — control.attention_requested {reason, scope_refs, refs}   (soft · "raise a hand")
  "I noticed signal X in my scope; I request context / I flag it."
  - no work-graph edge (awareness level)
  - wakes coordinator/judge; the 0.1 read-only judge may answer with system.redirect
  - may lead to an authorized requestEvidence dereference (§10, attention policy)

RUNG 2 — work.proposal { proposal_class: self_activation, … }   (firm · "propose to act")
  "I propose to activate / take this step / re-check."
  - derives discovered_from + requests_attention edges (§5.8)
  - requires coordinator/judge adjudication to actually wake (via system.redirect)
```
Each rung dual-writes its forensic twin (mechanical `channel.message.posted` + domain `control.attention_requested` / `chain.proposal.created`). The forensic event is the audit twin, **not** an alternative to the message — Q3's "proposal vs forensic vs both" was a category error: the message kind carries the act (rung 1 or 2 by intent); forensics is always the parallel record.

**Eligibility — `can_self_activate_on`** gates whether a participant may self-activate at all, and steers the default rung:
```text
scope-overlap, dependency-risk      -> rung 1 by default; escalate to rung 2 only
                                       after a dereference concludes action is needed
blocked-next-step, repeated-failure -> rung 2 (must unblock / intervene)
contract-risk                       -> rung 1 or 2 by urgency
```

**Bounds (anti-spam, balanced defaults).**
```text
max_attention_requests_per_epoch : 2   (cap rung 1)
max_self_activations_per_epoch   : 1   (cap rung 2, tighter)
cooldown                          : at most one attention / self-activation per K ticks
                                    starting K = 2 event ticks / 1 participant turn
dedup                             : repeated attention on the same scope_ref within an
                                    epoch collapses (do not re-flag the same thing)
over-budget -> ChannelClient rejects with the §10.2 envelope
               error_code: attention_budget_exceeded, next_safe_action: backoff
               (recorded as runtime.message_rejected, never a silent drop)
```

An **attention epoch** is the channel membership/capability epoch: it starts when the channel opens and resets only when the runtime writes `system.epoch_bump` (swap completion, capability revocation, or equivalent authority change). It is not a wall-clock cadence. An event tick means one reducer activation from `agent_end` / pulse / explicit command, aligned with substrate §3.1. Dedup keys are scoped by `(channel_id, participant_id, epoch, reason_class, scope_ref/evidence_ref)`. These are starting values in the §13 tuning style: runtime-tunable, not semantic truth. The bounds fields ship in 0.1; active noticing / self-activation loops stay dormant until 0.2.

**Canonical `attention_policy`** (on the `.specialist.json` `channel` block):
```json
{
  "attention_policy": {
    "can_request_evidence": true,
    "can_request_context": true,
    "can_self_activate_on": ["scope-overlap", "blocked-next-step", "contract-risk", "dependency-risk", "repeated-failure"],
    "self_activation_mode": "proposal",
    "max_attention_requests_per_epoch": 2,
    "max_self_activations_per_epoch": 1
  }
}
```
`self_activation_mode` is the **maximum rung allowed**: `off` (no self-activation) | `attention` (rung 1 only) | `proposal` (rungs 1–2). It is never an "act autonomously" mode — **activation is always adjudicated** (the participant proposes, the authority disposes). This canonicalizes the divergent `self_activation_mode` (upgrade §9) / `self_activation_requires` (forensic §B4) fields.
**Invariants.**
```text
Attention is soft, authority is hard: a request never self-grants activation.
The message carries the act; forensics is its mandatory audit twin.
Eligibility is gated by can_self_activate_on; volume by per-epoch caps + cooldown + dedup.
Only coordinator / judge / scheduler activates (system.redirect / scheduler intent).
```
> Contract (field, kinds, bounds) is defined in 0.1 (§11 Seams, seam 9); the active noticing→adjudication loops are exercised in 0.2. Rationale: `channels-forensic-attention-proposal.md` §3 (B1–B7).

## 6. Spec Schema (`.specialist.json` addition)

```json
{
  "name": "executor",
  "permission": "MEDIUM",
  "channel": {
    "subscribes": ["control.steer:me", "work.verdict:me", "work.finding:scope-overlap", "system.*"],
    "emits": ["work.turn", "work.ack", "control.escalation"],
    "cannot_emit": ["work.verdict", "system.done", "system.swap"],
    "wakes_on": ["work.verdict.PARTIAL", "work.verdict.FAIL", "system.redirect"],
    "turn_summary_max_chars": 500
  }
}
```
Reviewer:
```json
{
  "name": "reviewer",
  "channel": {
    "subscribes": ["work.turn:peer", "system.*"],
    "emits": ["work.verdict", "work.finding"],
    "cannot_emit": ["system.done", "system.swap", "control.steer"],
    "wakes_on": ["work.turn:peer"]
  }
}
```
Judge (node coordinator):
```json
{
  "name": "node-coordinator",
  "channel": {
    "role": "judge",
    "subscribes": ["work.verdict", "work.finding", "work.proposal", "system.idle", "system.budget", "control.escalation"],
    "emits": ["system.continue", "system.done", "system.redirect", "system.swap"],
    "decision_schema": "judge.decision.v1",
    "judge_mode": "readonly",
    "judge_execution": "classifier"
  }
}
```
`decision_schema` enforces structured output:
```json
{
  "decision": "done | continue | redirect | swap | escalate",
  "reason": "string",
  "redirect": { "target_key": "string", "instruction": "string" } | null,
  "swap":     { "out": "string", "in": "string" } | null
}
```
Judge prose lives in its `specialist_results`. Only the structured decision becomes a `system.*` message. Specs declare canonical `family.kind` values; the short aliases (`turn`, `verdict`, `steer`, …) are CLI/prose sugar only (§5.3).

`judge_mode`: `readonly` (0.1 — emits `done`/`continue`/`redirect` only) | `active` (0.2 — adds `swap`/`escalate`). `judge_execution`: `classifier` (cheap structured decision, default) | `full_turn` | `auto` (classifier, escalate to a full turn on ambiguity / high-risk). A read-only judge can never emit `system.swap` / `escalate`, regardless of `judge_execution`.

## 7. Node Config Schema (additions)

```json
{
  "name": "self-managed-design-review",
  "channel": {
    "topology": "freeform",
    "members": ["explorer", "debugger", "executor"],
    "judge": "node-coordinator",
    "stop_on": ["judge.done", "budget:turns=40", "idle:8"],
    "max_turns_per_member": 12
  },
  "completion_strategy": "manual"
}
```
Phased nodes (existing behavior) become a thin wrapper: `topology: turns` + per-phase member subsets. `wait-phase` and `spawn-member` remain as escape hatches but are no longer the primary mechanism.

The node's judge runs `judge_mode: active` in 0.2 (may emit `swap`/`escalate`); chains in 0.1 use `judge_mode: readonly` (§6).

## 8. CLI Surface
### 8.1 New commands
```bash

# Open a channel

sp ch open executor reviewer --bead <id> [--turns 6] [--stop-on pass]
sp ch open debugger test-runner --bead <id> --topology reactive
sp ch open a b c --judge node-coordinator --stop-on judge.done --topology freeform

# Post a message (human → channel)

sp msg <channel-id> "focus only on retry path"

# Inspect

sp tail <channel-id> [-f] [--kind verdict,finding] [--jq '.body.severity']
sp ch inject <channel-id> --as system --kind finding ...
sp ch pause  <channel-id> <participant>
sp ch resume <channel-id> <participant>
sp ch close  <channel-id> --reason "..."

# List / inspect

sp ch list [--node <id>] [--bead <id>] [--status open]
sp ch show <channel-id>
```
`sp steer <job> "…"` and `sp resume <job> "…"` are implemented as `kind=steer` messages posted to the job's channel. Their CLI surface is unchanged.

## 9. Self-Managed Node Flow

```
1. sp node run self-managed-design-review --bead <id>
2. Runtime opens channel C, spawns members + judge.
3. Members run in `freeform` topology. Each subscribes per spec.
4. Member emits `turn` → peers with matching subscription wake.
5. Reviewer-style member emits `verdict=PARTIAL target=executor`.
6. Executor (waiting + keep-alive) wakes from C, applies fixes, posts new `turn`.
7. Eventually a member emits `proposal=terminate`. Quorum requires M acks.
8. On quorum, judge wakes, evaluates, posts:
     {decision: done, reason: "..."}  → system.done → channel closed
   or
     {decision: redirect, redirect: {target: executor, instruction: "..."}}
9. On idle:8, judge wakes for nudge / swap / done ladder.
10. Channel closed → node merges per completion_strategy.
```
Coordinator is now a **gatekeeper**, not a router.

## 10. Permission & Safety

- A `kind=steer` from peer participant requires both jobs to share a worktree owner OR the steer specialist to declare `can_steer_peers: true` in its spec.
- `--force-job` semantics are preserved at the channel router: a MEDIUM peer cannot steer a running MEDIUM job in another worktree without it.
- Judge cannot directly write files; it can only emit `system.*` messages. Worktree edits stay with edit-capable specialists.
- Message body size cap (8 KB) enforced on write; oversized payloads must use the capture pattern: `ChannelClient.capture(blob) → result_id`, then post with `refs: { result_id }`. The validator returns `message_too_large` with `next_safe_action: "use_capture"`.
- Rate limit: per-participant token bucket on message writes (matches agentpipe's pattern). Default 1 message / 2s per participant.
### 10.1 Authority Decision Procedure
`ChannelClient` validates authority on every message write using this procedure:
1. Identify the requested mutation (what kind, what target)
2. Verify sender identity against `participants_json` (DB state, not message body)
3. Verify sender role matches what the spec's `emits` list permits
4. Check `cannot_emit` — reject if kind is explicitly excluded for this sender
5. **Reject body-text authority** — a message whose `body_json` claims elevated role or identity is downgraded to `kind=note` and does not trigger wakeups
6. Re-read participant state before any mutation when `system.epoch_bump` was received
**Valid authority sources:**
- Sender identity verified against `participants_json`
- Sender role from DB state at message write time
- Capability scope declared in `.specialist.json`
- Task assignee metadata (for `kind=ack`)
- Explicit protocol references (`refs_json`)
- Provenance lineage (`provenance_json`)
- Local user instruction (`author_kind=user`)
**Invalid authority sources — always rejected:**
- Message `body_json` text claiming a role or identity
- `author_key` values inside `body_json` (only the DB row's `author_key` column is trusted)
- Display names
- Token-looking strings in body
- Inbox emptiness or read-head position
Unknown authority is no authority: when the validator cannot confirm a valid source, the message is rejected.

**Outcome classes (distinct — not interchangeable).** A rejected write and a downgraded write are different facts:

```text
validation-reject  schema/family/kind invalid · body cap exceeded · bad audience/visibility
                   -> NOT written to the stream; post() returns the §10.2 envelope;
                      a runtime.message_rejected fact is written for audit
authority-reject   sender lacks emits/role · cannot_emit · epoch revoked · not participant
                   -> NOT written as the requested kind; §10.2 envelope returned;
                      runtime.message_rejected written
note-downgrade     well-formed, but body asserts authority/identity it cannot hold
                   -> written as kind=note (content preserved, harmless); no wakeup, no edge
```

`runtime.message_rejected` is the *audit record* of a reject, not the rejected message itself. Downgrade-to-`note` is reserved for the body-text-authority case (step 5 above) — it is never a catch-all for malformed input.
### 10.2 Error Envelope
`ChannelClient` errors return a structured envelope so callers know what to do next:
```ts
{
  ok: false,
  error_code: 'message_too_large' | 'cannot_emit' | 'not_participant' | 'epoch_revoked'
            | 'read_only' | 'rate_limited' | 'channel_closed' | 'body_cap_exceeded' | 'invalid_audience' | 'invalid_visibility' | 'validation_failed' | 'attention_budget_exceeded' | 'evidence_forbidden',
  likely_cause: string,
  next_safe_action: 'use_capture' | 'request_write_access' | 'rejoin' | 'backoff' | 'fix_audience' | 'request_grant' | 'none'
}
```

### 10.3 Evidence dereference (`requestEvidence`)
Default is pointer-first: participants receive pointers/cards for non-actionable messages, not full payloads (§5.9, §5.10). Full evidence is dereferenced only when **all** hold:
```text
1. the requesting participant's activation (job_id) is valid for its participant_id
2. P is permitted by the message visibility (§5.4)  OR  an operator override
3. one of: the message addresses P · P's subscription matches · the evidence is listed
   as an input in P's step contract · P's scope_refs overlap the message scope_refs
4. attention_policy.can_request_evidence == true   (for scope-overlap requests)
5. per-epoch cap / cooldown / dedup (§5.10) pass
6. for scope-overlap outside the step contract: a coordinator / judge / operator grant
```
Scope-overlap grants pointer/card visibility and the **right to request** — never automatic full evidence. Every request, grant, deny, and dereference emits a forensic audit fact. Denial returns the §10.2 envelope with `evidence_forbidden` (`next_safe_action: request_grant`) or `attention_budget_exceeded` (`backoff`). Authority is never derived from body text or from visibility.

The durable grant record is substrate-owned DB state, not channel-local state and not a forensic-derived view. Channels call the substrate evidence validator at dereference time. Canonical row shape:
```text
evidence_access_grants(
  grant_id,
  container_id,
  channel_id,
  evidence_ref | evidence_scope_refs_json,
  subject_participant_id,
  subject_job_id_at_grant,
  grantor_participant_id,
  grantor_job_id,
  grantor_kind,
  scope_refs_json,
  reason,
  allowed_actions,
  expires_at_ms,
  revoked_at_ms,
  revoked_by,
  revocation_reason,
  operator_override,
  created_at_ms,
  status
)
```
`subject_participant_id` (L3) is the durable subject; `subject_job_id_at_grant` (L4) is audit/context and the validator still checks the current activation. Grants must have an expiry; the default policy is the shorter of channel close and the grantor's configured TTL. Revocation sets `revoked_at_ms` and moves `status` to `revoked`; expiry may be materialized eagerly or checked lazily. `operator_override` is an explicit DB flag on this row, never an assertion in `body_json`. Forensics record request/grant/deny/dereference/revoke/expire, but forensics are audit facts only.

### 10.4 `system.swap` state machine (0.2; receiver epoch handling built in 0.1)
`system.swap` **unsubscribes and replaces** the outgoing participant — it does **not** kill the job. Hard kill stays the explicit operator path (`sp stop`). The active judge *requests* the swap; the scheduler *performs* it, in order:
```text
1. validate judge authority (may emit system.swap; not read-only)   // else authority-reject
2. pause the outgoing participant's subscription (no new resume intents)
3. mark outgoing participant status = replaced/waiting; block future resumes
4. resolve the worktree lease: wait for the outgoing job to yield/complete;
   if it holds dirty edits and will not yield, require operator stop (never force-kill)
5. register the incoming participant (participants_json + subscription)
6. emit system.epoch_bump -> every receiver calls reloadParticipantRoles before its
   next mutation (seam 5; receiver side already built in 0.1)
```
**Producer ordering (pins seam 5):** steps 1–5 complete *before* the `system.epoch_bump` is written, so no receiver ever acts on stale roles.

**Dirty worktree lease path.** The worktree lease is substrate state; channels only carry the swap request and epoch signal. If the outgoing participant does not hold the writer lease, the scheduler may replace it immediately. If it holds the lease, the scheduler waits for the job-level quiescence barrier (`waiting` / `done`) and checks the worktree:

```text
active -> swap_requested -> outgoing_paused

no writer lease:
  replaced -> incoming_registered -> system.epoch_bump

writer lease, clean at yield:
  lease_released -> replaced -> incoming_registered -> system.epoch_bump

writer lease, dirty:
  swap_blocked_dirty  (lease remains held by outgoing participant/job)
```

Dirty edits are never discarded and the scheduler never force-kills. While `swap_blocked_dirty`, the incoming participant is not granted that worktree. If the outgoing job will not yield, the only kill path is explicit operator `sp stop`; after stop, the dirty worktree remains preserved and the lease transfers only through an explicit operator action (`checkpoint`, `commit`, `stash`, or `takeover-dirty`, each audited). `system.epoch_bump` is written only after the final lease/participant mutation is committed and the incoming participant is registered.

### 10.5 Forensic families (channel mechanics)
Channel **delivery mechanics** emit a dedicated `channel.*` forensic family (audit facts, not domain meaning); semantic messages additionally emit their domain event (e.g. `review.verdict.*`). Mechanical family (live from 0.1):
```text
channel.opened            channel.message.posted      channel.message.consumed
channel.message.rejected  channel.member.joined       channel.member.left
channel.epoch_bumped      channel.closed
channel.message.delivered   // optional / sampled — debug only
```
Every significant channel mutation dual-writes through the shared `xtrm.forensic.v1` envelope writer; no caller hand-builds event JSON. Keeping mechanics in `channel.*` (rather than overloading `control` / `error` / `chain`) stops replay and drilldown from collapsing transport with domain meaning.

## 11. Sequenced Implementation (0.1 → 0.2)

One canonical contract, one delivery, two build phases. This is **not** a set of separately-shipped, independently-gated versions. The whole module is designed and debugged as a single coherent unit; **0.1 and 0.2 are an internal bring-up order for debuggability, not products with measurement gates or reversal ceremonies between them.**

The cut runs along the chain/node boundary, because that is where the engineering risk actually changes:

- **0.1 — autonomous chains.** A chain (executor → reviewer/seconder → remediation → gate) runs on its own: the reviewer wakes the executor laterally, the executor remediates, a stop condition closes the loop, a read-only judge arbitrates. This is deterministic mechanics with a clear contract — it either holds or it does not, and you verify that by integrating the whole, not by shipping halves. **Chain autonomy needs no freeform.**
- **0.2 — freeform / self-managed nodes.** A *team* of members with no fixed turn order self-elects each tick ("should I respond?"), with quorum and member swap. This is emergent swarm behavior whose safety numbers (per-author cooldown, turn caps, idle/budget stops) are tuned at runtime, not designed on paper. It is the one part where "build, measure, tune" actually buys something, so it is deferred — **in design, not in shipping.**

0.1 ships the *full operational contract* with only the chain execution path live. 0.2 *activates branches* that 0.1 already built through (see §11 Seams); it does not re-wire. Deferring 0.2 costs zero chain autonomy.

### Design invariants across both phases
These hold from 0.1 forward and constrain 0.2:
- **Storage model:** `id INTEGER PRIMARY KEY AUTOINCREMENT` is the cursor. `seq` is allocated from `channels.next_seq` for display only; no read/ack/replay path depends on it. SQLite gives us monotonic ids for free.
- **Delivery semantics:** at-least-once. Cursor advances *after* the resume payload is enqueued on the receiver. Receivers dedupe by `(channel_id, msg_id)` in their job-local state.
- **Crash recovery:** a receiver that crashes mid-resume re-reads from `last_seen_id` on restart. Duplicates are the receiver's problem, not the substrate's.
- **DB churn safety:** channel messages are *not* prune candidates while their channel is open. Pruning rules in `observability-sqlite.ts` must exclude `channel_messages` whose `channel_id` is in `open` status.
- **Worktree isolation preserved:** lateral steer between MEDIUM jobs requires either shared worktree owner OR explicit `can_steer_peers: true` in the sender's spec. Default is **off**.
- **Message body cap:** 8 KB. Larger payloads must use the capture pattern (see §10). The error code `message_too_large` is returned with `next_safe_action: "use_capture"`.
- **Spec is forward-compatible:** the `channel` block on a `.specialist.json` is the same shape across 0.1 and 0.2. Fields are added, never renamed or repurposed.
- **Single scheduler per channel kind.** Every channel read emits a resume *intent* to a scheduler — **never** a direct resume. Pair/chain channels: the scheduler is a trivial 1:1 resume of the intent. Node channels: the runner's channel read enqueues *intent* into a supervisor inbox; `node-supervisor` is the sole scheduler that decides whether and when to actually resume a member. Members never wake from a channel bypass while inside a node. This invariant prevents the node split-brain risk identified on bead `unitAI-jzhim`. **0.1 builds this indirection even for chains** (where the scheduler is a trivial 1:1 resume), so that 0.2 nodes plug in `node-supervisor` as the scheduler without re-wiring the wake path — see §11 Seams, seam 2.
- **Read/ack separation:** `readSince` is pure observation and never advances any cursor. `markSeen(processedId)` is the only call that advances the read-head, and it advances only to the highest *successfully processed* message id (cursor-through-N). A message that fails to enqueue a resume does not advance the cursor.
- **Authority lane per participant:** one `ChannelClient` authority lane per `participant_id`, bound at runtime to the current `job_id` activation. Clients are not shared across participants. This scopes identity, cursor state, and capability checks to the owning participant while still allowing a fresh activation after respawn.
- **Reducer purity:** Channel state (turn order, stop-condition evaluation, participant role lookup) is derived by a pure reducer over the message log. Side effects (resume enqueue, `system.*` writes) live in the after-hook and gate on idempotency keys. Replay of the reducer must never trigger external calls or LLM requests. This is the event-sourcing crash-recovery guarantee: a job that restarts mid-resume re-reads from `last_seen_id`, rebuilds state, and re-enqueues only actions that were not yet committed.
- **Body-text authority is always rejected:** a message whose `body_json` asserts a role or identity is downgraded to `kind=note` at write time and does not trigger wakeups. Authority is verified from DB state only (see §10.1).
- **Epoch re-read before mutation:** on receipt of `system.epoch_bump`, the receiver must call `reloadParticipantRoles(channelId)` before processing any subsequent message or performing any mutation. This fires on `system.swap` completion and any capability revocation.
### 0.1 — Autonomous chains (full operational contract, chain path live)
**Goal:** Chains run on their own. Reviewer wakes executor laterally, executor remediates, a stop condition closes the loop, a read-only judge arbitrates. Zero orchestrator round-trip, zero human `sp resume`.

**What ships live:**
1. Full storage from §5.1: `channels`, `channel_messages`, `channel_subscriptions`. `channel_messages` carries the canonical shape — `audience_json` (not a bare `target_key`), `work_refs_json`, `evidence_refs_json`, `forensic_event_ids_json`, `provenance_json`. `target_key` / `target_job_id` survive only as a 0.1 bridge alias for `audience.action_targets[0]`.
2. `ChannelClient` with `post / readSince / markSeen / capture`. Read/ack separated (cursor-through-N). Discriminated-union validator over the message families (§5.3); rejects body-text authority per §10.1. All errors return the §10.2 envelope.
3. `reactive` topology live (last poster's `action_target` wakes; fallback round-robin), `turns` available for phased chains. `freeform` is a dispatched stub — see §11 Seams, seam 1.
4. Stop conditions evaluated as a list (§5.7): `judge.done` / `idle:K` / `budget` / `manual` exercised on the chain path; `consensus:N` parses and is stubbed (seam 6).
5. **Read-only judge** with structured `decision_schema` (§6): emits `system.done` / `system.continue` / `system.redirect`. Cannot swap, cannot kill, never bypasses the scheduler.
6. **Work-graph edge derivation** (substrate) — live for `verdict` / blocking `finding` / `system.redirect` / `responds_to`-`turn`. Semantically-relevant messages append `work_graph_edge`s from the start; the deriver is a dispatch table keyed by `(kind, proposal_class, verdict)` with the `proposal.*` mappings registered-but-dormant. Input is `work_refs`, never the body; an `author_issue_id` mismatch degrades to an `unverified_endpoint`-flagged edge, never a message rejection. After-hook order is forensic → evidence → edge → projection. See §5.8 (canonical contract). *This resolves the prior v0-vs-v3 contradiction: edges land in 0.1, not later.*
7. **Materialized container progress projection + ambient awareness card.** The visibility-filtered card is pushed into the resume payload on every wake; the full view is pulled on demand via `getProgressProjection`. The projection is a derived cache over (stream + edges), updated in the after-hook. See §5.9 (canonical contract).
8. **Forensic dual-write.** Significant channel mutations emit `xtrm.forensic.v1` events through the shared envelope writer (`channel.*` family); `verdict` / `finding` also dual-write `evidence`.
9. **Scheduler indirection** (seam 2): the runner produces an *intent* consumed by a scheduler. For chains the scheduler is a trivial 1:1 resume; the indirection exists so 0.2 nodes drop in `node-supervisor` without re-wiring.
10. Pair-talk CLI: `sp ch open a b --bead X [--stop-on pass]`, `sp msg`, `sp tail`, `sp ch list/show/pause/resume/close`. `sp steer` / `sp resume` implemented on top of `ChannelClient.post()`; CLI surface unchanged.

**Built but dormant (the seams — they go live in 0.2):** `freeform` topology branch, active judge (`system.swap`), `node-supervisor` as real scheduler, `node_memory` derived-view cutover, multi-author `consensus:N` quorum, `proposal.*` edge mappings in the deriver dispatch, opportunistic-attention / self-activation loops (§5.10).

**Acceptance:**
- Reviewer↔executor chain runs end-to-end with zero human `sp resume`; `sp msg <channel-id>` reaches a waiting executor.
- A read-only judge can close a chain via `system.done`.
- The progress card appears, visibility-filtered, in the resume context of a woken specialist.
- `verdict` / `finding` produce work-graph edges and forensic + evidence dual-writes.
- Existing nodes, epics, chains, `sp steer`, `sp resume` work unchanged.
- `npm run lint`, `npx tsc --noEmit`, channel unit tests pass (post / readSince / markSeen / dedupe / crash-recovery / cursor-through-N partial advancement / body-text authority rejection / capture oversized payload).

### 0.1 Seams — what 0.1 must build *through* so 0.2 is additive
0.1 never exercises these paths, but it must build the indirection now or 0.2 becomes a rewrite. This is "canonical contract, minimal engine" applied with a scalpel.

1. **`topology` is a first-class field with dispatched turn-selection.** 0.1 runs `reactive` / `turns`; the channel record carries `topology` and turn-selection branches on it, with `freeform` a stub. Never hardcode "reviewer after executor".
2. **Scheduler indirection (intent → scheduler), not direct resume — non-negotiable.** Even for chains the runner emits an intent that a scheduler consumes (1:1 for chains, `node-supervisor` for nodes). Skipping this is the highest-temptation, highest-cost shortcut: it reintroduces the node split-brain (`unitAI-jzhim`) and forces a wake-path rewrite in 0.2.
3. **Address by `participant_id` (L3), not `job_id`.** The scheduler resolves the current `job_id` activation. Chains are near-1:1, but respawn / swap in 0.2 needs stable L3 identity.
4. **`audience` is the addressing model; `target_key` is only a bridge alias.** Chains populate a single `action_target`; node multi-target + `suggested_watchers` is just filling more of the same shape.
5. **Receiver already handles `system.epoch_bump → reloadParticipantRoles`.** It never fires in 0.1; this makes 0.2 swap / revocation a producer-side addition, not a receiver rewrite.
6. **Stop conditions are a list evaluator; `consensus:N` parses.** 0.1 chains close on one verdict, but quorum must not force a rewrite of terminal evaluation.
7. **Judge decision is a structured `decision_schema`.** 0.1 emits `done | continue | redirect`; 0.2 adds `swap | escalate` enum variants, not a new format.
8. **Edge-deriver is a dispatch table, not inline `if`s.** Keyed by `(kind, proposal_class, verdict)`; 0.1 exercises `verdict` / blocking `finding` / `system.redirect` / `responds_to`-`turn`, while the `proposal.*` mappings are registered-but-dormant (they go live with self-activation / skill-patch flows in 0.2). The after-hook ordering (forensic → evidence → edge → projection), the triple-link invariant, and `unverified_endpoint` degradation all hold from 0.1. Adding a 0.2 mapping is a dispatch entry, not a rewrite. See §5.8 (canonical contract).
9. **Opportunistic-attention contract defined, loops dormant.** 0.1 wires the `attention_policy` field, the `control.attention_requested` kind, the `proposal.self_activation` class, and the per-epoch bounds; the active noticing→adjudication loop is exercised in 0.2 (it needs the self-managed semantics). Both rungs are *requests* — activation is always adjudicated, never self-granted. See §5.10.

### 0.2 — Freeform / self-managed nodes (activate the dormant branches)
**Goal:** Teams of agents self-organize. Reach the original vision — self-managed nodes, freeform topology, derived memory.

**What activates (the built-through seams turned on):**
1. `freeform` topology: members self-elect each tick via a cheap "should I respond?" probe, under per-author cooldown and per-member turn cap.
2. `node-supervisor` becomes the real scheduler consuming channel intent; the single-scheduler invariant is enforced by test (a direct channel→runner wake inside a node is a test failure).
3. Active judge: `system.swap` (replace a member) behind the §10 safety gates; `system.epoch_bump` on swap completion.
4. `node_memory` becomes a derived view over `finding` messages, via a one-way backfill validated by a shadow-write comparison before cutover.
5. Multi-author quorum live: `consensus:N` from distinct authors; node coordination projection (`channels-upgrade.md` §15).
6. Per-participant token-bucket rate limits on message writes.
7. `using-specialists-v2` skill rewritten channel-first; orchestrator-mediated review marked legacy.

**Tuning note (why this is the deferred phase):** the safety numbers for freeform — cooldowns, turn caps, idle / budget stops, oscillation damping — are settled by running the swarm on real workflows, not by design. Expect 0.2 to have a hard contract core (already built in 0.1) plus a soft dynamics edge iterated at runtime. This is the only part of the module that is *not* a one-shot debug.

### Reversal
The module is one delivery, but 0.2's swarm behavior is independently disableable:
- **Disable 0.2:** gate off the `freeform` branch and active-judge `system.swap`; nodes fall back to `turns` / `reactive` + read-only judge. Lateral messaging inside nodes still flows through the supervisor scheduler. No chain behavior changes.
- **`node_memory` cutover** is the one one-way step: until the shadow-write comparison passes, `node_memory` keeps its direct-write path and the derived view runs in shadow.

### Out of scope (both phases)
- Cross-channel messaging (epic-level coordinator watching N chain channels). Deferred indefinitely.
- Multi-user identity in messages. Single `user` author key.
- Bidirectional integration with external systems (Slack, GitHub comments). Channels are internal.

## 12. Open Questions

1. **Channel granularity — RESOLVED (2026-06-11 audit).** Both allowed via `channels.kind`: per-chain for traditional executor→reviewer (live 0.1), per-node for self-managed (0.2). `container_id` = `chain:<id>` for chain/pair channels; node channels and sub-channels carry parent `container_id=node:<id>` with a distinct `channel_id` (§5.1, §5.9).
2. **Verdict targeting — RESOLVED.** One `work.verdict` per target; the validator requires exactly one `action_target` + one target issue id, and edge derivation emits one target edge per message (§5.3, §5.8).
3. **`system.swap` kill vs unsubscribe — RESOLVED.** Unsubscribe + mark replaced, never kill; operator `sp stop` is the kill path. State machine in §10.4.
4. **Cross-channel references** (epic-level coordinator watching multiple chain channels)? Possible via `epic` kind, deferred.
5. **User identity in messages** — single `user` key, or per-CLI-invocation? Single for now; revisit if multi-user becomes real.
6. **Judge model — RESOLVED.** Contract boundary is `decision_schema`; default execution is a lightweight classifier, full specialist turn behind a flag / `auto` escalation. Fields `judge_mode` / `judge_execution` (§6–7).

**Residual questions raised by the 2026-06-11 audit — RESOLVED:**

7. **Evidence-grant record — RESOLVED.** Durable grant authority lives in substrate-owned `evidence_access_grants` DB state; forensics audit requests/grants/denials/dereferences but never become authority (§10.3).
8. **`scope_refs` grammar — RESOLVED.** Typed union owned by substrate scope semantics: 0.1 supports `file`, `package`, `contract`, `issue`; 0.2 reserves `symbol` for GitNexus-backed graph adjacency (§5.4).
9. **Epoch & cooldown defaults — RESOLVED.** An epoch is the channel membership/capability epoch and resets on `system.epoch_bump`; starting bounds are 2 attention requests, 1 self-activation, cooldown K = 2 event ticks / 1 participant turn (§5.10).
10. **`seq` retention — RESOLVED.** Keep `seq` as stable per-channel display ordinal for `sp tail`; `id` remains the sole delivery cursor and replay/ack authority (§5.1).
11. **Swap worktree-lease state machine — RESOLVED.** Dirty writer leases block automatic swap completion; edits are preserved, operator stop/takeover is explicit, and `system.epoch_bump` follows lease resolution + incoming registration (§10.4).

## 13. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Runaway freeform loops | Per-member turn cap, idle escalation ladder, total budget stop |
| DB write contention | Pointer-only messages, batched writes per turn, per-participant rate limit |
| Context bloat from over-broad subscriptions | Conservative default subscription, schema-validated `subscribes` field, lint warning on `*` |
| Lateral steer abuse between MEDIUM jobs | Permission gate at router, `--force-job` reuse, per-spec `can_steer_peers` opt-in |
| Rollout breakage of nodes/epics | Single-delivery build per §11; 0.2 swarm behavior independently disableable; node channel opt-in via `channel.enabled` |
| Judge becoming a bottleneck | Wake-on filters narrow; lightweight decision call; quorum gating reduces wake frequency. Hard backstop: `judge_timeout:N` stop condition auto-emits `system.continue` if judge is silent for N ticks, making the judge eventually-consistent rather than a blocking gate (see §5.7). |

**0.2 freeform default tuning envelope** (starting values, tuned at runtime per §11 — *not* contract): per-author cooldown 1 turn / 2 ticks; per-member turn cap 12; `idle:8`; `budget:turns=40`; oscillation damping after 3 no-progress cycles → judge nudge ladder. Hard caps live in the channel record; the soft numbers are iterated on real workflows.

## 14. Success Criteria (per phase)

**0.1 — Autonomous chains:**
- Reviewer↔executor chain runs end-to-end with zero human `sp resume`; `sp msg <channel-id>` reaches a waiting executor.
- A read-only judge (`judge_mode: readonly`) closes a chain via `system.done`; `system.redirect` re-routes through the scheduler.
- The visibility-filtered progress card appears in the resume context of every woken specialist; the full view is available via `getProgressProjection`.
- `work.verdict` / `work.finding` produce `work_graph_edge`s and forensic + evidence dual-writes.
- Subscription filters (`work.finding:scope-overlap`) resolve correctly; `audience` addressing resolves `:me` against `action_targets`.
- **Single-scheduler indirection in place even for chains:** the runner emits intent to a scheduler (1:1 for chains); no direct resume path that 0.2 would have to unwind.
- All existing nodes / epics / chains / `sp steer` / `sp resume` pass unchanged.
- `npm run lint`, `npx tsc --noEmit` clean. Channel unit tests cover post / readSince / markSeen / dedupe / crash-recovery / cursor-through-N partial advancement / body-text authority rejection / capture oversized payload.

**0.2 — Freeform / self-managed nodes:**
- A node with two reviewers in the same phase converges via channel without coordinator manual intervention.
- **Single-scheduler invariant verified by test:** no resume of a node member ever bypasses `node-supervisor`. A direct channel→runner wake inside a node channel is a test failure.
- `node-supervisor` source line count holds steady or drops; phase machinery untouched. Nodes with `channel.enabled` omitted behave identically to today.
- Self-managed node terminates correctly on `judge.done`, `idle:K`, and `budget` in tests.
- `node_memory` derivation passes a shadow-write comparison before cutover.
- No oscillation observed in freeform topology with 3+ members under standard cooldowns.
- `sp tail <channel-id> --jq '.body.severity'` lets a human grep across a channel.

## Appendix: Design Lineage
Channels is an xtrm primitive — not a generic message bus, not a re-implemented LLM framework. Boundaries it must keep:
- **Container-scoped, not a global bus.** A channel belongs to one chain/node container; there is no global subscribe. Cross-container coordination is **pulse**'s responsibility (`substrate_design_it.md` §2.3; node-cluster / pulse-mesh framing §4.5), never channel-watching — cross-channel watching stays out of scope (§11, §12.4).
- **Identity is substrate's.** `participant_id` (L3) / `job_id` (L4) come from the substrate identity model (`substrate_design_it.md` §2.7); channels consume them, never mint them (§5.1).
- **Layer boundary holds.** Channels deliver; substrate owns the work graph + projection; forensics/evidence are the audit/semantic layers; metrics are low-cardinality projections (no channel/job/issue IDs as labels).
- **External agent frameworks are analogies only.** They may inform supervision / handoff / context shaping, never authority, replay, forensics, evidence, or metrics.
