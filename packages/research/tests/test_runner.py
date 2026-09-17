from __future__ import annotations

from datetime import timedelta

import pytest

from xtrm_research.runner import RunHandle, RunNotStartedError, retry_run, start_run
from xtrm_research.status import effective_status
from xtrm_research.store import load_manifest, manifest_path

from .helpers import FIXED_NOW, make_manifest


def test_refuses_to_write_sample_before_manifest_written(runs_root):
    handle = RunHandle(runs_root, "ghost-run")
    with pytest.raises(RunNotStartedError):
        handle.write_sample({"sample_id": "s-1"})


def test_refuses_to_write_event_before_manifest_written(runs_root):
    handle = RunHandle(runs_root, "ghost-run")
    with pytest.raises(RunNotStartedError):
        handle.write_event({"kind": "x"})


def test_start_run_writes_manifest_then_allows_samples(registry, runs_root):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    assert manifest_path(runs_root, manifest["run_id"]).exists()
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


def test_retry_creates_new_run_parent_files_untouched(registry, runs_root):
    parent = make_manifest(registry, run_id="run-parent")
    start_run(runs_root, "run-parent", parent)
    parent_manifest_bytes_before = manifest_path(runs_root, "run-parent").read_bytes()

    child_manifest = make_manifest(registry, run_id="run-retry")
    retry_run(
        runs_root, "run-parent", "run-retry", child_manifest, retried_sample_ids=["s-1"]
    )

    parent_manifest_bytes_after = manifest_path(runs_root, "run-parent").read_bytes()
    assert parent_manifest_bytes_before == parent_manifest_bytes_after

    child = load_manifest(runs_root, "run-retry")
    assert {"relation": "retry_of", "run_id": "run-parent"} in child["lineage"]
    assert child["retried_sample_ids"] == ["s-1"]


def test_heartbeat_stale_run_reports_interrupted(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-stale", now=FIXED_NOW)
    handle = start_run(runs_root, "run-stale", manifest)
    handle.heartbeat(now=FIXED_NOW)

    reloaded = load_manifest(runs_root, "run-stale")
    much_later = FIXED_NOW + timedelta(hours=1)
    assert effective_status(reloaded["status"], now=much_later) == "interrupted"
    assert (
        effective_status(reloaded["status"], now=FIXED_NOW + timedelta(seconds=1))
        == "started"
    )


def test_finish_run_sets_terminal_status(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-done")
    handle = start_run(runs_root, "run-done", manifest)
    handle.finish("success", now=FIXED_NOW)
    reloaded = load_manifest(runs_root, "run-done")
    assert effective_status(reloaded["status"], now=FIXED_NOW) == "success"


def test_finish_rejects_non_terminal_state(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-bad-finish")
    handle = start_run(runs_root, "run-bad-finish", manifest)
    with pytest.raises(ValueError):
        handle.finish("started")
