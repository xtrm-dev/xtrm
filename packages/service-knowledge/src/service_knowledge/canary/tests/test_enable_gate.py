"""Enable gate — refuses when thresholds fail; succeeds when met + operator confirm."""
from __future__ import annotations

from pathlib import Path

import pytest

from service_knowledge.canary import enable as enable_mod
from service_knowledge.canary import state as state_mod

GOOD_METRICS = {
    "verifier_runs": 250,
    "observation_window_days": 45,
    "verifier_fp_rate": 0.01,
    "verifier_fn_rate": 0.03,
}
BAD_METRICS = {
    "verifier_runs": 10,
    "observation_window_days": 3,
    "verifier_fp_rate": 0.1,
    "verifier_fn_rate": 0.2,
}


def test_refuses_when_thresholds_fail(tmp_path: Path) -> None:
    with pytest.raises(enable_mod.CanaryEnableError, match="thresholds not met"):
        enable_mod.enable(
            tmp_path,
            ["symbol", "literal"],
            enabled_by="op",
            assume_yes=True,
            metrics=BAD_METRICS,
        )
    assert state_mod.read_state(tmp_path).enabled is False


def test_refuses_when_operator_declines(tmp_path: Path) -> None:
    with pytest.raises(enable_mod.CanaryEnableError, match="did not confirm"):
        enable_mod.enable(
            tmp_path,
            ["symbol"],
            enabled_by="op",
            confirm=lambda _prompt: "nope",
            metrics=GOOD_METRICS,
        )
    assert state_mod.read_state(tmp_path).enabled is False


def test_refuses_classes_outside_allow_list(tmp_path: Path) -> None:
    with pytest.raises(enable_mod.CanaryEnableError, match="outside allow-list"):
        enable_mod.enable(
            tmp_path,
            ["symbol", "causal"],
            enabled_by="op",
            assume_yes=True,
            metrics=GOOD_METRICS,
        )


def test_succeeds_with_good_metrics_and_confirm(tmp_path: Path) -> None:
    st = enable_mod.enable(
        tmp_path,
        ["symbol", "literal"],
        enabled_by="op",
        confirm=lambda _prompt: enable_mod.CONFIRM_PHRASE,
        metrics=GOOD_METRICS,
        git_commit="deadbeef",
    )
    assert st.enabled is True
    assert st.classes == frozenset({"symbol", "literal"})
    reread = state_mod.read_state(tmp_path)
    assert reread.enabled is True
    assert reread.is_active is True


def test_assume_yes_bypasses_only_confirm_not_thresholds(tmp_path: Path) -> None:
    # assume_yes with GOOD metrics succeeds…
    st = enable_mod.enable(
        tmp_path,
        ["symbol"],
        enabled_by="ci",
        assume_yes=True,
        metrics=GOOD_METRICS,
    )
    assert st.enabled is True
    # …but assume_yes with BAD metrics still refuses.
    with pytest.raises(enable_mod.CanaryEnableError, match="thresholds not met"):
        enable_mod.enable(
            tmp_path,
            ["symbol"],
            enabled_by="ci",
            assume_yes=True,
            metrics=BAD_METRICS,
        )
