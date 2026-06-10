"""`mcpq` console-script entry point."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from . import __version__
from .args import parse_args
from .client import MCPClient
from .config import discover_config, load_config
from .render import render_call_result, render_schema, render_tool_list
from .telemetry import log_invocation, measure_ms
from .transport import TransportError


class _UserError(RuntimeError):
    """Recoverable error caused by user input; exit code 1."""


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
    parser.add_argument(
        "server",
        help="server name from .mcpq.json (or `servers` to list configured entries)",
    )
    # OP is required for real servers; not required when server == "servers".
    # Validation happens in _dispatch so we can surface a clear error.
    sub = parser.add_subparsers(dest="op", required=False, metavar="OP")

    list_tools = sub.add_parser("list-tools", help="list tools exposed by a server")
    list_tools.add_argument(
        "--json",
        action="store_true",
        help="emit raw JSON list of tool dicts to stdout",
    )

    describe = sub.add_parser("describe", help="describe a tool's input schema")
    describe.add_argument("tool", help="tool name")
    describe.add_argument(
        "--json",
        action="store_true",
        help="emit the raw tool dict to stdout",
    )

    call = sub.add_parser("call", help="call a tool with typed arguments")
    call.add_argument("tool", help="tool name")
    call.add_argument(
        "--arg",
        action="append",
        default=[],
        metavar="KEY[:TYPE]=VALUE",
        help=(
            "argument value, repeatable. TYPE defaults to str; "
            "supported: int, float, bool (true/false/1/0/yes/no), json. "
            "Example: --arg query=up --arg start:int=1700000000"
        ),
    )
    call.add_argument(
        "--json",
        action="store_true",
        help="emit the raw tools/call result envelope to stdout",
    )

    return parser


def _cmd_servers() -> int:
    path = discover_config()
    servers = load_config(path)
    print(f"config: {path}")
    for name, spec in servers.items():
        print(f"  {name}\tvia={spec.via}\turl={spec.url}\ttransport={spec.transport}")
    return 0


def _resolve_server(name: str, args: argparse.Namespace):
    path = discover_config() if args.config is None else args.config
    servers = load_config(path)
    if name not in servers:
        available = ", ".join(sorted(servers)) or "(none)"
        raise _UserError(f"unknown server {name!r}; available: {available}")
    return servers[name]


def _cmd_list_tools(args: argparse.Namespace) -> int:
    spec = _resolve_server(args.server, args)
    client = MCPClient(spec)
    client.initialize()
    tools = client.list_tools()
    if args.json:
        print(json.dumps(tools, indent=2, ensure_ascii=False))
    else:
        print(render_tool_list(tools))
    return 0


def _cmd_describe(args: argparse.Namespace) -> int:
    spec = _resolve_server(args.server, args)
    client = MCPClient(spec)
    client.initialize()
    tools = client.list_tools()
    tool = next((t for t in tools if t.get("name") == args.tool), None)
    if tool is None:
        available = ", ".join(sorted(t.get("name", "") for t in tools)) or "(none)"
        raise _UserError(
            f"unknown tool {args.tool!r} on server {args.server!r}; "
            f"available: {available}"
        )
    if args.json:
        print(json.dumps(tool, indent=2, ensure_ascii=False))
    else:
        print(render_schema(tool))
    return 0


def _cmd_call(args: argparse.Namespace) -> int:
    spec = _resolve_server(args.server, args)
    arguments: dict[str, Any] = parse_args(args.arg)
    client = MCPClient(spec)
    client.initialize()
    result = client.call_tool(args.tool, arguments)
    if result.get("isError"):
        message = _extract_error_text(result)
        raise _UserError(f"tool {args.tool!r} returned error: {message}")
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(render_call_result(result))
    return 0


def _extract_error_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if isinstance(content, list):
        texts = [
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        if texts:
            return "\n".join(texts)
    return json.dumps(result, ensure_ascii=False)


def _dispatch(args: argparse.Namespace) -> int:
    if args.server == "servers":
        return _cmd_servers()
    if args.op is None:
        raise _UserError(
            f"missing operation for server {args.server!r}; "
            f"choose one of: list-tools, describe, call"
        )
    if args.op == "list-tools":
        return _cmd_list_tools(args)
    if args.op == "describe":
        return _cmd_describe(args)
    if args.op == "call":
        return _cmd_call(args)
    raise _UserError(f"unknown subcommand {args.server!r}/{args.op!r}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    start = time.monotonic()
    server = "" if args.server == "servers" else args.server
    tool = getattr(args, "tool", "") or ""
    subcommand = "servers" if args.server == "servers" else args.op
    try:
        rc = _dispatch(args)
        log_invocation(
            server=server,
            subcommand=subcommand,
            tool=tool,
            duration_ms=measure_ms(start),
            outcome="ok",
        )
        return rc
    except _UserError as exc:
        log_invocation(
            server=server,
            subcommand=subcommand,
            tool=tool,
            duration_ms=measure_ms(start),
            outcome="error",
            error=type(exc).__name__,
        )
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except TransportError as exc:
        log_invocation(
            server=server,
            subcommand=subcommand,
            tool=tool,
            duration_ms=measure_ms(start),
            outcome="error",
            error="TransportError",
        )
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (ValueError, KeyError, FileNotFoundError) as exc:
        log_invocation(
            server=server,
            subcommand=subcommand,
            tool=tool,
            duration_ms=measure_ms(start),
            outcome="error",
            error=type(exc).__name__,
        )
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover
        log_invocation(
            server=server,
            subcommand=subcommand,
            tool=tool,
            duration_ms=measure_ms(start),
            outcome="error",
            error=type(exc).__name__,
        )
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
