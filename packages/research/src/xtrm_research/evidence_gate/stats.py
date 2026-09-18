"""Interval estimators for the Evidence Gate (XTRM-494, XTRM-499).

Every Evidence Gate number is reported with an interval (XTRM-488 is why).
Items are not independent — candidates of one retrieval call share a query
and a source — so the bootstrap resamples *clusters* (``cluster_key`` in the
dataset manifest), never items.

The package forbids callable parameters (the remote-seam rule in
``tests/test_guards.py``), so this module does not take a statistic
function: :func:`resample_indices` hands out seeded cluster resamples and
the caller evaluates its statistic on each. Evaluating every statistic on
the *same* resamples is what makes a delta between two arms paired.
"""

from __future__ import annotations

import math
import random

N_RESAMPLES = 2000
SEED = 20260918
#: More undefined resamples than this fraction and no interval is given.
MAX_SKIP_FRACTION = 0.05
Z95 = 1.959963984540054


def wilson(successes: int, n: int) -> list[float] | None:
    """Wilson score 95% interval for a proportion; None when n == 0."""
    if n == 0:
        return None
    p = successes / n
    denom = 1 + Z95 * Z95 / n
    centre = (p + Z95 * Z95 / (2 * n)) / denom
    half = Z95 * math.sqrt(p * (1 - p) / n + Z95 * Z95 / (4 * n * n)) / denom
    return [centre - half, centre + half]


def resample_indices(
    n_clusters: int, n_resamples: int = N_RESAMPLES, seed: int = SEED
) -> list[list[int]]:
    """``n_resamples`` lists of cluster indices drawn with replacement."""
    rng = random.Random(seed)
    return [
        [rng.randrange(n_clusters) for _ in range(n_clusters)]
        for _ in range(n_resamples)
    ]


def interval(
    point: float | None, draws: list[float | None], n_clusters: int, seed: int = SEED
) -> dict[str, object]:
    """Percentile 95% interval from bootstrap draws; undefined draws (None)
    are counted, and too many of them refuse the interval with a reason."""
    defined = sorted(d for d in draws if d is not None)
    skipped = len(draws) - len(defined)
    method = (
        f"cluster percentile bootstrap, {len(draws)} resamples, seed {seed}, "
        f"{n_clusters} clusters"
    )
    if point is None:
        return {
            "value": None,
            "ci95": None,
            "method": method,
            "null_reason": "undefined on the full set",
        }
    if not draws or skipped > MAX_SKIP_FRACTION * len(draws):
        return {
            "value": point,
            "ci95": None,
            "method": method,
            "null_reason": f"statistic undefined on {skipped} of {len(draws)} resamples",
        }
    lo = defined[int(math.floor(0.025 * (len(defined) - 1)))]
    hi = defined[int(math.ceil(0.975 * (len(defined) - 1)))]
    return {"value": point, "ci95": [lo, hi], "method": method, "skipped": skipped}


def group_items(items: list[dict]) -> list[list[dict]]:
    """Items grouped into bootstrap clusters by ``source_ref`` — one
    ctx_search call (stratum L) or one researcher job (stratum W) — in
    first-seen order, so the clustering is deterministic."""
    clusters: dict[str, list[dict]] = {}
    for item in items:
        clusters.setdefault(item["source_ref"], []).append(item)
    return list(clusters.values())
