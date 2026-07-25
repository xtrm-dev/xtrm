"""State schema — read/write roundtrip; corrupted file → treat as off (fail-closed)."""
from __future__ import annotations

from pathlib import Path

from service_knowledge.canary import state as state_mod


def test_roundtrip_default_disabled(tmp_path: Path) -> None:
    assert state_mod.read_state(tmp_path) == state_mod.DISABLED


def test_roundtrip_enabled(tmp_path: Path) -> None:
    st = state_mod.CanaryState(
        enabled=True,
        classes=frozenset({"symbol", "literal"}),
        enabled_at="2026-07-25T12:00:00Z",
        enabled_by="jaggerxtrm",
    )
    state_mod.write_state(tmp_path, st)
    reread = state_mod.read_state(tmp_path)
    assert reread.enabled is True
    assert reread.classes == frozenset({"symbol", "literal"})
    assert reread.enabled_at == "2026-07-25T12:00:00Z"
    assert reread.enabled_by == "jaggerxtrm"
    assert reread.is_active is True


def test_corrupt_json_is_off(tmp_path: Path) -> None:
    path = state_mod.state_file_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not valid json", encoding="utf-8")
    assert state_mod.read_state(tmp_path) == state_mod.DISABLED


def test_not_object_is_off(tmp_path: Path) -> None:
    path = state_mod.state_file_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('["oops"]', encoding="utf-8")
    assert state_mod.read_state(tmp_path) == state_mod.DISABLED


def test_forbidden_classes_dropped(tmp_path: Path) -> None:
    st = state_mod.CanaryState(
        enabled=True,
        classes=frozenset({"symbol", "causal"}),  # write bypasses filter…
        enabled_at="t",
        enabled_by="op",
    )
    state_mod.write_state(tmp_path, st)
    # …but read re-filters against the allow-list.
    reread = state_mod.read_state(tmp_path)
    assert reread.classes == frozenset({"symbol"})
    assert reread.enabled is True


def test_enabled_with_no_allowed_classes_is_off(tmp_path: Path) -> None:
    st = state_mod.CanaryState(
        enabled=True,
        classes=frozenset({"causal"}),
        enabled_at="t",
        enabled_by="op",
    )
    state_mod.write_state(tmp_path, st)
    assert state_mod.read_state(tmp_path) == state_mod.DISABLED
