"""Evaluators, including the parity evaluators for XTRM-481.

``exact_match_evaluate`` is the trivial deterministic evaluator used to
exercise the assessment-set path. ``board_duplicates_evaluate`` and
``contract_quality_evaluate`` reproduce the metric formulas of the original
research scripts at specialists commit ``a6e55215``,
``experiments/jev-dupes/dupes.py`` and ``sb_quality3.py``. Parity is the
contract: the numbers must match the originals to within 0.0005, so these
keep the choices a textbook would make differently — the half credit for
tied AUC pairs, ten fixed-width ECE bins, the ``max(1, tp + fp)`` precision
guard, and index-based order statistics. Nothing rounds; the originals
round only at print time.

Every metric is a point estimate, so ``se`` and ``ci95`` are ``null`` and
each ``method`` string says why.

The two AUCs disagree on an empty class and that difference is preserved:
:func:`contract_quality_evaluate` returns ``nan`` (the ``sb_quality3.py``
guard), while :func:`board_duplicates_evaluate` divides by zero exactly as
``dupes.py`` does, because a corrected formula fails parity.
"""

from __future__ import annotations

from typing import Any

# --- parity constants, verified against the source by tests/test_parity_ast.py ---

#: Half credit for a tied positive/negative score pair, in both AUCs.
AUC_TIE_CREDIT = 0.5
#: ``p >= 0.5`` classification threshold for precision and recall.
CLASSIFIER_THRESHOLD = 0.5
#: Number of fixed-width ECE bins.
ECE_BIN_COUNT = 10
#: Highest ECE bin index; ``min(int(p * 10), 9)``.
ECE_TOP_BIN_INDEX = 9
#: ``policy()`` multiplier when a contract cites stale PROBLEM symbols.
STALE_FACTOR = 0.5
#: Index divisor for the p10 order statistic: ``len(values) // 10``.
P10_DIVISOR = 10
#: Index divisor for the median order statistic: ``len(values) // 2``.
MEDIAN_DIVISOR = 2
#: Numerator of the p90 index: ``9 * len(values) // 10``.
P90_NUMERATOR = 9

#: Why every metric's ``se``/``ci95`` are null.
_POINT_ESTIMATE = (
    "; se and ci95 are null because the original report computes a point "
    "estimate only, with no variance or bootstrap interval"
)


def _metric(value: Any, n: int, method: str) -> dict[str, Any]:
    return {"value": value, "se": None, "ci95": None, "n": n, "method": method}


