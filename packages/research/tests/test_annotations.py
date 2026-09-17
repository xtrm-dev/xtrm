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
