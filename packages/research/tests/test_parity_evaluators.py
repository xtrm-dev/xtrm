"""Parity evaluator tests (XTRM-481).

Every expected value here is computed inside the test — by hand or by an
obviously-correct brute force — never by calling the implementation. The
pinned tests are constructed to fail if the textbook variant is
substituted: tie-credit AUC, fixed-width ECE binning, the
``max(1, tp + fp)`` precision guard, index-based order statistics, the
non-ok Sample exclusion, and the execution_mode agreement denominator.
"""

from __future__ import annotations

import math

import pytest

from xtrm_research.assessments import list_assessment_sets, write_assessment_set
from xtrm_research.evaluators import (
    PARITY_EVALUATORS,
    board_duplicates_evaluate,
    contract_quality_evaluate,
    jev_choice,
    policy,
)
from xtrm_research.hashing import compute_content_hash
from xtrm_research.runner import start_run
from xtrm_research.schemas import validate
from xtrm_research.views import run_metrics

from .helpers import FIXED_NOW, make_manifest

# --- synthetic Sample builders (the shape importers.py writes) --------------


def _dupe_sample(
    index: int,
    label: int,
    baseline: float,
    noul: float | None,
    probs: dict[str, float] | None = None,
    *,
    kind: str = "superseded",
    status: str = "ok",
) -> dict:
    sample = {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": f"dupe-s{index}",
        "index": index,
        "input": {
            "a": f"alpha-{index}",
            "b": f"beta-{index}",
            "label": label,
            "kind": kind,
            "baseline": baseline,
        },
        "status": status,
        "created_at": FIXED_NOW.isoformat(),
    }
    if status == "ok":
        sample["output"] = {
            "noul": noul,
            "choice": "same_work",
            "probs": probs if probs is not None else {"same_work": noul},
            "conf": 0.9,
        }
    return sample


def _contract_sample(
    index: int,
    label: dict | None,
    executable: float,
    open_decision: float,
    validation_covers_success: float,
    self_blocked: float,
    *,
    execution_mode: str = "repo_only",
    missing: tuple[str, ...] = (),
    status: str = "ok",
) -> dict:
    return {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": f"contract-core--CORE-{index}",
        "index": index,
        "input": {
            "board": "core",
            "ref": f"CORE-{index}",
            "evidence": {
                "problem_symbols": 1,
                "problem_symbols_missing": list(missing),
                "paths_not_in_repo": [],
            },
            "label": label,
        },
        "output": {
            "execution_mode": execution_mode,
            "executable": executable,
            "open_decision": open_decision,
            "validation_covers_success": validation_covers_success,
            "self_blocked": self_blocked,
        },
        "status": status,
        "created_at": FIXED_NOW.isoformat(),
    }


# --- tie-credit AUC ---------------------------------------------------------


def test_auc_half_credit_for_ties_differs_from_the_no_tie_variant():
    labels = [1, 0, 1, 0]
    scores = [0.5, 0.5, 0.5, 0.5]
    samples = [
        _dupe_sample(i, y, s, s, {"same_work": s})
        for i, (y, s) in enumerate(zip(labels, scores))
    ]
    _, metrics = board_duplicates_evaluate(samples)

    pos = [s for y, s in zip(labels, scores) if y]
    neg = [s for y, s in zip(labels, scores) if not y]
    tie_credit = sum((p > q) + 0.5 * (p == q) for p in pos for q in neg) / (
        len(pos) * len(neg)
    )  # 4 pairs, each tied -> 4 * 0.5 / 4
    no_tie_credit = sum(p > q for p in pos for q in neg) / (len(pos) * len(neg))

    assert (len(pos), len(neg)) == (2, 2)
    assert tie_credit == 0.5
    assert no_tie_credit == 0.0
    assert tie_credit != no_tie_credit
    assert metrics["auc.jev_noul"]["value"] == tie_credit
    assert metrics["auc.jev_noul"]["value"] != no_tie_credit
    assert metrics["auc.baseline"]["value"] == tie_credit


