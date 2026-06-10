"""Tests for the MCP protocol envelope + SSE parser."""

import json

from mcpq.protocol import (
    build_initialize,
    build_initialized,
    build_tools_call,
    build_tools_list,
    find_session_id,
    parse_response_body,
)


def test_initialize_envelope_shape():
    rpc = build_initialize(
        client_name="mcpq",
        client_version="0.1.0",
        protocol_version="2024-11-05",
    )
    env = rpc.to_dict() if hasattr(rpc, "to_dict") else dict(rpc.__dict__)
    # Some implementations expose .params directly; verify either way.
    assert getattr(rpc, "method", env.get("method")) == "initialize"
    params = getattr(rpc, "params", env.get("params"))
    assert params["protocolVersion"] == "2024-11-05"
    assert params["clientInfo"]["name"] == "mcpq"


def test_initialized_is_notification():
    rpc = build_initialized()
    method = getattr(rpc, "method", None)
    assert method == "notifications/initialized"


def test_tools_list_envelope():
    rpc = build_tools_list(request_id=2)
    assert getattr(rpc, "method") == "tools/list"
    assert getattr(rpc, "id") == 2


def test_tools_call_envelope():
    rpc = build_tools_call(name="my_tool", arguments={"q": "up"}, request_id=3)
    assert getattr(rpc, "method") == "tools/call"
    params = getattr(rpc, "params")
    assert params["name"] == "my_tool"
    assert params["arguments"] == {"q": "up"}


# ---------- SSE / body parser ----------

def test_parse_plain_json():
    body = b'{"result": {"x": 1}}'
    parsed = parse_response_body(body)
    assert parsed == {"result": {"x": 1}}


def test_parse_sse_single_event():
    body = b'event: message\ndata: {"result": 42}\n\n'
    parsed = parse_response_body(body)
    assert parsed == {"result": 42}


def test_parse_sse_multi_event_returns_last():
    body = (
        b'event: message\n'
        b'data: {"first": 1}\n\n'
        b'event: message\n'
        b'data: {"last": 2}\n\n'
    )
    parsed = parse_response_body(body)
    assert parsed == {"last": 2}


def test_parse_sse_multiline_data_concatenates():
    payload = {"data": "abc"}
    encoded = json.dumps(payload)
    half = len(encoded) // 2
    body = (
        f"event: message\n"
        f"data: {encoded[:half]}\n"
        f"data: {encoded[half:]}\n\n"
    ).encode()
    parsed = parse_response_body(body)
    assert parsed == payload


def test_parse_sse_ignores_comments():
    body = (
        b': this is a comment\n'
        b'event: message\n'
        b'data: {"x": 1}\n\n'
    )
    parsed = parse_response_body(body)
    assert parsed == {"x": 1}


# ---------- session-id lookup (dict input) ----------

def test_find_session_id_canonical():
    headers = {"Mcp-Session-Id": "abc123", "Content-Type": "application/json"}
    assert find_session_id(headers) == "abc123"


def test_find_session_id_lowercase():
    assert find_session_id({"mcp-session-id": "xyz"}) == "xyz"


def test_find_session_id_mixed_case():
    assert find_session_id({"MCP-Session-ID": "Z"}) == "Z"


def test_find_session_id_missing_returns_none():
    assert find_session_id({"Content-Type": "application/json"}) is None
