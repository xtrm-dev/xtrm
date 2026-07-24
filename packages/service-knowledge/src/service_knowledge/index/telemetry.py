"""Knowledge-index telemetry (research §3.7 PostToolUse / post-merge telemetry).

Every query and rebuild appends one JSON line to ``.xtrm/state/service-knowledge/events.jsonl``
with ``component=knowledge-index``. Raw query text is NEVER recorded — only a SHA-256 hash of
the normalized query — so the log is greppable by component without leaking intent.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from service_knowledge.index import paths

COMPONENT = "knowledge-index"


def query_hash(query: str) -> str:
    """Stable hash of a normalized query — logged instead of the raw text."""
    normalized = " ".join(query.split()).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def emit(consumer_root: Path, event: str, **fields: Any) -> dict[str, Any]:
    """Append one telemetry record; returns it. Never raises into the caller."""
    record: dict[str, Any] = {
        "timestamp": _utc_now(),
        "component": COMPONENT,
        "event": event,
    }
    record.update(fields)
    try:
        path = paths.events_path(consumer_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        # Telemetry must never break a query or rebuild.
        pass
    return record
