"""``service-knowledge status`` — report install state for a consumer repo."""
from __future__ import annotations

import argparse
import json

from service_knowledge import __version__
from service_knowledge.cli import common


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
        return 0
    print(f"umbrella packs:  {len(packs)}")
    for pack, umb in packs:
        reg = umb / "service-registry.json"
        try:
            n = len(json.loads(reg.read_text(encoding="utf-8")).get("services", {}))
        except (OSError, json.JSONDecodeError):
            n = -1
        print(f"  - pack '{pack.name}': umbrella '{umb.name}' · {n} services")
    return 0
