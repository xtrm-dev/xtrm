"""``service-knowledge index`` — build / query / stats / rebuild the per-repo FTS5 index.

Stdlib-only CLI over :mod:`service_knowledge.index`. ``build`` and ``rebuild`` both do a full
regeneration (the index is a derived projection); ``rebuild`` is the explicit operator trigger
named in the constraint, kept as a distinct alias so hooks can call it unambiguously.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from service_knowledge import index
from service_knowledge.cli.common import resolve_consumer_root
from service_knowledge.index import query as query_mod
from service_knowledge.index import schema


def _print_json(payload: object) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def _cmd_build(args: argparse.Namespace) -> int:
    root = resolve_consumer_root(args.path)
    stats = index.build(root)
    _print_json(asdict(stats))
    return 0


def _cmd_query(args: argparse.Namespace) -> int:
    root = resolve_consumer_root(args.path)
    paths = args.paths.split(",") if args.paths else []
    ctx = query_mod.QueryContext(query=args.query, paths=tuple(paths),
                                 service_id=args.service_id, limit=args.limit)
    result = query_mod.search(root, ctx)
    if args.bundle:
        _print_json(index.build_bundle(result, root))
    else:
        _print_json(result)
    return 0


def _cmd_stats(args: argparse.Namespace) -> int:
    root = resolve_consumer_root(args.path)
    conn = schema.connect(root)
    try:
        state = conn.execute("SELECT * FROM sk_index_state WHERE id=1").fetchone()
        counts = {}
        for row in conn.execute("SELECT kind, COUNT(*) AS n FROM sk_items GROUP BY kind").fetchall():
            counts[row["kind"]] = row["n"]
        total = conn.execute("SELECT COUNT(*) AS n FROM sk_items").fetchone()["n"]
        events = conn.execute("SELECT COUNT(*) AS n FROM sk_retrieval_events").fetchone()["n"]
    finally:
        conn.close()
    _print_json({
        "consumer_root": str(root),
        "index_state": dict(state) if state else None,
        "item_count": total,
        "items_by_kind": counts,
        "retrieval_events": events,
    })
    return 0


_DISPATCH = {
    "build": _cmd_build,
    "rebuild": _cmd_build,
    "query": _cmd_query,
    "stats": _cmd_stats,
}


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "index",
        help="Build / query / inspect the per-repo FTS5 evidence index.",
        description="Build / query / inspect the per-repo FTS5 evidence index.",
    )
    parser.add_argument("--path", default=None, help="Consumer repo root (default: git toplevel of cwd).")
    nested = parser.add_subparsers(dest="index_command", metavar="<action>")

    for action in ("build", "rebuild"):
        action_parser = nested.add_parser(action, help="Full rebuild of the derived index.",
                                          description="Full rebuild of the derived index.")
        action_parser.add_argument("--path", default=argparse.SUPPRESS,
                                   help="Consumer repo root (default: git toplevel of cwd).")

    q = nested.add_parser("query", help="Run a read-only retrieval query.")
    q.add_argument("--path", default=argparse.SUPPRESS,
                   help="Consumer repo root (default: git toplevel of cwd).")
    q.add_argument("query", help="Free-text query (alert, metric, concept, path).")
    q.add_argument("--service-id", default=None, dest="service_id")
    q.add_argument("--paths", default=None, help="Comma-separated file paths for territory routing.")
    q.add_argument("--limit", type=int, default=7)
    q.add_argument("--bundle", action="store_true", help="Emit a §3.2 evidence bundle instead of raw results.")

    stats = nested.add_parser("stats", help="Show index_state + item counts.")
    stats.add_argument("--path", default=argparse.SUPPRESS,
                       help="Consumer repo root (default: git toplevel of cwd).")
    parser.set_defaults(index_command=None)


def run(args: argparse.Namespace) -> int:
    command = getattr(args, "index_command", None)
    if not command:
        print("error: index requires an action: build | rebuild | query | stats", file=sys.stderr)
        return 2
    return _DISPATCH[command](args)
