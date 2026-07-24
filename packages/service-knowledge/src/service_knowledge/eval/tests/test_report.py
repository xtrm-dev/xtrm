"""Weekly report renderer (research §3.9). No vaultctl dependency."""
from __future__ import annotations

from service_knowledge.eval import metrics, report


def _report() -> metrics.MetricReport:
    outcome = metrics.CaseOutcome(
        case_id="x", predicted_services={"a"}, expected_services={"a"},
        retrieved_evidence={"i1"}, required_evidence={"i1"},
        forbidden_evidence={"stale"}, escaped_forbidden=set(),
    )
    return metrics.aggregate([outcome])


def test_markdown_has_all_twelve_metric_rows():
    md = report.render_markdown(_report(), week_label="2026-30", corpus_version="v0.6.0")
    for name in metrics.METRIC_ROWS:
        assert metrics.METRIC_LABELS[name] in md
    assert "2026-30" in md
    assert "Corpus expansion suggestions" in md


def test_markdown_includes_delta_and_status():
    previous = {"service_routing": {"precision": 0.5, "recall": 0.5}}
    md = report.render_markdown(_report(), week_label="2026-30", corpus_version="v0.6.0",
                                previous_values=previous)
    assert "Δ week-over-week" in md
    assert "green" in md


def test_unclassified_failures_listed():
    md = report.render_markdown(_report(), week_label="2026-30", corpus_version="v0.6.0",
                                unclassified_failures=["case-1: predicted [] vs expected [a]"])
    assert "case-1: predicted [] vs expected [a]" in md


def test_json_sidecar_is_machine_readable():
    import json

    payload = json.loads(report.render_json(_report(), week_label="2026-30", corpus_version="v0.6.0"))
    assert payload["week"] == "2026-30"
    assert set(payload["values"]) == set(metrics.METRIC_ROWS)
    assert payload["status"]["service_routing"] == "green"