def test_every_contract_auc_score_matches_a_brute_force_value():
    labels = [
        {"dispatchable": "yes", "validation_proves_success": "yes"},
        {"dispatchable": "no", "validation_proves_success": "no"},
        {"dispatchable": "yes", "validation_proves_success": "no"},
        {"dispatchable": "no", "validation_proves_success": "yes"},
    ]
    rows = [
        # executable, open_decision, validation_covers_success, self_blocked, missing
        (0.9, 0.1, 0.8, 0.0, ()),
        (0.2, 0.6, 0.3, 0.4, ("x",)),
        (0.6, 0.2, 0.5, 0.1, ()),
        (0.4, 0.5, 0.2, 0.3, ("y",)),
    ]
    samples = [
        _contract_sample(i, labels[i], ex, op, vcs, sb, missing=missing)
        for i, (ex, op, vcs, sb, missing) in enumerate(rows)
    ]
    _, metrics = contract_quality_evaluate(samples)

    def brute_force(ys, scores):
        pos = [s for y, s in zip(ys, scores) if y]
        neg = [s for y, s in zip(ys, scores) if not y]
        return sum((p > q) + 0.5 * (p == q) for p in pos for q in neg) / (
            len(pos) * len(neg)
        )

    dispatchable = [label["dispatchable"] == "yes" for label in labels]
    scores = {
        "executable": [ex for ex, _, _, _, _ in rows],
        "one_minus_open_decision": [1 - op for _, op, _, _, _ in rows],
        "one_minus_self_blocked": [1 - sb for _, _, _, sb, _ in rows],
        "not_stale": [0.0 if missing else 1.0 for _, _, _, _, missing in rows],
        "policy": [policy(s) for s in samples],
    }
    for name, values in scores.items():
        expected = brute_force(dispatchable, values)
        assert metrics[f"auc.{name}"]["value"] == pytest.approx(expected)

    proves_success = [label["validation_proves_success"] == "yes" for label in labels]
    vcs_scores = [vcs for _, _, vcs, _, _ in rows]
    assert metrics["auc.validation_covers_success"]["value"] == pytest.approx(
        brute_force(proves_success, vcs_scores)
    )
    assert metrics["auc.validation_covers_success"]["value"] == 0.5


def test_contract_auc_uses_the_same_tie_credit():
    yes = {"dispatchable": "yes", "validation_proves_success": "yes"}
    no = {"dispatchable": "no", "validation_proves_success": "no"}
    samples = [
        _contract_sample(0, yes, 0.5, 0.5, 0.5, 0.5),
        _contract_sample(1, no, 0.5, 0.5, 0.5, 0.5),
    ]
    _, metrics = contract_quality_evaluate(samples)
    # one tied positive/negative pair: (0 + 0.5 * 1) / (1 * 1)
    assert metrics["auc.executable"]["value"] == 0.5
    # the no-tie-credit variant would be 0.0
    assert metrics["auc.executable"]["value"] != 0.0


# --- fixed-width ECE --------------------------------------------------------


def test_ece_uses_fixed_width_bins_not_equal_mass_bins():
    rows = [(0.11, 0), (0.12, 0), (0.13, 0), (0.91, 1)]
    samples = [
        _dupe_sample(i, y, p, p, {"same_work": p}) for i, (p, y) in enumerate(rows)
    ]
    _, metrics = board_duplicates_evaluate(samples)

    # fixed width: min(int(p * 10), 9) puts the first three in bin 1, the last in bin 9
    fixed = (3 * abs((0.11 + 0.12 + 0.13) / 3 - 0.0) + 1 * abs(0.91 - 1.0)) / 4
    # equal mass with 2 bins of 2: [0.11, 0.12] and [0.13, 0.91]
    equal_mass = (
        2 * abs((0.11 + 0.12) / 2 - 0.0) + 2 * abs((0.13 + 0.91) / 2 - 0.5)
    ) / 4

    assert fixed == pytest.approx(0.1125)
    assert equal_mass == pytest.approx(0.0675)
    assert fixed != equal_mass
    assert metrics["ece.jev_noul"]["value"] == fixed


