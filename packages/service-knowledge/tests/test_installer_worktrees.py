"""B3: worktree-aware installer — five hooks, hooksPath override, --all-worktrees.

Isolates git global config (the dev host sets a global core.hooksPath) so the
git-resolved active dir is the repo default unless a test sets a local override.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest


def _git(args: list[str], cwd: Path) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


INSTALLER_PATH = (
    Path(__file__).resolve().parents[1]
    / "src" / "service_knowledge" / "install" / "install-service-knowledge.py"
)
HOOKS_DIR = INSTALLER_PATH.parent / "git-hooks"

DRIFT_HOOKS = ("post-merge", "post-checkout", "post-rewrite")
ALL_HOOKS = ("pre-commit", "pre-push", *DRIFT_HOOKS)


@pytest.fixture
def installer():
    spec = importlib.util.spec_from_file_location("install_service_knowledge_b3_test", INSTALLER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def isolated_git_config(monkeypatch) -> None:
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", os.devnull)


def _active_hooks_dir(repo: Path) -> Path:
    r = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--git-path", "hooks"],
        capture_output=True, text=True, check=True, timeout=5,
    )
    p = Path(r.stdout.strip())
    return p if p.is_absolute() else repo / p


def test_install_wires_five_hooks_and_chains_drift_trio(
    installer, consumer_repo: Path, isolated_git_config, capsys
) -> None:
    assert installer.install_git_hooks(consumer_repo) is True
    for name in ALL_HOOKS:
        src = consumer_repo / ".githooks" / name
        assert src.is_file(), name
    for name in DRIFT_HOOKS:
        text = (consumer_repo / ".githooks" / name).read_text(encoding="utf-8")
        assert "# [jaggers] drift-sweep" in text, name
        assert "git rev-parse --show-toplevel" in text, name
        assert '"$@"' in text, name  # argv+stdin passthrough for checkout/rewrite
    active = _active_hooks_dir(consumer_repo)
    for name in ALL_HOOKS:
        chain = (active / name).read_text(encoding="utf-8")
        assert "# [jaggers] chain-githooks" in chain, name
        assert f".githooks/{name}" in chain, name
    # Per-worktree self-check reports coverage.
    out = capsys.readouterr().out
    assert "3/3 drift hooks" in out


def test_install_repairs_stale_service_skills_paths_in_new_hooks(
    installer, consumer_repo: Path, isolated_git_config
) -> None:
    assert installer.install_git_hooks(consumer_repo) is True
    for name in DRIFT_HOOKS:
        hook = consumer_repo / ".githooks" / name
        hook.write_text(
            hook.read_text().replace("/service-knowledge/", "/service-skills/"),
            encoding="utf-8",
        )
    assert installer.install_git_hooks(consumer_repo) is True
    for name in DRIFT_HOOKS:
        content = (consumer_repo / ".githooks" / name).read_text()
        assert "/service-skills/" not in content, name


def test_hooks_path_override_installs_there(
    installer, consumer_repo: Path, isolated_git_config, tmp_path
) -> None:
    custom = tmp_path / "custom-hooks"
    _git(["config", "core.hooksPath", str(custom)], consumer_repo)
    assert installer._detect_hooks_path_override(consumer_repo) == str(custom)
    assert installer.install_git_hooks(consumer_repo) is True
    for name in DRIFT_HOOKS:
        assert (custom / name).is_file(), name
        chain = (custom / name).read_text(encoding="utf-8")
        assert "# [jaggers] chain-githooks" in chain
    # Self-check resolves as git would (the override dir), not .git/hooks.
    assert _active_hooks_dir(consumer_repo) == custom


def test_self_check_fails_loudly_when_chain_missing(
    installer, consumer_repo: Path, isolated_git_config
) -> None:
    assert installer.install_git_hooks(consumer_repo) is True
    active = _active_hooks_dir(consumer_repo)
    (active / "post-checkout").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    ok, report = installer._self_check_worktree(consumer_repo, active)
    assert ok is False
    assert any("post-checkout" in line for line in report)


def test_all_worktrees_chains_linked_worktree(
    installer, consumer_repo: Path, isolated_git_config, tmp_path
) -> None:
    assert installer.install_git_hooks(consumer_repo) is True
    linked = tmp_path / "linked"
    _git(["worktree", "add", str(linked)], consumer_repo)
    try:
        assert installer.install_git_hooks(consumer_repo, all_worktrees=True) is True
        for wt in (consumer_repo, linked):
            active = _active_hooks_dir(wt)
            for name in DRIFT_HOOKS:
                chain = (active / name).read_text(encoding="utf-8")
                assert "# [jaggers] chain-githooks" in chain, f"{wt} {name}"
                assert (wt / ".githooks" / name).is_file(), f"{wt} {name}"
    finally:
        _git(["worktree", "remove", "--force", str(linked)], consumer_repo)


def _commit_touching(repo: Path, rel: str) -> tuple[str, str]:
    (repo / rel).parent.mkdir(parents=True, exist_ok=True)
    (repo / rel).write_text("changed\n", encoding="utf-8")
    _git(["add", rel], repo)
    prev = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()
    _git(["commit", "-qm", f"touch {rel}"], repo)
    new = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()
    return prev, new


def test_post_checkout_e2e_touch_writes_marker(
    consumer_repo: Path, isolated_git_config
) -> None:
    prev, new = _commit_touching(consumer_repo, "db/state.txt")
    hook = HOOKS_DIR / "post_checkout_drift_sweep.py"
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(consumer_repo)}
    r = subprocess.run(
        ["python3", str(hook), prev, new, "1"],
        cwd=consumer_repo, capture_output=True, text=True, env=env, check=False,
    )
    assert r.returncode == 0, r.stderr
    marker = consumer_repo / ".xtrm/.service-knowledge-drift-pending"
    assert marker.exists()
    content = marker.read_text(encoding="utf-8")
    assert "trigger: post-checkout" in content
    assert "services: db" in content


def test_post_checkout_e2e_fresh_clone_writes_fresh_cache(
    consumer_repo: Path, isolated_git_config, tmp_path
) -> None:
    clone = tmp_path / "clone"
    subprocess.run(
        ["git", "clone", "-q", str(consumer_repo), str(clone)],
        check=True, capture_output=True, text=True,
    )
    hook = HOOKS_DIR / "post_checkout_drift_sweep.py"
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(clone)}
    r = subprocess.run(
        ["python3", str(hook), "0" * 40, "abc1234", "1"],
        cwd=clone, capture_output=True, text=True, env=env, check=False,
    )
    assert r.returncode == 0, r.stderr
    marker = clone / ".xtrm/.service-knowledge-drift-pending"
    assert marker.exists()
    content = marker.read_text(encoding="utf-8")
    assert "reason: fresh-cache" in content
    assert "services: (none)" in content


def test_post_rewrite_e2e_amend_writes_marker(
    consumer_repo: Path, isolated_git_config
) -> None:
    prev, new = _commit_touching(consumer_repo, "db/state.txt")
    hook = HOOKS_DIR / "post_rewrite_drift_sweep.py"
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(consumer_repo)}
    r = subprocess.run(
        ["python3", str(hook), "amend"],
        input=f"{prev} {new}\n",
        cwd=consumer_repo, capture_output=True, text=True, env=env, check=False,
    )
    assert r.returncode == 0, r.stderr
    marker = consumer_repo / ".xtrm/.service-knowledge-drift-pending"
    assert marker.exists()
    content = marker.read_text(encoding="utf-8")
    assert "trigger: post-rewrite" in content
    assert "services: db" in content
