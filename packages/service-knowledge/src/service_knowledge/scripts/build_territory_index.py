#!/usr/bin/env python3
"""Build the mtime-keyed territory index consumed by ``hook_prefilter.sh`` (XTRM-556).

The Claude Code hooks fire on every tool call, and a python3 spawn costs ~31 ms before any
application code runs — over the 20 ms budget on its own. ``hook_prefilter.sh`` answers the
"does this path touch a registered territory?" question in awk and only spawns the real hook
when the answer is maybe.

That decision is only safe if this index is faithful to the registry the hook itself reads, so
the index is deliberately dumb: it is the de-duplicated list of territory patterns, one per
line, with the source registry path on line 1. ``hook_prefilter.sh`` treats a missing, empty,
or older-than-registry index as "undecided" and defers to the hook, so a stale index degrades
to today's behaviour instead of to a wrong answer.

Writes atomically (tmp + rename) so a concurrent hook never reads a half-written index.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from bootstrap import (  # noqa: E402  # type: ignore[import-not-found]
    RootResolutionError,
    get_registry_path,
    load_registry,
)


def index_path() -> Path:
    return Path(__file__).resolve().parent.parent / "cache" / "territory.index"


def collect_patterns(registry: dict) -> list[str]:
    """Every territory pattern in the registry, de-duplicated, in stable order.

    Order is preserved so the awk matcher sees the same candidate order the Python
    matcher would, and empty pattern lists contribute nothing.
    """
    seen: set[str] = set()
    out: list[str] = []
    for service in registry.get("services", {}).values():
        for pattern in service.get("territory", []) or []:
            if isinstance(pattern, str) and pattern and pattern not in seen:
                seen.add(pattern)
                out.append(pattern)
    return out


def build(project_root: str | None = None) -> int:
    try:
        registry_path = get_registry_path(project_root)
        registry = load_registry(project_root)
    except (RootResolutionError, Exception):
        return 1

    patterns = collect_patterns(registry)

    target = index_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    payload = "\n".join([str(registry_path), *patterns]) + "\n"

    # Unchanged registry: keep the existing mtime so the hot path keeps using it.
    try:
        if target.read_text(encoding="utf-8") == payload:
            return 0
    except OSError:
        pass

    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".territory.index.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        os.replace(tmp, target)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(build(sys.argv[1] if len(sys.argv) > 1 else None))