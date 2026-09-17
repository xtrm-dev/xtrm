from __future__ import annotations

from xtrm_research.assessments import list_assessment_sets, write_assessment_set
from xtrm_research.evaluators import exact_match_evaluate
from xtrm_research.runner import start_run
from xtrm_research.store import events_path, manifest_path, samples_path
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


def test_second_evaluation_adds_set_execution_files_untouched(registry, runs_root):
    manifest, samples = _seed_run(registry, runs_root)
    evaluator = registry.latest("evaluator", "exact-match")

    before = {
        "manifest": manifest_path(runs_root, "run-eval").read_bytes(),
        "samples": samples_path(runs_root, "run-eval").read_bytes(),
        "events": events_path(runs_root, "run-eval").read_bytes()
        if events_path(runs_root, "run-eval").exists()
        else b"",
    }

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
        runs_root, "run-eval", "as-2", evaluator, assessments2, metrics2, now=FIXED_NOW
    )

    after = {
        "manifest": manifest_path(runs_root, "run-eval").read_bytes(),
        "samples": samples_path(runs_root, "run-eval").read_bytes(),
        "events": events_path(runs_root, "run-eval").read_bytes()
        if events_path(runs_root, "run-eval").exists()
        else b"",
    }
    assert before == after

    sets = list_assessment_sets(runs_root, "run-eval")
    assert {s["assessment_set_id"] for s in sets} == {"as-1", "as-2"}

    metrics = run_metrics(runs_root, "run-eval")
    assert (
        metrics["accuracy"]["value"] == 0.0
    )  # as-2 (later timestamp tie) wins the merge
