"""Seeded, reproducible stratified sampling (XTRM-478).

Given a population of items that each carry a stratum key and a score, the
sampler draws a target-size sample spread across the population's score
quartiles and across strata, and returns the seed it used alongside the
sample. The sample is a pure function of ``(population, target_size, seed)``:
re-running with the same seed regenerates the identical sample, and no
Python RNG state is read or written — selection is a keyed hash of the seed
and item id, so reproducibility does not depend on the ``random`` module's
internals across Python versions.

The campaign that consumes this is coordinator-run and reads confidential
data offline; this module never opens a data file. Tests build synthetic
populations.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

__all__ = [
    "PopulationItem",
    "StratifiedSample",
    "assign_quartiles",
    "stratified_sample",
]


@dataclass(frozen=True)
class PopulationItem:
    """One candidate in the population: an id, a stratum key and a score."""

    item_id: str
    stratum: str
    score: float


@dataclass(frozen=True)
class StratifiedSample:
    """A drawn sample plus the seed that reproduces it."""

    seed: int
    items: tuple[PopulationItem, ...]

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(item.item_id for item in self.items)


def assign_quartiles(values: Sequence[float]) -> list[int]:
    """Return a 0..3 equal-count quartile index for each value.

    Rank-based, not threshold-based: the lowest quarter of values gets 0 and
    the highest gets 3, with ties broken by position so the groups stay as
    equal-sized as the population allows. That keeps a sample spread across
    quartiles even when many scores are equal.
    """
    n = len(values)
    order = sorted(range(n), key=lambda index: (values[index], index))
    quartiles = [0] * n
    for rank, index in enumerate(order):
        quartiles[index] = rank * 4 // n
    return quartiles


def _selection_key(seed: int, item: PopulationItem) -> str:
    """A keyed, stable ordering key: the deterministic 'shuffle' for a seed."""
    digest = hashlib.sha256(f"{seed}\x1f{item.item_id}".encode("utf-8")).hexdigest()
    return digest


def _allocate(
    cell_sizes: dict[tuple[str, int], int], target: int
) -> dict[tuple[str, int], int]:
    """Split ``target`` across ``(stratum, quartile)`` cells by size.

    Largest-remainder proportional allocation, capped at each cell's size,
    with one guarantee: when ``target`` is at least the number of non-empty
    cells, every non-empty cell is represented at least once, so a small
    stratum is never silently dropped from a reference sample.
    """
    cells = sorted(key for key, size in cell_sizes.items() if size > 0)
    allocation = {key: 0 for key in cell_sizes}
    total = sum(cell_sizes.values())
    if target <= 0 or not cells:
        return allocation
    if target < len(cells):
        ranked = sorted(cells, key=lambda key: (-cell_sizes[key], key))
        for key in ranked[:target]:
            allocation[key] = 1
        return allocation

    remainders: dict[tuple[str, int], int] = {}
    assigned = 0
    for key in cells:
        product = target * cell_sizes[key]
        base = product // total
        allocation[key] = base
        assigned += base
        remainders[key] = product % total
    leftover = target - assigned
    while leftover > 0:
        progressed = False
        for key in sorted(cells, key=lambda key: (-remainders[key], key)):
            if leftover == 0:
                break
            if allocation[key] < cell_sizes[key]:
                allocation[key] += 1
                leftover -= 1
                progressed = True
        if not progressed:
            break

    for key in cells:
        if allocation[key] == 0:
            donor = max(
                (candidate for candidate in cells if allocation[candidate] > 1),
                key=lambda candidate: (allocation[candidate], candidate),
            )
            allocation[donor] -= 1
            allocation[key] = 1
    return allocation


def stratified_sample(
    population: Iterable[PopulationItem],
    target_size: int,
    seed: int,
) -> StratifiedSample:
    """Draw ``target_size`` items spread across score quartiles and strata.

    Allocation is proportional to each ``(stratum, quartile)`` cell's size
    (see :func:`_allocate`). Items inside a cell are chosen by a hash keyed
    on ``seed`` and ``item_id``, so the result depends on the seed alone.
    """
    items = list(population)
    if target_size < 0:
        raise ValueError(f"target_size must be >= 0, got {target_size}")
    if target_size > len(items):
        raise ValueError(
            f"target_size {target_size} exceeds population of {len(items)}"
        )
    item_ids = [item.item_id for item in items]
    if len(set(item_ids)) != len(item_ids):
        raise ValueError("population has duplicate item_id values")

    quartiles = assign_quartiles([item.score for item in items])
    cells: dict[tuple[str, int], list[PopulationItem]] = {}
    for item, quartile in zip(items, quartiles):
        cells.setdefault((item.stratum, quartile), []).append(item)

    cell_sizes = {key: len(members) for key, members in cells.items()}
    allocation = _allocate(cell_sizes, target_size)

    selected: list[PopulationItem] = []
    for key, count in allocation.items():
        if count <= 0:
            continue
        members = sorted(
            cells[key], key=lambda item: (_selection_key(seed, item), item.item_id)
        )
        selected.extend(members[:count])
    selected.sort(key=lambda item: item.item_id)
    return StratifiedSample(seed=seed, items=tuple(selected))
