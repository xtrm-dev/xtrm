"""Derived views: metrics, compare and chart datasets.

Every view here is computed fresh from samples.jsonl, events.jsonl and
assessment sets on each call — nothing is cached as a stored dashboard
table, so a view is regenerable at any time and never becomes stale truth.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from xtrm_research.assessments import list_assessment_sets


def run_metrics(root: Path, run_id: str) -> dict[str, dict[str, Any]]:
    """Merge metrics across every assessment set for a run.

    Later assessment sets (by ``timestamp``) win on a metric-name collision;
    nothing is dropped, matching "re-evaluation adds a set, never rewrites".
    """
    merged: dict[str, dict[str, Any]] = {}
    for assessment_set in sorted(
        list_assessment_sets(root, run_id), key=lambda s: s["timestamp"]
    ):
        merged.update(assessment_set["metrics"])
    return merged


def compare_runs(root: Path, run_ids: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    return {run_id: run_metrics(root, run_id) for run_id in run_ids}


def chart_dataset_rows(
    root: Path, run_ids: list[str], metric_name: str
) -> list[dict[str, Any]]:
    """One row per run carrying ``metric_name``, for a chart_spec's named dataset."""
    rows = []
    for run_id in run_ids:
        metric = run_metrics(root, run_id).get(metric_name)
        if metric is not None:
            rows.append({"run_id": run_id, **metric})
    return rows
