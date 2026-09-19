# Planning Ready-contract v2 — pre-registration (frozen before execution)

Workload: `planning-ready` v1 · Experiment: `planning-ready-v2` v1
Substrate source: Jira XTRM-99 comments 13435 and 13438 · Baseline commit: `b5ec913`
(PR #243, ancestor of `main`)

This document is the frozen experimental contract. It was written **before** the
first live System One call, and the dataset, battery, policy, arms, thresholds
procedure and acceptance criteria below are fixed from that point: the primary
comparison is not modified after the held-out results are seen. Any later
change is recorded as an explicitly exploratory analysis in the run
annotations, never by editing this contract.

## 1. Dataset

| Item | Value |
|---|---|
| id / version | `planning-ready-v2` / `v1` |
| units hash | `sha256:fae0fa1e71832488befc9ab598a726773c824f476f32c9bc7bd2e87bd5865b6f` |
| frozen at | see `units.jsonl` mtime and `manifest.json.created_at` |
| location | `~/.xtrm/research/datasets/planning-ready-v2/` (mode 700, outside git) |
| units | 1351 (one unit = one `(issue, revision)` contract pair) |
| work items | 951 distinct issues |
| source | read-only `sqlite3` backup snapshot of `~/.xtrm/state.db`; the live DB is never written |

Population partitions (frozen caps): open current revisions (300), the last two
revisions of issues with more than one revision (400 pairs → 800 units),
completed-and-attested final revisions (280), and a bounded flagged pool of
structurally invalid revisions (60).

Repository distribution (independently labelled units in brackets):
`xtrm` 226 (148 ready / 48 not ready), `core` 389 (15 / 39),
`specialists` 236 (111 / 16 — the held-out repository), `console` 33 (1 / 0),
`xtmux` 23 (0 / 0).

Revision history is first-class: 1009 issues carry more than one revision, and
each superseded revision plus its replacement forms a natural counterfactual
pair inside one work item. A unit's *state* is its own contract text only; a
later revision or closure is recorded under `observed_outcome` and never enters
the state.

### Three separated label channels (never collapsed)

- `incumbent_state` — the incumbent readiness system's own verdict for that
  revision: the reproduced structural findings, the revision's own attestation
  row, and the derived readiness state/dispatchable/reasons.
- `observed_outcome` — closure outcome, supersession, journal results,
  receipts. Future information by construction.
- `research_label` — the experimental label with `source`, `method`,
  `confidence` and `rationale`.

### Independent labels

378 structurally valid units carry an outcome-anchored label: 275 ready,
103 not ready. All 378 have `source = outcome_anchored`; confidence is
`high` 177, `medium` 182, `low` 19 (low = attested ready and then replaced).

The 393 structurally invalid units are **excluded from the primary population
by construction**: the incumbent deterministic channel answers those for free,
and including them would make readiness classification trivially easy. They are
reported separately as a robustness check.

### Frozen split

Grouped by work-item lineage (every revision of one issue shares one split) and
blocked by near-duplicate title cluster; `specialists` is held out entirely as
a whole repository. Partition rule: `sha256(cluster_key) mod 100` → `<60`
train, `<80` calibration, else test.

| partition | units | labelled (ready / not ready) |
|---|---|---|
| train | 632 | 141 (91 / 50) |
| calibration | 243 | 57 (40 / 17) |
| test (pre-registered held-out) | 240 | 53 (33 / 20) |
| repo_holdout (`specialists`) | 236 | 127 (111 / 16) |

### Mirror verification (evidence)

The deterministic channel reproduces the incumbent exactly, verified against
the live `sb` CLI on the sampled current revisions by
`packages/research/scripts/verify_planning_ready_mirror.py`:

- structural findings agreement **300/300 = 1.00**;
- derived readiness state and dispatchable agreement **300/300 = 1.00**.

Report: `~/.xtrm/research/datasets/planning-ready-v2/mirror-verification.json`.

### Incumbent baseline read-out on the frozen units

Of the 378 independently labelled units, the incumbent calls 19 ready
(false-READY against outcome evidence) and never calls a genuinely ready unit
not-ready within this population (0 false-DRAFT): 84 draft, 19 ready, 275
terminal. The incumbent is a **baseline, not an oracle**: 10 of the 19 were
attested ready and then replaced before completion.

The advisory path check finds 164 of 378 labelled units naming a repository
path that does not exist in the local checkout. That check is **advisory
only** — a contract may legitimately name a path that does not exist yet or
exists on another branch — and it gates nothing.

## 2. Frozen System One state

The state carries the ticket (`locator`, `kind`, `project`, `title`), the
contract revision rendered as section-labelled prose, and the Ready-contract
standard text. Composition:

- **Deterministic diagnostics are deliberately absent from the state**: they are
  a separate channel composed by policy, so no semantic judgment is anchored by
  a structural finding it was not asked about.
- Coordination state (sibling work, active claims) and dispatch state (the
  actual dispatch prompt) are **not instantiated**; no question depends on them.
- Standard provenance (source files and `sha256`) is recorded in the run
  manifest; `questions.standard_provenance()` computes it.

## 3. Frozen question battery

Eleven Noul questions, each with explicit `criteria.true` / `criteria.false`,
plus one Choice. **No Score**: the Ready policy has no ordinal dimension
(operator constraint 7).

Mandatory readiness predicates: `problem_actionable`, `success_observable`,
`scope_bounded`, `non_goals_effective`, `constraints_actionable`,
`validation_proves_success`, `output_unambiguous`.

Blocking gates: `open_decision`, `depends_on_missing_context`,
`micromanages_implementation`, `self_blocked`.

Choice: `execution_mode` = `repo_only` | `live_environment` |
`operator_or_other_team`.

The holistic arm asks exactly one question, in a separate request:
`executable` — "a fresh, competent worker with repository access could execute
this contract from its text alone".

## 4. Deterministic checks (code, not System One)

`xtrm_research.planning_ready.contracts.structural_findings` — the faithful
mirror of Substrate's `validateContractStructure`: required sections present
and non-empty, `validation[].check` / `output[].artifact` shape, one
unresolved-marker finding per field (`TBD|TODO|XXX|FIXME`), SCRUTINY validity,
ownership and context-ref shape, journal/memory authority rule. Verified at
1.00 agreement with the incumbent (above).

## 5. Frozen policy (arm B, the primary composition)

```
on(contract):
  if any deterministic structural finding              -> DRAFT
  if P(open_decision) > open_decision_above            -> NEEDS_DECISION
  if P(self_blocked) > self_blocked_above              -> BLOCKED
  if P(depends_on_missing_context) > missing_ctx_above -> DRAFT   (fresh-worker test)
  if any mandatory predicate < mandatory_false_below   -> DRAFT   (not compensated)
  if any mandatory predicate < mandatory_true_above    -> REVIEW  (genuine uncertainty)
  if P(micromanages_implementation) > micro_above      -> REVIEW  (advisory)
  else                                                 -> READY
```

Non-compensatory by construction: a deterministic failure ends the decision,
and a gate cannot be outweighed by positive readiness signals.

## 6. Arms

| arm | definition | run id |
|---|---|---|
| A | holistic single `executable` Noul, threshold fitted on train | `planning-ready-v2-holistic` |
| B0 | deterministic-only baseline, no semantic judgment | `planning-ready-v2-deterministic-only` |
| B | atomic battery + the frozen explicit policy above | `planning-ready-v2-atomic-explicit` |
| C | the same primitive answers + calibrated learned composition (no invariants), fitted on train, threshold on calibration | `planning-ready-v2-learned` |
| D | arm B with genuine uncertainty escalated to `claude-sonnet-5` (effort low) | `planning-ready-v2-escalation` |
| — | raw battery answers (the primitive evidence every arm replays) | `planning-ready-v2-jev-battery` |
| — | adversarial mutation suite | `planning-ready-v2-mutations` |

Arm C is a comparison arm only. The Planning contract's mandatory invariants are
not compensatory, so a learned scalar winning on aggregate would not license
replacing the explicit policy; that limitation is published with the run.

## 7. Thresholds and calibration procedure

- Explicit-policy thresholds: grid search on the **train partition only**,
  objective balanced accuracy of the binary READY decision, ties broken toward
  the lower false-READY count. Grid values are in `policy.DEFAULT_GRID`.
- Holistic arm threshold: same train-only procedure.
- Learned composition: logistic regression (L2, IRLS, pure stdlib) fitted on
  train; its decision threshold calibrated on the **calibration partition**.
- The test partition is never used to choose a threshold, a weight or an
  acceptance criterion. All frozen values are recorded in each run manifest.

## 8. Primary metrics and uncertainty

Population for headline metrics: the pre-registered **test** partition (53
labelled, structurally valid units). Also reported: pooled train+calibration+test,
and the whole-repository holdout.

- `false_ready_rate` (headline safety metric), `false_draft_rate`, `precision`,
  `recall`, `accuracy`, `balanced_accuracy`, `coverage`.
- Proportion intervals: Wilson 95%.
- Balanced accuracy and every paired difference: percentile bootstrap over
  **clusters = work items** (2000 resamples, seed 20260919), never over units.
- Per-primitive `auc`, `brier`, `ece`, `mean_p` against the ready label, with
  the same cluster bootstrap.
- Paired `false_ready_rate_delta_vs_holistic` on identical units.
- Mutation suite: per-class paired primitive deltas with bootstrap intervals,
  plus acceptance counts.
- Escalation arm: escalation rate, coverage, and the reasoning model's own
  reported cost.

Every published metric carries value, n, method and an interval where
estimable.

## 9. Success and falsification criteria (pre-registered)

**Supports the hypothesis** (all must hold on the test partition):

1. arm B's false-READY rate is lower than arm A's, and the paired
   false-READY difference's 95% interval excludes zero;
2. arm B's false-READY rate is not inflated by escalation (arm D is reported
   alongside);
