# Deterministic Quant Pipelines in XTRM

**Status:** cross-repository design contract and XTRM v1 reference vertical  
**Date:** 2026-08-10, Europe/Rome  
**Programme:** XTRM / Mercury Quant  
**Scope:** deterministic quantitative research, model-development, validation, backtest and promotion chains executed through XTRM  
**Implementation status:** design/reference only; this document does not claim `GATE-COMPOSE`, `GATE-DO0`, release, deployment or authority promotion  
**XTRM copy:** `xtrm-dev/xtrm/docs/shared/xtrm-deterministic-quant-pipelines-2026-08-10.md`  
**Quant copy:** `mercuryintelligence/quant/docs/design/deterministic-quant-pipelines.md`

## 1. Document role

This document makes the long-running deterministic-quant-pipeline design explicit and reconciles it with the current XTRM v1 architecture.

It is the detailed reference fixture for the `Quant/math vertical` already required by the XTRM current execution plan and completion ledger. It specializes the generic XTRM chain model for quantitative research and model engineering without creating a second orchestration runtime.

The central design is:

```text
quant objective
→ governed model/specification contract
→ agentic semantic and methodological work
→ deterministic mathematical/data gates
→ implementation
→ independent test construction
→ deterministic test execution
→ reproducible backtest/experiment
→ statistical/risk validation
→ adversarial independent review
→ explicit promotion authority
```

The pipeline is deliberately hybrid.

Agents do the work for which semantic reasoning is useful: translating intent into a model contract, evaluating market conventions, composing methodology, deriving formulas, interpreting ambiguous evidence, implementing code and conducting adversarial review.

Deterministic validators do the work for which an executable invariant can be the source of truth: schema checks, mathematical identities, time alignment, reproducibility, unit/integration tests, golden-fixture parity, leakage checks, statistical constraints and artifact integrity.

The governing principle is:

> **An agent may propose, derive, implement, explain and critique. It may not replace a deterministic gate with prose, and it may not certify its own work merely by asserting that the work is correct.**

## 2. Authority and synchronization

This document has two identical repository copies because the contract crosses an architectural boundary.

The XTRM copy owns the integration interpretation: how a quant pipeline is represented as a `ChainTemplate`, compiled to a `ResolvedChain`, executed through `specialists.execution.v1`, reduced from evidence and scheduled through XTRM runtime semantics.

The Quant copy owns the domain interpretation: what constitutes quantitative maturity, mathematical correctness, reproducibility, validation, golden-fixture parity, backtest evidence and promotion readiness.

Neither copy supersedes its upstream authorities.

For generic workflow/runtime semantics, authority remains with the current XTRM execution plan, the accepted XTRM v1 runtime reconciliation, the Specialists chain-template canon, the Specialist execution protocol, Channels and their eventual canonical successors.

For quantitative-domain semantics, authority remains with the live Quant implementation and its canonical validation, promotion, validator, testing and architecture documentation.

If the two copies of this document drift, they must be reconciled rather than allowed to become independent specifications. If this document conflicts with a newer canonical XTRM or Quant contract, the newer canonical contract wins and this document must be amended.

## 3. Why Quant is the XTRM reference vertical

Quantitative model work is a strong first end-to-end XTRM fixture because it exercises nearly every architectural seam that deterministic orchestration is intended to control:

```text
non-deterministic cognition
+ deterministic mathematical invariants
+ typed contracts
+ expensive commands
+ long-running experiments
+ artifacts
+ reproducibility requirements
+ independent review
+ human promotion authority
+ eventual cross-repository publication
```

A toy coding chain can prove dispatch. A quantitative chain can prove whether XTRM actually separates cognition, evidence, execution, validation and authority correctly.

The XTRM v1 programme should therefore treat a real Quant fixture as a vertical acceptance case for the path:

```text
ChainTemplate
→ ResolvedChain
→ manual composition
→ exact scheduler intents
→ managed Specialist executions
→ deterministic command gates
→ evidence reducer
→ runtime delivery/recovery
→ independent final review
```

It must not be used to bypass the programme gates. The first execution may be manual/observe-only until the relevant XTRM gates are satisfied.

## 4. What “deterministic pipeline” means

A deterministic quant pipeline does **not** mean that every LLM response is reproducible token-for-token.

Determinism applies to the governed shell around cognition.

Given the same approved root contract, template/catalog version, effective SCRUTINY and compiler inputs, composition must resolve to the same required topology and gate set.

Given the same persisted `ResolvedChain` and authoritative evidence projection, the reducer must derive the same legal next state and scheduler intents.

A gate defined by executable mathematics, schema, test or artifact checks must produce a versioned machine result rather than be replaced by an LLM opinion.

