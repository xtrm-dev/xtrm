"""Synthetic Alertmanager payload → returns hinted service in top-K."""
from __future__ import annotations

from service_knowledge.mcp import incident_routing


def test_alertmanager_payload_hints_service() -> None:
    payload = {
        "receiver": "sre",
        "status": "firing",
        "alerts": [
            {
                "labels": {"alertname": "HighLatency", "service": "api-gateway", "severity": "critical"},
                "annotations": {"summary": "p99 latency > 500ms", "description": "http_request_duration_seconds{service=\"api-gateway\"}"},
                "startsAt": "2026-07-24T00:00:00Z",
                "endsAt": "2026-07-24T00:05:00Z",
            }
        ],
    }
    result = incident_routing.route(payload)
    assert result["advisory_only"] is True
    assert "api-gateway" in result["hinted_services"]
    assert "api-gateway" in result["query"]


def test_empty_payload_is_advisory_noop() -> None:
    result = incident_routing.route({"alerts": []})
    assert result["advisory_only"] is True
    assert result["services"] == []
    assert result["query"] == ""
