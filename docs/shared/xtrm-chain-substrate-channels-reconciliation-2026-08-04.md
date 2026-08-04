# XTRM Chain, Substrate, Channels, and Pulse Reconciliation

**Status:** Programme coordination note; proposed companion to the current execution plan. Not a new architecture and not an implementation authorization by itself.

**Snapshot date:** 2026-08-04 15:37 CEST.

**Programme context:** KAN-127 / XT Codex parity is already being implemented across Core, Specialists, and xtmux. This note prevents the next deterministic-chain wave from introducing forms that conflict with the long-developed Substrate and Channels designs.

## 1. Purpose

This note records one coherent interpretation of the following existing authorities:

- `docs/substrate/substrate_design_it.md` and its canonical English companion;
- `docs/channels/channels.md` and the Channels decision documents;
- `docs/substrate/chain_templates.md` and the executable formula assets in Specialists;
- Specialists `enhanced-prd.md` and `specialists-roadmap.md`;
- the current XTRM execution plan and the KAN-127 sequencing note;
- current merged behavior in Core, Specialists, and xtmux.

It answers five concrete questions:

1. What is the runtime shape of a deterministic chain before and after Substrate lands?
2. Where do Channels belong without becoming a second lifecycle authority?
3. When is a script or CLI command a pulse emitter?
4. Which compatibility fields must be frozen in the first chain compiler?
5. What has actually landed in the three runtime repositories under KAN-127?

## 2. Authority and freshness

For current-state claims, use this precedence:

1. merged repository code, schemas, tests, and public CLI contracts;
2. current open PRs as review evidence, never as completed behavior;
3. the current XTRM execution plan and mutable release snapshots;
4. the Specialists PRD and roadmap for accepted bridge requirements and sequencing;
5. Substrate and Channels for the target runtime model;
6. Jira as programme projection and Beads as repository-local executable work truth.

Substrate is the target model, but its daemon, unified store, container runtime, and Channels runtime are not assumed to exist today. Bridge implementation must remain usable with Core, Specialists, xtmux, and Beads while producing contracts that can migrate without semantic remapping.

## 3. Reconciled chain model

The existing designs converge on this lifecycle:

```text
selected formula / chain template
→ pure deterministic composition
→ persisted resolved_chain_json
→ approved chain activation
→ exact command and Specialist activation intents
→ persisted outcomes and evidence
→ evidence-driven reducer transition
→ close / merge as a derivation of satisfied contracts
```

### 3.1 Formula or ChainTemplate

The template is the named reusable chain shape. It declares:

- root contract expectations;
- ordered or dependency-linked steps;
- writer, reviewer, advisor, and validator roles;
- SCRUTINY-dependent structure;
- required gates and artifacts;
- retry or bounded review-loop policy;
- optional per-step capability/skill requirements.

The current executable formula remains the authority for pre-Substrate executable shape. The conceptual chain-template document owns canonical intent. Substrate becomes authoritative for runtime semantics after landing.

### 3.2 ResolvedChain

The compiler output is the durable, immutable composition artifact. Its bridge representation is the persisted `resolved_chain_json`; it must be designed as a Substrate-compatible chain-container specification rather than as a new competing workflow object.

At minimum it resolves:

- template identity, version, and digest;
- root issue/contract identity;
- step issue identities and dependency edges;
- effective SCRUTINY and activated conditional gates;
- participant kind, role, and stable `participant_id` derivation;
- Specialist definition and effective model/surface;
- per-step injected skills/capabilities;
- exact command or activation intent shape;
- expected result, artifact, and evidence contracts;
- channel binding, topology, judge, stop conditions, and effective subscriptions;
- pulse-emission capabilities, budgets, and idempotency requirements;
- timeout, retry, and escalation policy;
- worktree lease requirements and owner;
- visibility/redaction constraints;
- compiler and source-contract provenance.

The resolved artifact must not contain mutable execution state.

### 3.3 Runtime activation

Do not create a new independent `ChainRun` authority or store.

The target runtime identity is:

```text
chain container
├── root and step issues
├── stable participants
├── jobs / activations
├── associated channel
├── pulses
├── persisted outcomes
└── evidence refs
```

