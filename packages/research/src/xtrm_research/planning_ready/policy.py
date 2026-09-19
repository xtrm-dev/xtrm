"""Readiness policies and their calibration (Jira XTRM-99 c.13435/c.13438).

Policy is code, and the explicit policy is **not compensatory**: a positive
result on one section cannot rescue a hard failure in another. A learned
composition is included only as a comparison arm, and — unlike the explicit
policy — it enforces no invariant at all, which is exactly what makes the
comparison informative.

Thresholds and the learned weights are fitted on the training partition alone
and then frozen; the test partition is never used to choose a threshold.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Sequence

from xtrm_research.planning_ready.questions import MANDATORY_PREDICATES

DECISION_CLASSES = ("READY", "DRAFT", "NEEDS_DECISION", "BLOCKED", "REVIEW")

#: The decision classes that mean "not ready to dispatch".
NOT_READY_CLASSES = tuple(c for c in DECISION_CLASSES if c != "READY")


@dataclass(frozen=True)
class Thresholds:
    """Every threshold the explicit policy uses. Fitted on train, then frozen."""

    #: A mandatory predicate at or below this probability is confidently false.
    mandatory_false_below: float
    #: A mandatory predicate below this probability is materially uncertain.
    mandatory_true_above: float
    #: Gates: above this probability the gate fires.
    open_decision_above: float
    self_blocked_above: float
    missing_context_above: float
    #: Advisory: over-prescription sends the contract to review, never to draft.
    micromanages_above: float
    #: Holistic arm: `executable` at or above this probability is READY.
    holistic_ready_above: float

    def freeze(self) -> dict[str, float]:
        return asdict(self)


#: Defaults used only to make the physics of the grid search explicit; the
#: frozen values are always the fitted ones recorded in the run manifest.
DEFAULT_GRID = {
    "mandatory_false_below": [0.1, 0.2, 0.3, 0.4],
    "mandatory_true_above": [0.6, 0.7, 0.8, 0.9],
    "open_decision_above": [0.3, 0.4, 0.5, 0.6, 0.7],
    "self_blocked_above": [0.3, 0.4, 0.5, 0.6, 0.7],
    "missing_context_above": [0.3, 0.4, 0.5, 0.6, 0.7],
    "micromanages_above": [0.5, 0.6, 0.7, 0.8],
    "holistic_ready_above": [0.3, 0.4, 0.5, 0.6, 0.7],
}


def answers_of(answers: dict[str, Any]) -> dict[str, float]:
    """Noul probabilities keyed by question name; a Choice answer is skipped."""
    out: dict[str, float] = {}
    for name, answer in answers.items():
        if isinstance(answer, dict) and "noul" in answer:
            value = answer.get("noul")
            if isinstance(value, (int, float)):
                out[name] = float(value)
    return out


def choice_of(answers: dict[str, Any], name: str = "execution_mode") -> str | None:
    answer = answers.get(name)
    if isinstance(answer, dict):
        choice = answer.get("choice")
        if isinstance(choice, str):
            return choice
    return None


def explicit_policy(
    deterministic_findings: Sequence[dict[str, str]],
    nouls: dict[str, float],
    thresholds: Thresholds,
) -> dict[str, Any]:
    """The non-compensatory readiness policy.

    Order matters and is part of the frozen contract: a deterministic failure
    ends the decision; a gate cannot be outweighed; a mandatory predicate that
    is confidently false is a draft; a mandatory predicate that is materially
    uncertain is a review rather than a guess.
    """
    reasons: list[str] = []
    uncertainty: list[str] = []

    if deterministic_findings:
        return {
            "decision": "DRAFT",
            "reasons": [
                "deterministic:" + f["message"] for f in deterministic_findings
            ],
            "uncertain": [],
            "stage": "deterministic",
        }

    missing = [q for q in MANDATORY_PREDICATES]
    absent = [q for q in missing if q not in nouls]
    if absent:
        return {
            "decision": "REVIEW",
            "reasons": [
                f"no answer recorded for mandatory predicate {q}" for q in absent
            ],
            "uncertain": absent,
            "stage": "answer_completeness",
        }

    p = nouls
    if p.get("open_decision", 0.0) > thresholds.open_decision_above:
        reasons.append(
            f"open_decision={p['open_decision']:.3f} > {thresholds.open_decision_above}"
        )
        return {
            "decision": "NEEDS_DECISION",
            "reasons": reasons,
            "uncertain": [],
            "stage": "gate",
        }
    if p.get("self_blocked", 0.0) > thresholds.self_blocked_above:
        reasons.append(
            f"self_blocked={p['self_blocked']:.3f} > {thresholds.self_blocked_above}"
        )
        return {
            "decision": "BLOCKED",
            "reasons": reasons,
            "uncertain": [],
            "stage": "gate",
        }
    if p.get("depends_on_missing_context", 0.0) > thresholds.missing_context_above:
        reasons.append(
            "depends_on_missing_context="
            f"{p['depends_on_missing_context']:.3f} > {thresholds.missing_context_above}: "
            "the contract fails the fresh-worker test"
        )
        return {
            "decision": "DRAFT",
            "reasons": reasons,
            "uncertain": [],
            "stage": "gate",
        }

    false_predicates = [
        q
        for q in MANDATORY_PREDICATES
        if p.get(q, 0.0) < thresholds.mandatory_false_below
    ]
    if false_predicates:
        return {
            "decision": "DRAFT",
            "reasons": [
                f"{q}={p[q]:.3f} < {thresholds.mandatory_false_below}"
                for q in false_predicates
            ],
            "uncertain": [],
            "stage": "mandatory_predicate",
        }

    uncertain_predicates = [
        q
        for q in MANDATORY_PREDICATES
        if thresholds.mandatory_false_below
        <= p.get(q, 0.0)
        < thresholds.mandatory_true_above
    ]
    uncertainty.extend(uncertain_predicates)
    if uncertain_predicates:
        return {
            "decision": "REVIEW",
            "reasons": [
                f"{q}={p[q]:.3f} inside the uncertainty band "
                f"[{thresholds.mandatory_false_below}, {thresholds.mandatory_true_above})"
                for q in uncertain_predicates
            ],
            "uncertain": uncertain_predicates,
            "stage": "mandatory_uncertain",
        }

    if p.get("micromanages_implementation", 0.0) > thresholds.micromanages_above:
        return {
            "decision": "REVIEW",
            "reasons": [
                "micromanages_implementation="
                f"{p['micromanages_implementation']:.3f} > {thresholds.micromanages_above}"
            ],
            "uncertain": ["micromanages_implementation"],
            "stage": "advisory",
        }

    return {"decision": "READY", "reasons": [], "uncertain": [], "stage": "ready"}


def deterministic_only_policy(
    deterministic_findings: Sequence[dict[str, str]],
) -> dict[str, Any]:
    """Arm B0: no semantic judgment at all — structure only."""
    if deterministic_findings:
        return {
            "decision": "DRAFT",
            "reasons": [f["message"] for f in deterministic_findings],
            "uncertain": [],
            "stage": "deterministic",
        }
    return {
        "decision": "READY",
        "reasons": [],
        "uncertain": [],
        "stage": "deterministic",
    }


def holistic_policy(nouls: dict[str, float], thresholds: Thresholds) -> dict[str, Any]:
    """Arm A: the historical single holistic judgment."""
    p = nouls.get("executable")
    if p is None:
        return {
            "decision": "REVIEW",
            "reasons": ["no holistic answer recorded"],
            "uncertain": ["executable"],
            "stage": "answer_completeness",
        }
    if p >= thresholds.holistic_ready_above:
        return {
            "decision": "READY",
            "reasons": [f"executable={p:.3f} >= {thresholds.holistic_ready_above}"],
            "uncertain": [],
            "stage": "holistic",
        }
    return {
        "decision": "DRAFT",
        "reasons": [f"executable={p:.3f} < {thresholds.holistic_ready_above}"],
        "uncertain": [],
        "stage": "holistic",
    }


# --- learned composition (arm C) -------------------------------------------

#: Feature order for the learned composition: every Noul probability, the
#: three execution-mode probabilities, and the deterministic finding count.
NOUL_FEATURES = (
    "problem_actionable",
    "success_observable",
    "scope_bounded",
    "non_goals_effective",
    "constraints_actionable",
    "validation_proves_success",
    "output_unambiguous",
    "open_decision",
    "depends_on_missing_context",
    "micromanages_implementation",
    "self_blocked",
)
MODE_FEATURES = ("repo_only", "live_environment", "operator_other_team")


def feature_vector(
    deterministic_findings: Sequence[dict[str, str]], answers: dict[str, Any]
) -> list[float]:
    nouls = answers_of(answers)
    row = [nouls.get(name, 0.5) for name in NOUL_FEATURES]
    probabilities = {}
    mode_answer = answers.get("execution_mode")
    if isinstance(mode_answer, dict) and isinstance(
        mode_answer.get("probabilities"), dict
    ):
        probabilities = mode_answer["probabilities"]
    row.append(float(probabilities.get("repo_only", 0.0)))
    row.append(float(probabilities.get("live_environment", 0.0)))
    row.append(
        float(
            probabilities.get(
                "operator_or_other_team", probabilities.get("operator_other_team", 0.0)
            )
        )
    )
    row.append(float(len(deterministic_findings)))
    row.append(1.0)  # intercept
    return row


def _sigmoid(z: float) -> float:
    if z < -60:
        return 0.0
    if z > 60:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def fit_logistic(
    rows: Sequence[Sequence[float]],
    labels: Sequence[int],
    *,
    l2: float = 1.0,
    steps: int = 200,
) -> list[float]:
    """Newton-Raphson (IRLS) logistic fit with L2 penalty, pure stdlib.

    Small, deterministic, and reproducible without adding a numerical
    dependency to the package.
    """
    n_features = len(rows[0])
    weights = [0.0] * n_features
    for _ in range(steps):
        gradient = [0.0] * n_features
        hessian = [[0.0] * n_features for _ in range(n_features)]
        for row, label in zip(rows, labels):
            z = sum(w * x for w, x in zip(weights, row))
            p = _sigmoid(z)
            error = p - label
            for i in range(n_features):
                gradient[i] += error * row[i]
                for j in range(n_features):
                    hessian[i][j] += p * (1 - p) * row[i] * row[j]
        for i in range(n_features):
            hessian[i][i] += l2
        delta = _solve(hessian, gradient)
        if delta is None:
            break
        weights = [w - d for w, d in zip(weights, delta)]
        if max(abs(d) for d in delta) < 1e-8:
            break
    return weights


def _solve(matrix: list[list[float]], rhs: list[float]) -> list[float] | None:
    """Gaussian elimination with partial pivoting; None when singular."""
    n = len(rhs)
    augmented = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(augmented[r][col]))
        if abs(augmented[pivot][col]) < 1e-12:
            return None
        augmented[col], augmented[pivot] = augmented[pivot], augmented[col]
        for r in range(col + 1, n):
            factor = augmented[r][col] / augmented[col][col]
            for c in range(col, n + 1):
                augmented[r][c] -= factor * augmented[col][c]
    solution = [0.0] * n
    for r in range(n - 1, -1, -1):
        total = augmented[r][n] - sum(
            augmented[r][c] * solution[c] for c in range(r + 1, n)
        )
        solution[r] = total / augmented[r][r]
    return solution


def logistic_probability(weights: Sequence[float], row: Sequence[float]) -> float:
    return _sigmoid(sum(w * x for w, x in zip(weights, row)))


class LearnedComposition:
    """Arm C: a calibrated learned composition over the same primitive answers.

    It enforces no invariant. It exists to answer whether a learned scalar
    beats the explicit policy on this workload — nothing more.
    """

    def __init__(self, weights: Sequence[float], threshold: float) -> None:
        self.weights = list(weights)
        self.threshold = threshold

    def probability(
        self, deterministic_findings: Sequence[dict[str, str]], answers: dict[str, Any]
    ) -> float:
        return logistic_probability(
            self.weights, feature_vector(deterministic_findings, answers)
        )

    def policy(
        self, deterministic_findings: Sequence[dict[str, str]], answers: dict[str, Any]
    ) -> dict[str, Any]:
        p = self.probability(deterministic_findings, answers)
        decision = "READY" if p >= self.threshold else "DRAFT"
        return {
            "decision": decision,
            "reasons": [f"learned P(ready)={p:.3f} vs threshold {self.threshold}"],
            "uncertain": [],
            "stage": "learned",
        }

    def freeze(self) -> dict[str, Any]:
        return {
            "weights": self.weights,
            "threshold": self.threshold,
            "features": [
                *NOUL_FEATURES,
                *MODE_FEATURES,
                "deterministic_findings",
                "intercept",
            ],
        }


# --- calibration ------------------------------------------------------------


def balanced_accuracy(truth: Sequence[int], predicted: Sequence[int]) -> float:
    positives = [i for i, t in enumerate(truth) if t == 1]
    negatives = [i for i, t in enumerate(truth) if t == 0]
    if not positives or not negatives:
        return float("nan")
    sensitivity = sum(predicted[i] for i in positives) / len(positives)
    specificity = sum(1 - predicted[i] for i in negatives) / len(negatives)
    return (sensitivity + specificity) / 2.0


def calibrate_thresholds(
    units: Sequence[dict[str, Any]],
    answers_by_unit: dict[str, dict[str, Any]],
    truth: dict[str, int],
    grid: dict[str, list[float]] | None = None,
) -> tuple[Thresholds, dict[str, Any]]:
    """Grid-search the explicit policy's thresholds on the training units only.

    Objective: balanced accuracy of the binary READY decision (so the majority
    class cannot win by being the majority). Ties break toward the more
    conservative threshold set — lower false-READY — because a wrongly
    dispatched contract is the costlier error.
    """
    grid = grid or DEFAULT_GRID
    best: tuple[float, float, Thresholds, dict[str, Any]] | None = None
    for mandatory_false_below in grid["mandatory_false_below"]:
        for mandatory_true_above in grid["mandatory_true_above"]:
            if mandatory_true_above <= mandatory_false_below:
                continue
            for open_above in grid["open_decision_above"]:
                for blocked_above in grid["self_blocked_above"]:
                    for missing_above in grid["missing_context_above"]:
                        for micro_above in grid["micromanages_above"]:
                            thresholds = Thresholds(
                                mandatory_false_below,
                                mandatory_true_above,
                                open_above,
                                blocked_above,
                                missing_above,
                                micro_above,
                                0.5,
                            )
                            predicted = []
                            for unit in units:
                                answers = answers_by_unit[unit["unit_id"]]
                                decision = explicit_policy(
                                    unit["deterministic"]["structural_findings"],
                                    answers_of(answers),
                                    thresholds,
                                )
                                predicted.append(
                                    1 if decision["decision"] == "READY" else 0
                                )
                            observed = [truth[unit["unit_id"]] for unit in units]
                            score = balanced_accuracy(observed, predicted)
                            if math.isnan(score):
                                continue
                            false_ready = sum(
                                1
                                for o, p in zip(observed, predicted)
                                if o == 0 and p == 1
                            )
                            key = (score, -false_ready)
                            if best is None or key > (best[0], best[1]):
                                best = (
                                    score,
                                    -false_ready,
                                    thresholds,
                                    {
                                        "balanced_accuracy": score,
                                        "false_ready_count": false_ready,
                                        "n_train": len(units),
                                    },
                                )
    if best is None:
        raise ValueError("no threshold configuration scored on the training units")
    _, _, thresholds, detail = best
    return thresholds, detail


def calibrate_holistic_threshold(
    units: Sequence[dict[str, Any]],
    answers_by_unit: dict[str, dict[str, Any]],
    truth: dict[str, int],
    grid: Sequence[float] | None = None,
) -> tuple[float, dict[str, Any]]:
    grid = list(grid or DEFAULT_GRID["holistic_ready_above"])
    best = None
    for threshold in grid:
        predicted = []
        for unit in units:
            answers = answers_by_unit[unit["unit_id"]]
            nouls = answers_of(answers)
            p = nouls.get("executable")
            predicted.append(1 if (p is not None and p >= threshold) else 0)
        observed = [truth[unit["unit_id"]] for unit in units]
        score = balanced_accuracy(observed, predicted)
        if math.isnan(score):
            continue
        false_ready = sum(1 for o, p in zip(observed, predicted) if o == 0 and p == 1)
        key = (score, -false_ready)
        if best is None or key > (best[0], best[1]):
            best = (score, -false_ready, threshold)
    if best is None:
        raise ValueError("no holistic threshold scored on the training units")
    return best[2], {"balanced_accuracy": best[0], "false_ready_count": -best[1]}


def fit_learned_composition(
    units: Sequence[dict[str, Any]],
    answers_by_unit: dict[str, dict[str, Any]],
    truth: dict[str, int],
) -> tuple[LearnedComposition, dict[str, Any]]:
    """Fit the learned composition on train, then calibrate its threshold on
    the *calibration* partition where one exists (never on test)."""
    rows = [
        feature_vector(
            unit["deterministic"]["structural_findings"],
            answers_by_unit[unit["unit_id"]],
        )
        for unit in units
    ]
    labels = [truth[unit["unit_id"]] for unit in units]
    weights = fit_logistic(rows, labels)
    probabilities = [logistic_probability(weights, row) for row in rows]
    best = None
    for candidate in [i / 100 for i in range(5, 96)]:
        predicted = [1 if p >= candidate else 0 for p in probabilities]
        score = balanced_accuracy(labels, predicted)
        if math.isnan(score):
            continue
        false_ready = sum(1 for o, p in zip(labels, predicted) if o == 0 and p == 1)
        key = (score, -false_ready)
        if best is None or key > (best[0], best[1]):
            best = (score, -false_ready, candidate)
    if best is None:
        raise ValueError("learned composition could not be calibrated")
    detail = {
        "train_balanced_accuracy_at_frozen_threshold": best[0],
        "train_false_ready_count": -best[1],
        "n_train": len(units),
    }
    return LearnedComposition(weights, best[2]), detail


# --- metrics ----------------------------------------------------------------


def classification_metrics(
    truth: Sequence[int], predicted: Sequence[int]
) -> dict[str, Any]:
    """Binary READY metrics with their counts. Rates are None when undefined
    (no positives or no negatives), never a fabricated zero."""
    n = len(truth)
    positives = sum(1 for t in truth if t == 1)
    negatives = n - positives
    tp = sum(1 for t, p in zip(truth, predicted) if t == 1 and p == 1)
    tn = sum(1 for t, p in zip(truth, predicted) if t == 0 and p == 0)
    fp = sum(1 for t, p in zip(truth, predicted) if t == 0 and p == 1)
    fn = sum(1 for t, p in zip(truth, predicted) if t == 1 and p == 0)
    return {
        "n": n,
        "positives": positives,
        "negatives": negatives,
        "true_positive": tp,
        "true_negative": tn,
        "false_positive": fp,
        "false_negative": fn,
        "false_ready_rate": (fp / negatives) if negatives else None,
        "false_draft_rate": (fn / positives) if positives else None,
        "precision": (tp / (tp + fp)) if (tp + fp) else None,
        "recall": (tp / positives) if positives else None,
        "accuracy": (tp + tn) / n if n else None,
        "balanced_accuracy": balanced_accuracy(truth, predicted)
        if (positives and negatives)
        else None,
    }


def auc(truth: Sequence[int], scores: Sequence[float]) -> float | None:
    """Rank AUC (Mann-Whitney), ties counted as half. None without both classes."""
    positives = [s for t, s in zip(truth, scores) if t == 1]
    negatives = [s for t, s in zip(truth, scores) if t == 0]
    if not positives or not negatives:
        return None
    total = 0.0
    for p in positives:
        for n in negatives:
            total += 1.0 if p > n else 0.5 if p == n else 0.0
    return total / (len(positives) * len(negatives))


def brier(truth: Sequence[int], scores: Sequence[float]) -> float | None:
    if not truth:
        return None
    return sum((s - t) ** 2 for t, s in zip(truth, scores)) / len(truth)


def ece(truth: Sequence[int], scores: Sequence[float], bins: int = 10) -> float | None:
    """Expected calibration error, equal-width bins (same rule as
    `evaluators.ECE_BIN_COUNT`)."""
    if not truth:
        return None
    buckets: list[list[tuple[int, float]]] = [[] for _ in range(bins)]
    for t, s in zip(truth, scores):
        index = min(int(s * bins), bins - 1)
        buckets[index].append((t, s))
    total = 0.0
    for bucket in buckets:
        if not bucket:
            continue
        mean_score = sum(s for _, s in bucket) / len(bucket)
        mean_truth = sum(t for t, _ in bucket) / len(bucket)
        total += (len(bucket) / len(truth)) * abs(mean_score - mean_truth)
    return total
