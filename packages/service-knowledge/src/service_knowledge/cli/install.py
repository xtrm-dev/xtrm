"""``service-knowledge install`` — vendor machinery + migrate + wire hooks into a consumer."""
from __future__ import annotations

import argparse

from service_knowledge import __version__
from service_knowledge.cli import common


def run(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    from_version, touched, duration_ms = common.apply(
        root, "install", all_worktrees=getattr(args, "all_worktrees", False)
    )

    print(f"{common.GREEN}service-knowledge v{__version__} installed into:{common.NC} {root}")
    if from_version and from_version != __version__:
        print(f"  upgraded from v{from_version}")
    if touched:
        print(f"  files touched ({len(touched)}):")
        for t in touched[:20]:
            print(f"    - {t}")
        if len(touched) > 20:
            print(f"    … and {len(touched) - 20} more")
    else:
        print(f"  {common.YELLOW}○ already up to date (no changes){common.NC}")
    print(f"  duration: {duration_ms:.0f} ms")
    print(f"  telemetry: {(root / '.xtrm/state/service-knowledge/install.jsonl').as_posix()}")
    return 0
