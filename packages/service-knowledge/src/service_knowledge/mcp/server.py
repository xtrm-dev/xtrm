"""Minimal stdio MCP server for the three read-only knowledge tools.

Mirrors vaultctl's line-delimited JSON protocol so the two servers are drop-in compatible:
read ``{"tool": <name>, "args": {...}}`` per line, write ``{"result": ...}`` (or ``{"error": ...}``).
``list_tools`` advertises the three shipped tools; the two deferred tools are listed under
``deferred`` so clients can discover the roadmap without a hard surface break.
"""
from __future__ import annotations

import json
import sys
from typing import Any

from service_knowledge.mcp import DEFERRED_TOOLS, tool_registry, tool_specs


def handle(request: dict[str, Any]) -> dict[str, Any]:
    method = request.get("tool")
    args = dict(request.get("args", {}))
    if method == "list_tools":
        return {"tools": sorted(tool_registry()), "deferred": list(DEFERRED_TOOLS), "specs": tool_specs()}
    tools = tool_registry()
    if method not in tools:
        return {"error": f"unknown tool {method}"}
    try:
        return {"result": tools[method](**args)}
    except TypeError as exc:
        return {"error": f"bad arguments for {method}: {exc}"}
    except Exception as exc:  # boundary: MCP server must return errors, not crash the pipe
        return {"error": f"{method} failed: {exc}"}


def serve_stdio() -> None:
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps({"error": "invalid JSON"}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps(handle(request), ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    serve_stdio()
