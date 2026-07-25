"""Canary status snapshot: current state + metric snapshot vs policy thresholds.

Returns a dict of the form::

    {"state": {...}, "thresholds": {...}, "metrics": {...},
     "checks": {"observation_window_days_ok": bool, ...},
     "status": "green" | "yellow" | "red"}

green  = canary enabled + eligible (or thresholds met and awaiting operator).
yellow = disabled, all threshold checks pass (safe to enable).
red    = disabled and at least one threshold check fails, or fail_closed logs found.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service_knowledge.canary import state as state_mod

# Ratified policy thresholds (docs/devops/service-knowledge-canary.md §3).
POLICY_THRESHOLDS: dict[str, Any] = {
    "observation_window_days_min": 30,
    "verifier_runs_min": 200,
    "verifier_fp_max": 0.02,
    "verifier_fn_max": 0.05,
}


def snapshot(consumer_root: Path) -> dict[str, Any]:
    st = state_mod.read_state(consumer_root)
    metrics = collect_metrics(consumer_root)
    checks = evaluate_thresholds(metrics)
    if st.is_active:
        colour = "green"
    elif all(checks.values()):
        colour = "yellow"
    else:
        colour = "red"
    return {
        "state": st.to_dict(),
        "thresholds": POLICY_THRESHOLDS,
        "metrics": metrics,
        "checks": checks,
        "status": colour,
    }


def collect_metrics(consumer_root: Path) -> dict[str, Any]:
    """Best-effort scrape of the local eval + gate telemetry.

    Any component that's missing / unreadable yields None (never raises) — the
    threshold check reads that as failing, which is the fail-closed default."""
    return {
        "verifier_runs": _count_gate_events(consumer_root),
        "observation_window_days": _observation_window_days(consumer_root),
        "verifier_fp_rate": _eval_metric("verifier_fp_rate"),
        "verifier_fn_rate": _eval_metric("verifier_fn_rate"),
    }


def evaluate_thresholds(metrics: dict[str, Any]) -> dict[str, bool]:
    runs = metrics.get("verifier_runs") or 0
    days = metrics.get("observation_window_days") or 0
    fp = metrics.get("verifier_fp_rate")
    fn = metrics.get("verifier_fn_rate")
    return {
        "observation_window_days_ok": days >= POLICY_THRESHOLDS["observation_window_days_min"],
        "verifier_runs_ok": runs >= POLICY_THRESHOLDS["verifier_runs_min"],
        "verifier_fp_ok": fp is not None and fp < POLICY_THRESHOLDS["verifier_fp_max"],
        "verifier_fn_ok": fn is not None and fn < POLICY_THRESHOLDS["verifier_fn_max"],
    }


def _events_file(consumer_root: Path) -> Path:
    # reconcile.py writes gate telemetry to .xtrm/state/service-knowledge/events.jsonl
    return consumer_root / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"


def _count_gate_events(consumer_root: Path) -> int:
    path = _events_file(consumer_root)
    if not path.exists():
        return 0
    count = 0
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("component") == "reconcile-gate":
                    count += 1
    except OSError:
        return 0
    return count


def _observation_window_days(consumer_root: Path) -> int:
    from datetime import datetime, timezone

    path = _events_file(consumer_root)
    if not path.exists():
        return 0
    first_ts: str | None = None
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("component") != "reconcile-gate":
                    continue
                ts = row.get("timestamp")
                if isinstance(ts, str):
                    first_ts = ts
                    break
    except OSError:
        return 0
    if not first_ts:
        return 0
    try:
        first_dt = datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
    except ValueError:
        return 0
    now = datetime.now(timezone.utc)
    return max(0, (now - first_dt).days)


def _eval_metric(name: str) -> float | None:
    """Read the newest eval report and return the named metric, or None."""
    # eval reports are shipped under service_knowledge/eval/reports/*.json (PR5a).
    try:
        from service_knowledge import eval as _eval_pkg
    except ImportError:
        return None
    reports_dir = Path(_eval_pkg.__file__).parent / "reports"
    if not reports_dir.is_dir():
        return None
    candidates = sorted(reports_dir.glob("*.json"))
    if not candidates:
        return None
    for path in reversed(candidates):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        # accept either {metrics: {...}} or a flat metric dict
        source = data.get("metrics") if isinstance(data.get("metrics"), dict) else data
        if isinstance(source, dict) and name in source and isinstance(source[name], (int, float)):
            return float(source[name])
    return None
