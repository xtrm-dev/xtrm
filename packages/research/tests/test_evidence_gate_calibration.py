"""Evidence Gate calibration, thresholds and interval helpers (XTRM-498)."""

from __future__ import annotations

import math
import random

import pytest

from xtrm_research.evidence_gate import calibration as c
from xtrm_research.evidence_gate import stats


def test_brier_ece_auc_on_hand_computed_cases():
    assert c.brier([0.9, 0.2], [1, 0]) == pytest.approx((0.01 + 0.04) / 2)
    # two equal-mass bins: {0.2 (y=0), 0.4 (y=1)} and {0.6 (y=0), 0.8 (y=1)}:
    # |0.3 - 0.5| * 0.5 + |0.7 - 0.5| * 0.5 = 0.2
    assert c.ece([0.2, 0.4, 0.6, 0.8], [0, 1, 0, 1], bins=2) == pytest.approx(0.2)
    # pairs (pos, neg): (0.4 vs 0.2) win, (0.4 vs 0.6) lose, (0.8 vs *) win x2 -> 3/4
    assert c.auc([0.2, 0.4, 0.6, 0.8], [0, 1, 0, 1]) == pytest.approx(0.75)
    assert c.auc([0.5, 0.5], [0, 1]) == pytest.approx(0.5)
    assert c.auc([0.1, 0.2], [1, 1]) is None


def test_platt_recovers_generating_parameters():
    rng = random.Random(1)
    xs, ys = [], []
    for _ in range(4000):
        x = rng.uniform(-4, 4)
        xs.append(x)
        ys.append(1 if rng.random() < c.sigmoid(1.5 * x - 0.5) else 0)
    a, b = c.fit_platt(xs, ys)
    assert a == pytest.approx(1.5, abs=0.15) and b == pytest.approx(-0.5, abs=0.15)
    assert c.fit_platt([0.1, 0.2], [1, 1]) is None


def test_isotonic_is_monotone_and_pools_violators():
    steps = c.fit_isotonic([1, 2, 3, 4], [0, 1, 0, 1])
    values = [v for _, v in steps]
    assert values == sorted(values)
    assert c.apply_isotonic(steps, 2.5) == pytest.approx(0.5)


def test_out_of_fold_never_sees_the_label_it_predicts():
    rng = random.Random(2)
    xs = [rng.uniform(-3, 3) for _ in range(200)]
    ys = [1 if rng.random() < c.sigmoid(x) else 0 for x in xs]
    folds = [i % 5 for i in range(200)]
    before, _ = c.out_of_fold(xs, ys, folds)
    flipped = [1 - y if f == 0 else y for y, f in zip(ys, folds)]
    after, _ = c.out_of_fold(xs, flipped, folds)
    held = [i for i, f in enumerate(folds) if f == 0]
    others = [i for i, f in enumerate(folds) if f != 0]
    assert all(before[i] == after[i] for i in held)
    assert any(before[i] != after[i] for i in others)


def test_recall_threshold_meets_target_on_training_data():
    ps = [0.9, 0.8, 0.7, 0.6, 0.1, 0.05]
    ys = [1, 1, 0, 1, 1, 0]
    t = c.recall_threshold(ps, ys, target=0.75)
    assert t == 0.6
    recall = sum(1 for p, y in zip(ps, ys) if y and p >= t) / sum(ys)
    assert recall >= 0.75
    assert c.recall_threshold([0.3], [0]) is None


def test_fold_assignment_keeps_clusters_whole_and_is_seeded():
    keys = [f"c{i}" for i in range(23)]
    a = c.fold_of_clusters(keys)
    assert set(a) == set(keys) and set(a.values()) == set(range(5))
    assert a == c.fold_of_clusters(list(reversed(keys)))
    assert a != c.fold_of_clusters(keys, seed=1)


def test_wilson_matches_closed_form():
    lo, hi = stats.wilson(25, 40)
    # XTRM-488 records 25/40 -> [0.4703, 0.7578]
    assert lo == pytest.approx(0.4703, abs=1e-4) and hi == pytest.approx(
        0.7578, abs=1e-4
    )
    assert stats.wilson(0, 0) is None


def test_interval_refuses_when_too_many_resamples_are_undefined():
    good = stats.interval(0.5, [0.4, 0.5, 0.6] * 100, 10)
    assert good["ci95"] == [0.4, 0.6]
    bad = stats.interval(0.5, [None] * 10 + [0.5] * 90, 10)
    assert bad["ci95"] is None and "10 of 100" in bad["null_reason"]
    assert stats.interval(None, [0.1], 3)["ci95"] is None


def test_resamples_are_seeded_cluster_indices():
    r1 = stats.resample_indices(7, n_resamples=3, seed=5)
    assert r1 == stats.resample_indices(7, n_resamples=3, seed=5)
    assert all(len(r) == 7 and all(0 <= k < 7 for k in r) for r in r1)
    assert not math.isnan(sum(sum(r) for r in r1))
