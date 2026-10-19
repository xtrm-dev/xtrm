"""``service-knowledge status`` — report install state for a consumer repo.

Drift marker state is reported with the same dual-name semantics as the pi
extension (canonical ``.service-knowledge-drift-pending`` wins over legacy
``.service-skills-drift-pending`` — core 16118989) so the CLI and the ext agree.

Live-read contract (B2): the marker file is re-read at use time on every
``status`` invocation — never a session-start snapshot. A PENDING banner cached
in session context goes stale the moment the marker is cleared; ``status``
reports the file as it exists now.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from service_knowledge import __version__
from service_knowledge.cli import common

CANONICAL_MARKER_REL = Path(".xtrm") / ".service-knowledge-drift-pending"
LEGACY_MARKER_REL = Path(".xtrm") / ".service-skills-drift-pending"


def _drift_marker(root) -> str | None:
    """Return the relative marker path that is present, canonical preferred; None if none.

    Live read at call time (B2): checks the filesystem now, holds no cache."""
    for rel in (CANONICAL_MARKER_REL, LEGACY_MARKER_REL):
        if (root / rel).exists():
            return rel.as_posix()
    return None


def _drift_marker_detail(root) -> str:
    """Live one-line marker detail (reason/services/timestamp) for status output.

    Re-reads the file at use time; unparsable/legacy markers degrade to the
    bare PRESENT line rather than failing status."""
    try:
        from service_knowledge.cli.drift import read_marker as _read_marker

        parsed = _read_marker(root)
    except Exception:
        parsed = None
    if not parsed:
        return ""
    bits: list[str] = []
    if parsed.get("reason"):
        bits.append(f"reason={parsed['reason']}")
    if parsed.get("services"):
        bits.append(f"services={parsed['services']}")
    if parsed.get("range"):
        bits.append(f"range={parsed['range']}")
    if parsed.get("timestamp"):
        bits.append(f"timestamp={parsed['timestamp']}")
    return (" " + " ".join(bits)) if bits else ""


def run(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    installed = common.read_installed_version(root)
    mdir = common.machinery_dir(root)
    cache = root / common.CACHE_REL
    packs = common.find_umbrella_packs(root)

    print(f"consumer:        {root}")
    print(f"package version: v{__version__}")
    print(f"installed:       {'v' + installed if installed else 'NOT INSTALLED'}")
    print(f"machinery dir:   {mdir.relative_to(root).as_posix()} {'(present)' if mdir.exists() else '(absent)'}")
    print(f"fts5 cache:      {cache.relative_to(root).as_posix()} {'(present)' if cache.exists() else '(absent)'}")

    if not packs:
        print("umbrella packs:  none (no service registry found)")
    else:
        print(f"umbrella packs:  {len(packs)}")
        for pack, umb in packs:
            reg = umb / "service-registry.json"
            try:
                n = len(json.loads(reg.read_text(encoding="utf-8")).get("services", {}))
            except (OSError, json.JSONDecodeError):
                n = -1
            print(f"  - pack '{pack.name}': umbrella '{umb.name}' · {n} services")

    marker = _drift_marker(root)
    if marker:
        print(f"drift marker:     PRESENT ({marker}){_drift_marker_detail(root)}")
    else:
        print("drift marker:     absent")
    return 0
