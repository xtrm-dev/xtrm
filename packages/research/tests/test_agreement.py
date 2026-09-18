"""Agreement statistics checked against external published worked examples.

The expected values are quoted from the sources below, never taken from
this implementation's own output:

* Percent agreement and Cohen's kappa: the standard 50-item, two-rater
  example with the 2x2 table ``[[20, 5], [10, 15]]`` gives
  ``P_o = 35/50 = 0.70`` and ``kappa = 0.40``. This table and both values
  appear in the worked example of Wikipedia, "Cohen's kappa"; the
  coefficient itself is from Cohen, J. (1960), "A coefficient of agreement
  for nominal scales", Educational and Psychological Measurement 20(1),
  37-46.
* Krippendorff's alpha (nominal): the 12-unit, 4-coder example in
  Krippendorff, K. (2011), "Computing Krippendorff's Alpha-Reliability",
  reports ``alpha_nominal = 0.743``. This implementation computes
  0.74342105..., so the published value is matched within 1e-3.
"""

from __future__ import annotations

import random

import pytest

from xtrm_research.agreement import (
    cohens_kappa,
    dispatchable_rate_by_length_quartile,
    krippendorff_alpha_nominal,
    percent_agreement,
)

#: Published 50-item two-rater table: [[20, 5], [10, 15]].
COHEN_MATRIX = (
    [("yes", "yes")] * 20
    + [("yes", "no")] * 5
    + [("no", "yes")] * 10
    + [("no", "no")] * 15
)

#: Krippendorff (2011) 12-unit, 4-coder example, units as rows.
CANONICAL_ALPHA_MATRIX = [
    [1, 1, None, 1],
    [2, 2, 3, 2],
    [3, 3, 3, 3],
    [3, 3, 3, 3],
    [2, 2, 2, 2],
    [1, 2, 3, 4],
    [4, 4, 4, 4],
    [1, 1, 2, 1],
    [2, 2, 2, 2],
    [None, 5, 5, 5],
    [None, None, 1, 1],
    [None, 3, None, None],
]


def test_percent_agreement_matches_published_example():
    # Wikipedia "Cohen's kappa" worked example: P_o = 35/50 = 0.70.
    assert percent_agreement(COHEN_MATRIX) == pytest.approx(0.70, abs=1e-9)


def test_cohens_kappa_matches_published_example():
    # Same example: kappa = (0.70 - 0.50) / (1 - 0.50) = 0.40.
    assert cohens_kappa(COHEN_MATRIX) == pytest.approx(0.40, abs=1e-3)


def test_cohens_kappa_is_one_on_perfect_agreement():
    assert cohens_kappa([("a", "a"), ("b", "b"), ("a", "a")]) == 1.0


def test_cohens_kappa_requires_exactly_two_labelers():
    with pytest.raises(ValueError, match="two labelers"):
        cohens_kappa([("a", "a", "a")])


def test_percent_agreement_ignores_items_with_one_label():
    matrix = [("a", "a"), ("b", None), ("c", "c")]
    # Only the two double-labelled items are pairable, and both agree.
    assert percent_agreement(matrix) == 1.0


def test_krippendorff_alpha_matches_published_example():
    # Krippendorff (2011): alpha_nominal = 0.743 for this example.
    assert krippendorff_alpha_nominal(CANONICAL_ALPHA_MATRIX) == pytest.approx(
        0.743, abs=1e-3
    )


def test_krippendorff_alpha_is_one_on_perfect_agreement():
    assert krippendorff_alpha_nominal([("a", "a"), ("b", "b"), ("c", "c")]) == 1.0


def test_krippendorff_alpha_is_near_zero_at_chance_agreement():
    # Two labelers drawing independently from the same binary distribution
    # have expected alpha 0; with a fixed sample this lands within 0.05.
    rng = random.Random(20260917)
    options = ["yes", "no"]
    chance = [[rng.choice(options), rng.choice(options)] for _ in range(2000)]
    assert abs(krippendorff_alpha_nominal(chance)) < 0.05


def test_krippendorff_alpha_uses_partially_labelled_items_not_drops_them():
    # Two three-labeler items are missing one label each. Dropping every
    # incomplete item (the naive choice) gives a different alpha than
    # Krippendorff's coincidence method, so the difference pins the rule.
    with_missing = [
        ["a", "a", "a"],
        ["a", "a", "b"],
        ["a", "a", None],
        ["b", "b", "b"],
        ["a", "b", "b"],
        ["b", "b", None],
        ["a", "a", "a"],
    ]
    complete_only = [row for row in with_missing if None not in row]
    assert (
        abs(
            krippendorff_alpha_nominal(with_missing)
            - krippendorff_alpha_nominal(complete_only)
        )
        > 1e-9
    )


def test_krippendorff_alpha_rejects_data_with_no_pairable_item():
    with pytest.raises(ValueError, match="no pairable data"):
        krippendorff_alpha_nominal([("a", None), (None, "b")])


def test_dispatchable_rate_by_length_quartile_reports_each_quartile():
    lengths = list(range(1, 41))
    # Rates per length quartile: 1.0, 0.5, 0.2, 0.0. If the quartile
    # assignment were wrong (reversed, or threshold-based on the wrong
    # boundary) these distinct rates would not line up.
    labels = (
        [True] * 10 + [True] * 5 + [False] * 5 + [True] * 2 + [False] * 8 + [False] * 10
    )
    report = dispatchable_rate_by_length_quartile(labels, lengths)
    assert [entry.quartile for entry in report] == [1, 2, 3, 4]
    assert [entry.rate for entry in report] == pytest.approx([1.0, 0.5, 0.2, 0.0])
    assert [entry.labelled for entry in report] == [10, 10, 10, 10]


def test_dispatchable_rate_quartile_treats_missing_labels_as_unlabelled():
    lengths = [1, 2, 3, 4, 5, 6, 7, 8]
    labels = ["yes", "no", None, "no", None, "no", None, "no"]
    report = dispatchable_rate_by_length_quartile(labels, lengths)
    assert [entry.labelled for entry in report] == [2, 1, 1, 1]
    assert [entry.rate for entry in report] == pytest.approx([0.5, 0.0, 0.0, 0.0])


def test_dispatchable_rate_rejects_misaligned_inputs():
    with pytest.raises(ValueError, match="differ in size"):
        dispatchable_rate_by_length_quartile([True], [1, 2])
