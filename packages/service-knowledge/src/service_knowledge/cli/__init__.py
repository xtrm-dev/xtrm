"""service-knowledge CLI — standalone lifecycle for the service-knowledge package.

Entry point ``service-knowledge = service_knowledge.cli:main`` (pyproject.toml).
Stdlib-only; does NOT depend on xtrm/sp/xt/xtmux. Subcommands: install · update ·
status · migrate · remove · index · canary · drift · mcp · help.
"""
from __future__ import annotations

import argparse
import sys

from service_knowledge import __version__
from service_knowledge.cli import (
    _help,
    canary_cmd,
    drift,
    index_cmd,
    install,
    mcp_cmd,
    migrate,
    remove,
    status,
    update,
)

_SUBCOMMANDS = {
    "install": (install.run, "Install service-knowledge into a consumer repo (vendor + migrate + wire hooks)."),
    "update": (update.run, "Pull the installed package version into a consumer (idempotent)."),
    "status": (status.run, "Report install state for a consumer repo."),
    "migrate": (migrate.run, "One-time rename of the service-skills umbrella to service-knowledge."),
    "remove": (remove.run, "Uninstall machinery + cache + hooks (keeps your per-service knowledge)."),
    "index": (index_cmd.run, "Build / query / inspect the per-repo FTS5 evidence index."),
    "canary": (canary_cmd.run, "Manage the per-repo auto-merge canary (status | enable | disable)."),
    "drift": (drift.run, "Detect / clear service-knowledge drift (writes a pending marker)."),
    "mcp": (mcp_cmd.run, "Serve the read-only knowledge tools over MCP (JSON-RPC stdio), and inspect them."),
}


def _help_run(args: argparse.Namespace) -> int:
    topic = getattr(args, "topic", None)
    if not topic or topic == "topics":
        print(_help.topic_index_text())
        return 0
    body = _help.TOPICS.get(topic)
    if body is None:
        print(f"error: unknown topic '{topic}'", file=sys.stderr)
        print(file=sys.stderr)
        print(_help.topic_index_text(), file=sys.stderr)
        return 2
    print(body)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="service-knowledge",
        description="First-class operational service-knowledge package CLI.",
        epilog=_help.TOP_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"service-knowledge {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="<command>")
    for name, (_fn, help_text) in _SUBCOMMANDS.items():
        if name in ("index", "canary", "drift", "mcp"):
            continue  # registered below with nested actions
        sp = sub.add_parser(
            name,
            help=help_text,
            description=help_text,
            epilog=_help.EPILOGS.get(name, ""),
            formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        sp.add_argument("--path", default=None, help="Consumer repo root (default: git toplevel of cwd).")
        if name in ("install", "update"):
            sp.add_argument(
                "--all-worktrees", action="store_true", default=False,
                help="Chain + self-check git hooks in every linked worktree "
                "(default: only the current worktree's active hooks dir).",
            )
    # `index` and `canary` carry nested actions; register them separately.
    index_cmd.register(sub)
    canary_cmd.register(sub)
    drift.register(sub)
    mcp_cmd.register(sub)

    # `help <topic>` — concept-level explainers (workflow / verifier / mcp / …).
    help_p = sub.add_parser(
        "help",
        help="Explain concepts (workflow · install · bootstrap · index · hooks · drift · verifier · mcp · activator · eval · canary · telemetry).",
        description=(
            "Show a concept-level explainer for a topic. "
            "Run `service-knowledge help topics` for the full list."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
        "  service-knowledge help topics\n"
        "  service-knowledge help workflow\n"
        "  service-knowledge help verifier\n"
        "  service-knowledge help mcp\n",
    )
    help_p.add_argument("topic", nargs="?", default=None,
                        help="Topic name (omit or 'topics' for the index).")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2
    if args.command == "help":
        return _help_run(args)
    fn, _ = _SUBCOMMANDS[args.command]
    try:
        return fn(args)
    except (RuntimeError, NotADirectoryError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
