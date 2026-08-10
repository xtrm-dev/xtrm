#!/usr/bin/env python3
"""arena-top — top models from Arena AI (formerly LMSYS Chatbot Arena) leaderboards.

Arena AI publishes no public API. This reads the daily JSON snapshots maintained
at https://github.com/oolong-tea-2026/arena-ai-leaderboards (GitHub Actions, daily,
10 leaderboards). Stdlib only — Python 3.10+, no third-party deps.

Usage:
  arena-top [category] [N]      default category: code, N: 10
  arena-top --list              list categories
  arena-top code 20 --json      emit raw JSON
  arena-top text --snapshot 2026-07-01   historical snapshot
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

BASE = "https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data"
CATEGORIES = [
    "text", "code", "vision", "document", "search",
    "image-edit", "image-to-video", "text-to-image", "text-to-video", "video-edit",
]


def _fetch(url: str, timeout: float = 20.0):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def latest_snapshot() -> str:
    """Return the latest snapshot date path (YYYY-MM-DD)."""
    return _fetch(f"{BASE}/latest.json")["path"]


def fetch_leaderboard(category: str, snapshot: str | None = None) -> dict:
    """Fetch one leaderboard snapshot as a dict with 'meta' and 'models'."""
    if category not in CATEGORIES:
        raise ValueError(f"unknown category '{category}'. valid: {', '.join(CATEGORIES)}")
    if snapshot is None:
        snapshot = latest_snapshot()
    return _fetch(f"{BASE}/{snapshot}/{category}.json")


def render_table(data: dict, n: int) -> str:
    meta, models = data["meta"], data["models"]
    lines = [
        f"# Arena AI — {meta['leaderboard']} | updated {meta['last_updated']} "
        f"| snapshot {meta.get('fetched_at', '')[:10]} | {meta['model_count']} models",
        f"{'#':>2}  {'model':34} {'vendor':14} {'license':10} {'score':>6} {'votes':>6}",
    ]
    for m in models[:n]:
        lines.append(
            f"{m['rank']:>2}  {(m.get('model') or '')[:34]:34} "
            f"{(m.get('vendor') or '?')[:14]:14} {(m.get('license') or '?')[:10]:10} "
            f"{float(m.get('score', 0)):>6.0f} {m.get('votes', '?'):>6}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="arena-top",
        description="Top models from Arena AI leaderboards (daily JSON snapshots).",
        epilog=f"categories: {', '.join(CATEGORIES)}",
    )
    p.add_argument("category", nargs="?", default="code",
                   help="leaderboard category (default: code)")
    p.add_argument("n", nargs="?", type=int, default=10,
                   help="number of models to show (default: 10)")
    p.add_argument("--snapshot", help="YYYY-MM-DD snapshot (default: latest)")
    p.add_argument("--json", action="store_true", help="emit raw JSON")
    p.add_argument("--list", action="store_true", help="list categories and exit")
    args = p.parse_args(argv)

    if args.list:
        print("\n".join(CATEGORIES))
        return 0
    try:
        data = fetch_leaderboard(args.category, args.snapshot)
    except Exception as e:
        print(f"arena-top: {e}", file=sys.stderr)
        return 1
    if args.json:
        json.dump(data, sys.stdout, indent=2)
        print()
    else:
        print(render_table(data, args.n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
