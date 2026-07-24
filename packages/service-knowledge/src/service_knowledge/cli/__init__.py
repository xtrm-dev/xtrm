"""service-knowledge CLI — standalone lifecycle for the service-knowledge package.

Entry point ``service-knowledge = service_knowledge.cli:main`` (pyproject.toml).
Stdlib-only; does NOT depend on xtrm/bd/sp/xt/xtmux. Subcommands: install · update ·
status · migrate · remove.
"""
from __future__ import annotations

import argparse
import sys

from service_knowledge import __version__
from service_knowledge.cli import eval_cmd, index_cmd, install, migrate, remove, status, update

_SUBCOMMANDS = {
    "install": (install.run, "Install service-knowledge into a consumer repo (vendor + migrate + wire hooks)."),
    "update": (update.run, "Pull the installed package version into a consumer (idempotent)."),
    "status": (status.run, "Report install state for a consumer repo."),
    "migrate": (migrate.run, "One-time rename of the service-skills umbrella to service-knowledge."),
    "remove": (remove.run, "Uninstall machinery + cache + hooks (keeps your per-service knowledge)."),
    "index": (index_cmd.run, "Build / query / inspect the per-repo FTS5 evidence index."),
    "eval": (eval_cmd.run, "Run the labeled eval corpus + emit the weekly §3.9 report."),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="service-knowledge",
        description="First-class operational service-knowledge package CLI.",
    )
    parser.add_argument("--version", action="version", version=f"service-knowledge {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="<command>")
    for name, (_fn, help_text) in _SUBCOMMANDS.items():
        if name in ("index", "eval"):
            continue  # registered below with nested actions
        sp = sub.add_parser(name, help=help_text, description=help_text)
        sp.add_argument("--path", default=None, help="Consumer repo root (default: git toplevel of cwd).")
    # `index` and `eval` carry nested actions; register them separately.
    index_cmd.register(sub)
    eval_cmd.register(sub)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2
    fn, _ = _SUBCOMMANDS[args.command]
    try:
        return fn(args)
    except (RuntimeError, NotADirectoryError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
