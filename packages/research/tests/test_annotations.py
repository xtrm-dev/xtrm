from __future__ import annotations

import pytest

from xtrm_research.annotations import append_annotation, latest_conclusion
from xtrm_research.runner import start_run
from xtrm_research.store import events_path, manifest_path, samples_path, status_path

from .helpers import FIXED_NOW, make_manifest


def test_annotate_appends_execution_files_byte_identical(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-annotate")
    handle = start_run(runs_root, "run-annotate", manifest)
    handle.write_sample(
        {
            "schema_version": "xtrm-research-sample/v1",
            "sample_id": "s-1",
            "index": 0,
            "input": {},
            "status": "ok",
            "created_at": FIXED_NOW.isoformat(),
        }
    )
    handle.write_event(
        {
            "schema_version": "xtrm-research-event/v1",
            "seq": 0,
            "ts": FIXED_NOW.isoformat(),
            "kind": "x",
        }
    )

    def snapshot():
        return {
            "manifest": manifest_path(runs_root, "run-annotate").read_bytes(),
            "status": status_path(runs_root, "run-annotate").read_bytes(),
            "samples": samples_path(runs_root, "run-annotate").read_bytes(),
            "events": events_path(runs_root, "run-annotate").read_bytes(),
        }

    before = snapshot()
    append_annotation(
        runs_root, "run-annotate", author="me", kind="conclusion", text="looks fine"
    )
    after = snapshot()

    assert before == after
    assert latest_conclusion(runs_root, "run-annotate") == "looks fine"


def test_annotate_nonexistent_run_raises(runs_root):
    with pytest.raises(FileNotFoundError):
        append_annotation(runs_root, "ghost", author="me", kind="caveat", text="t")
    assert not (runs_root / "ghost").exists()


def test_torn_annotation_then_append_repairs_and_keeps_latest(registry, runs_root):
    from xtrm_research.annotations import list_annotations
    from xtrm_research.store import annotations_path

    manifest = make_manifest(registry, run_id="run-torn-ann")
    start_run(runs_root, "run-torn-ann", manifest)
    with annotations_path(runs_root, "run-torn-ann").open("a", encoding="utf-8") as f:
        f.write('{"author": "x", "ki')  # torn mid-write

    append_annotation(
        runs_root, "run-torn-ann", author="me", kind="conclusion", text="later"
    )

    rows = list_annotations(runs_root, "run-torn-ann")
    assert [r["text"] for r in rows] == ["later"]


def test_result_summary_annotation_roundtrip(registry, runs_root):
    from xtrm_research.annotations import list_annotations

    manifest = make_manifest(registry, run_id="run-summary")
    start_run(runs_root, "run-summary", manifest)
    summary = {
        "plain_language": "Arm B recovered 91% of ready contracts.",
        "supported_claims": ["arm B separated ready from draft contracts"],
        "unsupported_claims": ["production adoption"],
        "caveats": ["labels are adjudicated, not outcomes"],
        "decision": "keep the incumbent readiness logic until outcome labels exist",
    }
    row = append_annotation(
        runs_root,
        "run-summary",
        "test",
        "result_summary",
        evidence_status="exploratory",
        result_summary=summary,
    )
    assert "text" not in row  # the headline lives in plain_language
    assert row["result_summary"] == summary
    listed = list_annotations(runs_root, "run-summary")
    assert listed[-1]["kind"] == "result_summary"
    assert listed[-1]["result_summary"]["plain_language"].startswith("Arm B")


def test_result_summary_requires_structured_block_and_status(registry, runs_root):
    from xtrm_research.schemas import SchemaValidationError

    manifest = make_manifest(registry, run_id="run-summary-2")
    start_run(runs_root, "run-summary-2", manifest)
    good = {
        "plain_language": "x",
        "supported_claims": [],
        "unsupported_claims": [],
        "caveats": [],
        "decision": "d",
    }
    # structured block present but evidence_status missing: rejected
    with pytest.raises(SchemaValidationError):
        append_annotation(
            runs_root,
            "run-summary-2",
            "test",
            "result_summary",
            result_summary=good,
        )
    # text alone is not a summary: rejected
    with pytest.raises(SchemaValidationError):
        append_annotation(
            runs_root,
            "run-summary-2",
            "test",
            "result_summary",
            "text alone is not a summary",
            evidence_status="exploratory",
        )
