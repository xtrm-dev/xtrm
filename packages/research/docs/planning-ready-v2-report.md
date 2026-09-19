# Planning Ready-contract v2 — campaign report

Experiment `planning-ready-v2` v1 on workload `planning-ready` v1.
Frozen pre-registration: [`planning-ready-v2.md`](planning-ready-v2.md) (written before the
first live call). Source: Jira XTRM-99 comments 13435 and 13438. Code: PR #245.

## 1. What was asked and what was done

The question: **can atomic System One judgments over a Planning work contract, composed by
explicit code, decide READY / DRAFT / NEEDS_DECISION / BLOCKED / REVIEW — and does each
judgment mean what its name claims?**

The work: the current Planning Ready contract was compiled into a deterministic structural
channel plus an eleven-Noul atomic battery plus one Choice, composed by an explicit
non-compensatory policy, and evaluated against (a) the historical single holistic judgment,
(b) a deterministic-only baseline, (c) a learned composition over the same answers, and
(d) the same policy with genuine uncertainty escalated to a reasoning model. Each primitive
was also tested directly by eleven controlled single-invariant mutations.

## 2. Evidence base

| item | value |
|---|---|
| dataset | `planning-ready-v2` v1, `units_sha256:fae0fa1e71832488befc9ab598a726773c824f476f32c9bc7bd2e87bd5865b6f` |
| units | 1351 (issue × revision) over 951 work items; 1009 issues carry more than one revision |
| independently labelled | 378 structurally valid units (275 ready / 103 not ready) |
| held-out test partition | 53 labelled units (33 ready / 20 not ready) |
| labels | outcome-anchored (closure, supersession); three channels recorded separately |
| deterministic mirror | structural findings **300/300**, derived readiness state **300/300** vs the live `sb` CLI |
| runs | `planning-ready-v2-{jev-battery, holistic, deterministic-only, atomic-explicit, learned, escalation, mutations-r2}` |
| run bodies | sanitized reading copies on the `research-artifacts` branch (`planning-ready-v2/`), 5894 values redacted |
| spend | Jev USD 0.179 (1949 requests, input-only billing) + 75 reasoning-model escalations inside an 80-call / USD 2.00 budget |

## 3. Held-out results (test partition, n = 53)

| arm | false-READY (safety) | false-DRAFT | balanced acc. | precision | recall |
|---|---|---|---|---|---|
| A holistic (historical) | 0.600 [0.387, 0.781] | 0.182 | 0.609 | 0.692 | 0.818 |
| B0 deterministic-only | 1.000 | 0.000 | 0.500 | 0.623 | 1.000 |
| **B atomic explicit policy** | **0.100 [0.028, 0.301]** | 0.545 | 0.677 | 0.882 | 0.455 |
| C learned composition | 0.450 | 0.242 | 0.654 | 0.735 | 0.758 |
| D B + escalation | 0.100 | 0.515 | 0.692 | 0.889 | 0.485 |

Proportions carry Wilson 95% intervals; every rate is computed on the same 53 units.

**Paired false-READY difference against the holistic arm** (negative favours the atomic policy,
percentile bootstrap clustered by work item):

| comparison | test | pooled (train+calibration+test) | whole-repo holdout (`specialists`) |
|---|---|---|---|
| B − A | **−0.500 [−0.714, −0.294]** | −0.563 [−0.663, −0.462] | **−0.375 [−0.632, −0.143]** |
| D − A | −0.500 [−0.714, −0.294] | −0.402 [−0.515, −0.287] | −0.250 [−0.500, −0.056] |
| C − A | −0.150 [−0.364, +0.056] | −0.322 [−0.436, −0.209] | −0.062 [−0.214, 0.000] |
| B0 − A | +0.400 [+0.182, +0.609] | +0.264 [+0.176, +0.360] | +0.062 [0.000, +0.214] |

The pre-registered success criterion — arm B's false-READY rate lower than the holistic arm's
with the paired interval excluding zero — **holds on the test partition and in the held-out
repository**. The safety improvement is concrete: of 20 genuinely not-ready contracts, the
holistic judgment accepted 12 and the atomic policy accepts 2.

## 4. Where the decisions land (all 378 evaluated units)

| arm | READY | DRAFT | NEEDS_DECISION | BLOCKED | REVIEW |
|---|---|---|---|---|---|
| B atomic explicit policy | 126 | 45 | 16 | 22 | 151 |
| D B + escalation | 175 | 67 | 16 | 22 | 80 |

Escalation converted 75 abstentions into decisions (49 to READY) **without** adding a single
false-READY on the test partition: the safety metric is unchanged at 0.100. That is the
operationally useful result — abstention is where the conservatism lives, and the reasoning
model is the cheap way out of it.

