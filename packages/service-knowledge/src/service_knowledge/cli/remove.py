"""``service-knowledge remove`` — uninstall machinery + cache + hooks from a consumer.

Does NOT delete the per-repo umbrella pack or per-service skills (your knowledge stays);
it only removes the vendored machinery, the empty cache, and the wired Claude hooks.
"""
from __future__ import annotations

import argparse

from service_knowledge.cli import common, telemetry


def run(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    touched = common.unwire_hooks(root)
    touched += common.remove_machinery(root)
    telemetry.emit(root, "remove", from_version=common.read_installed_version(root), files_touched=sorted(set(touched)))

    if touched:
        print(f"{common.GREEN}removed service-knowledge from:{common.NC} {root}")
        for t in sorted(set(touched)):
            print(f"  - {t}")
    else:
        print(f"{common.YELLOW}○{common.NC} nothing to remove (not installed)")
    return 0
