#!/usr/bin/env python3
"""Post-merge reindex hook — rebuild the per-repo service-knowledge FTS5 index.

Fires after a merge onto the consumer's default branch (main/master). Runs
``service-knowledge index rebuild`` so the index reflects the newly-merged code.
Target: ≤60s on a mercury-infra baseline.

Silent no-op when: not on default branch; no registry present; CLI missing.
Never fails the merge (post-merge hooks cannot abort anyway).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_BRANCHES = {"main", "master"}
BUDGET_SECONDS = 90  # 60s target + 30s slack


def _project_root() -> Path:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            check=True, capture_output=True, text=True,
        )
        return Path(r.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


def _current_branch(root: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
            check=True, capture_output=True, text=True,
        )
        return r.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def _has_registry(root: Path) -> bool:
    for candidate in (
        root / ".xtrm" / "skills" / "default" / "service-knowledge" / "registry.json",
        root / ".claude" / "skills" / "service-skills" / "registry.json",
    ):
        if candidate.exists():
            return True
    return False


def main() -> int:
    root = _project_root()
    if not _has_registry(root):
        return 0
    if _current_branch(root) not in DEFAULT_BRANCHES:
        return 0
    cli = shutil.which("service-knowledge")
    if not cli:
        return 0
    try:
        subprocess.run(
            [cli, "index", "rebuild"],
            cwd=str(root),
            check=False,
            timeout=BUDGET_SECONDS,
            capture_output=True,
        )
    except (subprocess.TimeoutExpired, OSError):
        # Never break a post-merge; log and move on.
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