Every activation, command and experiment must be attributable to immutable execution identity and input/artifact fingerprints.

Retries, remediation loops, recovery and publication must be bounded and explicit.

This yields a useful distinction:

```text
workflow determinism
    topology · dependencies · gates · authority · transitions

execution determinism
    exact command intent · inputs · environment · seeds · artifact identity

cognitive variability
    agent proposals · derivations · implementation choices · critique
```

XTRM governs the first two. It measures the third rather than pretending it does not exist.

## 5. Layering and ownership

The Quant pipeline spans five layers that must remain separate.

```text
Quant domain contract
    objective · hypothesis · data semantics · methodology · promotion criteria
            │
            ▼
Specialists workflow plane
    ChainTemplate · ResolvedChain · roles · gates · evidence contracts
            │
            ▼
XTRM execution plane
    execution identity · profiles · leases · recovery · scheduler · delivery
            │
            ▼
Quant computation plane
    mercury analyze · mq · validators · run-dag · backtests · fixtures
            │
            ▼
Publication/deployment plane
    Quant promotion · Market Data parity · backfill/deploy · operator authority
```

No layer should absorb another merely because it can technically invoke it.

In particular, `mercury run-dag` is a deterministic computation/cache DAG. It may be invoked inside a pipeline step and may produce important evidence. It is not the XTRM workflow authority, does not replace `ResolvedChain`, and does not decide which Specialist or human gate is required next.

Likewise, a Specialist is not a mathematical validator simply because it can execute Python. A deterministic validator is an executable contract whose inputs, version, result and evidence are independently inspectable.

## 6. Entry modes

The current Quant validation workflow has two materially different starts, and the XTRM compiler should preserve them rather than force both through one vague prompt.

### 6.1 Greenfield model development

The root contract asks Quant to build a new model, transform, signal, diagnostic or research product.

The pipeline must establish the model specification, data semantics, methodological assumptions and validation protocol before implementation is treated as authoritative.

Recommended template identity:

```text
quant-model-development
```

### 6.2 Port-and-validate / parity work

An existing implementation or production behavior already exists, commonly in Market Data, and the objective is to reproduce it through the Quant/API surface while detecting and resolving divergences.

The governing target is parity, not free invention.

Recommended template identity:

```text
quant-port-validation
```

Both templates share the same invariant that mathematical claims are promoted only after deterministic evidence. Their early semantic roles differ: greenfield work must create methodology; parity work must first identify the authoritative reference implementation, fixtures and permitted differences.

A later compiler may resolve these templates from root-contract metadata. Template selection remains a governed composition decision, not an LLM-side ad hoc choice made after execution begins.

## 7. Canonical quant pipeline

The canonical full chain is:

```text
ROOT — QuantModelContract
  │
  ▼
Q1 — SpecAgent
  │
  ▼
Q2 — Advisor critique
  │
  ▼
G1 — Deterministic specification validator
  │
  ▼
Q3 — CompositionAgent
  │
  ▼
Q4 — FormulaDerivationAgent / quant-methodologist
  │
  ▼
G2 — Deterministic methodology/invariant validator
  │
  ▼
Q5 — PythonImplementationAgent / executor
  │
  ▼
Q6 — Independent test-engineer
  │
  ▼
G3 — Unit + integration + golden/parity test runner
  │
  ▼
E1 — Reproducible backtest / experiment command
  │
  ▼
G4 — Statistical and risk validator
  │
  ▼
Q7 — Adversarial final reviewer
  │
  ▼
H1 — Operator promotion / publication authority
```

The names `SpecAgent`, `CompositionAgent`, `FormulaDerivationAgent` and `PythonImplementationAgent` describe **domain responsibilities**. They do not require a parallel agent framework or necessarily one permanent Specialist definition per label.

XTRM may bind a responsibility to an existing Specialist role plus an execution profile and skill, or introduce a dedicated domain Specialist when evaluation proves that a stable role boundary is useful.

For example:

```text
PythonImplementationAgent  → existing executor + quant implementation profile
Q6                         → existing test-engineer
G3                         → deterministic test-runner
Q7                         → existing reviewer + quant review contract
Q2                         → researcher / overthinker / bounded advisor
Q4                         → quant-methodologist domain specialist
```

The reusable XTRM canonical production QA pipeline still applies. A quant template specializes it; it does not silently remove seconder, test, obligations, security or final-review requirements that the generic chain canon makes mandatory for the resolved scope/SCRUTINY.

## 8. Root contract: `QuantModelContract`

The root contract should become machine-readable enough that agents cannot silently redefine the research question during implementation.

A target conceptual shape is:

```yaml
schema_version: mercury.quant-model-contract.v1
mode: greenfield | port-validation
objective: ...
hypothesis: ...
intended_use: research | analytics | production_candidate

universe:
  instruments: [...]
  asset_classes: [...]
  venue_or_source: ...

time_semantics:
  timezone: ...
  session_calendar: ...
  sampling_interval: ...
  as_of_policy: ...
  publication_lag_policy: ...
  vintage_policy: ...

data_contract:
  required_fields: [...]
  allowed_sources: [...]
  missing_data_policy: ...
  adjustment_policy: ...

methodology:
  target_or_estimand: ...
  feature_definitions: [...]
  formula_refs: [...]
  parameter_policy: ...
  deterministic_seed_policy: ...
  numerical_tolerances: ...

market_conventions:
  price_or_rate_convention: ...
  spread_direction: ...
  tick_grid: ...
  contract_roll_policy: ...
  day_count_or_calendar_rules: ...

validation:
  unit_invariants: [...]
  leakage_checks: [...]
  golden_fixture_required: true
  backtest_required: true
  primary_metrics: [...]
  statistical_tests: [...]
  risk_limits: [...]
  robustness_checks: [...]

promotion:
  target: validation_only | quant_core | market_data_parity
  required_evidence: [...]
  human_approval_required: true
```

Not every model needs every field. The important property is explicit N/A disposition rather than silent omission for high-value contracts such as leakage policy, time semantics, reproducibility and promotion evidence.

## 9. Q1 — SpecAgent

`SpecAgent` converts research intent into the first structured model specification.

It owns semantic completeness, not mathematical certification.

Its responsibilities include defining the target quantity, intended usage, data needs, temporal semantics, output shape, acceptance metrics, failure modes and open assumptions. For port-validation work it identifies the reference behavior and parity boundary.

It must not implement the production model as a shortcut around specification review.

Its output should be a structured spec artifact plus a concise decision record. The artifact becomes input to later roles; the prose is not itself gate evidence.

## 10. Q2 — Advisor critique

Before the specification freezes, one or more bounded advisors may challenge it.

Useful advisor functions include:

```text
quant-researcher
    external literature / comparable methods / empirical caveats

overthinker
    failure modes / leakage / identifiability / regime dependence

market-domain advisor
    instrument conventions / microstructure / calendar / data caveats
```

This stage is especially useful at high or critical SCRUTINY. Under a native Pi harness it may use bounded RLM children; under the corrected RPC runtime it can use ordinary Specialist/advisor activations. The workflow semantics are identical either way.

Advisor findings are evidence/proposals. They do not mutate the approved topology and do not pass a gate by themselves.

## 11. G1 — deterministic specification validator

The first deterministic gate answers: is the specification structurally executable and internally coherent?

Examples include:

```text
required contract fields present
known instrument/time conventions selected or explicitly N/A
no contradictory train/test windows
no impossible dependency on unavailable data
seed/reproducibility policy present where stochastic methods are used
promotion target compatible with declared data source
output schema machine-valid
port-validation reference and parity criterion present
```

The gate emits a versioned validation artifact.

Failure routes remediation back to the owning semantic step. It does not invite a model to reinterpret a failed assertion as “close enough.”

## 12. Q3 — CompositionAgent

`CompositionAgent` translates the approved model specification into an executable quantitative composition.

This is the semantic layer that deterministic validators cannot replace.

It owns questions such as:

```text
which transformations compose the model
how intermediate quantities are defined
which market conventions govern those quantities
how features align in event time
where lagging/forward information is permitted
what state is estimated versus observed
which outputs are inferential versus descriptive
how the model maps from intent to measurable quantities
```

The CompositionAgent must use existing `mq` primitives where they already express the required mathematics instead of casually reimplementing them.

Its output is a method/composition artifact consumable by formula derivation and tests.

## 13. Q4 — FormulaDerivationAgent / quant-methodologist

The quant-methodology role locks the mathematics before implementation becomes the source of truth.

It derives equations, units, sign conventions, numerical policies, statistical assumptions, boundary conditions and expected invariants. It also identifies cases where no deterministic validator can legitimately certify a methodological choice and therefore independent semantic review remains necessary.

Typical responsibilities include:

```text
formula derivation
unit and dimensional consistency
rate/price/spread direction
rounding and tick-grid rules
calendar/day-count conventions
normalization and annualization
window semantics
lag construction
statistical assumptions
confidence/probability semantics
required synthetic test vectors
real-data smoke cases
```

This is where the earlier XTRM `quant-methodologist` extension fits naturally.

A `quant-researcher` may support the methodologist, but research evidence does not automatically override the approved root contract.

## 14. G2 — deterministic methodology and invariant validator

G2 converts the parts of methodology that are mechanically checkable into executable assertions.

Examples:

```text
algebraic identities
probabilities sum to one
variance / volatility non-negativity
confidence interval ordering
monotonic or bounded score rules
unit conversions
known analytical special cases
round-trip transformations
calendar and lag invariants
no use of future rows for current decisions
stable behavior at NaN/empty/edge inputs
fixed-seed reproducibility
```

A crucial distinction applies to the current Quant validator system.

The existing `save_result()` validators are useful exploratory safety rails and may emit warnings while a research script continues. That does **not** automatically make every current validator a blocking XTRM gate.

For XTRM, a blocking deterministic gate requires an explicit contract:

```text
validator identity + version
input/artifact refs
assertion set
severity
machine result
failure details
reproducibility metadata
evidence digest
```

Only validators with suitable correctness and false-pass/false-fail evidence should be promoted to blocking authority.

## 15. Q5 — PythonImplementationAgent / executor

Implementation begins only after the relevant spec/method gates are satisfied.

The implementation role writes code in the assigned worktree under normal XTRM ownership and execution-profile rules.

Its mandate is narrow:

```text
implement the approved quantitative contract
preserve the mathematical interface
reuse approved primitives
keep the math core pure where promotion requires it
record deviations explicitly
produce testable artifacts
```

The implementation role does not rewrite the model objective because a different model is easier to code.

If implementation discovers a real methodological contradiction, it emits a finding and the reducer routes remediation to the owning earlier step. The fix loop changes evidence/state; it does not silently mutate the frozen `ResolvedChain` topology.

## 16. Q6 — independent test engineering

Test construction is independent from the primary implementation role.

The test engineer derives tests from:

```text
root model contract
methodology and invariant artifacts
actual implementation diff
known edge cases
golden/parity requirements
prior failures where relevant
```

It should create or refine synthetic fixtures, boundary cases, regression cases, deterministic seeds, golden fixtures and integration/smoke tests.

The test engineer is not asked merely to restate the implementer's tests.

## 17. G3 — deterministic test, golden and parity gate

G3 executes the machine test surface and records the exact command outcomes and artifacts.

For Quant promotion candidates, this normally includes:

```text
unit tests on synthetic deterministic fixtures
mathematical invariant tests
integration/smoke tests
golden-fixture reproduction
validation-script ↔ promoted-core parity
Quant ↔ Market Data parity where that publication stage is in scope
```

A golden fixture is not decorative evidence. It is the explicit contract that catches a “cleaner” rewrite whose numerical output shifted unexpectedly.

A gate failure is authoritative evidence of non-satisfaction until the responsible step repairs it or the governing contract is explicitly amended through the proper authority path.

## 18. E1 — reproducible backtest / experiment execution

The backtest or empirical experiment is a runtime execution, not an informal notebook result.

Every authoritative run should be reconstructable from an execution manifest such as:

```yaml
schema_version: mercury.quant-experiment.v1
execution_id: ...
code_commit: ...
model_contract_digest: ...
methodology_digest: ...
dataset_refs: [...]
dataset_fingerprints: [...]
data_as_of: ...
vintage_refs: [...]
start: ...
end: ...
train_window: ...
test_window: ...
walk_forward_policy: ...
random_seeds: [...]
parameters: {...}
transaction_cost_model: ...
slippage_model: ...
roll_policy: ...
environment_lock_digest: ...
command_intent_ref: ...
artifact_dir: ...
```

The scheduler emits an exact command intent. The runtime executes it under bounded timeout/resource policy. Outputs become artifacts referenced by evidence.

If `mercury run-dag` is the appropriate compute engine, its source/input/parameter-derived cache semantics may accelerate this execution. Cache identity does not replace the experiment manifest or evidence contract.

Long-running backtests may emit bounded checkpoint/progress pulses through a registered emitter capability. Ordinary stdout lines do not become workflow facts.

## 19. G4 — statistical and risk validator

G4 evaluates whether the empirical result satisfies the predeclared validation contract.

Mechanically checkable components should be deterministic. Examples include:

```text
minimum sample/window requirements
metric schema and finite-value checks
risk-limit thresholds
confidence/probability bounds
bootstrap or interval ordering
turnover/exposure constraints
train/test separation
walk-forward coverage
cost/slippage inclusion when mandated
regime/sensitivity result presence
reproducibility across repeated fixed-input runs
```

The design must avoid false determinism.

Questions such as whether an econometric assumption is intellectually justified, whether a proxy is economically meaningful, or whether an observed effect is plausibly causal may require quant-methodologist/reviewer judgment. They should not be disguised as arbitrary numeric thresholds merely so the pipeline can call itself deterministic.

The contract should therefore distinguish:

```text
deterministic_assertions
methodological_review_items
operator_risk_decisions
```

## 20. Q7 — adversarial final reviewer

The final reviewer is independent from the implementation path and consumes authoritative artifacts rather than trusting the job feed alone.