def test_ece_divides_by_sample_count_not_by_bin_count():
    """The divisor is n, not the number of non-empty bins.

    Dividing by the bin count is what most calibration write-ups do, so it is
    the likeliest substitution. This fixture has 7 samples in 5 non-empty bins,
    which separates all three candidate divisors; every number below is
    computed here, not read from the implementation.
    """
    rows = [(0.22, 1), (0.29, 0), (0.40, 0), (0.49, 1), (0.61, 1), (0.73, 1), (0.91, 0)]
    samples = [
        _dupe_sample(i, y, p, p, {"same_work": p}) for i, (p, y) in enumerate(rows)
    ]
    _, metrics = board_duplicates_evaluate(samples)

    bins = [[(p, y) for p, y in rows if min(int(p * 10), 9) == k] for k in range(10)]
    nonempty = [b for b in bins if b]
    gaps = [
        (len(b), abs(sum(x for x, _ in b) / len(b) - sum(t for _, t in b) / len(b)))
        for b in nonempty
    ]
    assert len(rows) == 7 and len(nonempty) == 5

    by_n = sum(n * g for n, g in gaps) / len(rows)
    by_bin_count = sum(n * g for n, g in gaps) / len(nonempty)
    unweighted_mean = sum(g for _, g in gaps) / len(nonempty)

    assert by_n == pytest.approx(0.31)
    assert by_bin_count == pytest.approx(0.434)
    assert unweighted_mean == pytest.approx(0.374)
    assert metrics["ece.jev_noul"]["value"] == pytest.approx(by_n)
    assert metrics["ece.jev_noul"]["value"] != pytest.approx(by_bin_count)
    assert metrics["ece.jev_noul"]["value"] != pytest.approx(unweighted_mean)


def test_ece_clamps_the_top_bin_so_p_equals_one_is_not_dropped():
    """``min(int(p * 10), 9)`` is a clamp, not a rounding detail.

    Ten bins indexed by a bare ``int(p * 10)`` send p = 1.0 to index 10, which
    no bin covers, so the sample is silently dropped from every bin while the
    divisor still counts it. The fixture is chosen so that dropping it changes
    the value: a fixture where the top bin's weighted gap happens to survive
    the drop would pass for both implementations and pin nothing.
    """
    rows = [(0.05, 1), (0.5, 0), (1.0, 0)]
    samples = [
        _dupe_sample(i, y, p, p, {"same_work": p}) for i, (p, y) in enumerate(rows)
    ]
    _, metrics = board_duplicates_evaluate(samples)

    assert min(int(1.0 * 10), 9) == 9
    assert int(1.0 * 10) == 10  # the unclamped index has no bin

    def ece(clamp: bool) -> float:
        index = (lambda p: min(int(p * 10), 9)) if clamp else (lambda p: int(p * 10))
        bins = [[(p, y) for p, y in rows if index(p) == k] for k in range(10)]
        return sum(
            len(b) * abs(sum(p for p, _ in b) / len(b) - sum(y for _, y in b) / len(b))
            for b in bins
            if b
        ) / len(rows)

    clamped, dropped = ece(True), ece(False)
    assert clamped == pytest.approx(0.8166666666666668)
    assert dropped == pytest.approx(0.48333333333333334)
    assert abs(clamped - dropped) > 0.3, "the fixture must separate the two"
    assert metrics["ece.jev_noul"]["value"] == pytest.approx(clamped)
    assert metrics["ece.jev_noul"]["n"] == 3


# --- precision guard --------------------------------------------------------


def test_precision_with_no_predicted_positives_is_zero_via_the_max_guard():
    samples = [
        _dupe_sample(0, 1, 0.4, 0.49, {"same_work": 0.49}),
        _dupe_sample(1, 0, 0.3, 0.20, {"same_work": 0.20}),
    ]
    _, metrics = board_duplicates_evaluate(samples)

    pairs = [(0.49, 1), (0.20, 0)]
    tp = sum(p >= 0.5 and y for p, y in pairs)
    fp = sum(p >= 0.5 and not y for p, y in pairs)
    assert (tp, fp) == (0, 0)
    assert metrics["precision.jev_noul"]["value"] == 0.0
    assert metrics["recall.jev_noul"]["value"] == 0.0
    # the textbook tp / (tp + fp) raises; the max(1, ...) guard does not
    with pytest.raises(ZeroDivisionError):
        _ = tp / (tp + fp)


# --- index-based order statistics -------------------------------------------


def _linear_percentile(values: list[float], percent: float) -> float:
    """The tidy alternative: numpy's default linear interpolation."""
    rank = percent / 100 * (len(values) - 1)
    low = int(rank)
    high = min(low + 1, len(values) - 1)
    return values[low] + (rank - low) * (values[high] - values[low])