During the bridge, the same semantics may be represented through Beads, Specialists job state, Core command outcomes, and xtmux coordination records. The bridge implementation must preserve one authority per domain rather than copying all facts into a new chain database.

## 4. Ownership boundaries

| Domain | Current bridge owner | Target interpretation |
|---|---|---|
| Formula assets and Specialist role definitions | Specialists | Inputs to composition |
| Pure chain compiler and persisted resolved shape | C1 programme work; implementation owner to be confirmed from current plan | Substrate-compatible chain composition |
| Worktree creation, runtime launch, exact argv, safety, cleanup | Core | Command/activation execution boundary |
| Specialist job lifecycle and verbose result | Specialists | Participant activation lifecycle |
| Runtime identity, messages, obligations, monitors, waits, wakes, event journal | xtmux | Current coordination authority and Channels bridge |
| Work contracts and executable dependency graph | Beads during bridge | Substrate issues/container membership after migration |
| Typed communication stream | Existing xtmux primitives during bridge; future Channels | Communication, not lifecycle truth |
| Pulse and reducer scheduling | Future D1 work | Tick/wakeup signal and deterministic transition evaluation |
| Verdicts, tests, diffs, commits, PRs, reports | Evidence owners and refs | Semantic proof used by reducer/close |

The compiler composes these authorities. It must not absorb them.

## 5. Channels compatibility

A channel is the typed, ordered, append-only communication surface associated with a chain or node. It is not a container, job, event log replacement, result store, or lifecycle engine.

Channels should carry:

- `work.turn` summaries with pointers;
- `work.finding` and `work.verdict` messages;
- remediation routing to the correct participant;
- `control.attention_requested` and escalations;
- judge/coordinator structured decisions;
- bounded human steer and participant wake requests;
- evidence and forensic pointers, not raw payload duplication.

The first compiler must resolve the effective channel contract even before the full Channels runtime is active:

```text
channel_id / container scope
participant membership
subscribes
emits
cannot_emit
wakes_on
topology
judge configuration
stop conditions
attention policy
visibility defaults
```

Initially these fields may be inspection-only or dormant. They must still be validated so later Channels activation does not require recompiling the meaning of historical chain templates.

### 5.1 Stream versus projection

- Channels owns the message stream.
- Substrate owns the recomputable chain/node progress projection.
- Evidence stores own semantic proof.
- The coordinator and specialists consume the projection; they do not authoritatively define it.
- The reducer advances only on validated state/evidence, not on prose or message presence alone.

## 6. Pulses, commands, and evidence

A CLI command or script is not automatically a pulse emitter.

### 6.1 Command intent

An exact, idempotent instruction to execute a program or launch a Specialist. It includes argv, cwd/worktree, environment allowlist, input refs, timeout, and expected outcome schema.

### 6.2 Command outcome

The mechanical result of the command or launch: accepted/refused/degraded/success/failure, exit code, runtime identity, exact next actions, owned side effects, and cleanup state.

KAN-127's `xtrm.command-outcome.v1` is the current launcher-boundary example. It is an input to future chain execution; it is not itself a pulse or semantic verdict.

### 6.3 Evidence

Durable proof used by the reducer and close/merge derivation, for example:

- validator report;
- unit/integration test report;
- backtest artifact and metrics;
- Specialist structured verdict;
- diff/commit/PR refs;
- release or deployment result;
- operator approval.

### 6.4 Pulse

A typed, idempotent signal that something relevant occurred and the reducer/scheduler should reevaluate the affected scope.

A pulse does not grant authority and does not prove success. It produces a forensic twin and carries correlation/evidence pointers.

### 6.5 Emitter rule

A runner or script becomes a pulse emitter only when it is registered with bounded capability:

```text
can_emit.pulse_kinds
budget
escalate_when
idempotency-key derivation
correlation and evidence-ref rules
```

Recommended bridge policy:

- short commands: the chain runner emits start/terminal boundary pulses;
- long-running domain processes: the process may emit bounded checkpoint/risk/artifact pulses through a registered adapter;
- ordinary stdout/stderr lines never become pulses automatically;
- every pulse causes reevaluation, while evidence authorizes transition.

## 7. Quant pipeline fixture

