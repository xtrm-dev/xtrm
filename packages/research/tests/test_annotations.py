from __future__ import annotations

from xtrm_research.annotations import append_annotation, latest_conclusion
from xtrm_research.runner import start_run
from xtrm_research.store import events_path, manifest_path, samples_path

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

    before = {
        "manifest": manifest_path(runs_root, "run-annotate").read_bytes(),
        "samples": samples_path(runs_root, "run-annotate").read_bytes(),
        "events": events_path(runs_root, "run-annotate").read_bytes(),
    }

    append_annotation(
        runs_root, "run-annotate", author="me", kind="conclusion", text="looks fine"
    )

    after = {
        "manifest": manifest_path(runs_root, "run-annotate").read_bytes(),
        "samples": samples_path(runs_root, "run-annotate").read_bytes(),
        "events": events_path(runs_root, "run-annotate").read_bytes(),
    }
    assert before == after
    assert latest_conclusion(runs_root, "run-annotate") == "looks fine"
