"""Filesystem layout for the per-repo service-knowledge index (research §3.4).

The SQLite index is a *derived, regenerable* projection living in the consumer repo at
``.xtrm/cache/service-knowledge.sqlite``; telemetry lives under ``.xtrm/state/service-knowledge/``.
Ownership and lifecycle stay separate from the memory substrate (a deliberate §3.4 decision).
"""
from __future__ import annotations

from pathlib import Path

CACHE_REL = Path(".xtrm") / "cache" / "service-knowledge.sqlite"
LOCK_REL = Path(".xtrm") / "cache" / "service-knowledge.sqlite.lock"
STATE_REL = Path(".xtrm") / "state" / "service-knowledge"
EVENTS_REL = STATE_REL / "events.jsonl"


def db_path(consumer_root: Path) -> Path:
    return Path(consumer_root) / CACHE_REL


def lock_path(consumer_root: Path) -> Path:
    """Sidecar single-flight lock for the read-time freshness gate (B1)."""
    return Path(consumer_root) / LOCK_REL


def state_dir(consumer_root: Path) -> Path:
    return Path(consumer_root) / STATE_REL


def events_path(consumer_root: Path) -> Path:
    return Path(consumer_root) / EVENTS_REL
