"""MCP JSON-RPC envelopes and SSE response parsing.

The streamable-http transport returns each response as either:
  * a plain JSON body (`Content-Type: application/json`), or
  * a Server-Sent Events stream (`Content-Type: text/event-stream`) framed
    as `event: message\\ndata: {...}\\n\\n` per the MCP spec.

Both shapes carry a `Mcp-Session-Id` response header that subsequent calls
must echo back.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

SESSION_HEADER = "mcp-session-id"
ACCEPT_HEADER = "application/json, text/event-stream"
CONTENT_TYPE = "application/json"

INITIALIZE_METHOD = "initialize"
INITIALIZED_METHOD = "notifications/initialized"
TOOLS_LIST_METHOD = "tools/list"
TOOLS_CALL_METHOD = "tools/call"


@dataclass
class RPCRequest:
    method: str
    params: Mapping[str, Any] | None = None
    id: int | None = None

    def to_envelope(self) -> str:
        if self.id is None:
            envelope: dict[str, Any] = {"jsonrpc": "2.0", "method": self.method}
        else:
            envelope = {"jsonrpc": "2.0", "id": self.id, "method": self.method}
        if self.params is not None:
            envelope["params"] = dict(self.params)
        return json.dumps(envelope, separators=(",", ":"))


def build_initialize(client_name: str, client_version: str, protocol_version: str) -> RPCRequest:
    return RPCRequest(
        method=INITIALIZE_METHOD,
        params={
            "protocolVersion": protocol_version,
            "capabilities": {},
            "clientInfo": {"name": client_name, "version": client_version},
        },
        id=1,
    )


def build_initialized() -> RPCRequest:
    # No `id` per JSON-RPC notification semantics.
    return RPCRequest(method=INITIALIZED_METHOD, params={})


def build_tools_list(request_id: int) -> RPCRequest:
    return RPCRequest(method=TOOLS_LIST_METHOD, params={}, id=request_id)


def build_tools_call(name: str, arguments: Mapping[str, Any], request_id: int) -> RPCRequest:
    return RPCRequest(
        method=TOOLS_CALL_METHOD,
        params={"name": name, "arguments": dict(arguments)},
        id=request_id,
    )


def parse_response_body(body: bytes) -> dict[str, Any]:
    """Decode an MCP response body that is either raw JSON or SSE-framed."""
    text = body.decode("utf-8", errors="replace")
    stripped = text.lstrip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    return _parse_sse(text)


def _parse_sse(text: str) -> dict[str, Any]:
    """Parse a text/event-stream payload and return the last `message` event."""
    messages: list[dict[str, Any]] = []
    data_lines: list[str] = []

    def _flush() -> None:
        nonlocal data_lines
        if data_lines:
            payload = "\n".join(data_lines)
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError:
                # Skip non-JSON event payloads (e.g. ping comments).
                pass
            else:
                messages.append(parsed)
        data_lines = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r")
        if line == "":
            _flush()
            continue
        if line.startswith(":"):
            # SSE comment / keepalive — ignore.
            continue
        if ":" not in line:
            field = line
            value = ""
        else:
            field, _, value = line.partition(":")
            if value.startswith(" "):
                value = value[1:]
        if field == "data":
            data_lines.append(value)
    # Trailing event without final blank line.
    if data_lines:
        _flush()

    if not messages:
        raise ValueError("SSE payload contained no JSON messages")
    return messages[-1]


def find_session_id(headers: Mapping[str, str]) -> str | None:
    """Case-insensitive lookup for the `Mcp-Session-Id` response header."""
    target = SESSION_HEADER.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return value
    return None