The quant pipeline should become the first end-to-end reference fixture because it combines agentic reasoning, deterministic validators, CLI commands, artifacts, and expensive long-running work.

Illustrative resolved sequence:

```text
intent and objective
→ SpecAgent produces model specification
→ advisor critiques the specification
→ deterministic specification validator
→ formula derivation / market-convention review
→ Python implementation
→ independent test engineering
→ deterministic unit and integration tests
→ backtest command
→ statistical/risk validator
→ adversarial final review
→ operator approval
```

For a deterministic validator step:

```text
scheduler emits exact command intent
→ runner emits execution-started pulse
→ command executes
→ command outcome and validation artifact persist
→ runner emits terminal pulse with evidence refs
→ optional work.finding/work.verdict message is posted
→ progress projection updates
→ reducer reads evidence and emits the next scheduler intent
```

The validator command is not the pulse. The runner/registered adapter emits the pulse around the command boundary.

For a long-running backtest, the domain process may additionally emit bounded progress or checkpoint pulses, but only through the registered capability and without turning log lines into runtime events.

## 8. Sequencing relative to the current execution plan

No new intermediate architecture layer is required. Extend the existing programme gates with compatibility acceptance criteria:

```text
Finish KAN-127 K4/K5/K6 without chain or Channels scope expansion

Before C1 implementation:
→ reconcile PRD + roadmap + chain templates + Substrate + Channels
→ freeze the ResolvedChain compatibility contract

C1
→ pure compiler
→ persisted resolved_chain_json
→ resolved participant/channel/pulse bindings
→ manual review / approve / insert / show

GATE-COMPOSE
→ deterministic manual composition only
→ no automatic advancement

D1
→ evidence reducer
→ exact scheduler intents
→ pulse-to-reducer ticks
→ progress projection

GATE-DO0
→ coordinator shadow
→ Channels observation and bounded wake integration

GATE-AUTH
→ selected enforcement or automatic advancement after measured evidence
```

## 9. KAN-127 scope guard

KAN-127 remains the runtime-parity and deterministic-interface enabler. It must not absorb:

- the chain compiler;
- Substrate containers;
- a Channels runtime;
- the chain reducer or scheduler;
- domain-specific quant pipelines;
- a new store or lifecycle authority.

It should finish:

- Codex runtime characterization;
- deterministic launcher outcomes;
- Core launcher and lifecycle/distribution parity;
- Specialists native Codex role/render/invocation/result parity;
- xtmux Codex identity/lifecycle/turn/message/recovery parity;
- bounded retirement of conflicting active Serena integration;
- K5 promotion evidence;
- K6 ordered release and released-trio smoke.

## 10. Verified three-repository implementation audit

This section records only evidence found in live GitHub state at the snapshot time. `merged` means present on the default branch. Open PRs are not counted as completed.

### 10.1 Core — `xtrm-dev/core`

**Default branch:** `main`  
**Verified head:** `d65aac6e757d8f0b07415a8d719610156bddb640`

Completed under KAN-127:

- PR #536 merged — initial K1 runtime-boundary characterization.
- PR #538 merged — reconciled Codex 0.146.0 lifecycle payloads, schemas, rollout fixture, and negative characterization.
- PR #537 merged — K2 `xtrm.command-outcome.v1` and deterministic detached Pi/Claude outcomes.
- PR #539 merged — experimental `xt codex`, isolated trust profile, exact thread persistence/resume, safety profiles, cleanup, and detached outcome emission.
- PR #540 merged — K4 Codex managed skills/distribution parity and Core-side active Serena retirement.

Verified but not completed programme stages:

- No Core K5 promotion PR was located.
- No K6 Codex compatibility release PR was located.
- Latest located released Core line remains `xtrm-tools 0.11.4` from PR #535, which predates the KAN-127 implementation wave.

### 10.2 Specialists — `xtrm-dev/specialists`

**Default branch:** `master`  
**Verified merged head before the open Serena branch:** `c026f40357382c6c22742ee27420f1e70c3c6299`

Completed under KAN-127:

- PR #245 merged — K1 native-surface characterization.
- PR #246 merged — K3 native Codex role/render surface and `$skill-name` syntax.
- PR #247 merged — K4 invocation handoff and read-only consumption of `xtrm.command-outcome.v1`, with result projection parity and no second result authority.

