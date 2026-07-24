"""Every emission writes valid JSON with required fields; no PII, no raw query text."""
from __future__ import annotations

import json
from pathlib import Path

from service_knowledge.eval import harness


def test_harness_events_are_valid_json_with_required_fields(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "one.json").write_text(json.dumps({
        "query_or_task": "sensitive-looking-user-name-that-must-not-leak",
        "touched_paths": ["src/x.py"],
        "expected_services": ["api-gateway"],
        "required_evidence": ["src/x.md"],
        "forbidden_evidence": [],
        "expected_probes": [],
        "cross_repo_required": False,
        "outcome": "success",
        "expected_verifier": "PASS",
        "provenance": ["synthetic:test_telemetry_shape"],
    }))
    out = tmp_path / "reports"
    harness.run(["run", "--corpus", str(corpus), "--output-dir", str(out),
                 "--consumer-root", str(tmp_path)])
    events_path = tmp_path / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"
    text = events_path.read_text(encoding="utf-8")
    assert "sensitive-looking-user-name-that-must-not-leak" not in text
    lines = [json.loads(line) for line in text.splitlines() if line.strip()]
    assert lines, "no telemetry lines emitted"
    required = {"timestamp", "component", "event"}
    for rec in lines:
        assert required <= set(rec), f"missing required fields in {rec}"
        assert rec["component"] == "eval-harness"


def test_verifier_telemetry_jsonl_side_channel(tmp_path: Path, monkeypatch) -> None:
    verifier = __import__("service_knowledge.scripts.verifier", fromlist=["*"])
    fixtures_dir = Path(__file__).resolve().parents[2] / "scripts" / "verifier" / "tests" / "fixtures" / "api-gateway"
    if not (fixtures_dir / "candidate.md").exists():
        import pytest
        pytest.skip("api-gateway fixtures not shipped")
    monkeypatch.setenv("SERVICE_KNOWLEDGE_CONSUMER_ROOT", str(tmp_path))
    corpus = verifier.SourceCorpus(base_dir=fixtures_dir / "source")
    verifier.verify_candidate(
        (fixtures_dir / "candidate.md").read_text(),
        (fixtures_dir / "current.md").read_text(),
        service_id="api-gateway",
        corpus=corpus,
        verified_at_ref="",
        emit_telemetry=True,
    )
    events = (tmp_path / ".xtrm" / "state" / "service-knowledge" / "events.jsonl").read_text()
    lines = [json.loads(line) for line in events.splitlines() if line.strip()]
    assert any(rec["component"] == "verifier" and rec["event"] == "run" for rec in lines)
    for rec in lines:
        assert "timestamp" in rec
        assert "raw_query" not in rec