For a quant pipeline, the review packet should include at least:

```text
root QuantModelContract
resolved chain identity
advisor/methodology decisions
implementation diff and commit
validator reports
unit/integration/golden results
backtest manifest and artifacts
statistical/risk report
known deviations and unresolved questions
promotion target
```

The reviewer checks semantic adequacy that deterministic validators cannot prove and verifies that required evidence actually corresponds to the current code/data/configuration.

The reviewer may return PASS, PARTIAL/REMEDIATE or FAIL according to the canonical Specialists verdict contract. A reviewer may not waive a mandatory deterministic gate merely by writing a persuasive explanation unless the underlying authority explicitly permits a documented waiver path.

## 21. H1 — operator promotion authority

The default end of a research/model chain is **promotion-ready**, not autonomous publication.

The operator or an explicitly promoted authority decides whether the candidate advances to Quant core, Market Data parity/backfill, deployment or production use.

For the current Quant promotion model, the promotion-ready packet should preserve the existing requirements that:

```text
mercury analyze validation/<name>.py runs end-to-end
output is stable for fixed input/window subject to declared staleness
math core is pure
required data is available through the supported interface
unit tests exist
golden fixture is frozen and reproduced
validation script calls the promoted core
Quant and Market Data math/signature parity is maintained when promoted there
```

Backfill and deployment remain explicit operational actions. They must not occur merely because a research backtest passed.

## 22. `ResolvedChain` representation

The chain compiler should resolve a quant template into the same generic `specialists.resolved-chain.v1` artifact used elsewhere in XTRM, with domain-specific evidence declarations rather than a separate quant runtime.

Illustrative shape:

```json
{
  "schema_version": "specialists.resolved-chain.v1",
  "chain_id": "...",
  "root_bead_id": "...",
  "template": {
    "name": "quant-model-development",
    "version": 1,
    "digest": "..."
  },
  "effective_scrutiny": "high",
  "state": "approved",
  "steps": [
    {
      "step_id": "spec",
      "class": "step",
      "role": "quant-spec",
      "execution_profile": "quant-research-v1",
      "dependencies": [],
      "mandatory": true,
      "expected_evidence": ["quant-model-contract"]
    },
    {
      "step_id": "spec-validator",
      "class": "gate",
      "role": "deterministic-command",
      "dependencies": ["spec"],
      "mandatory": true,
      "expected_evidence": ["quant-spec-validation.v1"]
    },
    {
      "step_id": "methodology",
      "class": "step",
      "role": "quant-methodologist",
      "execution_profile": "quant-methodology-v1",
      "dependencies": ["spec-validator"],
      "mandatory": true,
      "expected_evidence": ["quant-methodology.v1"]
    },
    {
      "step_id": "method-validator",
      "class": "gate",
      "role": "deterministic-command",
      "dependencies": ["methodology"],
      "mandatory": true,
      "expected_evidence": ["quant-invariants.v1"]
    },
    {
      "step_id": "implement",
      "class": "step",
      "role": "executor",
      "execution_profile": "quant-implementation-v1",
      "dependencies": ["method-validator"],
      "mandatory": true,
      "expected_evidence": ["git-diff", "commit"]
    },
    {
      "step_id": "test-engineer",
      "class": "step",
      "role": "test-engineer",
      "dependencies": ["implement"],
      "mandatory": true,
      "expected_evidence": ["test-plan", "fixture-diff"]
    },
    {
      "step_id": "tests",
      "class": "gate",
      "role": "test-runner",
      "dependencies": ["test-engineer"],
      "mandatory": true,
      "expected_evidence": ["unit-report", "golden-parity-report"]
    },
    {
      "step_id": "backtest",
      "class": "step",
      "role": "deterministic-command",
      "dependencies": ["tests"],
      "mandatory": true,
      "expected_evidence": ["quant-experiment.v1", "backtest-artifacts"]
    },
    {
      "step_id": "stat-risk",
      "class": "gate",
      "role": "quant-validator",
      "dependencies": ["backtest"],
      "mandatory": true,
      "expected_evidence": ["quant-stat-risk-validation.v1"]
    },
    {
      "step_id": "review",
      "class": "gate",
      "role": "reviewer",
      "execution_profile": "quant-review-v1",
      "dependencies": ["stat-risk"],
      "mandatory": true,
      "expected_evidence": ["review-verdict"]
    },
    {
      "step_id": "promotion",
      "class": "gate",
      "role": "human",
      "dependencies": ["review"],
      "mandatory": true,
      "expected_evidence": ["operator-decision"]
    }
  ]
}
```

The persisted approved topology is frozen. Execution status, attempts, results and evidence refs are runtime state/projections, not reasons to rewrite the approved template silently.

