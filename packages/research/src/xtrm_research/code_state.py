"""Capturing the ``code`` block of a run manifest: repo, commit, dirty state."""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any


def capture_code_state(repo_path: Path) -> dict[str, Any]:
    """Return ``{repo, commit, dirty, dirty_patch_hash}`` for a git checkout.

    Falls back to ``commit="unknown"`` / ``dirty=True`` if ``repo_path`` is
    not inside a git checkout, so manifest building never hard-fails on a
    missing git binary.
    """
    repo_path = Path(repo_path)
    try:
        commit = _git(repo_path, "rev-parse", "HEAD")
        status = _git(repo_path, "status", "--porcelain")
        dirty = bool(status.strip())
        dirty_patch_hash = None
        if dirty:
            diff = _git(repo_path, "diff", "HEAD")
            dirty_patch_hash = (
                f"sha256:{hashlib.sha256(diff.encode('utf-8')).hexdigest()}"
            )
        return {
            "repo": str(repo_path),
            "commit": commit.strip(),
            "dirty": dirty,
            "dirty_patch_hash": dirty_patch_hash,
        }
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {
            "repo": str(repo_path),
            "commit": "unknown",
            "dirty": True,
            "dirty_patch_hash": None,
        }


def _git(repo_path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_path), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout
