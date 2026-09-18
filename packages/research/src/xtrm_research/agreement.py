"""Inter-labeler agreement statistics for nominal labels (XTRM-478).

A label matrix is a sequence of items (rows); each row is a sequence of
labels, one per labeler in a fixed labeler order. A label is any nominal
value (string, int, bool) and ``None`` marks a labeler who did not label
that item. Missing labels are handled, not dropped: Krippendorff's alpha is
computed over every pairable value, so an item rated by two of three
labelers still contributes.

Plain Python only — ``collections`` and ``itertools`` from the stdlib. The
package deliberately carries no numpy/scipy/pandas dependency.

The tests check these functions against external published worked examples,
never against the implementation's own output:

* Percent agreement and Cohen's kappa: the standard 50-item, two-rater
  example with the 2x2 table ``[[20, 5], [10, 15]]`` gives
  ``P_o = 35/50 = 0.70`` and ``kappa = 0.40`` — the worked example in
  Wikipedia, "Cohen's kappa", and the coefficient from Cohen, J. (1960),
  "A coefficient of agreement for nominal scales", Educational and
  Psychological Measurement 20(1), 37-46.
* Krippendorff's alpha (nominal): the 12-unit, 4-coder example in
  Krippendorff, K. (2011), "Computing Krippendorff's Alpha-Reliability",
  reports ``alpha_nominal = 0.743`` (the same example and value appear in
  the README of the ``krippendorff`` package). This module computes
  0.74342105... for it.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import permutations
from typing import Any

from xtrm_research.sampling import assign_quartiles

__all__ = [
    "LengthQuartileRate",
    "cohens_kappa",
    "dispatchable_rate_by_length_quartile",
    "krippendorff_alpha_nominal",
    "percent_agreement",
]

Matrix = Sequence[Sequence[Any]]


def _present(row: Sequence[Any]) -> list[Any]:
    return [value for value in row if value is not None]


def percent_agreement(matrix: Matrix) -> float:
    """Fraction of pairable items on which every present label agrees.

    An item is pairable when at least two labelers labelled it. For the
    two-labeler case this is Cohen's observed agreement ``P_o``.
    """
    pairable = 0
    agreeing = 0
    for row in matrix:
        values = _present(row)
        if len(values) < 2:
            continue
        pairable += 1
        if all(value == values[0] for value in values):
            agreeing += 1
    if pairable == 0:
        raise ValueError("percent_agreement: no item has two or more labels")
    return agreeing / pairable


def cohens_kappa(matrix: Matrix) -> float:
    """Cohen's kappa for a two-labeler matrix.

    Every row must have exactly two columns (labeler A, labeler B). Items
    with a missing label on either side are excluded, which is the standard
    definition for a two-rater coefficient.
    """
    rows = [list(row) for row in matrix]
    if any(len(row) != 2 for row in rows):
        raise ValueError("cohens_kappa: exactly two labelers are required")
    both = [(a, b) for a, b in rows if a is not None and b is not None]
    if not both:
        raise ValueError("cohens_kappa: no item has labels from both labelers")

    n = len(both)
    observed = sum(1 for a, b in both if a == b) / n
    margin_a = Counter(a for a, _ in both)
    margin_b = Counter(b for _, b in both)
    categories = set(margin_a) | set(margin_b)
    expected = sum((margin_a[c] / n) * (margin_b[c] / n) for c in categories)
    if expected == 1.0:
        return 1.0
    return (observed - expected) / (1.0 - expected)


def krippendorff_alpha_nominal(matrix: Matrix) -> float:
    """Krippendorff's alpha for nominal data, missing labels included.

    Uses Krippendorff's coincidence matrix: each item with ``m`` present
    labels contributes each ordered pair of its values with weight
    ``1 / (m - 1)``, so a partially labelled item contributes the labels it
    does have instead of being discarded. ``alpha = 1 - D_o / D_e``.
    """
    coincidences: Counter[tuple[Any, Any]] = Counter()
    for row in matrix:
        values = _present(row)
        if len(values) < 2:
            continue
        weight = 1.0 / (len(values) - 1)
        for first, second in permutations(values, 2):
            coincidences[(first, second)] += weight

    total = sum(coincidences.values())
    if total < 2:
        raise ValueError("krippendorff_alpha_nominal: no pairable data")

    marginals: Counter[Any] = Counter()
    for (first, _second), count in coincidences.items():
        marginals[first] += count

    observed_disagreement = (
        sum(count for (first, second), count in coincidences.items() if first != second)
        / total
    )
    expected_disagreement = sum(
        first_count * second_count
        for first, first_count in marginals.items()
        for second, second_count in marginals.items()
        if first != second
    ) / (total * (total - 1))
    if expected_disagreement == 0.0:
        return 1.0
    return 1.0 - observed_disagreement / expected_disagreement


@dataclass(frozen=True)
class LengthQuartileRate:
    """The dispatchable rate among labelled items in one length quartile."""

    quartile: int
    items: int
    labelled: int
    dispatchable: int
    rate: float


def _dispatchable(value: Any) -> bool | None:
    if value is None:
        return None
    if value is True or value == "yes":
        return True
    if value is False or value == "no":
        return False
    raise ValueError(f"not a dispatchable label: {value!r}")


def dispatchable_rate_by_length_quartile(
    labels: Sequence[Any],
    lengths: Sequence[float],
) -> tuple[LengthQuartileRate, ...]:
    """Report the dispatchable rate per item-length quartile.

    ``labels`` and ``lengths`` are item-aligned; a label is ``True``/``"yes"``,
    ``False``/``"no"`` or ``None`` (not labelled). Lengths are split into
    equal-count quartiles 1..4 (shortest first), and each quartile reports
    the fraction of labelled items that are dispatchable. This makes a
    verbosity bias visible instead of assuming it absent.
    """
    labels = list(labels)
    lengths = list(lengths)
    if len(labels) != len(lengths):
        raise ValueError(
            f"labels and lengths differ in size: {len(labels)} != {len(lengths)}"
        )
    if not lengths:
        return ()

    buckets: dict[int, list[int]] = {}
    for quartile, label in zip(assign_quartiles(lengths), labels):
        bucket = buckets.setdefault(quartile, [0, 0, 0])
        bucket[0] += 1
        dispatchable = _dispatchable(label)
        if dispatchable is not None:
            bucket[1] += 1
            if dispatchable:
                bucket[2] += 1

    report = []
    for quartile in sorted(buckets):
        items, labelled, dispatchable = buckets[quartile]
        rate = dispatchable / labelled if labelled else 0.0
        report.append(
            LengthQuartileRate(quartile + 1, items, labelled, dispatchable, rate)
        )
    return tuple(report)
