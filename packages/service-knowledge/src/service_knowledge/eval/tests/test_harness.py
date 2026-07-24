"""End-to-end eval harness run against the packaged corpus (vaultctl-backed; run in CI)."""
from __future__ import annotations

import json
from pathlib import Path

from service_knowledge.eval import harness, metrics

CORPUS = Path(__file__).resolve().parent.parent / "corpus"


def test_run_corpus_emits_all_twelve_metrics(tmp_path):
    report, outcomes = harness.run_corpus(CORPUS, tmp_path, corpus_version="test", report_dir=tmp_path)
    assert report.case_count >= 80
    assert set(report.values) == set(metrics.METRIC_ROWS)
    assert set(report.status) == set(metrics.METRIC_ROWS)


def test_regression_anchors_route_correctly(tmp_path):
    _, outcomes = harness.run_corpus(CORPUS, tmp_path, corpus_version="test", report_dir=tmp_path)
    by_id = {outcome.case_id: outcome for outcome in outcomes}
    for anchor, service in [
        ("regression-api-gateway-wrong-claims", "api-gateway"),
        ("regression-runners-wrong-commands", "runners"),
        ("regression-alertmanager-stale-webhook", "alertmanager"),
    ]:
        outcome = by_id[anchor]
        assert service in outcome.predicted_services, f"{anchor} did not route to {service}"


def test_regression_anchors_verifier_catches_all_three(tmp_path):
    _, outcomes = harness.run_corpus(CORPUS, tmp_path, corpus_version="test", report_dir=tmp_path)
    by_id = {outcome.case_id: outcome for outcome in outcomes}
    for anchor in (
        "regression-api-gateway-wrong-claims",
        "regression-runners-wrong-commands",
        "regression-alertmanager-stale-webhook",
    ):
        # expect_block=True label + a blocking gate => one true positive per anchor, no FN.
        assert by_id[anchor].verifier_correct_blocked == 1, f"{anchor} not blocked"
        assert by_id[anchor].verifier_false_negative == 0


def test_no_stale_claim_escapes_on_anchors(tmp_path):
    _, outcomes = harness.run_corpus(CORPUS, tmp_path, corpus_version="test", report_dir=tmp_path)
    for outcome in outcomes:
        if outcome.case_id.startswith("regression-"):
            assert outcome.escaped_forbidden == set(), f"{outcome.case_id} leaked a stale claim"


def test_harness_telemetry_lines(tmp_path):
    harness.run_corpus(CORPUS, tmp_path, corpus_version="test", report_dir=tmp_path)
    events = (tmp_path / "events.jsonl").read_text().strip().splitlines()
    records = [json.loads(line) for line in events]
    assert all(r["component"] == "eval-harness" for r in records)
    runs = [r for r in records if r["event"] == "run"]
    metric_lines = [r for r in records if r["event"] == "metric_computed"]
    assert len(runs) == 1
    assert len(metric_lines) == 12  # one per §3.9 metric row
