# Calibration methodology and acceptance thresholds (XTRM-498, criterion 5)

This document states how a raw backend output becomes a System One `noul`
in the Evidence Gate, and how a per-question acceptance threshold is set.

Code: `src/xtrm_research/evidence_gate/calibration.py`. It is used by
`compare.py`, and `tests/test_evidence_gate_calibration.py` pins it (every
assertion mutation-proven).

Measured results — Brier and ECE raw vs calibrated, and the learned
thresholds per arm and question — are in `evidence-gate-results.md`,
generated from the comparison JSON.

## 1. What needs calibration, and why

| Arm | Raw output | Is it a probability? | May it be reported as `noul` raw? |
|---|---|---|---|
| Qwen3-Reranker-0.6B | softmax of the `yes`/`no` logits at the last position | probability-shaped, not calibrated | No (§2 of XTRM-99, §10.2). Only after calibration. |
| Embedding (bge-small) | cosine similarity in [-1, 1] | no | No. Only after calibration. |
| Jev (TypeSafe) | `noul` = P(yes) | claimed calibrated by the provider | Yes, by contract. It is still measured, and a calibrated variant is reported next to it. |
| Frontier (Claude, structured output) | probability stated by the model | stated, not calibrated | Measured raw and calibrated; the same treatment as Jev. |

Every arm goes through the same procedure. A raw score and its
calibration are reported side by side, so the calibration effect is
visible rather than assumed.

## 2. Procedure

1. **Grouped K-fold (K = 5).**
   - Units: the dataset's bootstrap clusters (one `ctx_search` call, or one
     researcher job). Every item of a cluster lands in the same fold.
   - Fold of a cluster: its rank under `sha256("20260918:" + cluster_key)`,
     dealt round-robin.
   - A calibrator never sees a sibling of the item it scores.
2. **Input transform.**
   - Probability-shaped raw output: `x = logit(clip(raw, 1e-6, 1 - 1e-6))`.
   - Cosine: `x = raw`.
3. **Platt scaling** (primary): `p = sigmoid(a·x + b)`.
   - Fit by Newton-Raphson on the four training folds, with a 1e-3 ridge
     on `a` for separable folds.
   - A training fold with one class present cannot be fit. It predicts its
     training base rate and is recorded as `degenerate` in `calibration_fits`.
4. **Isotonic regression** (sensitivity check): pool-adjacent-violators,
   fit the same way.
5. **Out-of-fold.**
   - Every reported calibrated probability is produced by the calibrator
     fit on the other folds.
   - A test pins this: flipping the labels of the held-out fold changes no
     held-out prediction.
6. **Metrics on the out-of-fold probabilities.**
   - Brier score.
   - ECE over 10 equal-mass bins (`sum |mean p - mean y| · bin share`).
   - AUC on the raw score (calibration-invariant up to ties).
   - Each metric carries a 95% cluster-bootstrap interval: 2000 resamples,
     seed 20260918.

## 3. Acceptance thresholds per question type

The Evidence Gate optimises for **high evidence recall, not aggressive
reduction** (XTRM-99 §2). The acceptance rule is therefore recall-targeted
and set per question.

**Retaining questions** (`contains_usable_evidence`,
`contradicts_query_assumption`; also reported for `relevant` and
`warrants_frontier_attention`):

- For each fold, the threshold is the largest `t` such that recall of
  `p >= t` on the training folds is at least 0.95.
- The held-out fold is decided with that `t`.
- The out-of-fold recall and precision at threshold, with intervals, show
  how the target survives on unseen data.
- The fold thresholds are published per arm and question in the results
  JSON (`thresholds`).

**Rare questions** (`contradicts_query_assumption`,
`contains_prompt_injection`):

- A question with fewer than 10 positives in the evaluation set has no
  meaningful calibration or threshold. Its policy path is **disabled**,
  and its metrics read **not established**.
- Real XTRM search workloads produced 1 contradiction and 2 injections in
  265 items (label class balance, XTRM-494).
- Without this rule, a training fold with no positive would accept every
  item, and the gate would silently retain everything. The first
  comparison run showed exactly that (compare test
  `test_rare_contradiction_path_is_disabled_not_accept_all`).

**Score question** (`source_authority`, 4 levels):

- Answered only by arms that return a distribution (Jev, frontier).
- Measured by multiclass Brier and by the mean absolute error of the
  expected level.
- No threshold: v1 policy does not act on authority.

## 4. What a threshold is NOT

- It is not transferable across question-spec versions. A spec change
  changes the question's content hash and invalidates its calibration
  history (XTRM-99 OQ4).
  - Answer for research: the calibration record is keyed by arm, question
    spec hash, dataset hash and label version.
  - A future runtime must key it the same way.
- It is not a probability of correctness of the gate as a whole. The gate
  metrics (useful-evidence recall, retained precision, token reduction)
  are reported separately.
- The bootstrap intervals resample evaluation items. They do not refit the
  calibrators, so they omit calibration-fit variance. With about 50 items
  per fold, that variance is not negligible, and the intervals are
  therefore a lower bound on the true uncertainty.

## 5. Which questions need calibrated probabilities vs ranking only (OQ5)

- **Need calibrated probabilities:** any question whose answer feeds a
  threshold policy that must hold a target rate on new data. In v1 that is
  `contains_usable_evidence`, and `contradicts_query_assumption` once it
  has enough positives.
- **Ranking only:** a question used only to order candidates within one
  query, such as choosing the top 5-10 for the frontier agent. It needs
  AUC, not calibration. A raw reranker score is acceptable there, but it
  must not be labelled `noul`.
