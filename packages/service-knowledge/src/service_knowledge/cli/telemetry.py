"""Per-invocation telemetry for the service-knowledge CLI.

Every install/update/migrate/remove appends one JSON line to
``<consumer>/.xtrm/state/service-knowledge/install.jsonl``. Grep by ``component``
to isolate sk-cli events. No secrets are ever recorded — only paths, versions,
event names, touched-file counts and timing.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COMPONENT = "sk-cli"


def state_dir(consumer_root: Path) -> Path:
    return consumer_root / ".xtrm" / "state" / "service-knowledge"


def telemetry_path(consumer_root: Path) -> Path:
    return state_dir(consumer_root) / "install.jsonl"


def emit(
    consumer_root: Path,
    event: str,
    *,
    from_version: str | None = None,
    to_version: str | None = None,
    files_touched: list[str] | None = None,
    duration_ms: float | None = None,
) -> dict[str, Any]:
    """Append one telemetry record; returns the record. Never raises into the caller."""
    record: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "component": COMPONENT,
        "event": event,
        "consumer_path": str(consumer_root),
        "from_version": from_version,
        "to_version": to_version,
        "files_touched": files_touched or [],
        "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
    }
    try:
        path = telemetry_path(consumer_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
    except OSError:
        # Telemetry must never break an install/update/migrate.
        pass
    return record
