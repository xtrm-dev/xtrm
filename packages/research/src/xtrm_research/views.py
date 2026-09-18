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
from xtrm_research.store import events_path, run_exists, samples_path


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


def compare_runs(root: Path, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    return {run_id: run_summary(root, run_id) for run_id in run_ids}


def chart_dataset_rows(
    root: Path, run_ids: list[str], metric_key: str
) -> list[dict[str, Any]]:
    """One row per run carrying ``metric_key`` (an ``"<evaluator_id>::<metric>"``
    key from :func:`run_metrics`), for a chart_spec's named dataset."""
    rows = []
    for run_id in run_ids:
        metric = run_metrics(root, run_id).get(metric_key)
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
