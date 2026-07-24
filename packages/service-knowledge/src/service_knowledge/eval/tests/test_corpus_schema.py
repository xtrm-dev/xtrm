"""Every corpus case has the 8-field shape and non-empty provenance."""
from __future__ import annotations

import json
from pathlib import Path

CORPUS = Path(__file__).resolve().parents[1] / "corpus"
REQUIRED = {
    "query_or_task",
    "touched_paths",
    "expected_services",
    "required_evidence",
    "forbidden_evidence",
    "expected_probes",
    "cross_repo_required",
    "outcome",
}


def _iter_cases():
    for path in sorted(CORPUS.rglob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        for case in (raw if isinstance(raw, list) else [raw]):
            yield path, case


def test_every_case_has_required_fields() -> None:
    total = 0
    for path, case in _iter_cases():
        missing = REQUIRED - set(case)
        assert not missing, f"{path.name}: missing fields {missing}"
        assert case["query_or_task"].strip(), f"{path.name}: empty query_or_task"
        assert isinstance(case["expected_services"], list), f"{path.name}: expected_services not a list"
        total += 1
    assert total >= 30, f"corpus too small: {total} cases (need >= 30 for baseline)"


def test_expected_services_resolve_against_fixture_registry() -> None:
    known = {"api-gateway", "runners", "alertmanager", "postgres", "redis", "orchestrator",
             "coordinator", "specialists", "service-knowledge", "bd", "sp", "xt", "xtrm",
             "worktree", "board-audit", "changelog-keeper", "sync-docs", "reviewer",
             "gitnexus", "vaultctl", "grafana", "prometheus", "tempo"}
    for path, case in _iter_cases():
        for svc in case["expected_services"]:
            assert svc in known, f"{path.name}: unknown service {svc!r}"


def test_provenance_links_non_empty() -> None:
    for path, case in _iter_cases():
        provenance = case.get("provenance")
        assert provenance, f"{path.name}: missing provenance"
        assert isinstance(provenance, (list, str)), f"{path.name}: provenance wrong type"
        if isinstance(provenance, list):
            assert provenance, f"{path.name}: empty provenance list"
