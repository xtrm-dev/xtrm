"""Single-line JSON telemetry emitted to stderr on every CLI invocation."""

from __future__ import annotations

import json
import sys
import time
from typing import Any


def log_invocation(
    server: str,
    subcommand: str,
    tool: str = "",
    duration_ms: int = 0,
    outcome: str = "ok",
    **extras: Any,
) -> None:
    record: dict[str, Any] = {
        "server": server,
        "subcommand": subcommand,
        "tool": tool,
        "duration_ms": duration_ms,
        "outcome": outcome,
    }
    record.update(extras)
    sys.stderr.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def measure_ms(start: float) -> int:
    """Return integer milliseconds elapsed since `start` (a monotonic clock reading)."""
    return int((time.monotonic() - start) * 1000)
