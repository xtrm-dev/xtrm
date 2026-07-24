"""Resolve the consumer repo root for an MCP tool invocation.

MCP tools run inside the consumer repo; the root is ``$SERVICE_KNOWLEDGE_ROOT`` (explicit
override) or ``$CLAUDE_PROJECT_DIR`` or the git toplevel of the cwd. Read-only tools must never
fail hard on resolution — callers pass an explicit root in tests.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path


def resolve_consumer_root(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    for env in ("SERVICE_KNOWLEDGE_ROOT", "CLAUDE_PROJECT_DIR"):
        value = os.environ.get(env)
        if value:
            return Path(value).expanduser().resolve()
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True, timeout=5,
        )
        return Path(result.stdout.strip()).resolve()
    except (subprocess.SubprocessError, OSError):
        return Path.cwd().resolve()
