from __future__ import annotations

from datetime import timedelta

import pytest

from xtrm_research.assessments import list_assessment_sets, write_assessment_set
from xtrm_research.evaluators import exact_match_evaluate
from xtrm_research.runner import start_run
from xtrm_research.store import events_path, manifest_path, samples_path, status_path
from xtrm_research.views import run_metrics

from .helpers import FIXED_NOW, make_manifest


def _seed_run(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-eval")
    handle = start_run(runs_root, "run-eval", manifest)
    sample = {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": "s-1",
        "index": 0,
        "input": {},
        "output": "not-a-duplicate",
        "status": "ok",
        "created_at": FIXED_NOW.isoformat(),
    }
    handle.write_sample(sample)
    return manifest, [sample]


def _snapshot(runs_root, run_id):
    return {
        "manifest": manifest_path(runs_root, run_id).read_bytes(),
        "status": status_path(runs_root, run_id).read_bytes(),
        "samples": samples_path(runs_root, run_id).read_bytes(),
        "events": events_path(runs_root, run_id).read_bytes()
        if events_path(runs_root, run_id).exists()
        else b"",
    }


def test_second_evaluation_adds_set_execution_files_untouched(registry, runs_root):
    _manifest, samples = _seed_run(registry, runs_root)
    evaluator = registry.latest("evaluator", "exact-match")

    before = _snapshot(runs_root, "run-eval")

    assessments, metrics = exact_match_evaluate(
        samples, expected={"s-1": "not-a-duplicate"}
    )
    write_assessment_set(
        runs_root, "run-eval", "as-1", evaluator, assessments, metrics, now=FIXED_NOW
    )
    assessments2, metrics2 = exact_match_evaluate(
        samples, expected={"s-1": "duplicate"}
    )
    write_assessment_set(
        runs_root,
        "run-eval",
        "as-2",
        evaluator,
        assessments2,
        metrics2,
        now=FIXED_NOW + timedelta(hours=1),
    )

    assert _snapshot(runs_root, "run-eval") == before

    sets = list_assessment_sets(runs_root, "run-eval")
    assert {s["assessment_set_id"] for s in sets} == {"as-1", "as-2"}

    metrics = run_metrics(runs_root, "run-eval")
    assert (
        metrics["exact-match::accuracy"]["value"] == 0.0
    )  # as-2, the later timestamp, wins


def test_metric_merge_orders_by_timestamp_not_directory_name(registry, runs_root):
    # "a-set" sorts before "b-set" by directory name, but carries the
    # LATER timestamp: if the merge used directory-name order it would
    # apply b-set second and get 1.0; timestamp order applies a-set
    # second (it's later) and must get 0.0.
    _manifest, samples = _seed_run(registry, runs_root)
    evaluator = registry.latest("evaluator", "exact-match")

    _, metrics_early = exact_match_evaluate(
        samples, expected={"s-1": "not-a-duplicate"}
    )
    write_assessment_set(
        runs_root, "run-eval", "b-set", evaluator, [], metrics_early, now=FIXED_NOW
    )
    _, metrics_late = exact_match_evaluate(samples, expected={"s-1": "duplicate"})
    write_assessment_set(
        runs_root,
        "run-eval",
        "a-set",
        evaluator,
        [],
        metrics_late,
        now=FIXED_NOW + timedelta(hours=1),
    )

    merged = run_metrics(runs_root, "run-eval")
    assert (
        merged["exact-match::accuracy"]["value"] == 0.0
    )  # a-set (later) wins, not b-set


def test_assessment_set_is_write_once(registry, runs_root):
    _manifest, samples = _seed_run(registry, runs_root)
    evaluator = registry.latest("evaluator", "exact-match")
    assessments, metrics = exact_match_evaluate(
        samples, expected={"s-1": "not-a-duplicate"}
    )
    write_assessment_set(
        runs_root, "run-eval", "as-1", evaluator, assessments, metrics, now=FIXED_NOW
    )
    with pytest.raises(FileExistsError):
        write_assessment_set(
            runs_root,
            "run-eval",
            "as-1",
            evaluator,
            assessments,
            metrics,
            now=FIXED_NOW,
        )


def test_assessment_for_nonexistent_run_raises(registry, runs_root):
    evaluator = registry.latest("evaluator", "exact-match")
    with pytest.raises(FileNotFoundError):
        write_assessment_set(runs_root, "ghost", "as-1", evaluator, [], {})
    assert not (runs_root / "ghost").exists()


def test_assessment_set_id_path_traversal_rejected(registry, runs_root):
    _seed_run(registry, runs_root)
    evaluator = registry.latest("evaluator", "exact-match")
    with pytest.raises(ValueError):
        write_assessment_set(runs_root, "run-eval", "../../escaped", evaluator, [], {})
    assert not (runs_root.parent / "escaped").exists()


def test_assessment_referencing_unknown_sample_id_rejected(registry, runs_root):
    _seed_run(registry, runs_root)
    evaluator = registry.latest("evaluator", "exact-match")
    bad_assessments = [{"sample_id": "does-not-exist", "answer": {"noul": 1.0}}]
    with pytest.raises(ValueError, match="unknown sample"):
        write_assessment_set(
            runs_root, "run-eval", "as-bad", evaluator, bad_assessments, {}
        )
