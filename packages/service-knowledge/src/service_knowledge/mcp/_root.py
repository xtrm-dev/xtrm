"""Resolve the consumer repo root for an MCP tool invocation.

MCP tools run inside the consumer repo; the trusted root is ``$SERVICE_KNOWLEDGE_ROOT`` or
``$CLAUDE_PROJECT_DIR`` or the git toplevel of the cwd. A request-supplied root must match it.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path


def resolve_consumer_root(explicit: str | None = None) -> Path:
    for env in ("SERVICE_KNOWLEDGE_ROOT", "CLAUDE_PROJECT_DIR"):
        value = os.environ.get(env)
        if value:
            root = Path(value).expanduser().resolve()
            break
    else:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                capture_output=True, text=True, check=True, timeout=5,
            )
            root = Path(result.stdout.strip()).resolve()
        except (subprocess.SubprocessError, OSError):
            root = Path.cwd().resolve()

    if explicit and Path(explicit).expanduser().resolve() != root:
        raise ValueError("consumer_root must match the trusted MCP consumer root")
    return root