## 23. SCRUTINY policy

Quantitative work should not interpret low SCRUTINY as permission to remove mathematical correctness gates.

The minimum mandatory spine for any production-candidate quantitative change is:

```text
explicit contract
→ method/invariant validation
→ independent tests
→ deterministic test execution
→ empirical validation or explicit verified N/A
→ independent final review
```

SCRUTINY primarily changes the amount of structural defence around that spine.

A conceptual policy is:

```text
LOW
  minimal advisors; core validators/tests/review remain

MEDIUM
  default quant-methodologist + standard robustness checks

HIGH
  quant-researcher/overthinker advice, stronger robustness/sensitivity,
  richer real-data smoke and parity evidence

CRITICAL
  high controls plus independent methodology challenge,
  expanded stress/regime analysis, security/data-governance gates where relevant,
  explicit operator sign-off
```

A backtest may be legitimately N/A for a pure mathematical utility or non-predictive transform, but the N/A disposition must itself be explicit and validated against the root contract. It is not an omitted step discovered only after the fact.

## 24. Execution profiles and bounded RLM

The pipeline must be compatible with either accepted XTRM runtime outcome: corrected Pi RPC or a future native XTRM harness on public Pi runtime APIs.

Suggested profile classes are:

```text
quant-research-v1
    read/analysis tools
    optional persistent IPython
    bounded RLM advisor/research children
    no publication authority

quant-methodology-v1
    read/analysis tools
    Python scratch capability
    bounded domain research
    no production write authority

quant-implementation-v1
    assigned worktree write authority
    explicit tool surface
    optional bounded read-only advisors

quant-validator-v1
    command/artifact gate
    deterministic where possible
    no generic autonomous mutation

quant-review-v1
    read-only evidence/repository access
    optional bounded advisor child
    no implementation ownership
```

RLM is a cognitive capability below a governed step:

```text
ResolvedChain step: quant-methodologist
    ├── literature child
    ├── market-conventions child
    └── numerical-stability child
```

The children may return evidence or proposals to their parent. They may not insert/remove chain steps, waive a gate, grant authority, publish, or make their own output become memory truth.

Persistent IPython is particularly appropriate for Quant research and method work, but it remains an execution-profile capability rather than the universal tool boundary for production agents.

## 25. Execution identity, retries and recovery

Each activation and command must fit the XTRM v1 execution identity model.

At minimum, the evidence chain should be able to recover:

```text
assignment_id
actor_id
participant_id
execution_id
attempt
parent_execution_id
runtime_session_id
generation
authority_ref
code/data/config fingerprints
```

A retry creates a new bounded attempt; it does not erase the previous one.

The reducer distinguishes mechanical retry from semantic remediation.

Examples:

```text
transient provider failure
    → retry same governed step under policy

unit-test assertion failure
    → remediation intent to implementation/test owner

specification contradiction
    → remediation intent to spec/method owner

backtest deterministic failure
    → do not blindly rerun expecting a different truth

lost process with recoverable session
    → reconcile persisted state, then resume or restart according to profile
```

Mutation uncertainty follows the XTRM `uncertain` rule. If an external side effect may have happened but cannot be established, the system reconciles before replay. This is especially important for publication, Jira/GitHub mutations, backfills, deployments and any future automatically promoted artifacts.

## 26. Bounded convergence

The root Bead remains the durable statement of what must become true. The quant pipeline does not invent a second persistent-goal store.

Convergence policy bounds how long the chain may attempt to satisfy the contract:

```yaml
max_attempts_per_step: ...
max_fix_loops: ...
max_tokens: ...
max_wall_time: ...
max_backtest_retries: ...
terminal_states:
  - passed
  - failed
  - blocked
  - escalated
```

Reaching a limit is never equivalent to success.

A failed validator may trigger a bounded fix loop. The reducer routes the work to the responsible participant while preserving the approved chain topology and the full attempt/evidence lineage.

## 27. Channels, delivery and pulses

Quant collaboration should use the same Channels semantics as the rest of XTRM.

Useful messages include:

```text
work.finding
work.verdict
work.proposal
control.attention_requested
control.steer
system.done
```

They carry semantic information and evidence pointers. They are not substitutes for the evidence itself.

Delivery remains separate:

```text
ChannelMessage
→ DeliveryIntent
→ DeliveryAttempt
→ ProcessingReceipt
```

A reviewer finding can be delivered immediately, queued for a running executor or consumed by a later remediation activation without changing its semantic meaning.

For deterministic and long-running Quant commands:

```text
scheduler emits exact command intent
→ runtime admits execution
→ execution-started pulse
→ command runs
→ outcome + artifacts persist
→ terminal/checkpoint pulse with evidence refs
→ reducer reevaluates authoritative evidence
```

