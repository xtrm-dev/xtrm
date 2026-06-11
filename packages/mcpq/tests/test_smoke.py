"""Live smoke tests against the mercury_platform MCP sidecars.

Gated on `docker ps` showing both `infra-prometheus-mcp` and `infra-grafana-mcp`.
If either container isn't running, the whole module skips — these tests are NOT
unit tests; they exercise real network + docker-exec + MCP handshake.

Use the self-test config at `packages/mcpq/.mcpq.json` (both servers via the
`docker:infra-prometheus-mcp` proxy).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from mcpq.client import MCPClient
from mcpq.config import load_config

SELF_TEST_CONFIG = Path(__file__).resolve().parents[1] / ".mcpq.json"


def _container_running(name: str) -> bool:
    try:
        out = subprocess.run(
            ["docker", "ps", "--filter", f"name={name}", "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return name in out.stdout.splitlines()


def _sidecars_up() -> bool:
    return _container_running("infra-prometheus-mcp") and _container_running("infra-grafana-mcp")


pytestmark = pytest.mark.skipif(
    not _sidecars_up(),
    reason="live mercury_platform MCP sidecars not running (skip smoke)",
)


@pytest.fixture(scope="module")
def servers():
    assert SELF_TEST_CONFIG.exists(), f"missing self-test config: {SELF_TEST_CONFIG}"
    return load_config(SELF_TEST_CONFIG)


def test_prometheus_initialize(servers):
    client = MCPClient(servers["prometheus"])
    info = client.initialize()
    assert info["serverInfo"]["name"]
    assert client.session_id is not None


def test_prometheus_list_tools_returns_six_mercury_prefixed(servers):
    client = MCPClient(servers["prometheus"])
    client.initialize()
    tools = client.list_tools()
    names = sorted(t["name"] for t in tools)
    assert len(names) == 6, f"expected 6 tools, got {len(names)}: {names}"
    assert all(n.startswith("mercury_") for n in names), names


def test_prometheus_call_health_check(servers):
    client = MCPClient(servers["prometheus"])
    client.initialize()
    result = client.call_tool("mercury_health_check", {})
    # call_tool returns the JSON-RPC result envelope; either a dict with
    # 'content' or 'structuredContent', or a tool-level error.
    assert not result.get("isError"), result


def test_prometheus_call_execute_query_returns_vector_value_one(servers):
    client = MCPClient(servers["prometheus"])
    client.initialize()
    result = client.call_tool(
        "mercury_execute_query",
        {"query": 'up{job="prometheus"}'},
    )
    assert not result.get("isError"), result
    # Find the value=1 in either structuredContent or content[].text
    text_blob = json.dumps(result)
    assert '"1"' in text_blob or '"value":1' in text_blob or "'value': 1" in text_blob


def test_grafana_initialize(servers):
    client = MCPClient(servers["grafana"])
    info = client.initialize()
    assert info["serverInfo"]["name"]


def test_grafana_list_tools_returns_at_least_forty(servers):
    client = MCPClient(servers["grafana"])
    client.initialize()
    tools = client.list_tools()
    assert len(tools) >= 40, f"expected 40+ tools, got {len(tools)}"


def test_grafana_describe_search_dashboards(servers):
    client = MCPClient(servers["grafana"])
    client.initialize()
    tools = client.list_tools()
    sd = next((t for t in tools if t["name"] == "search_dashboards"), None)
    assert sd is not None, "search_dashboards tool missing"
    assert "inputSchema" in sd
