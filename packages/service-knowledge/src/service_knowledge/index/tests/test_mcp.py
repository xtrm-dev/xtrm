"""MCP surface: 3 read-only tools registered; list_tools advertises them + deferred roadmap."""
from __future__ import annotations

import io
import json
import sys

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


def test_knowledge_get_rejects_untrusted_skill_paths(alertmanager_consumer, tmp_path):
    index.build(alertmanager_consumer)
    outside = tmp_path / "outside.txt"
    outside.write_text("PLANTED-ARBITRARY-READ", encoding="utf-8")
    for skill_path in ("../outside.txt", str(outside), "alertmanager/alertmanager.yml"):
        response = mcp_server.handle(
            {"tool": "knowledge_get", "args": {
                "skill_path": skill_path, "consumer_root": str(alertmanager_consumer)}})
        assert "error" in response.get("result", response)
        assert "PLANTED-ARBITRARY-READ" not in json.dumps(response)


def test_knowledge_get_rejects_alternate_consumer_root(alertmanager_consumer, tmp_path):
    index.build(alertmanager_consumer)
    alternate = tmp_path / "alternate"
    alternate.mkdir()
    planted = alternate / "secret.txt"
    planted.write_text("PLANTED-ALTERNATE-ROOT", encoding="utf-8")
    response = mcp_server.handle(
        {"tool": "knowledge_get", "args": {
            "skill_path": "SKILL.md", "consumer_root": str(alternate)}})
    assert "error" in response.get("result", response)
    assert "PLANTED-ALTERNATE-ROOT" not in json.dumps(response)


def test_unknown_tool_errors():
    assert "error" in mcp_server.handle({"tool": "knowledge_probes"})


def test_stdio_jsonl_smoke_and_invalid_request(alertmanager_consumer, monkeypatch, capsys):
    index.build(alertmanager_consumer)
    requests = [
        {"tool": "knowledge_search", "args": {
            "query": "discord webhook", "consumer_root": str(alertmanager_consumer)}},
        "not-json",
    ]
    monkeypatch.setattr(
        sys, "stdin", io.StringIO("\n".join(
            item if isinstance(item, str) else json.dumps(item) for item in requests
        ) + "\n"))

    mcp_server.serve_stdio()

    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 2
    search_response = json.loads(lines[0])
    assert search_response["result"]["routing"]["matched_services"] == ["alertmanager"]
    assert json.loads(lines[1]) == {"error": "invalid JSON"}
