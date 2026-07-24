"""Metric definitions + aggregation (research §3.9). No vaultctl dependency."""
from __future__ import annotations

from service_knowledge.eval import metrics


def test_twelve_metric_rows_match_3_9():
    assert len(metrics.METRIC_ROWS) == 12
    assert metrics.METRIC_ROWS == (
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
    # every row has a label + a threshold band
    assert set(metrics.METRIC_LABELS) == set(metrics.METRIC_ROWS)
    assert set(metrics.THRESHOLDS) == set(metrics.METRIC_ROWS)


def test_threshold_directions():
    assert metrics.THRESHOLDS["service_routing"].direction == "higher"
    assert metrics.THRESHOLDS["stale_claim_escape_rate"].direction == "lower"
    assert metrics.THRESHOLDS["stale_claim_escape_rate"].status(0.0) == "green"
    assert metrics.THRESHOLDS["stale_claim_escape_rate"].status(0.5) == "red"
    assert metrics.THRESHOLDS["service_routing"].status(0.9) == "green"
    assert metrics.THRESHOLDS["service_routing"].status(None) == "unknown"


def test_precision_recall_micro_average():
    result = metrics.precision_recall([{"a", "b"}, {"c"}], [{"a"}, {"c", "d"}])
    # TP=2 (a, c); predicted=3; expected=3
    assert result["precision"] == 2 / 3
    assert result["recall"] == 2 / 3


def test_aggregate_stale_escape_and_routing():
    outcomes = [
        metrics.CaseOutcome(
            case_id="ok",
            predicted_services={"svc"}, expected_services={"svc"},
            retrieved_evidence={"i1"}, required_evidence={"i1", "i2"},
            forbidden_evidence={"stale"}, escaped_forbidden=set(),
            expected_probes={"p"}, surfaced_probes={"p"},
            verifier_correct_blocked=1,
        ),
        metrics.CaseOutcome(
            case_id="leak",
            predicted_services={"wrong"}, expected_services={"svc"},
            forbidden_evidence={"stale"}, escaped_forbidden={"stale"},
        ),
    ]
    report = metrics.aggregate(outcomes)
    # 1 escape / 2 forbidden labels
    assert report.values["stale_claim_escape_rate"] == 0.5
    assert report.status["stale_claim_escape_rate"] == "red"
    # routing: TP=1 (svc), predicted=2, expected=2 -> p=0.5 r=0.5
    assert report.values["service_routing"]["precision"] == 0.5
    assert report.values["verification_false_negative_rate"] == 0.0
    assert report.case_count == 2


def test_aggregate_empty_denominators_are_none():
    report = metrics.aggregate([metrics.CaseOutcome(case_id="bare")])
    assert report.values["retrieval_precision_at_k"] is None
    assert report.values["citation_utilization_rate"] is None
    assert report.status["retrieval_precision_at_k"] == "unknown"
