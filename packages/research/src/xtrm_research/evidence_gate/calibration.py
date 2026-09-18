"""Evidence Gate calibration and acceptance thresholds (XTRM-498).

Method (docs/xtrm-99/calibration.md states it in full):

* **Folds.** Grouped K-fold (K=5) over bootstrap clusters (one ctx_search
  call or one researcher job): every item of a cluster lands in the same
  fold, so no fold is calibrated on a sibling of an item it scores. Fold of
  a cluster = rank of ``sha256(seed:cluster_key)``, dealt round-robin.
* **Calibrator.** Platt scaling — ``p = sigmoid(a * x + b)`` fit by Newton's
  method on the training folds, where ``x = logit(raw)`` for probability-
  like raw scores and ``x = raw`` for a cosine. Isotonic regression (pool
  adjacent violators) is fit the same way as a sensitivity check. A
  training fold with one class present cannot be fit; it predicts its
  training base rate and the fold is counted as ``degenerate``.
* **Out-of-fold.** Every reported probability is the calibrator of the
  OTHER folds applied to the item: no metric is computed on an item whose
  label the calibrator saw.
* **Thresholds.** Per question and fold, the acceptance threshold is the
  largest ``t`` whose training-fold recall at ``p >= t`` is at least
  :data:`TARGET_RECALL` (evidence-retaining questions optimise for recall,
  §2). The held-out fold is decided with the threshold learned without it.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any

K_FOLDS = 5
SEED = 20260918
TARGET_RECALL = 0.95
_EPS = 1e-6


def logit(p: float) -> float:
    p = min(max(p, _EPS), 1 - _EPS)
    return math.log(p / (1 - p))


def sigmoid(z: float) -> float:
    if z >= 0:
        return 1 / (1 + math.exp(-z))
    e = math.exp(z)
    return e / (1 + e)


def fold_of_clusters(
    cluster_keys: list[str], k: int = K_FOLDS, seed: int = SEED
) -> dict[str, int]:
    ordered = sorted(
        set(cluster_keys),
        key=lambda c: hashlib.sha256(f"{seed}:{c}".encode()).hexdigest(),
    )
    return {c: i % k for i, c in enumerate(ordered)}


def fit_platt(
    xs: list[float], ys: list[int], iters: int = 100
) -> tuple[float, float] | None:
    """Logistic regression of y on x (two parameters), Newton-Raphson with
    a tiny ridge for separable data. None when one class only."""
    if len(set(ys)) < 2:
        return None
    a, b = 0.0, logit(sum(ys) / len(ys))
    for _ in range(iters):
        ga = gb = haa = hab = hbb = 0.0
        for x, y in zip(xs, ys):
            p = sigmoid(a * x + b)
            w = p * (1 - p)
            ga += (p - y) * x
            gb += p - y
            haa += w * x * x
            hab += w * x
            hbb += w
        ridge = 1e-3
        ga += ridge * a
        haa += ridge
        det = haa * hbb - hab * hab
        if abs(det) < 1e-12:
            break
        da = (hbb * ga - hab * gb) / det
        db = (haa * gb - hab * ga) / det
        a, b = a - da, b - db
        if abs(da) < 1e-9 and abs(db) < 1e-9:
            break
    return a, b


def fit_isotonic(xs: list[float], ys: list[int]) -> list[tuple[float, float]] | None:
    """Pool-adjacent-violators; returns (upper x of block, value) steps."""
    if len(set(ys)) < 2:
        return None
    pairs = sorted(zip(xs, ys))
    blocks: list[list[float]] = []  # [sum_y, count, max_x]
    for x, y in pairs:
        blocks.append([float(y), 1.0, x])
        while (
            len(blocks) > 1
            and blocks[-2][0] / blocks[-2][1] >= blocks[-1][0] / blocks[-1][1]
        ):
            s, n, mx = blocks.pop()
            blocks[-1][0] += s
            blocks[-1][1] += n
            blocks[-1][2] = mx
    return [(mx, s / n) for s, n, mx in blocks]


def apply_isotonic(steps: list[tuple[float, float]], x: float) -> float:
    for upper, value in steps:
        if x <= upper:
            return value
    return steps[-1][1]


def out_of_fold(
    xs: list[float], ys: list[int], folds: list[int], method: str = "platt"
) -> tuple[list[float], dict[str, Any]]:
    """Out-of-fold calibrated probabilities and a record of each fold fit."""
    preds = [0.0] * len(xs)
    record: dict[str, Any] = {"method": method, "folds": []}
    for fold in sorted(set(folds)):
        train = [i for i, f in enumerate(folds) if f != fold]
        test = [i for i, f in enumerate(folds) if f == fold]
        tx, ty = [xs[i] for i in train], [ys[i] for i in train]
        if method == "platt":
            params = fit_platt(tx, ty)
            for i in test:
                preds[i] = (
                    sigmoid(params[0] * xs[i] + params[1])
                    if params
                    else sum(ty) / len(ty)
                )
            record["folds"].append(
                {
                    "fold": fold,
                    "n_train": len(train),
                    "params": params,
                    "degenerate": params is None,
                }
            )
        else:
            steps = fit_isotonic(tx, ty)
            for i in test:
                preds[i] = apply_isotonic(steps, xs[i]) if steps else sum(ty) / len(ty)
            record["folds"].append(
                {"fold": fold, "n_train": len(train), "degenerate": steps is None}
            )
    return preds, record


def recall_threshold(
    ps: list[float], ys: list[int], target: float = TARGET_RECALL
) -> float | None:
    """Largest threshold t with recall(p >= t) >= target; None if no positive."""
    positives = sorted((p for p, y in zip(ps, ys) if y == 1), reverse=True)
    if not positives:
        return None
    need = math.ceil(target * len(positives))
    return positives[need - 1]


def out_of_fold_decisions(
    ps: list[float], ys: list[int], folds: list[int], target: float = TARGET_RECALL
) -> tuple[list[int], list[float | None]]:
    """Held-out accept decisions with thresholds learned on the other folds
    (a fold whose training part has no positive accepts everything)."""
    decisions = [1] * len(ps)
    thresholds: list[float | None] = []
    for fold in sorted(set(folds)):
        train = [i for i, f in enumerate(folds) if f != fold]
        t = recall_threshold([ps[i] for i in train], [ys[i] for i in train], target)
        thresholds.append(t)
        for i, f in enumerate(folds):
            if f == fold:
                decisions[i] = 1 if t is None or ps[i] >= t else 0
    return decisions, thresholds


def brier(ps: list[float], ys: list[int]) -> float | None:
    if not ps:
        return None
    return sum((p - y) ** 2 for p, y in zip(ps, ys)) / len(ps)


def ece(ps: list[float], ys: list[int], bins: int = 10) -> float | None:
    """Expected calibration error over equal-mass bins (ties split by
    position): sum over bins of |mean p - mean y| weighted by bin size."""
    n = len(ps)
    if n == 0:
        return None
    order = sorted(range(n), key=lambda i: ps[i])
    total = 0.0
    for b in range(bins):
        members = order[b * n // bins : (b + 1) * n // bins]
        if members:
            gap = abs(
                sum(ps[i] for i in members) / len(members)
                - sum(ys[i] for i in members) / len(members)
            )
            total += gap * len(members) / n
    return total


def auc(scores: list[float], ys: list[int]) -> float | None:
    """Mann-Whitney AUC with midranks for ties; None if one class only."""
    pos = sum(ys)
    neg = len(ys) - pos
    if pos == 0 or neg == 0:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    rank_sum = sum(r for r, y in zip(ranks, ys) if y == 1)
    return (rank_sum - pos * (pos + 1) / 2) / (pos * neg)
