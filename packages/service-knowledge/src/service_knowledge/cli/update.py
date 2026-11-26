"""``service-knowledge update`` — pull the installed package version into a consumer.

Idempotent: re-vendors from the installed package, re-runs the migration, and produces
no diff when the consumer is already at the package version.
"""
from __future__ import annotations

import argparse

from service_knowledge import __version__
from service_knowledge.cli import common


def run(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    from_version, touched, duration_ms = common.apply(
        root, "update",
        all_worktrees=getattr(args, "all_worktrees", False),
        per_edit_hooks=getattr(args, "per_edit_hooks", None),
    )

    if from_version == __version__ and not touched:
        print(f"{common.GREEN}○{common.NC} {root.name} already at v{__version__} (no changes)")
    else:
        print(f"{common.GREEN}service-knowledge updated to v{__version__}:{common.NC} {root}")
        if from_version:
            print(f"  from v{from_version}")
        print(f"  files touched: {len(touched)}")
    enabled = common.per_edit_hooks_enabled(root)
    print(
        f"  per-edit hooks: {'on' if enabled else 'off'}"
        + ("" if enabled else " (opt in with --per-edit-hooks)")
    )
    print(f"  duration: {duration_ms:.0f} ms")
    return 0