In review / not completed:

- PR #248 open and mergeable — K4 Specialists-side active Serena runtime retirement. This removes probe/spawn/injection/catalog/rule surfaces while preserving deprecated config parsing and passive process-health reporting.
- No K5 promotion PR was located.
- No K6 compatibility release PR was located.
- Latest located release remains `@jaggerxtrm/specialists 3.21.2` from PR #240, predating KAN-127 source work.

### 10.3 xtmux — `Jaggerxtrm/xtmux`

**Default branch:** `main`  
**Verified merged head:** `68a67e9cae884c8921e1f7d5717aadbc37a869d5`

Completed under KAN-127:

- PR #91 merged — K1 Codex hook/lifecycle characterization and ownership/replay fixtures.
- PR #92 merged — K3 Codex runtime adapter over the existing identity, lifecycle, message, obligation, monitor, wake, and event-journal authorities; structured consumption of Core outcomes; direct Stop turn capture; phantom-obligation parser fix.

In review / not completed:

- PR #93 open and mergeable — EVAL-01 Codex matrix plus recovery/idempotence evidence gate. The PR reports a passing product matrix, but it remains unmerged and therefore is not completed source state.
- The documented K4 restart-recovery/session-rebind completion is not yet evidenced by a merged K4 PR.
- No K5 promotion PR was located.
- No K6 compatibility release PR was located.
- Latest located release remains `@jaggerxtrm/xtmux 0.2.3` from PR #89, predating KAN-127 source work.

### 10.4 Cross-repository conclusion

The implementation wave is materially advanced:

```text
K1: completed in all three repositories
K2: completed in Core and consumed by downstream source
K3: completed in all three repositories
K4-Core: completed
K4-Specialists invocation/result: completed
K4-Specialists Serena retirement: open PR
K4-xtmux evidence/recovery: open/incomplete
K5 promotion: no located implementation evidence
K6 releases and released-trio smoke: no located implementation evidence
```

Therefore the correct programme statement is:

> Codex parity is largely implemented in source, but KAN-127 is not yet promotion- or release-complete. The remaining critical path is the open Specialists and xtmux K4 evidence, followed by a cross-repository K5 promotion decision and K6 compatibility release/smoke wave.

## 11. Immediate follow-up

1. Review and merge or correct Specialists PR #248.
2. Review and merge or correct xtmux PR #93, then complete the remaining K4 restart/session-rebind contract if it is not already included in the next patch.
3. Run one cross-repository K4 observation packet against the three default branches.
4. Produce an explicit K5 promotion artifact; do not infer promotion from source merge.
5. Cut the ordered K6 compatibility releases and run the released-trio smoke.
6. In parallel, perform a read-only crosswalk of PRD, roadmap, formula schema, Substrate, and Channels.
7. Only after that crosswalk, amend the C1 acceptance criteria and begin compiler implementation.

## 12. Jira report-back packet

When Jira access is available, add this summary to KAN-127 without creating new leaf-task mirrors:

> **2026-08-04 reconciliation:** K1 and K3 are merged across Core, Specialists, and xtmux. Core K2 deterministic outcomes and Core K4 distribution parity are merged. Specialists K4 invocation/result parity is merged; Specialists active Serena retirement remains open in PR #248. xtmux K3 is merged; EVAL-01/recovery evidence remains open in PR #93 and K4 is not yet promotion-complete. No K5 promotion or K6 compatibility release evidence was located. A programme reconciliation note now binds future chain work to existing Substrate, Channels, pulse, evidence, and identity semantics. KAN-127 remains scope-limited to Codex parity and release completion; C1/D1 chain work follows separately after a PRD/roadmap/design crosswalk.

## 13. Non-goals of this note

- It does not change Substrate or Channels normative specifications.
- It does not authorize automatic chain advancement.
- It does not create a new `ChainRun` store or lifecycle authority.
- It does not add Channels or pulses to KAN-127.
- It does not treat open PR descriptions as merged behavior.
- It does not replace the PRD, roadmap, formula assets, current execution plan, Jira, or Beads.
