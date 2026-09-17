from __future__ import annotations

import pytest

from xtrm_research.runner import start_run
from xtrm_research.schemas import SchemaValidationError
from xtrm_research.store import run_dir, safe_segment

from .helpers import make_manifest

_UNSAFE_NAMES = [
    "..",
    ".",
    "../escape",
    "a/b",
    "/abs/path",
    "",
    "a b",
    ".hidden",
    "a\\b",
    "été",
    "x" * 300,
    "a\nb",
    "a\x00b",
    ".leading-dot",
]


@pytest.mark.parametrize("bad", _UNSAFE_NAMES)
def test_safe_segment_rejects_unsafe_names(bad):
    with pytest.raises(ValueError):
        safe_segment(bad)


@pytest.mark.parametrize(
    "good", ["run-0001", "run-2026.09.17_a", "jev@v1", "run:1", "x" * 128]
)
def test_safe_segment_accepts_allowlisted_names(good):
    assert safe_segment(good) == good


def test_run_dir_rejects_traversal_run_id(runs_root):
    with pytest.raises(ValueError):
        run_dir(runs_root, "../escape")


def test_start_run_rejects_traversal_run_id(registry, runs_root):
    with pytest.raises((SchemaValidationError, ValueError)):
        manifest = make_manifest(registry, run_id="../escape")
        start_run(runs_root, "../escape", manifest)
    assert not (runs_root.parent / "escape").exists()
