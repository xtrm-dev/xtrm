"""Fail-closed corruption test — reconcile treats malformed canary config as off."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from service_knowledge.canary import state as state_mod
from service_knowledge.canary import decision


def _manifest():
    return SimpleNamespace(claims=[SimpleNamespace(claim_type=SimpleNamespace(value="symbol_name"))])


def _decision():
    return SimpleNamespace(verdict=SimpleNamespace(value="PASS"))


def test_corrupt_config_treated_as_off(tmp_path: Path) -> None:
    path = state_mod.state_file_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("::not-json::", encoding="utf-8")
    auto_merge, reason, snap = decision.evaluate(_manifest(), _decision(), state_root=tmp_path)
    assert auto_merge is False
    assert reason == "canary_off"
    assert snap["enabled"] is False


def test_wrong_type_treated_as_off(tmp_path: Path) -> None:
    path = state_mod.state_file_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('"not an object"', encoding="utf-8")
    auto_merge, reason, _ = decision.evaluate(_manifest(), _decision(), state_root=tmp_path)
    assert auto_merge is False
    assert reason == "canary_off"


def test_missing_file_treated_as_off(tmp_path: Path) -> None:
    auto_merge, reason, _ = decision.evaluate(_manifest(), _decision(), state_root=tmp_path)
    assert auto_merge is False
    assert reason == "canary_off"


def test_corruption_emits_fail_closed_log(tmp_path: Path) -> None:
    path = state_mod.state_file_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{bad", encoding="utf-8")
    state_mod.read_state(tmp_path)  # trigger the log
    log = state_mod.log_path(tmp_path)
    assert log.exists()
    lines = log.read_text(encoding="utf-8").strip().splitlines()
    assert any('"event":"fail_closed"' in line for line in lines)
