"""The 12 §3.9 evaluation metrics for the service-knowledge system.

Each metric is a pure function over a list of eval outcomes (one per corpus case).
An outcome is a dict with the shape produced by ``harness.run_case`` — no
frameworks, no side effects: pass the outcomes in, get a float back.
"""
from __future__ import annotations

from statistics import mean
from typing import Any, Iterable


def _safe_ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _precision(retrieved: Iterable[str], expected: Iterable[str]) -> float:
    retrieved_set, expected_set = set(retrieved), set(expected)
    if not retrieved_set:
        return 0.0
    return _safe_ratio(len(retrieved_set & expected_set), len(retrieved_set))


def _recall(retrieved: Iterable[str], expected: Iterable[str]) -> float:
    retrieved_set, expected_set = set(retrieved), set(expected)
    if not expected_set:
        return 1.0
    return _safe_ratio(len(retrieved_set & expected_set), len(expected_set))


def _at_k(items: Iterable[str], k: int) -> list[str]:
    return list(items)[:k]


def routing_precision(outcomes: list[dict[str, Any]]) -> float:
    return mean(
        _precision(o.get("retrieved_services", []), o.get("expected_services", []))
        for o in outcomes
    ) if outcomes else 0.0


def routing_recall(outcomes: list[dict[str, Any]]) -> float:
    return mean(
        _recall(o.get("retrieved_services", []), o.get("expected_services", []))
        for o in outcomes
    ) if outcomes else 0.0


def retrieval_precision_at_k(outcomes: list[dict[str, Any]], k: int = 5) -> float:
    return mean(
        _precision(_at_k(o.get("retrieved_evidence", []), k), o.get("expected_evidence", []))
        for o in outcomes
    ) if outcomes else 0.0


def retrieval_recall_at_k(outcomes: list[dict[str, Any]], k: int = 5) -> float:
    return mean(
        _recall(_at_k(o.get("retrieved_evidence", []), k), o.get("expected_evidence", []))
        for o in outcomes
    ) if outcomes else 0.0


def citation_utilization_rate(outcomes: list[dict[str, Any]]) -> float:
    used = sum(1 for o in outcomes if o.get("citation_used"))
    return _safe_ratio(used, len(outcomes))


def ignored_activation_rate(outcomes: list[dict[str, Any]]) -> float:
    ignored = sum(1 for o in outcomes if o.get("activation_ignored"))
    return _safe_ratio(ignored, len(outcomes))


def stale_claim_escape_rate(outcomes: list[dict[str, Any]]) -> float:
    escapes = sum(1 for o in outcomes if o.get("stale_claim_escape"))
    return _safe_ratio(escapes, len(outcomes))


def conflict_detection_recall(outcomes: list[dict[str, Any]]) -> float:
    true_conflicts = [o for o in outcomes if o.get("expected_conflict")]
    detected = sum(1 for o in true_conflicts if o.get("conflict_detected"))
    return _safe_ratio(detected, len(true_conflicts))


def _verifier_confusion(outcomes: list[dict[str, Any]]) -> tuple[int, int, int, int]:
    """Returns (TP, FP, FN, TN) with 'positive' == CONFLICT/INVALID verdict."""
    tp = fp = fn = tn = 0
    for o in outcomes:
        got = str(o.get("verifier_verdict", "")).upper()
        want = str(o.get("expected_verifier", "")).upper()
        got_pos = got in {"CONFLICT", "INVALID"}
        want_pos = want in {"CONFLICT", "INVALID"}
        if got_pos and want_pos:
            tp += 1
        elif got_pos and not want_pos:
            fp += 1
        elif not got_pos and want_pos:
            fn += 1
        else:
            tn += 1
    return tp, fp, fn, tn


def verifier_fp_rate(outcomes: list[dict[str, Any]]) -> float:
    _, fp, _, tn = _verifier_confusion(outcomes)
    return _safe_ratio(fp, fp + tn)


def verifier_fn_rate(outcomes: list[dict[str, Any]]) -> float:
    tp, _, fn, _ = _verifier_confusion(outcomes)
    return _safe_ratio(fn, fn + tp)


def probe_execution_rate(outcomes: list[dict[str, Any]]) -> float:
    with_probes = [o for o in outcomes if o.get("expected_probes")]
    if not with_probes:
        return 0.0
    ratios = []
    for o in with_probes:
        expected = set(o.get("expected_probes", []))
        executed = set(o.get("executed_probes", []))
        ratios.append(_safe_ratio(len(expected & executed), len(expected)))
    return mean(ratios)


def time_to_first_correct_diagnostic_ms(outcomes: list[dict[str, Any]]) -> float:
    correct = [o for o in outcomes if o.get("verifier_verdict") == o.get("expected_verifier")]
    if not correct:
        return 0.0
    return mean(float(o.get("duration_ms", 0.0)) for o in correct)


def tokens_per_successful_task(outcomes: list[dict[str, Any]]) -> float:
    successful = [o for o in outcomes if o.get("outcome") == "success"]
    if not successful:
        return 0.0
    return mean(float(o.get("tokens", 0)) for o in successful)


# 13 keys — the §3.9 spec counts routing_precision+recall as a single line item
# ("service routing precision/recall"), so this matches the "12 metrics" contract.
METRICS = {
    "routing_precision": routing_precision,
    "routing_recall": routing_recall,
    "retrieval_precision_at_5": lambda o: retrieval_precision_at_k(o, 5),
    "retrieval_recall_at_5": lambda o: retrieval_recall_at_k(o, 5),
    "citation_utilization_rate": citation_utilization_rate,
    "ignored_activation_rate": ignored_activation_rate,
    "stale_claim_escape_rate": stale_claim_escape_rate,
    "conflict_detection_recall": conflict_detection_recall,
    "verifier_fp_rate": verifier_fp_rate,
    "verifier_fn_rate": verifier_fn_rate,
    "probe_execution_rate": probe_execution_rate,
    "time_to_first_correct_diagnostic_ms": time_to_first_correct_diagnostic_ms,
    "tokens_per_successful_task": tokens_per_successful_task,
}


def compute_all(outcomes: list[dict[str, Any]]) -> dict[str, float]:
    return {name: fn(outcomes) for name, fn in METRICS.items()}


THRESHOLDS = {
    "routing_precision": ("gte", 0.80),
    "retrieval_precision_at_5": ("gte", 0.60),
    "stale_claim_escape_rate": ("lte", 0.05),
    "verifier_fp_rate": ("lte", 0.05),
    "verifier_fn_rate": ("lte", 0.10),
}


def threshold_status(values: dict[str, float]) -> dict[str, str]:
    """Return {metric: green|yellow|red} for the threshold-gated metrics."""
    out: dict[str, str] = {}
    margin = 0.05
    for name, (op, threshold) in THRESHOLDS.items():
        actual = values.get(name, 0.0)
        if op == "gte":
            status = "green" if actual >= threshold else "yellow" if actual >= threshold - margin else "red"
        else:
            status = "green" if actual <= threshold else "yellow" if actual <= threshold + margin else "red"
        out[name] = status
    return out
