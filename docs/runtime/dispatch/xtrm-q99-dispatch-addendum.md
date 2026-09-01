# Addendum — q99 dispatch repository pointers and precedence

Append this to any local copy of the q99 coordinator dispatch if the worker was
started from chat, `/tmp`, Beads memory, or an older prompt copy.

`ultracode`

## Repository-owned sources

Do not treat the pasted/chat copy of this dispatch as durable authority.
The repository-owned execution prompt is:

```text
docs/runtime/dispatch/xtrm-q99-local-dispatch-v2.md
```

The integrated runtime product authority is:

```text
docs/runtime/prd/native-chain-runtime.md
```

Read the PRD from the current branch/default head, not from an exported artifact.
The q99 dispatch is operational guidance; when it conflicts with accepted canon,
canon wins and the contradiction must be repaired rather than silently choosing
the prompt.

Before implementing the affected slices, also read the owning authorities:

```text
docs/runtime/adr/001-chain-authoring-compilation.md
  ChainSource / compiler / ResolvedChain freeze and coordination-analysis input

docs/runtime/adr/004-specialist-activation-capabilities-probes.md
  SpecialistActivationProfile, capability grants, ResultContract, probes

docs/runtime/adr/005-channels-cooperative-runtime.md
  Channels authority, external ingress/egress, obligations, PassiveAwareness

docs/runtime/adr/006-runtime-supervision-boundary.md
  ActivationSupervisor vs RuntimeSupervisor, provider adapters, tmux fallback

docs/channels/channels.md
  canonical ChannelMessage semantics and cursor/authority rules

docs/runtime/harness/native-adapters.md
  current native/provider adapter evidence and compatibility boundaries

docs/runtime/README.md
  authority map and current runtime milestone
```

## Required first action

At cold start:

```text
1. fetch/rebase against current origin/main;
2. read xtrm-q99 and its current children in Beads;
3. read the repository-owned dispatch and canonical PRD above;
4. reconcile the q99 graph against the new requirements rather than creating a
   duplicate epic;
5. update ADR-001/004/005/006, Channels, Eval/other owning canon only where the
   implemented decision makes their present language stale;
6. persist the resulting Beads checkpoint with exact doc/PR/merge evidence.
```

The following q99 additions are deliberate and must not disappear during graph
reconciliation:

```text
Universal ResultEnvelope + frozen JSON-Schema ResolvedResultContract
result_submit; final model JSON is not runtime authority
generic GateResult and EvidenceEnvelope
agent_end != result != protocol completion
pi-intercom / Claude native messaging / pi-claude-link provider adapters
external provider ingress translated into Channels before participant delivery
PassiveAwareness distinct from WAITING_ON_CHANNEL
ResolvedCoordinationPolicy frozen inside ResolvedChain.effective
RepositoryCoordinationAnalysis as explicit pure-compiler input
coupling-aware participant grouping / max useful parallelism
ownership and InterfaceChangeEvidence
task-dependent ChannelMessage vs durable artifact use
coordination temporal-graph projection through existing forensics/Eval Core
coordination failure metrics: communication / commitment / expectation
```

Do not introduce a second workflow runtime, second message authority, standalone
coordination-policy lifecycle, specialist-name result-schema registry, CRDT
requirement, or provider-native Channels bypass.

## Precedence

For mutable implementation truth use:

```text
current code/tests + exact merged Git head
→ current Beads contract/graph
→ canonical PRD and owning ADR/spec
→ this repository-owned dispatch
→ durable checkpoint/memory
→ chat/exported copies
```

If current code or Beads evidence falsifies a normative design claim, stop the
affected slice, record the contradiction, and use the programme escalation rule.
Do not silently preserve stale prompt wording.
