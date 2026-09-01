# XTRM q99 Dispatch Addendum — Canonical Pointers and Execution Precedence

`ultracode`

This addendum amends the current q99 local dispatch. It does **not** restart the programme, create a competing PRD, or replace the current Beads graph.

## 1. Read these repository artifacts first

Use the repository copies below as the durable source. Do not rely on chat scrollback or sandbox copies once these files exist in Git.

### Primary execution packet

```text
docs/runtime/dispatch/xtrm-q99-local-dispatch-v2.md
```

This is the operational implementation packet for q99: sequencing, acceptance tests, graph-reconciliation rules, review discipline and stop/escalation conditions.

### Canonical integrated runtime PRD

```text
docs/runtime/prd/native-chain-runtime.md
```

This is normative for the integrated object model and cross-subsystem requirements, including:

```text
ResolvedResultContract
ResultEnvelope / result_submit
JSON-Schema custom Specialist payloads
Generic GateResult / EvidenceEnvelope
provider-native external ingress/egress
pi-intercom / pi-claude-link dependency stance
PassiveAwareness vs WAITING_ON_CHANNEL
ResolvedCoordinationPolicy
RepositoryCoordinationAnalysis
ownership/interface evidence
coordination telemetry and Eval Core
```

## 2. Owning ADR/spec pointers

When implementation detail is ambiguous, read the owning authority rather than extending the dispatch by intuition.

```text
docs/runtime/adr/001-chain-authoring-compilation.md
  ChainSource / ChainDefinition / pure compiler / ResolvedChain freeze
  coordination-analysis inputs and resolved policy belong here when they affect authoring/compilation

docs/runtime/adr/002-container-chainrun-durability.md
  Container(kind=chain), ChainRun durability, journals, replay, uncertain

docs/runtime/adr/003-native-participant-runtime.md
  direct AgentSession hosting, activation/session identity and native runtime boundary

docs/runtime/adr/004-specialist-activation-capabilities-probes.md
  SpecialistActivationProfile, capability grants, probes, ResultContract ownership

docs/runtime/adr/005-channels-cooperative-runtime.md
  ChainRun semantic cooperation, request/reply, scheduler indirection, receipts

docs/runtime/adr/006-runtime-supervision-boundary.md
  ActivationSupervisor vs ChainReducer/Scheduler vs xtmux RuntimeSupervisor/provider adapters

docs/channels/channels.md
  canonical ChannelMessage ontology, visibility, authority, cursors and delivery semantics
```

If q99 establishes a normative refinement to one of these decisions, edit the existing owning ADR/spec in the same implementation programme. Do not create an unowned side document.

## 3. Specialists-owned pointers

Before changing custom result/output semantics, extension binding or Specialist activation behavior, read current Specialists default-branch authority, especially:

```text
src/specialist/schema.ts
docs/authoring.md
current canonical Specialists PRD
current specialist execution protocol
```

Reconcile these fields explicitly:

```text
prompt.output_schema
execution.response_format
execution.output_type
execution.expected_output_keys
```

XTRM must not silently redefine a Specialists-owned field in isolation.

## 4. Precedence

Use this precedence for q99 decisions:

```text
current accepted repository canon / owning ADR or subsystem spec
  > current Beads contract and dependency graph
  > q99 local dispatch
  > this addendum
  > historical research / chat / archived drafts
```

The dispatch and addendum may identify required canon changes. Until those changes are merged, they are implementation instructions, not evidence that canon already says the new thing.

If the current accepted canon contradicts a load-bearing q99 requirement and the contradiction cannot be reconciled by updating the documented owning authority, trigger the existing architecture-escalation rule rather than silently choosing one.

## 5. Research-derived coordination additions

The following additions are approved design inputs for q99, but external papers/frameworks are evidence rather than runtime authority:

```text
PassiveAwareness
  participant continues useful foreground work while relevant Channel attention is surfaced safely

ResolvedCoordinationPolicy
  participant grouping, max useful parallelism, ownership/interface boundaries,
  attention and artifact-sharing policy frozen with ResolvedChain

RepositoryCoordinationAnalysis
  explicit planner/compiler input describing dependency/coupling/ownership/interface structure;
  never hidden repository I/O inside the pure compiler

Coordination projection / Eval
  measure message/artifact topology, coordination cost, duplicate work,
  unanswered obligations and interface regressions without creating a new authority store
```

Do not import AgentRadio, Co-Coder, AgentRoom, CodeTeam, MSEval or CooperBench as a second orchestration runtime. Adopt only independently justified primitives and measurement ideas through existing XTRM contracts.

## 6. Provider-native messaging pointer

The approved current transport direction is:

```text
Pi ↔ Pi
  pi-intercom

Claude ↔ Claude
  Claude native peer / cross-session messaging

Claude ↔ Pi
  pi-claude-link

raw shell / vim / REPL / unsupported provider
  tmux fallback
```

Inside a governed ChainRun, all semantic communication still passes through Channels:

```text
external provider message
  → ProviderIngressAdapter
  → trusted identity binding + authorization
  → ChannelCommunicationService
  → ChannelMessage / ReplyObligation
  → SchedulerIntent / attention
  → participant
```

Provider transport must never become workflow authority.

## 7. Result/event pointer

Do not create per-Specialist runtime schemas.

Target:

```text
stable XTRM protocol envelope
  → Zod/runtime validation

custom Specialist result/evidence payload
  → frozen JSON Schema contract
```

The authoritative path is:

```text
result_submit
  → validate outer ResultEnvelope
  → validate payload against frozen ResolvedResultContract
  → persist accepted result/receipt
  → validate required evidence
  → FINALIZE
  → reducer may satisfy step
```

Never use:

```text
assistant final prose
  → JSON.parse / regex
  → step satisfied
```

`agent_end` remains a provider lifecycle fact, not a result.

## 8. q99 graph reconciliation

Do not create a new mega-epic from this addendum.

Run:

```bash
bd show xtrm-q99
bd ready
bd blocked
```

Then classify every requirement from the dispatch as:

```text
already represented correctly
  → keep existing Bead

represented with stale assumptions
  → amend existing Bead contract

genuinely missing and required for q99 acceptance
  → create one bounded discovered-from child

valid but not required for q99
  → follow-up only when concrete enough to execute
```

Do not block q99 on an optimal graph-partitioning algorithm, a general memory redesign, a CRDT workspace, or a native rewrite of working provider dependencies.

## 9. Documentation completion requirement

q99 is not documentation-complete if code lands while these authorities remain stale.

At minimum reconcile, when affected:

```text
docs/runtime/prd/native-chain-runtime.md
ADR-001
ADR-004
ADR-005
ADR-006
docs/channels/channels.md
Eval Core owning docs
Specialists authoring/schema/protocol docs
runtime README / current execution plan / ledger when programme truth changes
```

Historical reconciliation and archived drafts should remain historical unless a broken pointer needs repair.

## 10. Continue

After reading these pointers and reconciling the current q99 Beads graph, continue the autonomous implementation loop from the next genuinely ready Bead:

```text
ready
→ claim
→ implement
→ validate
→ fresh non-author review on exact final head
→ repair if needed
→ PASS
→ merge
→ close / durable checkpoint
→ refresh main + Beads
→ next ready
```

Do not stop merely because the documentation amendment or one PR is complete.
