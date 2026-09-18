"""Samples read verb (XTRM-474 slice 3): a run's sample records from samples.jsonl."""

from __future__ import annotations

import json

from xtrm_research.assessments import write_assessment_set
from xtrm_research.cli.main import main
from xtrm_research.evaluators import exact_match_evaluate
from xtrm_research.runner import start_run

from .helpers import FIXED_NOW, make_manifest


def _run_cli(argv, capsys):
    exit_code = main(argv)
    out = capsys.readouterr().out.strip()
    return exit_code, json.loads(out)


def _seed_chart_run(registry, runs_root, run_id="run-chart"):
    manifest = make_manifest(registry, run_id=run_id)
    handle = start_run(runs_root, run_id, manifest)
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
    evaluator = registry.latest("evaluator", "exact-match")
    assessments, metrics = exact_match_evaluate(
        [{"sample_id": "s-1", "output": "not-a-duplicate"}],
        expected={"s-1": "not-a-duplicate"},
    )
    write_assessment_set(
        runs_root, run_id, "as-1", evaluator, assessments, metrics, now=FIXED_NOW
    )
    return runs_root


# --- samples ---------------------------------------------------------------


def test_samples_returns_records_from_samples_jsonl(registry, runs_root, capsys):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "samples", "run-chart"], capsys
    )
    assert code == 0
    assert envelope["schema"] == "xtrm-research-cli/v1"
    assert envelope["command"] == "samples"
    assert envelope["ok"] is True
    assert envelope["error"] is None
    assert [s["sample_id"] for s in envelope["data"]] == ["s-1"]
    assert envelope["data"][0]["output"] == "not-a-duplicate"


def test_samples_unknown_run_returns_error_envelope(registry, runs_root, capsys):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "samples", "nope"], capsys
    )
    assert code != 0
    assert envelope["ok"] is False
    assert envelope["data"] is None
    assert "nope" in envelope["error"]


def test_samples_missing_file_returns_error_envelope(registry, runs_root, capsys):
    manifest = make_manifest(registry, run_id="run-nosamp")
    start_run(runs_root, "run-nosamp", manifest)
    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "samples", "run-nosamp"], capsys
    )
    assert code != 0
    assert envelope["ok"] is False
    assert envelope["data"] is None
    assert "samples.jsonl" in envelope["error"]


def test_samples_flags_work_in_either_position(registry, runs_root, capsys):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        ["samples", "run-chart", "--root", str(runs_root), "--json"], capsys
    )
    assert code == 0
    assert envelope["ok"] is True
    assert [s["sample_id"] for s in envelope["data"]] == ["s-1"]
