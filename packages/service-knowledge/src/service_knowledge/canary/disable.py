"""Disable the canary. No threshold check. Loud audit event."""
from __future__ import annotations

import subprocess
from pathlib import Path

from service_knowledge.canary import state as state_mod


def disable(consumer_root: Path, *, disabled_by: str) -> state_mod.CanaryState:
    """Flip state to off and log ``event=disable``. Idempotent."""
    prior = state_mod.read_state(consumer_root)
    new_state = state_mod.CanaryState(enabled=False, classes=frozenset())
    state_mod.write_state(consumer_root, new_state)
    state_mod.append_log(
        consumer_root,
        "disable",
        classes=sorted(prior.classes),
        enabled_by=disabled_by,
        thresholds={},
        git_commit=_current_git_commit(consumer_root),
    )
    return new_state


def _current_git_commit(root: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=False, timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""
