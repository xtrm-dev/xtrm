"""Run status lifecycle: started | success | error | invalid, plus the
reporting-time-only ``interrupted`` view for a stale heartbeat.

``interrupted`` is never stored on disk — it is derived from ``state`` plus
``last_heartbeat`` at read time, since staleness is relative to "now".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

DEFAULT_HEARTBEAT_TTL = timedelta(minutes=10)


def effective_status(
    manifest_status: dict[str, str],
    now: datetime | None = None,
    ttl: timedelta = DEFAULT_HEARTBEAT_TTL,
) -> str:
    state = manifest_status["state"]
    if state != "started":
        return state
    now = now or datetime.now(timezone.utc)
    last_heartbeat = datetime.fromisoformat(manifest_status["last_heartbeat"])
    if now - last_heartbeat > ttl:
        return "interrupted"
    return state
