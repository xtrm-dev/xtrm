"""MCP surface: 3 read-only tools registered; list_tools advertises them + deferred roadmap."""
from __future__ import annotations

from service_knowledge import index
from service_knowledge.mcp import DEFERRED_TOOLS, tool_registry, tool_specs
from service_knowledge.mcp import server as mcp_server


def test_three_tools_registered():
    registry = tool_registry()
    assert set(registry) == {"knowledge_search", "knowledge_get", "knowledge_evidence_for_files"}
    assert len(tool_specs()) == 3


def test_deferred_tools_documented():
    assert set(DEFERRED_TOOLS) == {"knowledge_probes", "knowledge_conflicts"}


def test_list_tools(alertmanager_consumer):
    index.build(alertmanager_consumer)
    response = mcp_server.handle({"tool": "list_tools"})
    assert set(response["tools"]) == {"knowledge_search", "knowledge_get", "knowledge_evidence_for_files"}
    assert "knowledge_probes" in response["deferred"]


def test_knowledge_search_tool(alertmanager_consumer):
    index.build(alertmanager_consumer)
    response = mcp_server.handle(
        {"tool": "knowledge_search", "args": {"query": "discord webhook", "consumer_root": str(alertmanager_consumer)}})
    bundle = response["result"]
    assert bundle["routing"]["matched_services"] == ["alertmanager"]


def test_knowledge_evidence_for_files_tool(alertmanager_consumer):
    index.build(alertmanager_consumer)
    response = mcp_server.handle(
        {"tool": "knowledge_evidence_for_files",
         "args": {"paths": ["alertmanager/alertmanager.yml"], "consumer_root": str(alertmanager_consumer)}})
    assert response["result"]["routing"]["matched_services"] == ["alertmanager"]


def test_knowledge_get_tool(alertmanager_consumer):
    index.build(alertmanager_consumer)
    response = mcp_server.handle(
        {"tool": "knowledge_get",
         "args": {"item_id": "section:alertmanager:notifications", "consumer_root": str(alertmanager_consumer)}})
    assert response["result"]["item"]["kind"] == "section"


def test_unknown_tool_errors():
    assert "error" in mcp_server.handle({"tool": "knowledge_probes"})
