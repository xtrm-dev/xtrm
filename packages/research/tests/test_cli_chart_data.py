"""Read-verb slice of Substrate XTRM-464 (bead XTRM-474): chart-data verb
over views.chart_dataset_rows and the xtrm-research-cli/v1 envelope."""

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


# --- chart-data ------------------------------------------------------------


def test_chart_data_returns_metric_rows(registry, runs_root, capsys):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "chart-data",
            "run-chart",
            "--metric",
            "exact-match::accuracy",
        ],
        capsys,
    )
    assert code == 0
    assert envelope["schema"] == "xtrm-research-cli/v1"
    assert envelope["command"] == "chart-data"
    assert envelope["ok"] is True
    assert envelope["error"] is None
    assert envelope["data"] == [
        {
            "run_id": "run-chart",
            "value": 1.0,
            "se": None,
            "ci95": None,
            "n": 1,
            "method": "exact_match",
        }
    ]


def test_chart_data_run_without_metric_is_explicit_no_metric_state(
    registry, runs_root, capsys
):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "chart-data",
            "run-chart",
            "--metric",
            "exact-match::missing",
        ],
        capsys,
    )
    assert code == 0
    assert envelope["ok"] is True
    assert envelope["data"] == [
        {
            "run_id": "run-chart",
            "state": "no_metric",
            "reason": "run 'run-chart' has no metric 'exact-match::missing'",
        }
    ]


def test_chart_data_unknown_run_returns_error_envelope(registry, runs_root, capsys):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "chart-data",
            "nope",
            "--metric",
            "exact-match::accuracy",
        ],
        capsys,
    )
    assert code != 0
    assert envelope["ok"] is False
    assert envelope["data"] is None
    assert "nope" in envelope["error"]


def test_chart_data_unreadable_manifest_returns_error_envelope(
    registry, runs_root, capsys
):
    _seed_chart_run(registry, runs_root)
    bad = runs_root / "run-bad"
    bad.mkdir(parents=True)
    (bad / "manifest.json").write_text("{not json")
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "chart-data",
            "run-bad",
            "--metric",
            "exact-match::accuracy",
        ],
        capsys,
    )
    assert code != 0
    assert envelope["ok"] is False
    assert envelope["data"] is None
    assert envelope["error"]


def test_chart_data_flags_work_in_either_position(registry, runs_root, capsys):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        [
            "chart-data",
            "run-chart",
            "--metric",
            "exact-match::accuracy",
            "--root",
            str(runs_root),
            "--json",
        ],
        capsys,
    )
    assert code == 0
    assert envelope["ok"] is True
    assert envelope["data"][0]["run_id"] == "run-chart"


def test_chart_data_resolves_unqualified_experiment_dataset_id(
    registry, runs_root, capsys
):
    _seed_chart_run(registry, runs_root)
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "chart-data",
            "run-chart",
            "--metric",
            "accuracy",
        ],
        capsys,
    )
    assert code == 0
    assert envelope["ok"] is True
    assert envelope["data"][0]["run_id"] == "run-chart"
    assert envelope["data"][0]["value"] == 1.0
