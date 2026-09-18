"""Seeded stratified sampler (XTRM-478).

No real data is touched: every population here is constructed in the test.
"""

from __future__ import annotations

import pytest

from xtrm_research.sampling import (
    PopulationItem,
    assign_quartiles,
    stratified_sample,
)

STRATA = ("alpha", "beta", "gamma", "delta")


def _population(strata=STRATA, per_stratum=40):
    return [
        PopulationItem(f"{stratum}-{index:02d}", stratum, float(index))
        for stratum in strata
        for index in range(per_stratum)
    ]


def test_same_seed_regenerates_identical_sample():
    population = _population()
    first = stratified_sample(population, 40, seed=7)
    second = stratified_sample(population, 40, seed=7)
    assert first.ids == second.ids
    # Regenerating from the returned seed alone reproduces the sample.
    third = stratified_sample(population, 40, seed=first.seed)
    assert third.ids == first.ids


def test_different_seed_gives_different_sample():
    population = _population()
    first = stratified_sample(population, 40, seed=7)
    other = stratified_sample(population, 40, seed=8)
    assert first.ids != other.ids
    assert set(first.ids) != set(other.ids)


def test_sample_spreads_across_score_quartiles_and_strata():
    population = _population()
    sample = stratified_sample(population, 40, seed=7)
    quartiles = assign_quartiles([item.score for item in population])
    by_id = {
        item.item_id: (item.stratum, quartile)
        for item, quartile in zip(population, quartiles)
    }
    assert {by_id[item_id][0] for item_id in sample.ids} == set(STRATA)
    assert {by_id[item_id][1] for item_id in sample.ids} == {0, 1, 2, 3}


def test_quartile_assignment_is_rank_based_and_equal_count():
    quartiles = assign_quartiles([0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])
    assert quartiles == [0, 0, 1, 1, 2, 2, 3, 3]


def test_small_stratum_is_represented_when_target_allows():
    population = [
        PopulationItem(f"big-{index}", "big", float(index)) for index in range(100)
    ] + [PopulationItem(f"small-{index}", "small", float(index)) for index in range(4)]
    sample = stratified_sample(population, 20, seed=1)
    assert len(sample.items) == 20
    assert any(item_id.startswith("small") for item_id in sample.ids)


def test_target_of_zero_returns_empty_sample():
    sample = stratified_sample(_population(), 0, seed=3)
    assert sample.items == ()
    assert sample.seed == 3


def test_target_larger_than_population_is_rejected():
    with pytest.raises(ValueError, match="exceeds population"):
        stratified_sample(_population(), 1000, seed=1)


def test_duplicate_item_ids_are_rejected():
    population = [PopulationItem("x", "a", 1.0), PopulationItem("x", "b", 2.0)]
    with pytest.raises(ValueError, match="duplicate item_id"):
        stratified_sample(population, 1, seed=1)
