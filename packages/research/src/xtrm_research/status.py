"""Run status lifecycle: started | success | error | invalid, plus the
reporting-time-only ``interrupted`` view for a stale or clock-skewed heartbeat.

``interrupted`` is never stored on disk — it is derived from ``state`` plus
``last_heartbeat`` at read time, since staleness is relative to "now".

A heartbeat timestamped after ``now`` is clock skew, not evidence the run is
alive: it is treated the same as a stale one (reported ``interrupted``)
rather than trusted to mean the run is live indefinitely.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

TERMINAL_STATES = ("success", "error", "invalid")
DEFAULT_HEARTBEAT_TTL = timedelta(minutes=10)


def effective_status(
    status: dict[str, str],
    now: datetime | None = None,
    ttl: timedelta = DEFAULT_HEARTBEAT_TTL,
) -> str:
    state = status["state"]
    if state != "started":
        return state
    now = now or datetime.now(timezone.utc)
    last_heartbeat = datetime.fromisoformat(status["last_heartbeat"])
    if last_heartbeat.tzinfo is None:
        raise ValueError(
            f"last_heartbeat {status['last_heartbeat']!r} is naive; timestamps must be timezone-aware"
        )
    age = now - last_heartbeat
    if age > ttl or age < timedelta(0):
        return "interrupted"
    return state