def test_order_statistics_are_index_based_not_interpolated():
    values = [0.1, 0.2, 0.3, 0.4]
    labels = [
        {"dispatchable": "yes", "validation_proves_success": "yes"},
        {"dispatchable": "no", "validation_proves_success": "no"},
        {"dispatchable": "yes", "validation_proves_success": "no"},
        {"dispatchable": "no", "validation_proves_success": "yes"},
    ]
    samples = [
        _contract_sample(i, labels[i], v, 0.1, 0.6, 0.05) for i, v in enumerate(values)
    ]
    _, metrics = contract_quality_evaluate(samples)

    ordered = sorted(values)
    index_based = (ordered[4 // 10], ordered[4 // 2], ordered[9 * 4 // 10])
    interpolated = tuple(_linear_percentile(ordered, p) for p in (10, 50, 90))

    assert index_based == (0.1, 0.3, 0.4)
    assert interpolated == pytest.approx((0.13, 0.25, 0.37))
    assert metrics["p10.executable"]["value"] == index_based[0]
    assert metrics["median.executable"]["value"] == index_based[1] == 0.3
    assert metrics["p90.executable"]["value"] == index_based[2]
    assert index_based != interpolated


@pytest.mark.parametrize("count", [4, 7, 10, 18, 23])
def test_order_statistic_indices_are_pinned_across_several_lengths(count):
    """Pin the index arithmetic itself, not one fixture's numbers.

    A percentile is a family, not a single alternative: linear interpolation,
    nearest-rank ``round(q * (n - 1))`` and ceil-rank ``ceil(q * n) - 1`` are
    all defensible, and no single length separates the original from all of
    them. Nearest-rank agrees with the original at n = 4 and n = 23, which is
    exactly why a single hand-picked fixture pins nothing.

    Using value == index makes the assertion a statement about the index:
    ``p10`` must be ``values[n // 10]``, so any variant that selects a
    different element fails, and interpolation fails additionally because it
    returns a value that is not a member of the input at all.
    """
    values = [float(i) for i in range(count)]
    labels = [
        {
            "dispatchable": "yes" if i % 2 else "no",
            "validation_proves_success": "yes" if i % 3 else "no",
        }
        for i in range(count)
    ]
    samples = [
        _contract_sample(i, labels[i], v, 0.1, 0.6, 0.05) for i, v in enumerate(values)
    ]
    _, metrics = contract_quality_evaluate(samples)

    expected = (values[count // 10], values[count // 2], values[9 * count // 10])
    assert (
        metrics["p10.executable"]["value"],
        metrics["median.executable"]["value"],
        metrics["p90.executable"]["value"],
    ) == expected

    # Every reported statistic is an element of the input, never between two.
    for key in ("p10.executable", "median.executable", "p90.executable"):
        assert metrics[key]["value"] in values


# --- policy -----------------------------------------------------------------


def test_policy_applies_the_half_stale_factor_only_when_symbols_are_missing():
    yes = {"dispatchable": "yes", "validation_proves_success": "yes"}
    stale = _contract_sample(0, yes, 0.8, 0.25, 0.6, 0.2, missing=("gone",))
    fresh = _contract_sample(1, yes, 0.8, 0.25, 0.6, 0.2)

    hand_computed = 0.8 * (1 - 0.25) * (1 - 0.2)
    assert policy(fresh) == pytest.approx(hand_computed)
    assert policy(stale) == pytest.approx(hand_computed * 0.5)
    assert policy(fresh) == pytest.approx(0.48)
    assert policy(stale) == pytest.approx(0.24)

    # the evaluator's policy AUC is the tie-credit AUC over policy()
    negative = _contract_sample(
        2,
        {"dispatchable": "no", "validation_proves_success": "no"},
        0.8,
        0.25,
        0.6,
        0.2,
        missing=("gone",),
    )
    _, metrics = contract_quality_evaluate([fresh, negative])
    pos = [policy(fresh)]
    neg = [policy(negative)]
    expected = sum((p > q) + 0.5 * (p == q) for p in pos for q in neg) / (
        len(pos) * len(neg)
    )
    assert expected == 1.0  # 0.48 > 0.24
    assert metrics["auc.policy"]["value"] == pytest.approx(expected)


# --- jev_choice -------------------------------------------------------------


def test_jev_choice_sums_both_keys_and_a_missing_key_contributes_zero():
    assert jev_choice({"same_work": 0.25, "one_covers_other": 0.5}) == 0.75
    assert jev_choice({"same_work": 0.25}) == 0.25
    assert jev_choice({"one_covers_other": 0.5}) == 0.5
    assert jev_choice({}) == 0.0

    samples = [
        _dupe_sample(0, 1, 0.9, 0.0, {"same_work": 1.0, "one_covers_other": 0.0}),
        _dupe_sample(1, 0, 0.1, 0.0, {"one_covers_other": 0.0}),
    ]
    _, metrics = board_duplicates_evaluate(samples)
    # choice scores are [1.0, 0.0]; a KeyError on the missing "same_work" would fail here
    assert metrics["auc.jev_choice"]["value"] == 1.0


# --- execution_mode agreement ----------------------------------------------


def test_execution_mode_agreement_divides_by_labels_carrying_a_mode():
    with_mode = {
        "dispatchable": "yes",
        "validation_proves_success": "yes",
        "execution_mode": "repo_only",
    }
    without_mode_1 = {"dispatchable": "no", "validation_proves_success": "no"}
    without_mode_2 = {"dispatchable": "yes", "validation_proves_success": "no"}
    samples = [
        _contract_sample(0, with_mode, 0.9, 0.1, 0.8, 0.0, execution_mode="repo_only"),
        _contract_sample(
            1, without_mode_1, 0.2, 0.6, 0.3, 0.4, execution_mode="repo_only"
        ),
        _contract_sample(
            2, without_mode_2, 0.5, 0.3, 0.5, 0.2, execution_mode="live_environment"
        ),
    ]
    _, metrics = contract_quality_evaluate(samples)

    matched = sum(
        s["output"]["execution_mode"] == s["input"]["label"].get("execution_mode")
        for s in samples
    )
    labeled = [s for s in samples if s["input"]["label"].get("execution_mode")]
    assert (matched, len(labeled), len(samples)) == (1, 1, 3)
    assert metrics["execution_mode_agreement"]["value"] == matched / len(labeled) == 1.0
    # the joined-row denominator would be 1/3, the original divides by 1
    assert metrics["execution_mode_agreement"]["value"] != matched / len(samples)
    assert matched / len(samples) == pytest.approx(1 / 3)


# --- non-ok exclusion (importer's skipped Samples) --------------------------


def test_board_duplicates_excludes_non_ok_samples_from_every_metric():
    ok = [
        _dupe_sample(0, 1, 0.9, 0.8, {"same_work": 0.7, "one_covers_other": 0.1}),
        _dupe_sample(1, 0, 0.1, 0.2, {"same_work": 0.2}),
        _dupe_sample(2, 1, 0.8, 0.7, {"same_work": 0.6}, kind="other"),
        _dupe_sample(3, 0, 0.2, 0.1, {"same_work": 0.1}, kind="other"),
    ]
    skipped = _dupe_sample(4, 0, 0.99, None, status="skipped")
    _, ok_metrics = board_duplicates_evaluate(ok)
    _, all_metrics = board_duplicates_evaluate([*ok, skipped])

    assert all_metrics == ok_metrics
    assert ok_metrics["auc.baseline"]["n"] == 4


# --- empty class ------------------------------------------------------------


def test_empty_class_auc_nan_for_contract_and_division_by_zero_for_duplicates():
    label_yes = {"dispatchable": "yes", "validation_proves_success": "yes"}
    contract = [_contract_sample(i, label_yes, 0.9, 0.1, 0.8, 0.0) for i in range(3)]
    _, metrics = contract_quality_evaluate(contract)
    assert math.isnan(metrics["auc.executable"]["value"])

    # dupes.py has no guard: no negatives -> len(pos) * len(neg) == 0
    duplicates = [_dupe_sample(i, 1, 0.9, 0.8, {"same_work": 0.7}) for i in range(3)]
    with pytest.raises(ZeroDivisionError):
        board_duplicates_evaluate(duplicates)


# --- full precision ---------------------------------------------------------


def test_brier_recall_and_kind_means_keep_full_precision():
    rows = [
        (1, 0.75, "same"),
        (0, 0.25, "same"),
        (1, 0.5, "other"),
        (0, 0.125, "other"),
    ]
    samples = [
        _dupe_sample(i, y, 0.3, p, {"same_work": p}, kind=kind)
        for i, (y, p, kind) in enumerate(rows)
    ]
    _, metrics = board_duplicates_evaluate(samples)

    labels = [y for y, _, _ in rows]
    probs = [p for _, p, _ in rows]
    brier = sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(labels)
    assert brier == 0.09765625
    assert metrics["brier.jev_noul"]["value"] == brier

    tp = sum(p >= 0.5 and y for p, y in zip(probs, labels))
    assert (tp, sum(labels)) == (2, 2)
    assert metrics["recall.jev_noul"]["value"] == 1.0

    assert metrics["mean_p_redundant.same"]["value"] == (0.75 + 0.25) / 2
    assert metrics["mean_p_redundant.other"]["value"] == (0.5 + 0.125) / 2


# --- unlabelled rows --------------------------------------------------------


def test_contract_order_statistics_include_unlabelled_rows_but_aucs_do_not():
    samples = [
        _contract_sample(
            0,
            {"dispatchable": "yes", "validation_proves_success": "yes"},
            0.9,
            0.1,
            0.8,
            0.0,
        ),
        _contract_sample(1, None, 0.1, 0.9, 0.2, 0.8),
    ]
    _, metrics = contract_quality_evaluate(samples)
    assert metrics["p10.executable"]["n"] == 2
    assert metrics["p10.executable"]["value"] == 0.1
    assert metrics["p90.executable"]["value"] == 0.9
    assert metrics["auc.executable"]["n"] == 1


# --- assessment-set path ----------------------------------------------------


def _evaluator_definition(definition_id: str) -> dict:
    payload = {
        "id": definition_id,
        "version": "v1",
        "kind": "deterministic",
        "config": {},
        "code_revision": "specialists-a6e55215",
    }
    return {**payload, "content_hash": compute_content_hash(payload)}


def test_parity_evaluators_write_assessment_sets_visible_to_run_metrics(
    registry, runs_root
):
    cases = {
        "board-duplicates-v1": [
            _dupe_sample(0, 1, 0.9, 0.8, {"same_work": 0.7, "one_covers_other": 0.1}),
            _dupe_sample(1, 0, 0.1, 0.2, {"same_work": 0.2}),
            _dupe_sample(2, 1, 0.8, 0.7, {"same_work": 0.6}, kind="other"),
            _dupe_sample(3, 0, 0.2, 0.1, {"same_work": 0.1}, kind="other"),
        ],
        "contract-quality-v3": [
            _contract_sample(
                0,
                {"dispatchable": "yes", "validation_proves_success": "yes"},
                0.9,
                0.1,
                0.8,
                0.0,
            ),
            _contract_sample(
                1,
                {"dispatchable": "no", "validation_proves_success": "no"},
                0.2,
                0.6,
                0.3,
                0.4,
            ),
            _contract_sample(
                2,
                {"dispatchable": "yes", "validation_proves_success": "no"},
                0.6,
                0.2,
                0.5,
                0.1,
            ),
        ],
    }
    for evaluator_id, samples in cases.items():
        run_id = f"run-{evaluator_id}"
        handle = start_run(runs_root, run_id, make_manifest(registry, run_id=run_id))
        for sample in samples:
            handle.write_sample(sample)
        handle.finish("success")

        assessments, metrics = PARITY_EVALUATORS[evaluator_id](samples)
        assert assessments == []
        evaluator = _evaluator_definition(evaluator_id)
        write_assessment_set(
            runs_root,
            run_id,
            "as-parity",
            evaluator,
            assessments,
            metrics,
            now=FIXED_NOW,
        )

        stored = list_assessment_sets(runs_root, run_id)[0]
        validate("assessment_set", stored)
        assert stored["metrics"]
        for metric in stored["metrics"].values():
            assert metric["method"]
            assert metric["se"] is None
            assert metric["ci95"] is None

        merged = run_metrics(runs_root, run_id)
        assert set(merged) == {f"{evaluator_id}::{name}" for name in metrics}
