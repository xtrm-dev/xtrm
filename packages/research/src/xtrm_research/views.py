"""Derived views: metrics, compare and chart datasets.

Every view here is computed fresh from samples.jsonl, events.jsonl and
assessment sets on each call — nothing is cached as a stored dashboard
table, so a view is regenerable at any time and never becomes stale truth.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from xtrm_research.assessments import list_assessment_sets
from xtrm_research.jsonl import read_lines
from xtrm_research.store import (
    events_path,
    load_manifest,
    run_exists,
    samples_path,
)


def run_metrics(root: Path, run_id: str) -> dict[str, dict[str, Any]]:
    """Merge metrics across every assessment set for a run.

    Keys are namespaced ``"<evaluator_id>::<metric_name>"`` so two
    evaluators reporting the same metric name never collide. Later
    assessment sets (by ``timestamp``) win on a same-key collision;
    nothing is dropped, matching "re-evaluation adds a set, never rewrites".
    """
    merged: dict[str, dict[str, Any]] = {}
    for assessment_set in sorted(
        list_assessment_sets(root, run_id), key=lambda s: s["timestamp"]
    ):
        evaluator_id = assessment_set["evaluator"]["id"]
        for metric_name, metric in assessment_set["metrics"].items():
            merged[f"{evaluator_id}::{metric_name}"] = metric
    return merged


def run_summary(root: Path, run_id: str) -> dict[str, Any]:
    """Metrics plus counts derived straight from samples.jsonl/events.jsonl."""
    if not run_exists(root, run_id):
        raise FileNotFoundError(f"no such run: {run_id!r}")
    return {
        "metrics": run_metrics(root, run_id),
        "sample_count": sum(1 for _ in read_lines(samples_path(root, run_id))),
        "event_count": sum(1 for _ in read_lines(events_path(root, run_id))),
    }


def compare_runs(
    root: Path, run_ids: list[str], baseline_run_id: str
) -> dict[str, dict[str, Any]]:
    """Summaries for ``run_ids``, each carrying metric deltas against
    ``baseline_run_id``.

    The return value is still a mapping from run id to that run's existing
    summary — the top level is never anything else, because the app consumer
    (``packages/xtrm-app/src/adapters/research/live.ts``) maps *every* top-
    level key through :func:`run_summary`'s shape. The delta data is additive
    inside each summary:

    - ``deltas[key]`` for every metric key the run and the baseline share:
      ``value_delta`` (run minus baseline), the two ``n`` values it was
      computed from, and ``within_tolerance``. A delta says nothing about
      direction of merit: the data does not state whether higher is better.
    - ``unpaired_metrics`` lists ``{metric, missing_side}`` for every metric
      key present on only one side, so a missing metric is reported, never
      zero-filled or silently dropped.

    ``within_tolerance`` uses the *run's own* declared ``tolerance`` (a
    non-negative number on the run manifest): ``True``/``False`` inside or
    outside it, ``None`` — distinct from ``False`` — when the run declares
    none. The baseline's own entry is present with zero deltas for every
    shared metric.

    Raises ``ValueError`` if ``baseline_run_id`` is not one of ``run_ids``,
    or if the runs do not all belong to the baseline's experiment (their
    metric namespaces would not be comparable).
    """
    if baseline_run_id not in run_ids:
        raise ValueError(
            f"baseline run {baseline_run_id!r} is not among the compared runs: "
            f"{run_ids}"
        )
    manifests = {run_id: load_manifest(root, run_id) for run_id in run_ids}
    summaries = {run_id: run_summary(root, run_id) for run_id in run_ids}

    baseline_experiment = manifests[baseline_run_id]["experiment"]["id"]
    for run_id in run_ids:
        experiment = manifests[run_id]["experiment"]["id"]
        if experiment != baseline_experiment:
            raise ValueError(
                "refusing to compare runs from different experiments: baseline "
                f"{baseline_run_id!r} is in experiment {baseline_experiment!r}, "
                f"but {run_id!r} is in experiment {experiment!r}"
            )

    baseline_metrics = summaries[baseline_run_id]["metrics"]
    for run_id, summary in summaries.items():
        metrics = summary["metrics"]
        tolerance = manifests[run_id].get("tolerance")
        deltas: dict[str, dict[str, Any]] = {}
        unpaired: list[dict[str, str]] = []
        for key in sorted(set(metrics) | set(baseline_metrics)):
            if key not in baseline_metrics:
                unpaired.append({"metric": key, "missing_side": "baseline"})
            elif key not in metrics:
                unpaired.append({"metric": key, "missing_side": "run"})
            else:
                value_delta = metrics[key]["value"] - baseline_metrics[key]["value"]
                deltas[key] = {
                    "value_delta": value_delta,
                    "baseline_n": baseline_metrics[key]["n"],
                    "run_n": metrics[key]["n"],
                    "within_tolerance": (
                        None if tolerance is None else abs(value_delta) <= tolerance
                    ),
                }
        summary["deltas"] = deltas
        summary["unpaired_metrics"] = unpaired
    return summaries


def _chart_metric(
    metrics: dict[str, dict[str, Any]], metric_key: str
) -> dict[str, Any] | None:
    """Resolve an Experiment named-dataset id to exactly one run metric.

    Persisted assessment metrics are evaluator-namespaced. Experiment
    ``named_datasets`` are semantic ids, so an unqualified id such as
    ``"accuracy"`` may resolve to ``"exact-match::accuracy"``.
    Ambiguity fails closed instead of silently picking an evaluator.
    """
    exact = metrics.get(metric_key)
    if exact is not None:
        return exact
    suffix = f"::{metric_key}"
    matches = [(key, metric) for key, metric in metrics.items() if key.endswith(suffix)]
    if len(matches) > 1:
        names = ", ".join(key for key, _ in matches)
        raise ValueError(
            f"chart dataset {metric_key!r} is ambiguous across metrics: {names}"
        )
    return matches[0][1] if matches else None


def chart_dataset_rows(
    root: Path, run_ids: list[str], metric_key: str
) -> list[dict[str, Any]]:
    """One row per run carrying a chart_spec named dataset."""
    rows = []
    for run_id in run_ids:
        metric = _chart_metric(run_metrics(root, run_id), metric_key)
        if metric is not None:
            rows.append({"run_id": run_id, **metric})
    return rows


def list_experiments(registry_root: Path) -> list[dict[str, Any]]:
    """Every experiment definition in the registry, sorted by (id, version).

    Read straight from the registry directory (not derived from run rows),
    so an experiment with zero runs is still visible. Raises
    :class:`SchemaValidationError` for an unreadable registry or manifest."""
    from xtrm_research.definitions import load_definition
    from xtrm_research.schemas import SchemaValidationError

    kind_dir = Path(registry_root) / "experiment"
    if not kind_dir.is_dir():
        raise SchemaValidationError(
            f"no experiment registry under {Path(registry_root)}"
        )
    definitions = [
        load_definition("experiment", path) for path in sorted(kind_dir.glob("*.json"))
    ]
    definitions.sort(key=lambda d: (d["id"], d["version"]))
    return [{"id": d["id"], "version": d["version"]} for d in definitions]


def run_samples(root: Path, run_id: str) -> list[dict[str, Any]]:
    """Sample records for a run, read from samples.jsonl.

    Raises :class:`FileNotFoundError` for an unknown run or a missing
    samples file — never an empty success."""
    from xtrm_research.store import run_exists, samples_path

    if not run_exists(root, run_id):
        raise FileNotFoundError(f"no such run: {run_id!r}")
    path = samples_path(root, run_id)
    if not path.exists():
        raise FileNotFoundError(f"run {run_id!r} has no samples.jsonl")
    return list(read_lines(path))
