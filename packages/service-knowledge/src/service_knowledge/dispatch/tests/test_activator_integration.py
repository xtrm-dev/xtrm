"""Activator integration tests: the real PreToolUse script fired as a subprocess.

Covers the §3.7 success criteria against a built api-gateway index:
* Write in api-gateway/** -> evidence bundle injected, no block.
* Write in api-gateway/** with a broken index -> LOUD block with an actionable message.
* Read/Glob/Grep never block, even on a broken index.
* OVERRIDE_KNOWLEDGE_BUNDLE=1 -> proceeds with a warning + an override telemetry event.
* Telemetry: component=activator lines; decision=block never appears for read-only tools.
"""
from __future__ import annotations

from pathlib import Path

from service_knowledge.dispatch.tests.conftest import read_telemetry, run_activator


def _break_index(consumer: Path) -> None:
    (consumer / ".xtrm" / "cache" / "service-knowledge.sqlite").write_bytes(b"garbage not sqlite")


def test_write_in_gateway_injects_bundle_no_block(gateway_consumer):
    code, out, err = run_activator(
        gateway_consumer, "Write", {"file_path": str(gateway_consumer / "api-gateway" / "config.yml")})
    assert code == 0, err
    assert out is not None
    hook = out["hookSpecificOutput"]
    assert "permissionDecision" not in hook or hook["permissionDecision"] != "deny"
    assert "api-gateway" in hook["additionalContext"]
    assert "evidence bundle" in hook["additionalContext"]


def test_write_in_gateway_broken_index_blocks_loudly(gateway_consumer):
    _break_index(gateway_consumer)
    code, out, err = run_activator(
        gateway_consumer, "Write", {"file_path": str(gateway_consumer / "api-gateway" / "config.yml")})
    assert code == 0, err
    hook = out["hookSpecificOutput"]
    assert hook["permissionDecision"] == "deny"
    reason = hook["permissionDecisionReason"]
    # LOUD + actionable: service, territory, expected bundle, why it failed, override path.
    assert "api-gateway" in reason
    assert "api-gateway/**" in reason
    assert "knowledge_evidence_for_files" in reason
    assert "OVERRIDE_KNOWLEDGE_BUNDLE=1" in reason


def test_read_never_blocks_on_broken_index(gateway_consumer):
    _break_index(gateway_consumer)
    for tool in ("Read", "Glob", "Grep"):
        code, out, err = run_activator(
            gateway_consumer, tool, {"file_path": str(gateway_consumer / "api-gateway" / "config.yml")})
        assert code == 0, err
        if out is not None:
            hook = out["hookSpecificOutput"]
            assert hook.get("permissionDecision") != "deny"


def test_override_proceeds_and_logs_override_event(gateway_consumer):
    _break_index(gateway_consumer)
    code, out, err = run_activator(
        gateway_consumer, "Write", {"file_path": str(gateway_consumer / "api-gateway" / "config.yml")},
        override=True)
    assert code == 0, err
    hook = out["hookSpecificOutput"]
    assert hook.get("permissionDecision") != "deny"
    assert "[OVERRIDE]" in hook["additionalContext"]
    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "activator"]
    overrides = [e for e in events if e.get("event") == "override"]
    assert overrides, "expected an override telemetry event"
    assert overrides[-1]["decision"] == "override"
    assert overrides[-1]["override_reason"]


def test_telemetry_records_activator_decisions(gateway_consumer):
    run_activator(gateway_consumer, "Write", {"file_path": str(gateway_consumer / "api-gateway" / "config.yml")})
    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "activator"]
    assert events
    record = events[-1]
    assert record["tool_name"] == "Write"
    assert record["service_ids"] == ["api-gateway"]
    assert record["decision"] in ("inject", "allow", "block", "override")
    assert "duration_ms" in record


def test_block_decision_never_logged_for_read_tools(gateway_consumer):
    _break_index(gateway_consumer)
    for tool in ("Read", "Glob", "Grep"):
        run_activator(gateway_consumer, tool, {"file_path": str(gateway_consumer / "api-gateway" / "config.yml")})
    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "activator"]
    read_blocks = [e for e in events if e.get("tool_name") in ("Read", "Glob", "Grep") and e.get("decision") == "block"]
    assert read_blocks == []


def test_non_territory_write_is_untouched(gateway_consumer):
    code, out, err = run_activator(
        gateway_consumer, "Write", {"file_path": str(gateway_consumer / "docs" / "readme.md")})
    assert code == 0, err
    assert out is None  # no territory match -> hook stays silent
