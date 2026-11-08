"""Structural validator: frontmatter, headings, semantic-block regression, links."""
import json
from pathlib import Path

from verifier import load_canonical_headings, verify_candidate
from verifier.structural_validator import (
    SEMANTIC_END,
    SEMANTIC_START,
    has_errors,
    validate_structure,
)

HEADINGS = ["Service Overview", "Common Operations", "Semantic Deep Dive (Human/Agent Refined)"]


def _valid_doc() -> str:
    return (
        "---\nservice_id: svc\n---\n\n# Svc\n\n"
        "## Service Overview\n\nBody.\n\n"
        "## Common Operations\n\nDo things.\n\n"
        f"{SEMANTIC_START}\n## Semantic Deep Dive (Human/Agent Refined)\n\nCuratorial.\n{SEMANTIC_END}\n"
    )


def test_valid_document_has_no_errors():
    issues = validate_structure(_valid_doc(), canonical_headings=HEADINGS)
    assert not has_errors(issues)


def test_missing_frontmatter_is_an_error():
    doc = _valid_doc().replace("---\nservice_id: svc\n---\n\n", "")
    issues = validate_structure(doc, canonical_headings=HEADINGS)
    assert any(i.code == "missing_frontmatter" for i in issues)


def test_deleted_semantic_block_is_refused():
    # Regression: umbrella_generator + verifier must never corrupt the preserved block.
    doc = _valid_doc().replace(
        f"{SEMANTIC_START}\n## Semantic Deep Dive (Human/Agent Refined)\n\nCuratorial.\n{SEMANTIC_END}\n",
        "## Semantic Deep Dive (Human/Agent Refined)\n\nCuratorial.\n",
    )
    issues = validate_structure(doc, canonical_headings=HEADINGS)
    assert any(i.code == "semantic_block_deleted" and i.severity == "error" for i in issues)
    assert has_errors(issues)


def test_unbalanced_semantic_markers_are_refused():
    doc = _valid_doc().replace(SEMANTIC_END, "")
    issues = validate_structure(doc, canonical_headings=HEADINGS)
    assert any(i.code == "semantic_block_unbalanced" for i in issues)


def test_missing_canonical_heading_is_an_error():
    doc = _valid_doc().replace("## Common Operations\n\nDo things.\n\n", "")
    issues = validate_structure(doc, canonical_headings=HEADINGS)
    assert any(i.code == "missing_heading" and "Common Operations" in i.message for i in issues)


def test_broken_link_is_a_warning_not_error():
    doc = _valid_doc().replace("Body.", "See [docs]( for details.")
    issues = validate_structure(doc, canonical_headings=HEADINGS)
    assert any(i.code == "broken_link" and i.severity == "warning" for i in issues)
    assert not has_errors([i for i in issues if i.code == "broken_link"])


def test_heading_check_skipped_without_canonical_list():
    issues = validate_structure(_valid_doc(), canonical_headings=None)
    assert not any(i.code == "missing_heading" for i in issues)


def _contract_headings() -> tuple[Path, list[str]]:
    contract_path = Path(__file__).resolve().parents[3] / "contracts/service_skill_contract.json"
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    return contract_path, [entry["heading"] for entry in contract["canonical_headings"]]


def _contract_doc(headings: list[str]) -> str:
    sections = []
    for heading in headings:
        section = f"## {heading}\n\nContext.\n"
        if heading == "Semantic Deep Dive (Human/Agent Refined)":
            section = f"{SEMANTIC_START}\n{section}{SEMANTIC_END}\n"
        sections.append(section)
    return "---\nservice_id: svc\n---\n\n# Svc\n\n" + "\n".join(sections)


def test_default_contract_loads_all_real_headings():
    contract_path, headings = _contract_headings()
    assert len(headings) == 12
    assert load_canonical_headings(contract_path) == headings
    assert load_canonical_headings() == headings


def test_default_contract_verifies_missing_heading():
    _, headings = _contract_headings()
    candidate = _contract_doc(headings)
    full = verify_candidate(candidate, candidate, service_id="svc", emit_telemetry=False)
    assert not any(issue["code"] in {"missing_heading", "heading_order"}
                   for issue in full.structural_issues)
    assert not any(issue["severity"] == "error" for issue in full.structural_issues)
    missing_heading = headings[1]
    incomplete = candidate.replace(f"## {missing_heading}\n\nContext.\n", "")
    result = verify_candidate(incomplete, candidate, service_id="svc", emit_telemetry=False)
    assert any(
        issue["code"] == "missing_heading" and missing_heading in issue["message"]
        for issue in result.structural_issues
    )
    explicit = verify_candidate(
        incomplete, candidate, service_id="svc",
        canonical_headings=[heading for heading in headings if heading != missing_heading],
        emit_telemetry=False,
    )
    assert not any(issue["code"] == "missing_heading" for issue in explicit.structural_issues)
