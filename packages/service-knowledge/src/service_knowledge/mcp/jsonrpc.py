"""Stdio MCP (JSON-RPC 2.0) server for the read-only knowledge tools.

Why this exists beside ``server.py``: ``server.py`` speaks vaultctl's line protocol
(``{"tool": .., "args": ..}``), not MCP, so no ``.mcp.json`` can point at it. This module serves the
same tools over real MCP JSON-RPC and leaves ``server.py`` untouched for vaultctl compatibility.

Transport: one JSON-RPC message per line on stdin/stdout, per the MCP stdio transport.

Protocol posture — stateless by construction. MCP 2026-07-28 removed ``initialize``,
``notifications/initialized`` and ``Mcp-Session-Id``; Claude Code still opens at 2025-11-25 by
default (docs/substrate/claude-transport-constraints.md §9). This server keeps no session state at
all, so it answers correctly in both worlds: an ``initialize`` request is answered for
initialize-era clients, and a bare ``tools/list`` or ``tools/call`` is answered whenever it arrives.
That satisfies ``legacy: "reject"`` clients and legacy clients without guessing a downgrade.

Errors are JSON-RPC errors for protocol faults (unknown method, malformed envelope) and tool-level
failures inside ``result`` with ``isError: true``, per MCP: a tool that fails is a successful call
that reports failure.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Any, TextIO

from service_knowledge import __version__
from service_knowledge.mcp import DEFERRED_TOOLS, tool_registry, tool_specs

SERVER_NAME = "service-knowledge"
SERVER_VERSION = __version__

# Newest first. A client asking for a version we serve gets its own back; any other request gets
# our newest supported version, which is what the MCP negotiation rule asks a server to do.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")

# Server-level guidance, surfaced to the client at initialize. This is the highest-leverage sentence
# the server can say: it tells the agent when to reach for the index instead of grep.
SERVER_INSTRUCTIONS = (
    "Operational service knowledge for this repository. Call knowledge_evidence_for_files before "
    "reading service source, and knowledge_search before grep, whenever the symptom-to-service "
    "mapping is unclear. Call knowledge_status when results look stale or empty, and "
    "knowledge_drift before trusting knowledge about recently changed code. These tools return "
    "evidence with citations, never conclusions."
)

JSONRPC_PARSE_ERROR = -32700
JSONRPC_INVALID_REQUEST = -32600
JSONRPC_METHOD_NOT_FOUND = -32601
JSONRPC_INVALID_PARAMS = -32602
JSONRPC_INTERNAL_ERROR = -32603


def _negotiate_protocol_version(requested: Any) -> str:
    """Return the client's version when we serve it, else our newest supported version."""
    if isinstance(requested, str) and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return SUPPORTED_PROTOCOL_VERSIONS[0]


def _jsonrpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _jsonrpc_result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _tool_list() -> list[dict[str, Any]]:
    """MCP ``tools/list`` payload derived from :func:`tool_specs` (the single source of truth)."""
    out: list[dict[str, Any]] = []
    for spec in tool_specs():
        out.append({
            "name": spec["name"],
            "description": spec["description"],
            "inputSchema": spec["parameters"],
            # Every shipped tool is read-only. ``index/gate.ensure_fresh`` may rebuild the DERIVED
            # sqlite cache on a stale index; that is a cache, not consumer data, and it is existing
            # behaviour documented in the skill.
            "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
        })
    return out


def _call_tool(name: Any, arguments: Any) -> dict[str, Any]:
    """Run one tool and shape the MCP ``tools/call`` result."""
    tools = tool_registry()
    if not isinstance(name, str) or name not in tools:
        known = ", ".join(sorted(tools))
        return {
            "content": [{"type": "text", "text": f"unknown tool {name!r}; available: {known}"}],
            "isError": True,
        }
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        return {
            "content": [{"type": "text", "text": "arguments must be a JSON object"}],
            "isError": True,
        }
    try:
        payload = tools[name](**arguments)
    except TypeError as exc:
        return {
            "content": [{"type": "text", "text": f"bad arguments for {name}: {exc}"}],
            "isError": True,
        }
    except (AttributeError, KeyError, OSError, RuntimeError, ValueError, sqlite3.Error) as exc:
        return {"content": [{"type": "text", "text": f"{name} failed: {exc}"}], "isError": True}

    # Tools report their own failures as {"error": ...} rather than raising, so surface that as a
    # protocol-level tool error instead of a successful payload with an error key inside it.
    if isinstance(payload, dict) and set(payload) == {"error"}:
        return {"content": [{"type": "text", "text": str(payload["error"])}], "isError": True}

    text = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": payload,
        "isError": False,
    }


def handle(request: Any) -> dict[str, Any] | None:
    """Handle one decoded JSON-RPC message. Returns None for notifications (no reply)."""
    if not isinstance(request, dict):
        return _jsonrpc_error(None, JSONRPC_INVALID_REQUEST, "request must be a JSON object")

    method = request.get("method")
    request_id = request.get("id")
    params = request.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return _jsonrpc_error(request_id, JSONRPC_INVALID_PARAMS, "params must be an object")

    # A notification (no id) is never answered, whatever the method.
    is_notification = request_id is None

    if method == "initialize":
        result = {
            "protocolVersion": _negotiate_protocol_version(params.get("protocolVersion")),
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": SERVER_INSTRUCTIONS,
        }
        return None if is_notification else _jsonrpc_result(request_id, result)

    if method in ("notifications/initialized", "initialized"):
        return None

    if method == "ping":
        return None if is_notification else _jsonrpc_result(request_id, {})

    if method == "tools/list":
        if is_notification:
            return None
        return _jsonrpc_result(request_id, {"tools": _tool_list()})

    if method == "tools/call":
        if is_notification:
            return None
        return _jsonrpc_result(request_id, _call_tool(params.get("name"), params.get("arguments")))

    if method in ("resources/list", "prompts/list"):
        # Advertised as absent in capabilities; answer empty rather than fault if asked anyway.
        return None if is_notification else _jsonrpc_result(request_id, {"resources": []} if "resources" in str(method) else {"prompts": []})

    return None if is_notification else _jsonrpc_error(
        request_id, JSONRPC_METHOD_NOT_FOUND, f"unknown method {method!r}"
    )


def serve_stdio(stdin: TextIO | None = None, stdout: TextIO | None = None) -> None:
    """Read newline-delimited JSON-RPC from stdin, write replies to stdout."""
    in_stream = stdin if stdin is not None else sys.stdin
    out_stream = stdout if stdout is not None else sys.stdout
    for raw in in_stream:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            out_stream.write(json.dumps(_jsonrpc_error(None, JSONRPC_PARSE_ERROR, "invalid JSON")) + "\n")
            out_stream.flush()
            continue
        try:
            response = handle(request)
        except Exception as exc:  # a tool crash must not take the server down
            response = _jsonrpc_error(
                request.get("id") if isinstance(request, dict) else None,
                JSONRPC_INTERNAL_ERROR,
                f"internal error: {exc}",
            )
        if response is not None:
            out_stream.write(json.dumps(response, ensure_ascii=False) + "\n")
        out_stream.flush()


def deferred_tools() -> tuple[str, ...]:
    """Roadmap tools, advertised through the CLI ``mcp specs`` surface only."""
    return DEFERRED_TOOLS


if __name__ == "__main__":
    serve_stdio()
