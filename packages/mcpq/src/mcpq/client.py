"""High-level MCP client combining protocol envelopes with a transport."""

from __future__ import annotations

from typing import Any, Mapping

from .config import ServerSpec
from .protocol import (
    ACCEPT_HEADER,
    CONTENT_TYPE,
    build_initialize,
    build_initialized,
    build_tools_call,
    build_tools_list,
    find_session_id,
    parse_response_body,
)
from .transport import DockerTransport, HostTransport, Response, TransportError
from .validation import validate_header_value

CLIENT_NAME = "mcpq"
CLIENT_VERSION = "0.1.0"


def build_transport(spec: ServerSpec) -> HostTransport | DockerTransport:
    if spec.via == "host":
        return HostTransport()
    if spec.via.startswith("docker:"):
        return DockerTransport(spec.proxy_container)
    raise ValueError(f"server {spec.name!r}: unknown via mode {spec.via!r}")


class MCPClient:
    """Stateful MCP client bound to one server."""

    def __init__(
        self,
        spec: ServerSpec,
        *,
        transport: HostTransport | DockerTransport | None = None,
    ) -> None:
        self.spec = spec
        self.transport = transport or build_transport(spec)
        self.session_id: str | None = None
        self._next_id = 1

    def _next_request_id(self) -> int:
        self._next_id += 1
        return self._next_id

    def _post(self, body: str) -> Response:
        headers: dict[str, str] = {"Content-Type": CONTENT_TYPE, "Accept": ACCEPT_HEADER}
        headers.update(self.spec.headers)
        if self.session_id is not None:
            headers["Mcp-Session-Id"] = self.session_id
        return self.transport.post(self.spec.url, headers, body.encode("utf-8"))

    def _capture_session(self, response: Response) -> None:
        sid = find_session_id(response.headers)
        if sid is not None:
            try:
                validate_header_value("Mcp-Session-Id", sid)
            except ValueError as exc:
                raise TransportError(f"invalid session id: {exc}") from exc
            self.session_id = sid

    def initialize(self) -> dict[str, Any]:
        req = build_initialize(
            client_name=CLIENT_NAME,
            client_version=CLIENT_VERSION,
            protocol_version=self.spec.protocol_version,
        )
        response = self._post(req.to_envelope())
        self._capture_session(response)
        result = parse_response_body(response.body)
        if "error" in result:
            raise TransportError(f"initialize error: {result['error']}")
        if response.status >= 400:
            raise TransportError(f"initialize HTTP {response.status}: {result}")
        # Per spec: acknowledge with notifications/initialized before tool calls.
        note = build_initialized()
        self._post(note.to_envelope())
        return result.get("result", {})

    def list_tools(self) -> list[dict[str, Any]]:
        req = build_tools_list(self._next_request_id())
        response = self._post(req.to_envelope())
        self._capture_session(response)
        result = parse_response_body(response.body)
        if "error" in result:
            raise TransportError(f"tools/list error: {result['error']}")
        if response.status >= 400:
            raise TransportError(f"tools/list HTTP {response.status}: {result}")
        return list(result.get("result", {}).get("tools", []))

    def call_tool(self, name: str, arguments: Mapping[str, Any] | None = None) -> dict[str, Any]:
        req = build_tools_call(name, arguments or {}, self._next_request_id())
        response = self._post(req.to_envelope())
        self._capture_session(response)
        result = parse_response_body(response.body)
        if "error" in result:
            raise TransportError(f"tools/call error: {result['error']}")
        if response.status >= 400:
            raise TransportError(f"tools/call HTTP {response.status}: {result}")
        return result.get("result", {})
