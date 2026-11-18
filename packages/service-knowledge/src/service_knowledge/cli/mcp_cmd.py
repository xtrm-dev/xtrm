"""``service-knowledge mcp`` — serve the read-only knowledge tools over MCP, and inspect them.

Three actions:

``serve``
    Run the stdio MCP (JSON-RPC 2.0) server. A ``.mcp.json`` or a plugin launcher points here.
``specs``
    Print the tool definitions (``--json`` for the machine-readable projection). This is the
    command that generates the pi extension's committed ``tool-definitions.json``.
``call``
    Invoke one tool from a shell and print its JSON result. The pi extension uses this as its
    execution path, so both hosts run literally the same code.

Stdlib-only, like the rest of the CLI. The tools themselves live in
:mod:`service_knowledge.mcp`; this module is only the process surface.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from service_knowledge.mcp import DEFERRED_TOOLS, tool_registry, tool_specs
from service_knowledge.mcp import jsonrpc


def _print_json(payload: object) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def _cmd_serve(_args: argparse.Namespace) -> int:
    jsonrpc.serve_stdio()
    return 0


def _cmd_specs(args: argparse.Namespace) -> int:
    specs = tool_specs()
    if args.json:
        _print_json({
            "server": jsonrpc.SERVER_NAME,
            "version": jsonrpc.SERVER_VERSION,
            "protocol_versions": list(jsonrpc.SUPPORTED_PROTOCOL_VERSIONS),
            "instructions": jsonrpc.SERVER_INSTRUCTIONS,
            "tools": specs,
            "deferred": list(DEFERRED_TOOLS),
        })
        return 0
    for spec in specs:
        required = spec["parameters"].get("required") or []
        params = ", ".join(
            f"{name}{'' if name in required else '?'}" for name in spec["parameters"].get("properties", {})
        )
        print(f"{spec['name']}({params})")
        print(f"    {spec['description']}")
    if DEFERRED_TOOLS:
        print(f"deferred: {', '.join(DEFERRED_TOOLS)}")
    return 0


def _cmd_call(args: argparse.Namespace) -> int:
    tools = tool_registry()
    if args.tool not in tools:
        print(f"error: unknown tool '{args.tool}'; available: {', '.join(sorted(tools))}", file=sys.stderr)
        return 2
    raw = args.args_json or "{}"
    try:
        arguments: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"error: --args-json is not valid JSON: {exc}", file=sys.stderr)
        return 2
    if not isinstance(arguments, dict):
        print("error: --args-json must be a JSON object", file=sys.stderr)
        return 2
    try:
        payload = tools[args.tool](**arguments)
    except TypeError as exc:
        print(f"error: bad arguments for {args.tool}: {exc}", file=sys.stderr)
        return 2
    _print_json(payload)
    # A tool that reports its own failure still exits 0: the JSON carries the error, and callers
    # (the pi extension) read the payload rather than the exit code for tool-level outcomes.
    return 0


def register(sub: argparse._SubParsersAction) -> None:
    mcp_p = sub.add_parser(
        "mcp",
        help="Serve the read-only knowledge tools over MCP (JSON-RPC stdio), and inspect them.",
        description=(
            "Serve the read-only knowledge tools over MCP, or inspect and invoke them from a shell. "
            "`serve` is the stdio JSON-RPC server a Claude Code plugin launcher or a .mcp.json points at."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
        "  service-knowledge mcp serve\n"
        "  service-knowledge mcp specs\n"
        "  service-knowledge mcp specs --json\n"
        "  service-knowledge mcp call knowledge_search --args-json '{\"query\": \"discord webhook\"}'\n",
    )
    actions = mcp_p.add_subparsers(dest="mcp_action", metavar="<action>")

    actions.add_parser("serve", help="Run the stdio MCP JSON-RPC server.")

    specs_p = actions.add_parser("specs", help="Print the tool definitions.")
    specs_p.add_argument("--json", action="store_true", default=False,
                         help="Machine-readable projection (server metadata + tools + deferred).")

    call_p = actions.add_parser("call", help="Invoke one tool and print its JSON result.")
    call_p.add_argument("tool", help="Tool name, e.g. knowledge_search.")
    call_p.add_argument("--args-json", default="{}",
                        help="Tool arguments as a JSON object (default: {}).")


def run(args: argparse.Namespace) -> int:
    action = getattr(args, "mcp_action", None)
    if action == "serve":
        return _cmd_serve(args)
    if action == "specs":
        return _cmd_specs(args)
    if action == "call":
        return _cmd_call(args)
    print("error: specify an action: serve | specs | call", file=sys.stderr)
    return 2
