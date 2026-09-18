"""compare_runs: per-metric deltas, unpaired reporting and per-run tolerance.

Slice XTRM-477. Every assertion here defends the app consumer
(packages/xtrm-app/src/adapters/research/live.ts): the compare payload's top
level must stay a mapping of run id to run summary, with delta data additive
*inside* each summary.
"""

from __future__ import annotations

import json

import pytest

from xtrm_research.assessments import write_assessment_set
from xtrm_research.cli.main import main
from xtrm_research.runner import start_run
from xtrm_research.views import compare_runs

from .helpers import FIXED_NOW, make_manifest

_SAMPLE = {
    "schema_version": "xtrm-research-sample/v1",
    "sample_id": "s-1",
    "index": 0,
    "input": {},
    "output": "not-a-duplicate",
    "status": "ok",
    "created_at": FIXED_NOW.isoformat(),
}


def _seed_run(
    registry, runs_root, run_id, metrics, *, tolerance=None, experiment_id=None
):
    """One run with a single assessment set carrying hand-set ``metrics``.

    ``metrics`` maps a bare metric name to ``(value, n)``; run_metrics
    namespaces it as ``<evaluator_id>::<name>``.
    """
    manifest = make_manifest(registry, run_id=run_id)
    if experiment_id is not None:
        manifest["experiment"]["id"] = experiment_id
    if tolerance is not None:
        manifest["tolerance"] = tolerance
    handle = start_run(runs_root, run_id, manifest)
    handle.write_sample(_SAMPLE)
    evaluator = registry.latest("evaluator", "exact-match")
    metric_payload = {
        name: {"value": value, "se": None, "ci95": None, "n": n, "method": "hand-set"}
        for name, (value, n) in metrics.items()
    }
    write_assessment_set(
        runs_root,
        run_id,
        f"{run_id}-as",
        evaluator,
        [],
        metric_payload,
        now=FIXED_NOW,
    )
    return runs_root


def _run_cli(argv, capsys):
    exit_code = main(argv)
    return exit_code, json.loads(capsys.readouterr().out.strip())


def test_self_compare_is_zero_delta_and_entry_present(registry, runs_root):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})

    result = compare_runs(runs_root, ["run-a"], "run-a")

    assert "run-a" in result
    summary = result["run-a"]
    delta = summary["deltas"]["exact-match::accuracy"]
    assert delta["value_delta"] == 0.0
    assert delta["baseline_n"] == 4
    assert delta["run_n"] == 4
    assert summary["unpaired_metrics"] == []
    # existing summary keys keep their exact meaning
    assert summary["metrics"]["exact-match::accuracy"]["value"] == 0.5
    assert summary["sample_count"] == 1
    assert summary["event_count"] == 0


def test_unpaired_metric_names_missing_side_and_is_never_zero_filled(
    registry, runs_root
):
    _seed_run(
        registry, runs_root, "run-base", {"accuracy": (0.5, 4), "precision": (0.25, 4)}
    )
    _seed_run(
        registry, runs_root, "run-other", {"accuracy": (0.6, 4), "recall": (0.75, 4)}
    )

    result = compare_runs(runs_root, ["run-base", "run-other"], "run-base")

    other = result["run-other"]
    assert other["unpaired_metrics"] == [
        {"metric": "exact-match::precision", "missing_side": "run"},
        {"metric": "exact-match::recall", "missing_side": "baseline"},
    ]
    # A missing metric is never zero-filled: it is absent from deltas entirely.
    assert "exact-match::precision" not in other["deltas"]
    assert "exact-match::recall" not in other["deltas"]
    assert set(other["deltas"]) == {"exact-match::accuracy"}


def test_within_tolerance_true_false_and_null_are_three_distinct_states(
    registry, runs_root
):
    _seed_run(registry, runs_root, "run-base", {"accuracy": (1.0, 4)})
    _seed_run(registry, runs_root, "run-in", {"accuracy": (1.04, 4)}, tolerance=0.05)
    _seed_run(registry, runs_root, "run-out", {"accuracy": (1.1, 4)}, tolerance=0.05)
    _seed_run(registry, runs_root, "run-none", {"accuracy": (1.2, 4)})

    result = compare_runs(
        runs_root, ["run-base", "run-in", "run-out", "run-none"], "run-base"
    )

    def flag(run_id):
        return result[run_id]["deltas"]["exact-match::accuracy"]["within_tolerance"]

    assert flag("run-in") is True  # |0.04| <= 0.05, just inside
    assert flag("run-out") is False  # |0.10| > 0.05, just outside
    # No tolerance declared is null, and null is asserted as null, not falsy.
    assert flag("run-none") is None
    assert flag("run-none") is not False
    # The full value_delta is still reported when within tolerance.
    assert result["run-in"]["deltas"]["exact-match::accuracy"][
        "value_delta"
    ] == pytest.approx(0.04)
    assert result["run-out"]["deltas"]["exact-match::accuracy"][
        "value_delta"
    ] == pytest.approx(0.1)


