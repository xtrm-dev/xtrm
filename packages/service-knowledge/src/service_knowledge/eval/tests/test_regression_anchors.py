"""The 3 api-gateway regression anchor cases are present in corpus; verifier catches them."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

CORPUS = Path(__file__).resolve().parents[1] / "corpus"
ANCHOR_IDS = {"api-gateway-invented-redaction-keys",
              "api-gateway-wrong-redaction-literal",
              "api-gateway-mislabeled-metric-labels"}


def _load_all():
    out = []
    for path in sorted(CORPUS.rglob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        for case in (raw if isinstance(raw, list) else [raw]):
            out.append((path, case))
    return out


def test_three_regression_anchors_present() -> None:
    anchor_names = set()
    for _, case in _load_all():
        anchor_names.add(case.get("case_id"))
    missing = ANCHOR_IDS - anchor_names
    assert not missing, f"missing regression anchor cases: {missing}"


def test_verifier_catches_each_anchor() -> None:
    verifier = pytest.importorskip("service_knowledge.scripts.verifier")
    fixtures_dir = Path(__file__).resolve().parents[2] / "scripts" / "verifier" / "tests" / "fixtures" / "api-gateway"
    if not (fixtures_dir / "candidate.md").exists():
        pytest.skip("api-gateway fixtures not shipped in this checkout")
    corpus = verifier.SourceCorpus(base_dir=fixtures_dir / "source")
    if (fixtures_dir / "source").is_dir():
        for src in (fixtures_dir / "source").rglob("*"):
            if src.is_file():
                rel = src.relative_to(fixtures_dir / "source").as_posix()
                corpus.files[rel] = src.read_text(encoding="utf-8", errors="ignore")
    manifest = verifier.verify_candidate(
        (fixtures_dir / "candidate.md").read_text(encoding="utf-8"),
        (fixtures_dir / "current.md").read_text(encoding="utf-8"),
        service_id="api-gateway",
        corpus=corpus,
        verified_at_ref="",
        emit_telemetry=False,
    )
    verdicts = {c.verdict.value for c in manifest.claims}
    assert "CONFLICT" in verdicts, f"verifier did not flag any conflict; verdicts={verdicts}"
