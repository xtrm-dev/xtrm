"""Post-merge hook smoke: default-branch rebuild is attempted and advisory failures are swallowed."""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest


_HOOK_PATH = (
    Path(__file__).resolve().parents[3]
    / "service_knowledge"
    / "install"
    / "git-hooks"
    / "post_merge_drift_sweep.py"
)


@pytest.fixture
def post_merge_hook():
    spec = importlib.util.spec_from_file_location("post_merge_drift_sweep_test", _HOOK_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_branch_main_invokes_index_rebuild(post_merge_hook, monkeypatch, tmp_path):
    calls: list[Path] = []
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(post_merge_hook, "_has_registry", lambda root: True)
    monkeypatch.setattr(post_merge_hook, "_current_branch", lambda root: "main")
    monkeypatch.setattr(post_merge_hook, "_default_branch", lambda root: "main")
    monkeypatch.setattr(post_merge_hook, "_rebuild_knowledge_index", calls.append)

    drift_detector = types.ModuleType("drift_detector")
    drift_detector.scan_drift = lambda **kwargs: []
    monkeypatch.setitem(sys.modules, "drift_detector", drift_detector)

    assert post_merge_hook.main() == 0
    assert calls == [tmp_path]


def test_rebuild_failure_never_breaks_hook(post_merge_hook, monkeypatch, tmp_path):
    from service_knowledge import index

    def fail(root):
        raise RuntimeError("index unavailable")

    monkeypatch.setattr(index, "build", fail)
    post_merge_hook._rebuild_knowledge_index(tmp_path)
