"""MCP JSON-RPC server surface (CORE-2714).

Covers the three things that make the server usable by both hosts:

* the protocol handshake in both worlds — an initialize-era client that opens with
  ``initialize`` and a modern client that calls ``tools/list`` straight away (MCP 2026-07-28 is
  stateless; see docs/substrate/claude-transport-constraints.md §6/§9);
* ``tools/list`` derived from ``tool_specs()`` so the surface cannot drift from the Python SSOT;
* the two new read-only tools, including the hard requirement that ``knowledge_drift`` mutates
  nothing (no marker write, no index rebuild).

The parity test against the pi extension's committed ``tool-definitions.json`` lives here too, so a
description edit that forgets to regenerate the JSON fails in the Python suite as well as in bun.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from service_knowledge import index
from service_knowledge.mcp import jsonrpc, knowledge_drift, tool_specs

REPO_ROOT = Path(__file__).resolve().parents[6]
EXT_TOOL_DEFINITIONS = REPO_ROOT / "packages" / "service-knowledge-ext" / "tool-definitions.json"


def _drive(messages: list[dict]) -> list[dict]:
    """Feed newline-delimited JSON-RPC through serve_stdio and decode the replies."""
    stdin = io.StringIO("\n".join(json.dumps(m) for m in messages) + "\n")
    stdout = io.StringIO()
    jsonrpc.serve_stdio(stdin, stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]


def test_initialize_negotiates_a_supported_version_and_announces_instructions():
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                   "clientInfo": {"name": "test", "version": "0"}},
    }])
    result = reply["result"]
    assert result["protocolVersion"] == "2025-11-25"
    assert result["serverInfo"]["name"] == "service-knowledge"
    assert result["capabilities"]["tools"]["listChanged"] is False
    # The instructions are the server's one chance to steer the agent towards the index.
    assert "knowledge_evidence_for_files" in result["instructions"]


def test_initialize_falls_back_to_a_supported_version_for_an_unknown_request():
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "1999-01-01"},
    }])
    assert reply["result"]["protocolVersion"] in jsonrpc.SUPPORTED_PROTOCOL_VERSIONS


def test_stateless_tools_list_needs_no_handshake(alertmanager_consumer):
    """A modern (stateless) client opens with tools/list; no initialize precedes it."""
    index.build(alertmanager_consumer)
    [reply] = _drive([{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}])
    names = [tool["name"] for tool in reply["result"]["tools"]]
    assert names == [spec["name"] for spec in tool_specs()]


def test_tools_list_schemas_are_the_python_specs(alertmanager_consumer):
    index.build(alertmanager_consumer)
    [reply] = _drive([{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}])
    served = {tool["name"]: tool for tool in reply["result"]["tools"]}
    for spec in tool_specs():
        assert served[spec["name"]]["inputSchema"] == spec["parameters"]
        assert served[spec["name"]]["description"] == spec["description"]
        assert served[spec["name"]]["annotations"]["readOnlyHint"] is True


def test_notifications_are_never_answered(alertmanager_consumer):
    replies = _drive([
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 3, "method": "ping"},
    ])
    assert [reply["id"] for reply in replies] == [3]


def test_tools_call_returns_text_and_structured_content(alertmanager_consumer):
    index.build(alertmanager_consumer)
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": {"name": "knowledge_search",
                   "arguments": {"query": "discord webhook", "consumer_root": str(alertmanager_consumer)}},
    }])
    result = reply["result"]
    assert result["isError"] is False
    assert result["structuredContent"]["routing"]["matched_services"] == ["alertmanager"]
    assert json.loads(result["content"][0]["text"])["routing"]["matched_services"] == ["alertmanager"]


def test_tools_call_unknown_tool_is_a_tool_error_not_a_protocol_fault():
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 5, "method": "tools/call",
        "params": {"name": "knowledge_probes", "arguments": {}},
    }])
    assert "error" not in reply
    assert reply["result"]["isError"] is True
    assert "knowledge_probes" in reply["result"]["content"][0]["text"]


def test_tools_call_non_object_arguments_is_a_tool_error():
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 6, "method": "tools/call",
        "params": {"name": "knowledge_search", "arguments": ["not", "an", "object"]},
    }])
    assert reply["result"]["isError"] is True


def test_unknown_method_is_a_jsonrpc_method_not_found():
    [reply] = _drive([{"jsonrpc": "2.0", "id": 7, "method": "workspace/execute"}])
    assert reply["error"]["code"] == jsonrpc.JSONRPC_METHOD_NOT_FOUND


def test_malformed_json_is_a_parse_error_and_does_not_kill_the_server(alertmanager_consumer):
    index.build(alertmanager_consumer)
    stdin = io.StringIO(
        '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'
        "not-json\n"
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
    )
    stdout = io.StringIO()
    jsonrpc.serve_stdio(stdin, stdout)
    replies = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
    assert len(replies) == 3
    assert replies[1]["error"]["code"] == jsonrpc.JSONRPC_PARSE_ERROR
    assert replies[2]["id"] == 2


def test_knowledge_status_reports_the_registry_and_never_needs_an_index(alertmanager_consumer, monkeypatch):
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(alertmanager_consumer))
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 8, "method": "tools/call",
        "params": {"name": "knowledge_status", "arguments": {}},
    }])
    payload = reply["result"]["structuredContent"]
    assert payload["registry_present"] is True
    assert payload["usable"] is True
    assert payload["service_count"] == 1
    assert payload["packs"] == [{"pack": "infra", "umbrella": "service-knowledge", "services": 1}]
    assert payload["consumer_root"] == str(alertmanager_consumer)


def _snapshot(root: Path) -> dict[str, tuple[int, int]]:
    """Every file under ``root/.xtrm`` with (size, mtime_ns) — a write shows up here."""
    state: dict[str, tuple[int, int]] = {}
    for path in sorted((root / ".xtrm").rglob("*")):
        if path.is_file():
            stat = path.stat()
            state[path.relative_to(root).as_posix()] = (stat.st_size, stat.st_mtime_ns)
    return state


def test_knowledge_drift_never_mutates_the_consumer(alertmanager_consumer, monkeypatch):
    """The tool is advertised read-only: no marker write and no index rebuild."""
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(alertmanager_consumer))
    index.build(alertmanager_consumer)
    before = _snapshot(alertmanager_consumer)

    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 9, "method": "tools/call",
        "params": {"name": "knowledge_drift", "arguments": {}},
    }])

    assert reply["result"]["isError"] is False
    assert _snapshot(alertmanager_consumer) == before
    marker = alertmanager_consumer / ".xtrm" / ".service-knowledge-drift-pending"
    assert not marker.exists()


def test_knowledge_drift_reports_the_marker_and_stale_services(alertmanager_consumer, monkeypatch):
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(alertmanager_consumer))
    registry_path = (alertmanager_consumer / ".xtrm" / "skills" / "infra" / "service-knowledge"
                     / "service-registry.json")
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["services"]["alertmanager"]["last_sync_ref"] = "0000000"
    registry_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    marker = alertmanager_consumer / ".xtrm" / ".service-knowledge-drift-pending"
    marker.write_text(
        "trigger: post-merge\nrange: abc1234..def5678\nreason: ref-range\n"
        "services: alertmanager\ntimestamp: 2026-01-01T00:00:00Z\n",
        encoding="utf-8",
    )

    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 10, "method": "tools/call",
        "params": {"name": "knowledge_drift", "arguments": {}},
    }])
    payload = reply["result"]["structuredContent"]
    assert payload["marker_present"] is True
    assert payload["marker"]["reason"] == "ref-range"
    assert payload["marker"]["trigger"] == "post-merge"
    assert payload["marker"]["legacy_name"] is False
    assert payload["services_behind_head"] == [{"service_id": "alertmanager", "last_sync_ref": "0000000"}]
    assert payload["drift_detected"] is True
    assert payload["suggested_action"] == knowledge_drift.RECONCILE_HINT


def test_knowledge_drift_prefers_the_canonical_marker_over_the_legacy_name(alertmanager_consumer, monkeypatch):
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(alertmanager_consumer))
    (alertmanager_consumer / ".xtrm" / ".service-skills-drift-pending").write_text(
        "trigger: post-checkout\nrange: aaa1111..bbb2222\n", encoding="utf-8")
    canonical = alertmanager_consumer / ".xtrm" / ".service-knowledge-drift-pending"
    canonical.write_text("trigger: post-merge\nrange: ccc3333..ddd4444\nreason: ref-range\n",
                         encoding="utf-8")

    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 11, "method": "tools/call",
        "params": {"name": "knowledge_drift", "arguments": {}},
    }])
    payload = reply["result"]["structuredContent"]
    assert payload["marker"]["legacy_name"] is False
    assert payload["marker"]["reason"] == "ref-range"


def test_knowledge_status_and_drift_reject_an_untrusted_root(alertmanager_consumer, tmp_path, monkeypatch):
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(alertmanager_consumer))
    alternate = tmp_path / "alternate"
    alternate.mkdir()
    for name in ("knowledge_status", "knowledge_drift"):
        [reply] = _drive([{
            "jsonrpc": "2.0", "id": 12, "method": "tools/call",
            "params": {"name": name, "arguments": {"consumer_root": str(alternate)}},
        }])
        assert reply["result"]["isError"] is True
        assert "consumer_root must match" in reply["result"]["content"][0]["text"]


def test_worktree_session_finds_the_registry_through_an_ancestor(alertmanager_consumer, monkeypatch):
    """<repo>/.xtrm/worktrees/<name> carries no registry; the MCP root walk must climb to it."""
    worktree = alertmanager_consumer / ".xtrm" / "worktrees" / "feature"
    worktree.mkdir(parents=True)
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(worktree))
    index.build(alertmanager_consumer)

    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 13, "method": "tools/call",
        "params": {"name": "knowledge_search", "arguments": {"query": "discord webhook", "limit": 2}},
    }])
    assert reply["result"]["isError"] is False
    assert reply["result"]["structuredContent"]["routing"]["matched_services"] == ["alertmanager"]


def test_explicit_consumer_root_may_name_a_bounded_ancestor(alertmanager_consumer, monkeypatch):
    worktree = alertmanager_consumer / ".xtrm" / "worktrees" / "feature"
    worktree.mkdir(parents=True)
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(worktree))
    [reply] = _drive([{
        "jsonrpc": "2.0", "id": 14, "method": "tools/call",
        "params": {"name": "knowledge_status",
                   "arguments": {"consumer_root": str(alertmanager_consumer)}},
    }])
    assert reply["result"]["isError"] is False
    assert reply["result"]["structuredContent"]["consumer_root"] == str(alertmanager_consumer)


def test_pi_extension_tool_definitions_match_the_python_specs():
    """Parity gate: the committed pi definitions are exactly the Python projection."""
    assert EXT_TOOL_DEFINITIONS.exists(), (
        f"missing {EXT_TOOL_DEFINITIONS}; regenerate with "
        "`service-knowledge mcp specs --json` and copy `tools` into it"
    )
    committed = json.loads(EXT_TOOL_DEFINITIONS.read_text(encoding="utf-8"))
    assert committed["tools"] == tool_specs()


def test_pi_extension_tool_definitions_carry_the_server_metadata():
    committed = json.loads(EXT_TOOL_DEFINITIONS.read_text(encoding="utf-8"))
    assert committed["server"] == jsonrpc.SERVER_NAME
    assert committed["instructions"] == jsonrpc.SERVER_INSTRUCTIONS
    assert committed["deferred"] == ["knowledge_probes", "knowledge_conflicts"]


# --------------------------------------------------------------------------- #
# No-registry refusal (CORE-2714 review finding 1)
# --------------------------------------------------------------------------- #

def _empty_repo(tmp_path: Path) -> Path:
    """A git repo with no service registry: the shape of every unrelated checkout."""
    root = tmp_path / "unrelated"
    root.mkdir()
    (root / ".git").mkdir()  # enough for `git rev-parse --show-toplevel` to still fail cleanly
    return root


def test_retrieval_tools_refuse_when_the_repo_has_no_registry(tmp_path, monkeypatch):
    # The Claude plugin installs at user scope, so its three retrieval tools are present in EVERY
    # repository. Returning an empty bundle as a success reads to an agent as "the knowledge base
    # says no", which is the grep fallback this surface exists to remove.
    root = _empty_repo(tmp_path)
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(root))
    for name, args in (
        ("knowledge_search", {"query": "anything"}),
        ("knowledge_evidence_for_files", {"paths": ["src/app.py"]}),
        ("knowledge_get", {"item_id": "anything"}),
    ):
        result = jsonrpc._call_tool(name, args)
        assert result["isError"] is True, name
        text = result["content"][0]["text"]
        assert "no service registry" in text, name
        assert str(root) in text, f"{name} must name the root it looked at"
        assert "structuredContent" not in result, f"{name} must not return a payload"


def test_retrieval_refusal_creates_no_xtrm_state(tmp_path, monkeypatch):
    # The freshness gate creates its cache before the caller learns there is no registry. Refusing
    # first is the difference between "no knowledge here" and "this repo now has .xtrm/ in it".
    root = _empty_repo(tmp_path)
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(root))
    jsonrpc._call_tool("knowledge_search", {"query": "anything"})
    jsonrpc._call_tool("knowledge_evidence_for_files", {"paths": ["src/app.py"]})
    assert not (root / ".xtrm").exists(), "a refused read must not write consumer state"


def test_status_still_answers_in_a_repo_with_no_registry(tmp_path, monkeypatch):
    # status is the diagnostic that TELLS you a repo has not adopted service-knowledge. It must
    # not refuse, or the one tool that can explain the situation is unavailable in the situation.
    root = _empty_repo(tmp_path)
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(root))
    result = jsonrpc._call_tool("knowledge_status", {})
    assert result["isError"] is False
    assert result["structuredContent"]["registry_present"] is False
    assert result["structuredContent"]["usable"] is False


def test_notifications_are_never_answered_even_with_malformed_params():
    # A notification has no id, so a reply to it cannot be correlated. Dropping it is the spec
    # behaviour; answering with an error is noise the client never asked for.
    replies = _drive([
        {"jsonrpc": "2.0", "method": "notifications/initialized", "params": "not-an-object"},
        {"jsonrpc": "2.0", "method": "tools/call", "params": "not-an-object"},
        {"jsonrpc": "2.0", "id": 9, "method": "ping"},
    ])
    assert [r["id"] for r in replies] == [9]


def test_a_crashing_notification_gets_no_reply(monkeypatch):
    def _boom(**_):
        raise RuntimeError("tool exploded")

    monkeypatch.setitem(jsonrpc.tool_registry(), "knowledge_search", _boom)
    replies = _drive([{"jsonrpc": "2.0", "method": "tools/call",
                       "params": {"name": "knowledge_search", "arguments": {}}}])
    assert replies == []
