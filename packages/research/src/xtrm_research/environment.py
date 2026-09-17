"""Capturing the ``environment`` block of a run manifest."""

from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from typing import Any


def capture_environment(flags: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "platform": platform.platform(),
        "python_version": sys.version.split()[0],
        "node_version": _node_version(),
        "flags": flags or {},
    }


def _node_version() -> str | None:
    node = shutil.which("node")
    if node is None:
        return None
    try:
        return subprocess.run(
            [node, "--version"], capture_output=True, text=True, check=True
        ).stdout.strip()
    except subprocess.CalledProcessError:
        return None
