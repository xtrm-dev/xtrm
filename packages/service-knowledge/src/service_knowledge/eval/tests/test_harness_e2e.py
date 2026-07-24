"""Run harness on a synthetic 3-case corpus → produces YYYY-WW.md report."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from service_knowledge.eval import harness, metrics


def _write_case(dir: Path, name: str, service: str, expected_verifier: str = "PASS") -> None:
    (dir / f"{name}.json").write_text(json.dumps({
        "query_or_task": f"synthetic case {name}",
        "touched_paths": [f"src/{service}/handler.py"],
        "expected_services": [service],
        "required_evidence": [f"src/{service}/SKILL.md"],
        "forbidden_evidence": [],
        "expected_probes": [f"docker ps | grep {service}"],
        "cross_repo_required": False,
        "outcome": "success",
        "expected_verifier": expected_verifier,
        "provenance": ["synthetic:test_harness_e2e"],
    }))


def test_e2e_report_has_all_metrics(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    _write_case(corpus, "case1", "api-gateway")
    _write_case(corpus, "case2", "runners")
    _write_case(corpus, "case3", "alertmanager", expected_verifier="CONFLICT")

    out = tmp_path / "reports"
    rc = harness.run(["run", "--corpus", str(corpus), "--output-dir", str(out),
                      "--consumer-root", str(tmp_path)])
    assert rc == 0

    week = datetime.now(timezone.utc).isocalendar()
    report = out / f"{week.year}-W{week.week:02d}.md"
    assert report.exists()
    body = report.read_text(encoding="utf-8")
    for name in metrics.METRICS:
        assert f"`{name}`" in body, f"{name} missing from report"

    events = (tmp_path / ".xtrm" / "state" / "service-knowledge" / "events.jsonl").read_text()
    lines = [json.loads(line) for line in events.splitlines() if line.strip()]
    assert any(rec["event"] == "run" for rec in lines)
    assert any(rec["event"] == "metric_computed" for rec in lines)
