"""``service-knowledge status`` — report install state for a consumer repo.

Drift marker state is reported with the same dual-name semantics as the pi
extension (canonical ``.service-knowledge-drift-pending`` wins over legacy
``.service-skills-drift-pending`` — core 16118989) so the CLI and the ext agree.
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
    """Return the relative marker path that is present, canonical preferred; None if none."""
    for rel in (CANONICAL_MARKER_REL, LEGACY_MARKER_REL):
        if (root / rel).exists():
            return rel.as_posix()
    return None


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
        print(f"drift marker:     PRESENT ({marker})")
    else:
        print("drift marker:     absent")
    return 0
