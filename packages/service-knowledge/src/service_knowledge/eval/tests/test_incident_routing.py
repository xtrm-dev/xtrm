"""incident_routing MCP tool (vaultctl-backed; run in CI)."""
from __future__ import annotations

from service_knowledge import index
from service_knowledge.mcp import incident_routing


def test_helper_extraction_is_pure():
    payload = {
        "commonLabels": {"service": "api-gateway"},
        "commonAnnotations": {"summary": "high latency"},
        "alerts": [
            {"labels": {"alertname": "HighLatency", "service": "api-gateway"},
             "annotations": {"summary": "p99 high", "description": "gw p99 > 1s"}}
        ],
    }
    alerts = incident_routing._extract_alerts(payload)
    assert incident_routing._candidate_service_ids(alerts, payload["commonLabels"]) == ["api-gateway"]
    assert incident_routing._alert_names(alerts, payload["commonAnnotations"]) == ["HighLatency"]


def test_label_named_service_outranks_noisy_match():
    search_result = {"results": [
        {"item": {"service_id": "api-gateway"}, "score": 0.5},
        {"item": {"service_id": "grafana"}, "score": 0.9},
    ]}
    ranked = incident_routing._rank_services(search_result, ["api-gateway"], 3)
    assert ranked[0]["service_id"] == "api-gateway"  # +1.0 label bonus beats grafana's raw score


def test_run_routes_alert_to_owning_service(routing_consumer):
    index.build(routing_consumer)
    payload = {
        "status": "firing",
        "commonLabels": {"service": "api-gateway"},
        "commonAnnotations": {"summary": "high latency"},
        "alerts": [
            {"status": "firing",
             "labels": {"alertname": "HighLatency", "service": "api-gateway", "severity": "critical"},
             "annotations": {"summary": "api-gateway p99 latency high"}}
        ],
    }
    result = incident_routing.run(payload, top_k=3, consumer_root=str(routing_consumer))
    assert result["advisory"] is True
    assert result["routed_services"][0]["service_id"] == "api-gateway"
    assert "api-gateway" in result["candidate_services"]
    assert result["alert_names"] == ["HighLatency"]
    assert isinstance(result["evidence_bundle"], dict)
    assert isinstance(result["probes"], list)
    # advisory only: no raw query text leaked into the result (hashed instead)
    assert "high latency" not in result["query_hash"]


def test_run_rejects_non_object_payload(routing_consumer):
    index.build(routing_consumer)
    try:
        incident_routing.run(["not", "an", "object"], consumer_root=str(routing_consumer))
    except ValueError:
        return
    raise AssertionError("expected ValueError for non-object payload")