def test_deltas_carry_both_n_values(registry, runs_root):
    _seed_run(registry, runs_root, "run-base", {"accuracy": (0.5, 8)})
    _seed_run(registry, runs_root, "run-other", {"accuracy": (0.9, 3)})

    result = compare_runs(runs_root, ["run-base", "run-other"], "run-base")

    delta = result["run-other"]["deltas"]["exact-match::accuracy"]
    assert delta["baseline_n"] == 8
    assert delta["run_n"] == 3
    assert delta["value_delta"] == pytest.approx(0.4)


def test_compare_different_experiments_is_refused_naming_both(registry, runs_root):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})
    _seed_run(
        registry,
        runs_root,
        "run-b",
        {"accuracy": (0.9, 4)},
        experiment_id="other-experiment",
    )

    with pytest.raises(ValueError) as excinfo:
        compare_runs(runs_root, ["run-a", "run-b"], "run-a")

    message = str(excinfo.value)
    assert "dup-detect-baseline" in message
    assert "other-experiment" in message


def test_compare_different_experiments_cli_is_ok_false(registry, runs_root, capsys):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})
    _seed_run(
        registry,
        runs_root,
        "run-b",
        {"accuracy": (0.9, 4)},
        experiment_id="other-experiment",
    )

    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "compare", "run-a", "run-b"], capsys
    )

    assert code != 0
    assert envelope["ok"] is False
    assert "dup-detect-baseline" in envelope["error"]
    assert "other-experiment" in envelope["error"]


def test_compare_top_level_maps_only_requested_run_ids(registry, runs_root):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})
    _seed_run(registry, runs_root, "run-b", {"accuracy": (0.6, 4)})
    _seed_run(registry, runs_root, "run-c", {"accuracy": (0.7, 4)})
    requested = ["run-a", "run-b", "run-c"]

    result = compare_runs(runs_root, requested, "run-a")

    # The app consumer maps EVERY top-level key through mapRunSummary, so the
    # top level may hold run summaries and nothing else — no baseline id, no
    # shared delta block.
    assert list(result) == requested
    assert set(result) == set(requested)
    for summary in result.values():
        assert set(summary) == {
            "metrics",
            "sample_count",
            "event_count",
            "deltas",
            "unpaired_metrics",
        }


def test_compare_cli_defaults_baseline_to_first_run_id(registry, runs_root, capsys):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})
    _seed_run(registry, runs_root, "run-b", {"accuracy": (0.9, 4)})

    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "compare", "run-a", "run-b"], capsys
    )

    assert code == 0
    assert envelope["command"] == "compare"
    assert set(envelope["data"]) == {"run-a", "run-b"}
    assert (
        envelope["data"]["run-a"]["deltas"]["exact-match::accuracy"]["value_delta"]
        == 0.0
    )
    assert envelope["data"]["run-b"]["deltas"]["exact-match::accuracy"][
        "value_delta"
    ] == pytest.approx(0.4)


def test_compare_cli_explicit_baseline_overrides_first(registry, runs_root, capsys):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})
    _seed_run(registry, runs_root, "run-b", {"accuracy": (0.9, 4)})

    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "compare",
            "run-a",
            "run-b",
            "--baseline",
            "run-b",
        ],
        capsys,
    )

    assert code == 0
    assert (
        envelope["data"]["run-b"]["deltas"]["exact-match::accuracy"]["value_delta"]
        == 0.0
    )
    assert envelope["data"]["run-a"]["deltas"]["exact-match::accuracy"][
        "value_delta"
    ] == pytest.approx(-0.4)


def test_compare_baseline_not_among_runs_is_refused(registry, runs_root):
    _seed_run(registry, runs_root, "run-a", {"accuracy": (0.5, 4)})

    with pytest.raises(ValueError, match="baseline run"):
        compare_runs(runs_root, ["run-a"], "run-missing")