3. every mutation class moves its declared primitive in the declared direction
   by at least the frozen materiality threshold (0.15 mean paired ΔP) with the
   interval excluding zero.

**Falsifies the hypothesis**:

1. arm B is no better than arm A on the test partition (paired difference
   interval contains zero);
2. at least one mutation class leaves its declared primitive statistically
   unmoved, or moves unrelated primitives further than the declared one.

## 10. Non-claims

- No production or runtime adoption of System One readiness. Substrate
  readiness stays deterministic-plus-attestation until a benchmark supports
  more.
- No claim that the incumbent readiness state is correct; it is a baseline.
- No claim that a semantic judgment replaces a deterministic check.
- No claim about downstream dispatch outcomes beyond the closure and
  supersession evidence on the frozen snapshot.
- The labelled population is outcome-anchored, not human-adjudicated; a
  revision that was attested ready and then replaced counts as not ready, which
  is a conservative choice and is stated in every result summary.

## 11. Budget (before the first call)

| item | expected | cap |
|---|---|---|
| Jev requests (atomic battery) | 1351 | 1351 |
| Jev requests (holistic arm) | 378 | 378 |
| Jev requests (mutation suite) | 220 (11 classes × 20 contracts) | 220 |
| Jev spend | ≈ USD 0.10 (1.76 M + 0.30 M + 0.29 M input tokens at USD 0.042/Mtok; output is not billed) | — |
| reasoning-model escalations (arm D) | ≈ 40–70 | 80 calls, USD 2.00 (`XTRM_RESEARCH_BUDGET_SCOPE=planning-ready-v2`) |
| provider key | `~/.secrets/typesafe_api_key.txt`, exported into the dedicated pane only; never printed, persisted or recorded | — |

All System One sends go through `guards.guarded_send`; the response cache means a
re-run of any stage replays instead of paying twice.

## 12. Follow-up (bounded, not in this lane)

`xtrm-research experiment run <experiment-id> --dataset … --variant … --reason …`
is **not** implemented: `runner_kind` and `sample_provider` are descriptive
strings with no runner registry in the package, so such a verb would introduce a
parallel execution framework. The desired CLI shape is recorded as a follow-up;
this campaign uses its workload-specific entry point
(`python -m xtrm_research.planning_ready`) and publishes through the normal
`publish_run` contract, so every run stays fully visible through
`xtrm-research` and xtrm-app.