## 5. Do the primitives mean what they claim? (mutation suite)

Eleven single-invariant mutations were applied to 20 strong contracts each, with the expected
movement declared before any call. **All 11 classes moved their declared primitive in the
declared direction**, by at least the frozen materiality threshold (0.15 mean ΔP), with every
bootstrap interval excluding zero:

| mutation | declared primitive | mean ΔP [95% CI] |
|---|---|---|
| `vague_scope` | scope_bounded | −0.769 [−0.786, −0.749] |
| `problem_as_label` | problem_actionable | −0.729 [−0.782, −0.649] |
| `hollow_non_goals` | non_goals_effective | −0.698 [−0.713, −0.682] |
| `unresolved_dependency` | self_blocked | +0.634 [+0.587, +0.667] |
| `break_output_semantics` | output_unambiguous | −0.622 [−0.647, −0.596] |
| `remove_observable_success` | success_observable | −0.609 [−0.629, −0.589] |
| `remove_necessary_constraint` | constraints_actionable | −0.528 [−0.562, −0.488] |
| `over_prescribe_implementation` | micromanages_implementation | +0.490 [+0.433, +0.548] |
| `static_only_validation` | validation_proves_success | −0.477 [−0.551, −0.394] |
| `chat_only_context` | depends_on_missing_context | +0.333 [+0.286, +0.374] |
| `introduce_unnamed_decision` | open_decision | +0.286 [+0.231, +0.339] |

One coupling is recorded rather than hidden: `chat_only_context` also collapses `scope_bounded`
(−0.781), because the mutation replaces the SCOPE text with "as discussed in the planning
thread" — the two are entangled by construction, not by accident. The mutation run reports it
as unexplained movement; this note is the explanation.

## 6. Primitive-level evidence (pooled, n = 378)

| primitive | AUC [95% CI] | Brier | ECE | mean P |
|---|---|---|---|---|
| problem_actionable | 0.640 [0.57, 0.71] | 0.252 | 0.168 | 0.728 |
| non_goals_effective | 0.631 [0.56, 0.70] | 0.230 | 0.127 | 0.755 |
| constraints_actionable | 0.624 [0.55, 0.69] | 0.224 | 0.062 | 0.638 |
| validation_proves_success | 0.587 [0.52, 0.65] | 0.258 | 0.130 | 0.525 |
| micromanages_implementation | 0.581 [0.50, 0.66] | 0.356 | 0.354 | 0.299 |
| scope_bounded | 0.537 [0.46, 0.61] | 0.238 | 0.129 | 0.761 |
| success_observable | 0.534 [0.46, 0.61] | 0.229 | 0.106 | 0.697 |
| output_unambiguous | 0.472 [0.40, 0.54] | 0.251 | 0.122 | 0.703 |
| open_decision | 0.468 [0.40, 0.55] | 0.280 | 0.200 | 0.482 |
| self_blocked | 0.435 [0.36, 0.51] | 0.421 | 0.430 | 0.263 |
| depends_on_missing_context | 0.364 [0.30, 0.43] | 0.405 | 0.394 | 0.275 |

Two readings matter and neither flatters the battery:

1. **The gate primitives sit below 0.5 in the desired direction.** `depends_on_missing_context`
   (0.364), `self_blocked` (0.435) and `open_decision` (0.468) are *negative* signals, so an AUC
   below 0.5 against the ready label is the correct orientation. A reader who assumes
   "higher AUC is better" for every row will misread this table; the direction is in the metric
   glossary for exactly that reason.
2. **No single primitive is a good standalone ranker** (best AUC 0.640) and the gate primitives
   are poorly calibrated (ECE 0.394–0.430). The measured policy advantage therefore comes from
   **composition and the deterministic gate**, not from any question being individually
   accurate. This is the honest headline: the battery is useful as a battery.

## 7. What this establishes, and what it does not

**Supported by this evidence**

- On the frozen board population, an atomic System One battery composed by an explicit
  non-compensatory policy makes substantially fewer false-READY calls than the historical
  holistic judgment (2/20 vs 12/20 on the held-out partition; paired interval excludes zero;
  the same direction in a held-out repository).
- Every primitive moves as declared when the invariant it names is changed, so the primitive
  names are not decorative.
- Escalating only genuine uncertainty recovers most abstentions without paying for it in
  false-READY calls.

**Not established**

- That the atomic policy is a better *decision maker* overall: the balanced-accuracy difference
  (0.677 vs 0.609) is not decisive — the intervals overlap — and the recall cost is real
  (0.455 vs 0.818: it withholds READY from 54.5% of genuinely ready contracts).
- That a learned composition beats the explicit policy; arm C is *not* decisively better than
  the holistic arm on the test partition (−0.150 [−0.364, +0.056]) and enforces no invariant.
