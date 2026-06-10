"""`mcpq` console-script entry point."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Sequence

from . import __version__
from .config import discover_config, load_config
from .telemetry import log_invocation, measure_ms


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mcpq",
        description="Query Docker-sidecar MCP servers from the host.",
    )
    parser.add_argument("--version", action="version", version=f"mcpq {__version__}")
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        metavar="FILE",
        help="explicit .mcpq.json path (bypasses walk-up discovery)",
    )

    sub = parser.add_subparsers(dest="subcommand", required=True)

    sub.add_parser("servers", help="list configured servers from .mcpq.json")

    list_tools = sub.add_parser(
        "list-tools",
        help="[phase B] list tools exposed by a server (stub)",
    )
    list_tools.add_argument("server", help="server name from .mcpq.json")

    describe = sub.add_parser(
        "describe",
        help="[phase B] describe a tool (stub)",
    )
    describe.add_argument("server", help="server name from .mcpq.json")
    describe.add_argument("tool", help="tool name")

    call = sub.add_parser(
        "call",
        help="[phase B] call a tool with JSON arguments (stub)",
    )
    call.add_argument("server", help="server name from .mcpq.json")
    call.add_argument("tool", help="tool name")
    call.add_argument(
        "--arg",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="JSON-encoded argument, repeatable",
    )

    return parser


def _cmd_servers(args: argparse.Namespace) -> int:
    path = discover_config() if args.config is None else args.config
    servers = load_config(path)
    print(f"config: {path}")
    for name, spec in servers.items():
        print(f"  {name}\tvia={spec.via}\turl={spec.url}\ttransport={spec.transport}")
    return 0


_STUB_MESSAGE = "implemented in Phase B"


def _cmd_stub(subcommand: str) -> int:
    print(_STUB_MESSAGE)
    log_invocation(server="", subcommand=subcommand, outcome="stub")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    start = time.monotonic()
    try:
        if args.subcommand == "servers":
            rc = _cmd_servers(args)
            log_invocation(server="", subcommand="servers", duration_ms=measure_ms(start), outcome="ok")
            return rc
        return _cmd_stub(args.subcommand)
    except Exception as exc:
        log_invocation(
            server="",
            subcommand=args.subcommand,
            duration_ms=measure_ms(start),
            outcome="error",
            error=type(exc).__name__,
        )
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