The command is not the pulse. A log line is not a pulse. A pulse requests reevaluation; evidence authorizes the transition.

## 28. Context and handoffs

Every agentic participant receives deterministic chain context rather than reconstructing topology from prose.

The context should identify:

```text
root and chain identity
current step/participant identity
role/class/position
effective SCRUTINY
upstream evidence pointers
pending mandatory gates
worktree/runtime identity
partial/missing context markers
```

Quant-specific context may additionally point to:

```text
model contract
methodology artifact
data manifest
current golden fixture
experiment/backtest manifest
statistical validation report
promotion target
```

Participants should pull only the upstream evidence they need. Full transcript dumps are not the default context mechanism.

Handoffs record decisions, evidence consumed, assumptions, unresolved questions and downstream attention. They must not attempt to persist hidden chain-of-thought.

## 29. Memory and reusable quant knowledge

A successful run may discover durable knowledge, for example a contract-specific CME convention, a recurring data-vintage pitfall or a stable testing procedure.

It does not enter semantic memory merely because an agent mentioned it.

The XTRM governed path remains:

```text
execution observation / Channel finding
→ evidence-backed candidate
→ dedupe / contradiction / supersession handling
→ review or promotion policy
→ versioned reusable memory / skill / rule
```

Quant memory retrieval should be pull-based and scoped. Relevant project/domain knowledge may come from the herd lens; bounded model/work-class knowledge from workgroup; reusable role practice from identity. Execution lineage is provenance, not a fourth memory store.

## 30. Telemetry and evaluation

The Quant vertical should exercise XTRM Eval Core rather than become an unmeasured demonstration.

Each candidate/run should fingerprint at least:

```text
model/provider
prompt/rule/skill versions
runtime/tool catalog
ChainTemplate + ResolvedChain digest
code commit
data manifest/vintage
model contract
methodology/config
validator versions
experiment parameters/seeds
```

Useful evaluation dimensions include:

```text
deterministic gate reproducibility
agent-role agreement/disagreement
review false-pass / false-fail
validator false-pass / false-fail where measurable
golden/parity stability
backtest reproducibility
recovery/idempotency correctness
remediation-loop count
token/time/resource cost
human override rate
promotion rejection reasons
```

Model-based graders remain advisory unless explicitly promoted by the XTRM authority gate. Deterministic graders/validators may become blocking only when their contract and measured precision justify that authority.

## 31. Quant repository compatibility

The design should reuse, not rewrite, current Quant machinery.

### `mercury analyze`

Remains the fast validation/research execution surface. It is appropriate for agent-developed scripts and live API smoke runs.

### `mq`

Remains the preferred math primitive surface. New work should reuse existing `mq.*` methods where appropriate and pass the mathematical correctness gate for promoted primitives.

### `mercury.core.validators`

Remains useful for result-level sanity and typed invariants. The XTRM integration adds a distinction between exploratory warning semantics and explicitly promoted blocking chain gates; it does not silently change current CLI behavior.

### `mercury run-dag`

Remains a computation DAG with cache semantics. It can execute expensive deterministic stages inside a chain step. It does not become the agent/workflow scheduler.

### `validation/`

Remains the research sandbox and integration-reference surface. XTRM should orchestrate its lifecycle, not eliminate it.

### Quant promotion

Remains the domain authority for extracting a pure math core, adding deterministic unit tests, freezing a golden fixture and maintaining the same mathematical contract across Quant and Market Data publication targets.

## 32. Cross-repository promotion boundary

A green Quant result and a production Market Data deployment are different states.

Recommended progression:

```text
research_validated
→ quant_promotion_ready
→ quant_core_merged
→ market_data_parity_ready
→ market_data_merged
→ backfill_required? / operator action
→ deployed
```

The same math core/signature/parity contract should be preserved where the current Quant promotion specification requires it.

XTRM may orchestrate and evidence these states in later templates, but publication/deployment authority remains explicit. No research agent receives deployment authority merely by participating in the model-development chain.

## 33. Initial implementation strategy

This document does not authorize skipping the current XTRM critical path. Implementation should proceed in stages.

### QD0 — document and fixture contract

Persist this design in XTRM and Quant. Identify one real but bounded Quant example suitable for repeatable fixture use. Freeze the root-contract, evidence and expected-artifact schemas required by that fixture.

### QD1 — validator inventory

Classify current Quant checks into:

```text
exploratory warning
candidate deterministic assertion
blocking-quality deterministic assertion
semantic review requirement
operator decision
```

Do not convert warnings into blockers wholesale.

### QD2 — template/compiler fixture

Once C1 compiler/schema work is available, encode `quant-model-development` and/or `quant-port-validation` as a per-repository template/fixture and prove deterministic resolution to `ResolvedChain`.

