"""The three git hooks are standalone installed scripts, each carrying its own copy of
``_historical_files``. Keep the copies identical and prove the E2BIG chunking."""
from __future__ import annotations

import importlib.util
import re
import subprocess
from pathlib import Path

import pytest

HOOK_DIR = Path(__file__).resolve().parent.parent / "src" / "service_knowledge" / "install" / "git-hooks"
HOOKS = ["post_merge_drift_sweep.py", "post_checkout_drift_sweep.py", "post_rewrite_drift_sweep.py"]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name[:-3], HOOK_DIR / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # hooks only define functions at import; main() is guarded
    return module


def _block(name: str) -> str:
    text = (HOOK_DIR / name).read_text(encoding="utf-8")
    match = re.search(r"# Paths per `git ls-tree` call.*?\n    return historical\n", text, re.S)
    assert match, f"{name}: _historical_files block not found"
    return match.group(0)


def test_the_three_copies_of_historical_files_are_identical() -> None:
    blocks = {name: _block(name) for name in HOOKS}
    assert len(set(blocks.values())) == 1, "the hooks' _historical_files copies drifted apart"


@pytest.mark.parametrize("name", HOOKS)
def test_paths_are_chunked_not_passed_as_one_argv(name: str, tmp_path: Path, monkeypatch) -> None:
    hook = _load(name)
    calls: list[list[str]] = []

    def fake_git(root, args, timeout=5):
        calls.append(args)
        listed = args[args.index("--") + 1:]
        return subprocess.CompletedProcess(args, 0, stdout="\0".join(listed) + "\0", stderr="")

    monkeypatch.setattr(hook, "_git", fake_git)
    paths = {f"db/file-{n:05d}.sql" for n in range(1230)}

    result = hook._historical_files(tmp_path, ["oldref", "newref"], paths)

    assert result == paths
    per_call = [len(args[args.index("--") + 1:]) for args in calls]
    assert max(per_call) <= hook._LS_TREE_CHUNK
    assert len(calls) == 2 * 3  # two refs x ceil(1230 / 500)


@pytest.mark.parametrize("name", HOOKS)
def test_a_failing_chunk_yields_none_so_the_hook_writes_the_unknown_marker(name: str, tmp_path: Path, monkeypatch) -> None:
    hook = _load(name)
    seen = {"n": 0}

    def flaky_git(root, args, timeout=5):
        seen["n"] += 1
        return None if seen["n"] == 2 else subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(hook, "_git", flaky_git)
    assert hook._historical_files(tmp_path, ["ref"], {f"p{n}" for n in range(900)}) is None