def exact_match_evaluate(
    samples: list[dict[str, Any]], expected: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Compare each sample's ``output`` to ``expected[sample_id]``.

    Each assessment carries a Noul answer (``noul`` = 1.0 on match, else
    0.0) — "did this match?" is naturally a yes/no judgment.
    Returns ``(assessments, metrics)`` shaped for
    :func:`xtrm_research.assessments.write_assessment_set`.
    """
    assessments = []
    correct = 0
    for sample in samples:
        is_match = sample.get("output") == expected.get(sample["sample_id"])
        correct += int(is_match)
        assessments.append(
            {
                "sample_id": sample["sample_id"],
                "answer": {"noul": 1.0 if is_match else 0.0},
            }
        )
    n = len(samples)
    accuracy = correct / n if n else 0.0
    method = "exact_match" if n else "exact_match-no-samples"
    metrics = {
        "accuracy": {
            "value": accuracy,
            "se": None,
            "ci95": None,
            "n": n,
            "method": method,
        }
    }
    return assessments, metrics


# --- duplicates parity (dupes.py at a6e55215) -------------------------------


def jev_choice(probs: dict[str, Any]) -> float:
    """The ``dupes.py`` choice score: ``probs['same_work'] +
    ``probs['one_covers_other']``, with a default of 0 for a missing key."""
    return probs.get("same_work", 0) + probs.get("one_covers_other", 0)


def _auc(ys: list[Any], scores: list[Any], *, guard_empty: bool) -> float:
    """Rank-sum AUC with half credit for tied pairs.

    ``guard_empty`` is the only difference between the two source scripts:
    ``sb_quality3.py`` returns ``nan`` for an empty class, ``dupes.py`` has
    no guard and divides by zero.
    """
    pos = [s for y, s in zip(ys, scores) if y]
    neg = [s for y, s in zip(ys, scores) if not y]
    if guard_empty and (not pos or not neg):
        return float("nan")
    return sum((p > q) + AUC_TIE_CREDIT * (p == q) for p in pos for q in neg) / (
        len(pos) * len(neg)
    )


def _brier(probs: list[Any], labels: list[Any]) -> float:
    return sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(labels)


def _ece(probs: list[Any], labels: list[Any]) -> float:
    bins = [
        [
            (p, y)
            for p, y in zip(probs, labels)
            if min(int(p * ECE_BIN_COUNT), ECE_TOP_BIN_INDEX) == k
        ]
        for k in range(ECE_BIN_COUNT)
    ]
    return sum(
        len(b) * abs(sum(p for p, _ in b) / len(b) - sum(y for _, y in b) / len(b))
        for b in bins
        if b
    ) / len(labels)


def _classifier_counts(probs: list[Any], labels: list[Any]) -> tuple[int, int]:
    tp = sum(p >= CLASSIFIER_THRESHOLD and y for p, y in zip(probs, labels))
    fp = sum(p >= CLASSIFIER_THRESHOLD and not y for p, y in zip(probs, labels))
    return tp, fp


def board_duplicates_evaluate(
    samples: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Reproduce ``dupes.py report()`` over imported ``board-duplicates-v1``
    Samples: AUC, Brier, ECE, precision and recall for the ``noul`` and
    ``choice`` Jev scores plus the ``baseline`` AUC, and the mean ``noul``
    per kind stratum.

    A Sample with ``status != "ok"`` is excluded from every metric: the
    importer writes a ``skipped`` Sample for a pair with no recorded answer,
    and ``dupes.py report()`` reads ``answers.jsonl`` directly, so it never
    sees such a pair at all. Returns ``([], metrics)`` — these are aggregate
    metric evaluators, not per-sample judgments.
    """
    rows = [s for s in samples if s.get("status") == "ok"]
    labels = [r["input"]["label"] for r in rows]
    baselines = [r["input"]["baseline"] for r in rows]
    noul = [r["output"]["noul"] for r in rows]
    choice = [jev_choice(r["output"]["probs"]) for r in rows]

    n = len(rows)
    auc_method = (
        "AUC by the rank-sum formula with half credit for ties: sum over "
        "positive/negative score pairs of (p > q) + 0.5 * (p == q), divided "
        "by len(pos) * len(neg)" + _POINT_ESTIMATE
    )
    brier_method = "mean of (p - y)^2 over every scored sample" + _POINT_ESTIMATE
    ece_method = (
        "ten fixed-width bins indexed by min(int(p * 10), 9); the sum over "
        "non-empty bins of (bin size * |mean(p) - mean(y)|), divided by the "
        "whole sample count, not the bin count" + _POINT_ESTIMATE
    )
    precision_method = (
        "tp / max(1, tp + fp) with tp = count(p >= 0.5 and y) and "
        "fp = count(p >= 0.5 and not y); the max(1, ...) guard makes zero "
        "predicted positives 0.0 instead of a division by zero" + _POINT_ESTIMATE
    )
    recall_method = "tp / sum(y) with tp = count(p >= 0.5 and y)" + _POINT_ESTIMATE
    mean_method = "arithmetic mean of noul within one kind stratum" + _POINT_ESTIMATE

    metrics: dict[str, dict[str, Any]] = {
        "auc.baseline": _metric(
            _auc(labels, baselines, guard_empty=False), n, auc_method
        ),
        "auc.jev_noul": _metric(_auc(labels, noul, guard_empty=False), n, auc_method),
        "auc.jev_choice": _metric(
            _auc(labels, choice, guard_empty=False), n, auc_method
        ),
    }
    for name, probs in (("jev_noul", noul), ("jev_choice", choice)):
        tp, fp = _classifier_counts(probs, labels)
        metrics[f"brier.{name}"] = _metric(_brier(probs, labels), n, brier_method)
        metrics[f"ece.{name}"] = _metric(_ece(probs, labels), n, ece_method)
        metrics[f"precision.{name}"] = _metric(
            tp / max(1, tp + fp), n, precision_method
        )
        metrics[f"recall.{name}"] = _metric(tp / sum(labels), n, recall_method)
    for kind in sorted({r["input"]["kind"] for r in rows}):
        values = [r["output"]["noul"] for r in rows if r["input"]["kind"] == kind]
        metrics[f"mean_p_redundant.{kind}"] = _metric(
            sum(values) / len(values), len(values), mean_method
        )
    return [], metrics


# --- contract-quality parity (sb_quality3.py at a6e55215) -------------------


def policy(sample: dict[str, Any]) -> float:
    """``sb_quality3.py policy()``: executable * (1 - open_decision) *
    (1 - self_blocked), halved when the contract cites missing PROBLEM
    symbols."""
    stale = len(sample["input"]["evidence"]["problem_symbols_missing"]) > 0
    output = sample["output"]
    return (
        output["executable"]
        * (1 - output["open_decision"])
        * (1 - output["self_blocked"])
        * (STALE_FACTOR if stale else 1.0)
    )


def contract_quality_evaluate(
    samples: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Reproduce ``sb_quality3.py report()`` over imported
    ``contract-quality-v3`` Samples: per-field p10/median/p90 order
    statistics, the agreement AUCs against the blind ``dispatchable``
    label, ``validation_covers_success`` against its label, and
    ``execution_mode`` agreement.

    Order statistics use every ok Sample; the AUCs and agreement use only
    Samples whose ``input.label`` is present (the importer leaves it
    ``null`` for a contract with no blind label). Returns ``([], metrics)``.
    """
    rows = [s for s in samples if s.get("status") == "ok"]
    joined = [s for s in rows if s["input"].get("label") is not None]
    fields = (
        "executable",
        "open_decision",
        "validation_covers_success",
        "self_blocked",
    )
    metrics: dict[str, dict[str, Any]] = {}
    for field in fields:
        values = sorted(s["output"][field] for s in rows)
        count = len(values)
        metrics[f"p10.{field}"] = _metric(
            values[count // P10_DIVISOR],
            count,
            "sorted(values)[len(values) // 10], an index-based order "
            "statistic with no interpolation" + _POINT_ESTIMATE,
        )
        metrics[f"median.{field}"] = _metric(
            values[count // MEDIAN_DIVISOR],
            count,
            "sorted(values)[len(values) // 2], an index-based order "
            "statistic with no interpolation" + _POINT_ESTIMATE,
        )
        metrics[f"p90.{field}"] = _metric(
            values[P90_NUMERATOR * count // P10_DIVISOR],
            count,
            "sorted(values)[9 * len(values) // 10], an index-based order "
            "statistic with no interpolation" + _POINT_ESTIMATE,
        )

    auc_method = (
        "AUC by the rank-sum formula with half credit for ties: sum over "
        "positive/negative score pairs of (p > q) + 0.5 * (p == q), divided "
        "by len(pos) * len(neg); an empty class is nan, matching "
        "sb_quality3.py" + _POINT_ESTIMATE
    )
    scores = (
        ("executable", lambda s: s["output"]["executable"]),
        ("one_minus_open_decision", lambda s: 1 - s["output"]["open_decision"]),
        ("one_minus_self_blocked", lambda s: 1 - s["output"]["self_blocked"]),
        (
            "not_stale",
            lambda s: 0.0 if s["input"]["evidence"]["problem_symbols_missing"] else 1.0,
        ),
        ("policy", policy),
    )
    dispatchable = [s["input"]["label"]["dispatchable"] == "yes" for s in joined]
    for name, score in scores:
        metrics[f"auc.{name}"] = _metric(
            _auc(dispatchable, [score(s) for s in joined], guard_empty=True),
            len(joined),
            auc_method,
        )
    proves_success = [
        s["input"]["label"]["validation_proves_success"] == "yes" for s in joined
    ]
    metrics["auc.validation_covers_success"] = _metric(
        _auc(
            proves_success,
            [s["output"]["validation_covers_success"] for s in joined],
            guard_empty=True,
        ),
        len(joined),
        auc_method,
    )

    labeled_modes = [
        s["input"]["label"] for s in joined if s["input"]["label"].get("execution_mode")
    ]
    if labeled_modes:
        matched = sum(
            s["output"]["execution_mode"] == s["input"]["label"].get("execution_mode")
            for s in joined
        )
        metrics["execution_mode_agreement"] = _metric(
            matched / len(labeled_modes),
            len(labeled_modes),
            "count of joined rows whose output execution_mode equals the "
            "label's, divided by the count of labels that carry an "
            "execution_mode; the numerator covers every joined row, "
            "including rows whose label carries no execution_mode "
            "(sb_quality3.py's deliberate asymmetry)" + _POINT_ESTIMATE,
        )
    return [], metrics


#: The parity evaluators by the experiment id they score.
PARITY_EVALUATORS = {
    "board-duplicates-v1": board_duplicates_evaluate,
    "contract-quality-v3": contract_quality_evaluate,
}
