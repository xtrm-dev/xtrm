"""Reconcile canary read: on+PASS+enabled-classes → auto-merge; anything else → no auto-merge."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from service_knowledge.canary import enable as enable_mod
from service_knowledge.canary import state as state_mod

# reconcile.py runs sys.path.insert to reach the vendored `verifier` package; we
# only need its _canary_evaluate helper here, and the two lightweight class it
# uses (ClaimType lives in the verifier module already imported by reconcile).
from service_knowledge.canary import decision


def _mock_manifest(claim_type_values: list[str]):
    """Minimal manifest shape decision.evaluate reads: iterable of
    objects with a ``.claim_type.value`` attribute."""
    claims = [SimpleNamespace(claim_type=SimpleNamespace(value=v)) for v in claim_type_values]
    return SimpleNamespace(claims=claims)


def _decision(verdict: str = "PASS"):
    return SimpleNamespace(verdict=SimpleNamespace(value=verdict))


GOOD_METRICS = {
    "verifier_runs": 500,
    "observation_window_days": 60,
    "verifier_fp_rate": 0.005,
    "verifier_fn_rate": 0.02,
}


def _turn_canary_on(root: Path, classes: list[str]) -> None:
    enable_mod.enable(
        root,
        classes,
        enabled_by="test",
        assume_yes=True,
        metrics=GOOD_METRICS,
        git_commit="testsha",
    )


def test_canary_on_pass_all_enabled_classes_auto_merges(tmp_path: Path) -> None:
    _turn_canary_on(tmp_path, ["symbol", "literal"])
    manifest = _mock_manifest(["symbol_name", "quoted_literal"])
    auto_merge, reason, snap = decision.evaluate(manifest, _decision("PASS"), state_root=tmp_path)
    assert auto_merge is True
    assert reason == "ok"
    assert snap["enabled"] is True


def test_canary_on_pass_one_outside_class_falls_back(tmp_path: Path) -> None:
    _turn_canary_on(tmp_path, ["symbol", "literal"])
    manifest = _mock_manifest(["symbol_name", "causal_claim"])
    auto_merge, reason, _ = decision.evaluate(manifest, _decision("PASS"), state_root=tmp_path)
    assert auto_merge is False
    assert reason.startswith("forbidden_class:") or reason.startswith("non_enabled_class:")


def test_canary_off_never_auto_merges(tmp_path: Path) -> None:
    # No state file at all → canary is off.
    manifest = _mock_manifest(["symbol_name"])
    auto_merge, reason, _ = decision.evaluate(manifest, _decision("PASS"), state_root=tmp_path)
    assert auto_merge is False
    assert reason == "canary_off"


def test_non_pass_verdict_never_auto_merges(tmp_path: Path) -> None:
    _turn_canary_on(tmp_path, ["symbol"])
    manifest = _mock_manifest(["symbol_name"])
    for verdict in ("PASS_WITH_ADVISORIES", "CONFLICT", "UNKNOWN", "EVIDENCE_RACE"):
        auto_merge, reason, _ = decision.evaluate(manifest, _decision(verdict), state_root=tmp_path)
        assert auto_merge is False
        assert reason == f"verdict_not_pass:{verdict}"


def test_env_override_off_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _turn_canary_on(tmp_path, ["symbol"])
    monkeypatch.setenv("SERVICE_KNOWLEDGE_CANARY", "off")
    manifest = _mock_manifest(["symbol_name"])
    auto_merge, reason, _ = decision.evaluate(manifest, _decision("PASS"), state_root=tmp_path)
    assert auto_merge is False
    assert reason == "env_override_off"


def test_unmapped_claim_type_falls_back(tmp_path: Path) -> None:
    _turn_canary_on(tmp_path, ["symbol", "literal"])
    manifest = _mock_manifest(["symbol_name", "runtime_claim"])  # runtime_claim is not mapped
    auto_merge, reason, _ = decision.evaluate(manifest, _decision("PASS"), state_root=tmp_path)
    assert auto_merge is False
    assert reason.startswith("non_enabled_class:unmapped:")
