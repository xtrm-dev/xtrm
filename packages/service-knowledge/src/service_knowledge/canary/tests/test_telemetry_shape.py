"""Enable/disable events carry the required audit fields."""
from __future__ import annotations

import json
from pathlib import Path

from service_knowledge.canary import disable as disable_mod
from service_knowledge.canary import enable as enable_mod
from service_knowledge.canary import state as state_mod

GOOD_METRICS = {
    "verifier_runs": 500,
    "observation_window_days": 60,
    "verifier_fp_rate": 0.005,
    "verifier_fn_rate": 0.02,
}


def _log_lines(root: Path) -> list[dict]:
    p = state_mod.log_path(root)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


REQUIRED_FIELDS = {
    "timestamp",
    "component",
    "event",
    "classes",
    "enabled_by",
    "thresholds_at_enable_time",
    "git_commit",
}


def test_enable_event_shape(tmp_path: Path) -> None:
    enable_mod.enable(
        tmp_path,
        ["symbol", "literal"],
        enabled_by="op",
        assume_yes=True,
        metrics=GOOD_METRICS,
        git_commit="abc123",
    )
    lines = _log_lines(tmp_path)
    enable_lines = [ln for ln in lines if ln.get("event") == "enable"]
    assert len(enable_lines) == 1
    entry = enable_lines[0]
    assert REQUIRED_FIELDS.issubset(entry.keys())
    assert entry["component"] == "canary"
    assert entry["classes"] == ["literal", "symbol"]
    assert entry["enabled_by"] == "op"
    assert entry["git_commit"] == "abc123"
    assert entry["thresholds_at_enable_time"] == GOOD_METRICS
    assert entry["timestamp"].endswith("Z")


def test_disable_event_shape(tmp_path: Path) -> None:
    enable_mod.enable(
        tmp_path,
        ["symbol"],
        enabled_by="op",
        assume_yes=True,
        metrics=GOOD_METRICS,
        git_commit="abc",
    )
    disable_mod.disable(tmp_path, disabled_by="op2")
    lines = _log_lines(tmp_path)
    disable_lines = [ln for ln in lines if ln.get("event") == "disable"]
    assert len(disable_lines) == 1
    entry = disable_lines[0]
    assert REQUIRED_FIELDS.issubset(entry.keys())
    assert entry["component"] == "canary"
    assert entry["enabled_by"] == "op2"
    # disable records what was previously enabled
    assert entry["classes"] == ["symbol"]
