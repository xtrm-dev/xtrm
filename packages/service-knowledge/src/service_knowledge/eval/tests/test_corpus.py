"""Packaged eval corpus invariants (research §3.9 + PR5a VALIDATION). No vaultctl dependency."""
from __future__ import annotations

from pathlib import Path

from service_knowledge.eval import harness

CORPUS = Path(__file__).resolve().parent.parent / "corpus"

_REQUIRED_FIELDS = (
    "query_or_task", "touched_paths", "expected_services", "required_evidence",
    "forbidden_evidence", "expected_probes", "cross_repo_required", "outcome",
)

_ANCHORS = {
    "regression-api-gateway-wrong-claims",
    "regression-runners-wrong-commands",
    "regression-alertmanager-stale-webhook",
}


def test_corpus_meets_80_case_floor():
    cases = harness.load_corpus(CORPUS)
    assert len(cases) >= 80


def test_three_regression_anchors_present():
    cases = harness.load_corpus(CORPUS)
    ids = {case.case_id for case in cases}
    assert _ANCHORS <= ids


def test_every_case_has_full_3_9_labels():
    for case in harness.load_corpus(CORPUS):
        for field_name in _REQUIRED_FIELDS:
            assert hasattr(case, field_name), f"{case.case_id} missing {field_name}"
        assert case.query_or_task, f"{case.case_id} empty query_or_task"
        assert case.expected_services, f"{case.case_id} empty expected_services"
        assert isinstance(case.cross_repo_required, bool)


def test_every_case_has_resolvable_provenance():
    for case in harness.load_corpus(CORPUS):
        assert case.provenance.get("ref"), f"{case.case_id} missing provenance ref"
        assert case.provenance.get("type"), f"{case.case_id} missing provenance type"


def test_regression_anchors_carry_verifier_blocks():
    cases = {case.case_id: case for case in harness.load_corpus(CORPUS)}
    for anchor in _ANCHORS:
        assert cases[anchor].verifier, f"{anchor} missing verifier block"
        assert cases[anchor].verifier.get("expect_block") is True


def test_case_ids_are_unique():
    cases = harness.load_corpus(CORPUS)
    ids = [case.case_id for case in cases]
    assert len(ids) == len(set(ids))
