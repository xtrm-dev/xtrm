"""``service-knowledge migrate`` — one-time rename of the service-skills umbrella.

Hard break: ``<pack>/service-skills`` -> ``<pack>/service-knowledge``, registry path refs
rewritten, umbrella regenerated as ``<repo>-service-knowledge``. Idempotent.
"""
from __future__ import annotations

import argparse

from service_knowledge.cli import common, telemetry


def run(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    # Vendor the new machinery first so the renamed umbrella generator is what regenerates.
    common.vendor_machinery(root)
    touched = common.migrate_umbrellas(root)
    telemetry.emit(root, "migrate", to_version=common.__version__, files_touched=sorted(set(touched)))

    if touched:
        print(f"{common.GREEN}migrated:{common.NC} {root.name}")
        for t in sorted(set(touched)):
            print(f"  - {t}")
    else:
        print(f"{common.GREEN}○{common.NC} {root.name} already migrated (no service-skills umbrella)")
    return 0
