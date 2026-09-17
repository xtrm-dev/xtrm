from __future__ import annotations

import pytest

from xtrm_research.runner import start_run
from xtrm_research.store import run_dir, safe_segment

from .helpers import make_manifest


@pytest.mark.parametrize("bad", ["..", ".", "../escape", "a/b", "/abs/path", ""])
def test_safe_segment_rejects_unsafe_names(bad):
    with pytest.raises(ValueError):
        safe_segment(bad)


def test_safe_segment_accepts_normal_run_id():
    assert safe_segment("run-0001") == "run-0001"


def test_run_dir_rejects_traversal_run_id(runs_root):
    with pytest.raises(ValueError):
        run_dir(runs_root, "../escape")


def test_start_run_rejects_traversal_run_id(registry, runs_root):
    manifest = make_manifest(registry, run_id="../escape")
    with pytest.raises(ValueError):
        start_run(runs_root, "../escape", manifest)
    assert not (runs_root.parent / "escape").exists()
