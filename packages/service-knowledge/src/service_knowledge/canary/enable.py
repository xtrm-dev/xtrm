"""Enable the canary — gated by (a) all thresholds met, (b) operator confirm.

Refuses when thresholds fail. Refuses when operator does not confirm. Writes
state + emits a ``component=canary, event=enable`` audit line. Does NOT bypass
the class allow-list: any class outside :data:`state.ALLOWED_CLASSES` in the
requested list is silently dropped by :func:`state.read_state` on the next
read (so an operator cannot enable a forbidden class through this CLI even by
editing the JSON — the read path re-filters).
"""
from __future__ import annotations

import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from service_knowledge.canary import state as state_mod
from service_knowledge.canary import status as status_mod

CONFIRM_PHRASE = "ENABLE CANARY"


class CanaryEnableError(RuntimeError):
    """Raised when enable is refused (thresholds fail or operator declines)."""


def _default_confirm(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        return ""


def enable(
    consumer_root: Path,
    classes: list[str],
    *,
    enabled_by: str,
    assume_yes: bool = False,
    confirm: Callable[[str], str] = _default_confirm,
    metrics: dict | None = None,
    git_commit: str | None = None,
) -> state_mod.CanaryState:
    """Enable the canary. Raises :class:`CanaryEnableError` when refused."""
    requested = frozenset(classes or [])
    outside = requested - state_mod.ALLOWED_CLASSES
    if outside:
        raise CanaryEnableError(
            f"classes outside allow-list: {sorted(outside)}. "
            f"Allowed: {sorted(state_mod.ALLOWED_CLASSES)}",
        )
    safe = requested & state_mod.ALLOWED_CLASSES
    if not safe:
        raise CanaryEnableError("must enable at least one allowed class")

    snap = status_mod.snapshot(consumer_root) if metrics is None else {
        "metrics": metrics,
        "checks": status_mod.evaluate_thresholds(metrics),
        "thresholds": status_mod.POLICY_THRESHOLDS,
    }
    checks = snap["checks"]
    if not all(checks.values()):
        failing = [k for k, v in checks.items() if not v]
        raise CanaryEnableError(
            f"thresholds not met: {failing}. Metrics: {snap['metrics']}",
        )

    if not assume_yes:
        prompt = (
            f"About to enable canary auto-merge for classes: {sorted(safe)}.\n"
            f"Metrics: {snap['metrics']}.\n"
            f"Type '{CONFIRM_PHRASE}' to confirm: "
        )
        answer = confirm(prompt).strip()
        if answer != CONFIRM_PHRASE:
            raise CanaryEnableError("operator did not confirm")

    commit = git_commit if git_commit is not None else _current_git_commit(consumer_root)
    new_state = state_mod.CanaryState(
        enabled=True,
        classes=safe,
        enabled_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        enabled_by=enabled_by,
    )
    state_mod.write_state(consumer_root, new_state)
    state_mod.append_log(
        consumer_root,
        "enable",
        classes=sorted(safe),
        enabled_by=enabled_by,
        thresholds=snap["metrics"],
        git_commit=commit,
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
