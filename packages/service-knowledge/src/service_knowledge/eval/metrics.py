"""Eval metric definitions + aggregation (research §3.9).

The twelve metric rows below are the *exact* §3.9 set — same names, same semantics. Each metric
carries a direction (``higher``/``lower`` better) and a green/yellow/red threshold band so the
weekly report can render a traffic-light status without a human re-deriving the cut-offs.

``service_routing`` is a single §3.9 row that yields a precision/recall pair; it is counted once
in :data:`METRIC_ROWS` but surfaces two numbers. The remaining eleven rows surface one number each.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# §3.9 row order — do not reorder; the weekly report and dashboards key off these names.
METRIC_ROWS: tuple[str, ...] = (
    "service_routing",
    "retrieval_precision_at_k",
    "retrieval_recall_at_k",
    "citation_utilization_rate",
    "ignored_activation_rate",
    "stale_claim_escape_rate",
    "conflict_detection_recall",
    "verification_false_positive_rate",
    "verification_false_negative_rate",
    "probe_execution_rate",
    "time_to_first_correct_diagnostic",
    "tokens_per_successful_task",
)

# Human labels mirror the §3.9 table verbatim.
METRIC_LABELS: dict[str, str] = {
    "service_routing": "Service routing precision/recall",
    "retrieval_precision_at_k": "Retrieval precision@K",
    "retrieval_recall_at_k": "Retrieval recall@K",
    "citation_utilization_rate": "Citation utilization rate",
    "ignored_activation_rate": "Ignored activation rate",
    "stale_claim_escape_rate": "Stale-claim escape rate",
    "conflict_detection_recall": "Conflict detection recall",
    "verification_false_positive_rate": "Verification false-positive rate",
    "verification_false_negative_rate": "Verification false-negative rate",
    "probe_execution_rate": "Probe execution rate",
    "time_to_first_correct_diagnostic": "Time to first correct diagnostic",
    "tokens_per_successful_task": "Tokens per successful task",
}


@dataclass(frozen=True)
class Threshold:
    """Green/yellow/red band for one metric.

    ``direction`` says which way is good. For ``higher`` metrics, ``green`` is a floor and the
    value degrades as it falls; for ``lower`` metrics, ``green`` is a ceiling and the value
    degrades as it rises. ``yellow`` is the warning band between green and red.
    """

    direction: str  # "higher" | "lower"
    green: float
    yellow: float
    red: float
    unit: str = ""

    def status(self, value: float | None) -> str:
        if value is None:
            return "unknown"
        if self.direction == "higher":
            if value >= self.green:
                return "green"
            if value >= self.yellow:
                return "yellow"
            return "red"
        # lower is better
        if value <= self.green:
            return "green"
        if value <= self.yellow:
            return "yellow"
        return "red"


# Baseline bands. The green cut-offs are the PR5a VALIDATION targets; yellow/red are operator
# review triggers that feed the PR5b canary-threshold decision. ``None``-valued metrics at run
# time (session-only signals with no corpus proxy) render ``unknown`` rather than a false light.
THRESHOLDS: dict[str, Threshold] = {
    "service_routing": Threshold("higher", green=0.80, yellow=0.65, red=0.50),
    "retrieval_precision_at_k": Threshold("higher", green=0.60, yellow=0.45, red=0.30),
    "retrieval_recall_at_k": Threshold("higher", green=0.70, yellow=0.55, red=0.40),
    "citation_utilization_rate": Threshold("higher", green=0.60, yellow=0.40, red=0.25),
    "ignored_activation_rate": Threshold("lower", green=0.15, yellow=0.30, red=0.50),
    "stale_claim_escape_rate": Threshold("lower", green=0.05, yellow=0.10, red=0.20),
    "conflict_detection_recall": Threshold("higher", green=0.80, yellow=0.60, red=0.40),
    "verification_false_positive_rate": Threshold("lower", green=0.05, yellow=0.10, red=0.20),
    "verification_false_negative_rate": Threshold("lower", green=0.10, yellow=0.20, red=0.35),
    "probe_execution_rate": Threshold("higher", green=0.60, yellow=0.40, red=0.25),
    # Seconds; lower is better. No hard §3.9 number — banded for operational impact tracking.
    "time_to_first_correct_diagnostic": Threshold("lower", green=120.0, yellow=300.0, red=600.0, unit="s"),
    # Tokens; lower is better. Efficiency tracker, no safety cut-off.
    "tokens_per_successful_task": Threshold("lower", green=8000.0, yellow=16000.0, red=32000.0, unit="tok"),
}


def _safe_div(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def precision_recall(
    predicted: list[set[str]], expected: list[set[str]]
) -> dict[str, float | None]:
    """Micro-averaged precision/recall over a list of (predicted, expected) id-sets."""
    true_positive = sum(len(p & e) for p, e in zip(predicted, expected))
    predicted_total = sum(len(p) for p in predicted)
    expected_total = sum(len(e) for e in expected)
    return {
        "precision": _safe_div(true_positive, predicted_total),
        "recall": _safe_div(true_positive, expected_total),
    }


@dataclass
class CaseOutcome:
    """Per-case measured signals the aggregator folds into the twelve metrics.

    Fields default to empty so a case that cannot exercise a signal (e.g. no verifier block) simply
    contributes nothing to that metric's denominator rather than a false zero.
    """

    case_id: str
    predicted_services: set[str] = field(default_factory=set)
    expected_services: set[str] = field(default_factory=set)
    retrieved_evidence: set[str] = field(default_factory=set)
    required_evidence: set[str] = field(default_factory=set)
    forbidden_evidence: set[str] = field(default_factory=set)
    escaped_forbidden: set[str] = field(default_factory=set)  # forbidden ids that leaked into the bundle
    expected_probes: set[str] = field(default_factory=set)
    surfaced_probes: set[str] = field(default_factory=set)
    # Verifier accounting (only populated for cases carrying a verifier block).
    verifier_correct_blocked: int = 0  # true positives: bad claim correctly blocked
    verifier_false_positive: int = 0  # good claim wrongly blocked
    verifier_false_negative: int = 0  # bad claim let through
    verifier_true_negative: int = 0  # good claim let through
    conflicts_expected: int = 0
    conflicts_detected: int = 0
    # Session-only proxies (None when the corpus cannot measure them).
    citations_surfaced: int | None = None
    citations_utilized: int | None = None
    activation_loaded: int | None = None
    activation_used: int | None = None
    time_to_first_correct_diagnostic_s: float | None = None
    tokens_for_task: float | None = None
    success: bool = True


@dataclass
class MetricReport:
    """Aggregated metric values + per-metric threshold status for one corpus run."""

    values: dict[str, Any]
    status: dict[str, str]
    case_count: int
    measurable: dict[str, int]  # metric -> number of cases that contributed a denominator

    def value_for(self, metric: str) -> float | None:
        value = self.values.get(metric)
        if isinstance(value, dict):  # service_routing -> use precision as the headline number
            value = value.get("precision")
        return value if isinstance(value, (int, float)) else None


def aggregate(outcomes: list[CaseOutcome]) -> MetricReport:
    """Fold per-case outcomes into the twelve §3.9 metric values + threshold status."""
    routing = precision_recall(
        [o.predicted_services for o in outcomes],
        [o.expected_services for o in outcomes],
    )
    retrieval = precision_recall(
        [o.retrieved_evidence for o in outcomes],
        [o.required_evidence for o in outcomes],
    )

    forbidden_total = sum(len(o.forbidden_evidence) for o in outcomes)
    escaped_total = sum(len(o.escaped_forbidden) for o in outcomes)

    probe_expected = sum(len(o.expected_probes) for o in outcomes)
    probe_surfaced = sum(len(o.surfaced_probes & o.expected_probes) for o in outcomes)

    vp = sum(o.verifier_false_positive for o in outcomes)
    vn = sum(o.verifier_false_negative for o in outcomes)
    vtp = sum(o.verifier_correct_blocked for o in outcomes)
    vtn = sum(o.verifier_true_negative for o in outcomes)

    conflicts_expected = sum(o.conflicts_expected for o in outcomes)
    conflicts_detected = sum(o.conflicts_detected for o in outcomes)

    citations_surfaced = _sum_optional([o.citations_surfaced for o in outcomes])
    citations_utilized = _sum_optional([o.citations_utilized for o in outcomes])
    activation_loaded = _sum_optional([o.activation_loaded for o in outcomes])
    activation_used = _sum_optional([o.activation_used for o in outcomes])

    diagnostics = [o.time_to_first_correct_diagnostic_s for o in outcomes
                   if o.time_to_first_correct_diagnostic_s is not None]
    tokens = [o.tokens_for_task for o in outcomes if o.tokens_for_task is not None]

    values: dict[str, Any] = {
        "service_routing": routing,
        "retrieval_precision_at_k": retrieval["precision"],
        "retrieval_recall_at_k": retrieval["recall"],
        "citation_utilization_rate": _safe_div(citations_utilized or 0, citations_surfaced or 0)
        if citations_surfaced is not None else None,
        "ignored_activation_rate": _ignored_activation_rate(activation_loaded, activation_used),
        "stale_claim_escape_rate": _safe_div(escaped_total, forbidden_total),
        "conflict_detection_recall": _safe_div(conflicts_detected, conflicts_expected),
        "verification_false_positive_rate": _safe_div(vp, vp + vtn),
        "verification_false_negative_rate": _safe_div(vn, vn + vtp),
        "probe_execution_rate": _safe_div(probe_surfaced, probe_expected),
        "time_to_first_correct_diagnostic": _mean(diagnostics),
        "tokens_per_successful_task": _mean(tokens),
    }

    measurable = {
        "service_routing": sum(1 for o in outcomes if o.expected_services),
        "retrieval_precision_at_k": sum(1 for o in outcomes if o.required_evidence),
        "retrieval_recall_at_k": sum(1 for o in outcomes if o.required_evidence),
        "citation_utilization_rate": sum(1 for o in outcomes if o.citations_surfaced is not None),
        "ignored_activation_rate": sum(1 for o in outcomes if o.activation_loaded is not None),
        "stale_claim_escape_rate": sum(1 for o in outcomes if o.forbidden_evidence),
        "conflict_detection_recall": sum(1 for o in outcomes if o.conflicts_expected),
        "verification_false_positive_rate": sum(1 for o in outcomes if o.verifier_false_positive or o.verifier_true_negative),
        "verification_false_negative_rate": sum(1 for o in outcomes if o.verifier_false_negative or o.verifier_correct_blocked),
        "probe_execution_rate": sum(1 for o in outcomes if o.expected_probes),
        "time_to_first_correct_diagnostic": len(diagnostics),
        "tokens_per_successful_task": len(tokens),
    }

    status = {name: THRESHOLDS[name].status(_headline(values[name])) for name in METRIC_ROWS}
    return MetricReport(values=values, status=status, case_count=len(outcomes), measurable=measurable)


def _headline(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("precision")
    return value if isinstance(value, (int, float)) else None


def _ignored_activation_rate(loaded: int | None, used: int | None) -> float | None:
    if loaded is None or loaded <= 0:
        return None
    return (loaded - (used or 0)) / loaded


def _sum_optional(values: list[int | None]) -> int | None:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return sum(present)


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)
