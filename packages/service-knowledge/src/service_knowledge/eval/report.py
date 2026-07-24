"""Weekly eval report renderer (research §3.9 + PR5a VALIDATION).

Renders a :class:`MetricReport` to the Markdown shape the weekly workflow publishes: raw metric
values, week-over-week delta against the previous report, green/yellow/red threshold status, and
corpus-expansion suggestions derived from unclassified failures. Raw values only — no smoothing.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from service_knowledge.eval import metrics
from service_knowledge.eval.metrics import MetricReport

_STATUS_EMOJI = {"green": "🟢", "yellow": "🟡", "red": "🔴", "unknown": "⚪"}


def _format_value(name: str, value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, dict):  # service_routing -> precision/recall pair
        precision = value.get("precision")
        recall = value.get("recall")
        return f"p={_fmt_num(precision)} / r={_fmt_num(recall)}"
    unit = metrics.THRESHOLDS[name].unit
    return f"{_fmt_num(value)}{unit}"


def _fmt_num(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def parse_previous_values(previous_path: Path | None) -> dict[str, Any]:
    """Read the raw-values JSON sidecar of the previous report (empty if none)."""
    if previous_path is None or not previous_path.exists():
        return {}
    try:
        return json.loads(previous_path.read_text(encoding="utf-8")).get("values", {})
    except (OSError, json.JSONDecodeError):
        return {}


def _delta(name: str, current: Any, previous: Any) -> str:
    current_number = _headline(current)
    previous_number = _headline(previous)
    if current_number is None or previous_number is None:
        return "—"
    change = current_number - previous_number
    arrow = "▲" if change > 0 else ("▼" if change < 0 else "＝")
    return f"{arrow} {abs(change):.3f}"


def _headline(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("precision")
    return value if isinstance(value, (int, float)) else None


def render_markdown(
    report: MetricReport,
    *,
    week_label: str,
    corpus_version: str,
    previous_values: dict[str, Any] | None = None,
    unclassified_failures: list[str] | None = None,
) -> str:
    """Render the weekly Markdown report."""
    previous = previous_values or {}
    lines: list[str] = []
    lines.append(f"# service-knowledge eval report — {week_label}")
    lines.append("")
    lines.append(f"- corpus_version: `{corpus_version}`")
    lines.append(f"- case_count: **{report.case_count}**")
    lines.append(f"- generated: {_utc_now()}")
    lines.append("")
    lines.append("## Metrics")
    lines.append("")
    lines.append("| Metric | Value | Δ week-over-week | Status | Cases |")
    lines.append("|---|---|---|---|---|")
    for name in metrics.METRIC_ROWS:
        label = metrics.METRIC_LABELS[name]
        value = report.values.get(name)
        status = report.status.get(name, "unknown")
        emoji = _STATUS_EMOJI.get(status, "⚪")
        lines.append(
            f"| {label} | {_format_value(name, value)} | {_delta(name, value, previous.get(name))} "
            f"| {emoji} {status} | {report.measurable.get(name, 0)} |"
        )
    lines.append("")
    lines.append("## Corpus expansion suggestions")
    lines.append("")
    if unclassified_failures:
        lines.append("Unclassified failures to label and fold into the corpus:")
        lines.append("")
        for failure in unclassified_failures:
            lines.append(f"- {failure}")
    else:
        lines.append("No unclassified failures this week. Consider adding drift-history and")
        lines.append("diagnostic-task cases to keep coverage above the 80-case floor.")
    lines.append("")
    lines.append("_Raw values are machine-readable in the adjacent `.json` sidecar._")
    lines.append("")
    return "\n".join(lines)


def render_json(report: MetricReport, *, week_label: str, corpus_version: str) -> str:
    """Machine-readable sidecar: raw values + status + measurability."""
    payload = {
        "week": week_label,
        "corpus_version": corpus_version,
        "case_count": report.case_count,
        "values": report.values,
        "status": report.status,
        "measurable": report.measurable,
    }
    return json.dumps(payload, indent=2, ensure_ascii=False, default=str)


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def find_previous_sidecar(reports_dir: Path, current_week: str) -> Path | None:
    """Newest ``*.json`` sidecar in ``reports_dir`` older than ``current_week`` (by name sort)."""
    candidates = sorted(
        path for path in reports_dir.glob("*.json")
        if path.stem != current_week and re.match(r"^\d{4}-\d{2}$", path.stem)
    )
    return candidates[-1] if candidates else None
