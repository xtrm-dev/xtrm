"""Shared structured telemetry for the dispatch layer (research §3.7).

One JSON line per decision to ``.xtrm/state/service-knowledge/events.jsonl``, greppable by
``component`` (``dispatch`` | ``bead-validator``). Mirrors ``index.telemetry`` shape but carries
the dispatch-layer component tags. Never raises into the caller — telemetry must not break a
promotion gate or a render.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from service_knowledge.index import paths


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def emit(consumer_root: Path, component: str, event: str, **fields: Any) -> dict[str, Any]:
    """Append one telemetry record and return it. Never raises into the caller."""
    record: dict[str, Any] = {
        "timestamp": _utc_now(),
        "component": component,
        "event": event,
    }
    record.update(fields)
    try:
        path = paths.events_path(Path(consumer_root))
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass
    return record