- Any production or runtime adoption. Substrate readiness remains deterministic-plus-attestation.
- That these labels are human truth: they are outcome-anchored. A revision that was attested
  ready and then replaced counts as not ready — conservative, and stated in every run.
- That the numbers transfer beyond this board snapshot: 20 negatives on the test partition
  makes the safety interval wide, and the population excludes structurally invalid contracts by
  construction.

## 8. Decision

**Hold, with a clear next step.** The incumbent deterministic-plus-attestation readiness stays
authoritative. The campaign's evidence is strong enough to justify a larger independently
labelled sample — the current test partition is 53 units — not a runtime change. The two
candidate next steps, in order: (1) human or independent adjudication of a stratified sample of
the 308 open, unattested hard units, so the deployment population gets real labels instead of
only coverage and disagreement measurements; (2) if that holds up, adopt the atomic battery as a
*screening* stage that can only withhold READY (never grant it) while attestation remains the
granting authority — the shape the current evidence actually supports.

## 9. Reproducing this

```sh
# definitions and registry (git)
packages/research/registry/experiment/planning-ready-v2-v1.json

# the frozen dataset and every run body (not in git by design — private board text)
~/.xtrm/research/datasets/planning-ready-v2/      # units.jsonl + manifest + mirror verification
~/.xtrm/research/runs/planning-ready-v2-*         # the evidence of record

# a sanitized reading copy, shareable and app-readable
git clone --branch research-artifacts --single-branch git@github.com:xtrm-dev/xtrm.git /tmp/art
cd packages/xtrm-app && npm run research:dev -- --runs /tmp/art/planning-ready-v2

# re-run any stage (the response cache replays answered calls instead of paying again)
cd packages/research
./.venv/bin/python -m xtrm_research.planning_ready collect --kind atomic   # then holistic
./.venv/bin/python -m xtrm_research.planning_ready arms
./.venv/bin/python -m xtrm_research.planning_ready mutations
./.venv/bin/python -m xtrm_research.planning_ready mutations-collect
./.venv/bin/python -m xtrm_research.planning_ready mutations-evaluate
./.venv/bin/python -m xtrm_research.planning_ready escalate --max-calls 80
```

Deviations from the pre-registration, both recorded in the runs themselves:

1. The escalation model is `commandcode/deepseek/deepseek-v4.1-flash` (pi transport) rather than
   the pre-registered `claude-sonnet-5`, because the operator allowlist does not include the
   latter. No criterion, budget or decision rule changed.
2. Units whose text the send-guard refused (38 of 1351) are excluded from threshold *fitting*
   and remain in evaluation, where the explicit policy resolves them to REVIEW. Their published
   bodies are redacted and marked `refused_by_guard`.

### Chart-definition correction applied after the runs were published

The experiment record shipped with dataset ids that no run could ever satisfy: chart specs and
`named_datasets` named bare `false_ready_rate`, `balanced_accuracy`, `coverage`, `primitive_auc`,
`primitive_brier` and `primitive_ece`, while the evaluator persists `test.false_ready_rate` (the
partition prefix is part of the leaf) and one triple per primitive, `constraints_actionable_auc`.
The chart resolver matches an exact metric key or a `"::"` suffix, so those ids resolved to nothing
and every chart on the run page rendered empty while all schema validation still passed.

The record is generated by `campaign.EXPERIMENT`, and the runs pin the *exact versioned* definition
from their manifest, so the fix corrects `planning-ready-v2` **v1 in place** rather than publishing
a v2 the existing runs would never reference:

- `named_datasets`, `metric_glossary` and the chart datasets now use the persisted leaves, generated
  from the same constants the evaluator uses (`DECISION_METRICS`, `policy.NOUL_FEATURES`).
- `primitive-signal` became `primitive-discrimination` (AUC) and `primitive-calibration` (ECE);
  Brier stays in the run metrics rather than adding eleven more sub-charts.
- The shared constant changed the `workload` definition's `metric_names` too, so
  `planning-ready` v1 was regenerated as well.

Consequences, stated plainly: the content hashes of both definitions changed
(`planning-ready-v2` `sha256:b9078391…` → `sha256:c8ced3836c…`, `planning-ready` `sha256:95411983…`
→ `sha256:a67735cbd3…`), while each run's manifest still records the hash it referenced at publish
time. No criterion, threshold, weight, budget, decision rule or result changed — the affected ids
were never resolvable, so nothing could have depended on them. Verified after the correction: all
25 chart datasets resolve against the sanitized published runs, all four charts populate, and a
regression test (`test_experiment_datasets_resolve_against_emitted_metric_ids`) now fails if a
dataset id drifts from the vocabulary the evaluator actually emits.