Before `GATE-COMPOSE`, this may be schema/compiler test data only.

### QD3 — command/evidence adapters

Define exact command intents and versioned evidence reports for specification validation, tests, backtests and statistical/risk validation. Reuse Quant CLI/run-dag surfaces where appropriate.

### QD4 — manual/observe-only vertical

Run the chain manually through approved composition with no automatic next-step advancement. Prove evidence lineage, independent gates and final review.

### QD5 — `GATE-DO0` reference fixture

After reducer/scheduler/runtime delivery exist, use the same Quant case to prove:

```text
exact idempotent dispatch
execution envelope
validator evidence
backtest command outcome
reducer transition
failure/remediation routing
retry/recovery safety
final independent gate
```

### QD6 — measured authority

Only after Eval Core measures the system should selected policies become blocking/automatic beyond already-authoritative deterministic assertions. Human promotion remains explicit unless separately authorized.

## 34. Acceptance criteria for the Quant vertical

The reference vertical is successful only when all of the following are evidenced:

1. one versioned Quant root contract compiles reproducibly to one approved `ResolvedChain`;
2. the approved topology distinguishes agentic steps, deterministic gates, command/experiment execution and human authority;
3. every mandatory deterministic gate emits a versioned inspectable artifact;
4. a failing gate cannot be converted to PASS by Specialist prose alone;
5. implementation runs through the normal XTRM execution envelope and worktree authority;
6. tests are independently authored/validated and then executed deterministically;
7. the backtest/experiment is reproducible from code/data/config/seed/environment fingerprints;
8. statistical/risk validation distinguishes executable assertions from semantic judgment;
9. Quant golden-fixture and promotion semantics remain intact;
10. `mercury run-dag`, if used, remains a nested compute engine rather than workflow authority;
11. the reducer derives transitions only from persisted authoritative evidence;
12. retries and remediation preserve attempt lineage and bounded convergence;
13. crash/recovery does not duplicate authoritative side effects or lose evidence;
14. RLM children, if enabled, cannot mutate approved topology or gain publication authority;
15. final review is independent and consumes current artifacts, not self-reported success;
16. publication/backfill/deployment remain behind explicit authority;
17. telemetry can reconstruct the full run without using high-cardinality business data as metric labels;
18. the complete case can be rerun as an XTRM regression fixture against later runtime, prompt, model or harness changes.

Passing this fixture is necessary evidence for the XTRM deterministic orchestration programme. It is not by itself sufficient to promote every XTRM workflow to automatic authority.

## 35. Explicit non-goals

This design does not authorize:

```text
a second quant-specific orchestration runtime
a replacement for Specialists
a replacement for Beads
a replacement for mercury run-dag
turning all save_result warnings into blocking failures
letting an LLM waive mathematical/test gates
letting RLM rewrite ResolvedChain
unbounded agent self-improvement
a universal persistent Python shell for production roles
a new XTRM package
Substrate runtime implementation as a prerequisite
silent Market Data deployment/backfill
automatic model promotion from one successful backtest
```

It also does not require every conceptual domain responsibility to become a standalone permanent Specialist. Role boundaries should be materialized only where they improve contracts, permissions, evidence or measured quality.

## 36. Final invariant

The target system should make this statement true:

> A Mercury quantitative model can be researched with flexible agentic cognition, but it can only advance through an explicit, reproducible and inspectable chain whose mathematical claims, tests, empirical evidence, review and promotion authority are independently represented.

In compact form:

```text
agents reason
validators prove what can be proven
reviewers judge what cannot be reduced to assertions
humans or explicitly promoted authorities decide publication
XTRM makes the transitions deterministic, durable and recoverable
```

That is the intended meaning of a deterministic quant pipeline in XTRM.

## 37. Primary references

Current implementation must be reconciled against the live versions of these sources before dispatch:

```text
xtrm-dev/xtrm
  docs/shared/xtrm-current-execution-plan.md
  docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md
  docs/shared/xtrm-v1-completion-ledger.md
  docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md

xtrm-dev/specialists
  docs/design/chain-templates.md
  docs/design/roadmap/chain-templates/README.md
  docs/design/execution-protocol-design/specialist-execution-protocol.md
  docs/design/roadmap/enhanced-prd.md
  docs/design/roadmap/specialists-roadmap.md

mercuryintelligence/quant
  validation/WORKFLOW.md
  validation/PROMOTION.md
  validation/ARCHITECTURE.md
  docs/internals/validators.md
  docs/testing.md
```

The superseded 2026-08-04 XTRM chain/Substrate/Channels reconciliation remains historical provenance for the original quant vertical sequence, but current XTRM main is the authority for runtime sequencing and gates.