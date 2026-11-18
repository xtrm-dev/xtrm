"""Structural validator: frontmatter, headings, semantic-block regression, links."""
import json
from pathlib import Path

import pytest
from verifier import compute_gate, load_canonical_headings, verify_candidate
from verifier.gate import GateVerdict
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


def _semantic_preservation_doc(interiors: tuple[str, ...]) -> str:
    _, headings = _contract_headings()
    semantic_heading = "## Semantic Deep Dive (Human/Agent Refined)\n\n"
    original = f"{SEMANTIC_START}\n{semantic_heading}Context.\n{SEMANTIC_END}\n"
    blocks = "\n".join(f"{SEMANTIC_START}{interior}{SEMANTIC_END}" for interior in interiors)
    return _contract_doc(headings).replace(original, f"{semantic_heading}{blocks}\n")


@pytest.mark.parametrize(
    ("current_interiors", "candidate_interiors"),
    [
        (("\nCurated text.\n",), ("\n\n",)),
        (("\nCurated text.\n",), ("\nCurated text!\n",)),
        (("\nCurated text.\n",), ("",)),
        (("\nCurated text.\n",), ()),
        (("\nFirst.\n", "\nSecond.\n"), ("\nFirst.\n",)),
        (("\nFirst.\n",), ("\nFirst.\n", "\nSecond.\n")),
        (("\nFirst.\n",), ("\nFirst.\n", "\nFirst.\n")),
        (("\nFirst.\n", "\nSecond.\n"), ("\nSecond.\n", "\nFirst.\n")),
        (("\nCurated text.\n",), ("\nCurated text. \n",)),
        (("\nCurated text.\n",), ("\r\nCurated text.\r\n",)),
        (("\nCaf\u00e9.\n",), ("\nCafe\u0301.\n",)),
    ],
    ids=[
        "balanced-marker-deletion", "one-byte-edit", "empty-interior", "only-block-removed",
        "one-of-two-removed", "block-added", "duplicate-block-added", "blocks-reordered",
        "whitespace-edit", "line-ending-edit", "unicode-normalization",
    ],
)
def test_semantic_preservation_rejects_changed_interiors(current_interiors, candidate_interiors):
    current = _semantic_preservation_doc(current_interiors)
    candidate = _semantic_preservation_doc(candidate_interiors)
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    assert any(
        issue["code"] == "semantic_block_modified" and issue["severity"] == "error"
        for issue in manifest.structural_issues
    )
    assert not any(issue["code"] == "missing_heading" for issue in manifest.structural_issues)
    decision = compute_gate(manifest)
    assert decision.verdict is GateVerdict.INVALID
    assert decision.is_writable is False


@pytest.mark.parametrize("interiors", [("\nCurated text.\n",), ("",), ("\nFirst.\n", "\nSecond.\n")])
def test_semantic_preservation_allows_identical_interiors_with_outside_edits(interiors):
    current = _semantic_preservation_doc(interiors)
    candidate = current.replace("# Svc\n", "# Svc\n\nAdded intro.\n")
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    assert manifest.structural_issues == []
    assert compute_gate(manifest).verdict is GateVerdict.PASS
    assert compute_gate(manifest).is_writable is True


@pytest.mark.parametrize("current", ["", _semantic_preservation_doc(())], ids=["new-guide", "no-current-block"])
def test_semantic_preservation_allows_creation_without_current_blocks(current):
    candidate = _semantic_preservation_doc(("\nNew curated text.\n",))
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    assert manifest.structural_issues == []
    assert compute_gate(manifest).verdict is GateVerdict.PASS
    assert compute_gate(manifest).is_writable is True


@pytest.mark.parametrize(
    ("markers", "expected_code"),
    [
        ("", "semantic_block_deleted"),
        (SEMANTIC_START, "semantic_block_unbalanced"),
        (SEMANTIC_END + SEMANTIC_START, "semantic_block_order"),
    ],
)
def test_semantic_preservation_keeps_candidate_marker_errors(markers, expected_code):
    current = _semantic_preservation_doc(("\nCurated text.\n",))
    candidate = _semantic_preservation_doc(()) + markers
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    codes = {issue["code"] for issue in manifest.structural_issues if issue["severity"] == "error"}
    assert expected_code in codes
    assert "semantic_block_modified" in codes


def _curated_doc(notes: int = 40) -> str:
    """Contract doc whose outside-block prose carries ``notes`` unique hand-written lines."""
    prose = "".join(f"Runbook note {i}.\n\n" for i in range(notes))
    return _semantic_preservation_doc(("\nCurated text.\n",)).replace("# Svc\n\n", f"# Svc\n\n{prose}")


def _curated_issues(candidate: str, current: str) -> list[dict]:
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    return [i for i in manifest.structural_issues if i["code"].startswith("curated_text_removed")]


def test_few_removed_curated_lines_are_an_advisory_listing_them():
    current = _curated_doc()
    candidate = current.replace("Runbook note 3.\n\n", "").replace("Runbook note 7.\n\n", "")
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    (issue,) = _curated_issues(candidate, current)
    assert issue["code"] == "curated_text_removed"
    assert issue["severity"] == "warning"
    assert "Runbook note 3." in issue["message"] and "Runbook note 7." in issue["message"]
    assert not any(i["severity"] == "error" for i in manifest.structural_issues)
    decision = compute_gate(manifest)
    assert decision.verdict is GateVerdict.PASS_WITH_ADVISORIES
    assert decision.is_writable is True


def test_rewritten_curated_line_counts_as_removed():
    current = _curated_doc()
    candidate = current.replace("Runbook note 5.", "Runbook note five, reworded.")
    (issue,) = _curated_issues(candidate, current)
    assert "Runbook note 5." in issue["message"]


def test_advisory_message_lists_at_most_ten_lines():
    current = _curated_doc(notes=100)
    candidate = current
    for i in range(12):
        candidate = candidate.replace(f"Runbook note {i}.\n\n", "")
    (issue,) = _curated_issues(candidate, current)
    assert issue["code"] == "curated_text_removed"
    assert sum(f"Runbook note {i}." in issue["message"] for i in range(12)) == 10


def test_wholesale_curated_deletion_is_an_error_that_blocks():
    current = _curated_doc()
    candidate = current
    for i in range(30):
        candidate = candidate.replace(f"Runbook note {i}.\n\n", "")
    issues = _curated_issues(candidate, current)
    assert [(i["code"], i["severity"]) for i in issues] == [("curated_text_removed_excessive", "error")]
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    decision = compute_gate(manifest)
    assert decision.verdict is GateVerdict.INVALID
    assert decision.is_writable is False


@pytest.mark.parametrize("current", ["", "\n\n  \n"], ids=["creation", "blank-only-current"])
def test_curated_guard_skips_creation(current):
    assert _curated_issues(_curated_doc(), current) == []


def test_pure_additions_do_not_trigger_curated_guard():
    current = _curated_doc()
    candidate = current.replace("# Svc\n", "# Svc\n\nBrand new paragraph.\n") + "\nTrailing addition.\n"
    assert _curated_issues(candidate, current) == []


def test_whitespace_only_reformatting_is_not_a_removal():
    current = _curated_doc()
    candidate = current.replace("Runbook note 4.", "   Runbook note 4.   ").replace("Runbook note 9.\n\n", "Runbook note 9.\n")
    assert _curated_issues(candidate, current) == []


def test_removal_inside_semantic_block_is_only_the_semantic_error():
    current = _curated_doc()
    candidate = current.replace("Curated text.", "")
    manifest = verify_candidate(candidate, current, service_id="svc", emit_telemetry=False)
    codes = {i["code"] for i in manifest.structural_issues}
    assert "semantic_block_modified" in codes
    assert not any(code.startswith("curated_text_removed") for code in codes)


def _plain_curated_issues(candidate: str, current: str) -> list:
    issues = validate_structure(candidate, require_semantic_block=False, current_text=current)
    return [i for i in issues if i.code.startswith("curated_text_removed")]


def _numbered(count: int, rewritten: int = 0) -> str:
    return "\n".join(
        f"Line {i} rewritten." if i < rewritten else f"Line {i}." for i in range(count)
    ) + "\n"


# regression: reviewer finding 1 (duplicate-line multiplicity)
def test_deleting_one_of_two_identical_lines_is_a_removal():
    filler = "\n".join(f"Filler {i}." for i in range(20))
    current = f"- foo\nA\n- foo\nB\n{filler}\n"
    candidate = f"- foo\nA\nB\n{filler}\n"
    (issue,) = _plain_curated_issues(candidate, current)
    assert issue.code == "curated_text_removed"
    assert issue.message.startswith("1 curated line(s)")


def test_moved_line_consumes_exactly_one_pool_entry():
    filler = "\n".join(f"Filler {i}." for i in range(20))
    current = f"Moved.\nA\nB\n{filler}\n"
    candidate = f"A\nB\n{filler}\nMoved.\n"
    assert _plain_curated_issues(candidate, current) == []


# regression: reviewer finding 2 (same text inside a candidate SEMANTIC block is not "kept")
def test_identical_text_inside_candidate_semantic_block_does_not_hide_deletion():
    filler = "\n".join(f"Filler {i}." for i in range(20))
    block = f"{SEMANTIC_START}\nRunbook step.\n{SEMANTIC_END}\n"
    current = f"Runbook step.\n{filler}\n{block}"
    candidate = f"{filler}\n{block}"
    (issue,) = _plain_curated_issues(candidate, current)
    assert issue.code == "curated_text_removed"
    assert "Runbook step." in issue.message


# regression: reviewer finding 4 (line number must point at the removed line, not an earlier substring)
def test_advisory_line_points_at_the_removed_line():
    filler = "\n".join(f"Filler {i}." for i in range(20))
    current = f"foo bar baz\n{filler}\nbar\n"
    candidate = f"foo bar baz\n{filler}\n"
    (issue,) = _plain_curated_issues(candidate, current)
    assert issue.line == 22


@pytest.mark.parametrize(
    ("total", "rewritten", "expected_code", "expected_severity"),
    [
        (12, 4, "curated_text_removed", "warning"),
        (12, 7, "curated_text_removed", "warning"),
        (20, 8, "curated_text_removed_excessive", "error"),
        (40, 8, "curated_text_removed", "warning"),
    ],
    ids=["small-file-4-of-12", "7-of-12-below-min", "8-of-20-error", "8-of-40-under-ratio"],
)
def test_excessive_removal_needs_both_ratio_and_minimum_count(total, rewritten, expected_code, expected_severity):
    issues = _plain_curated_issues(_numbered(total, rewritten), _numbered(total))
    assert [(i.code, i.severity) for i in issues] == [(expected_code, expected_severity)]
