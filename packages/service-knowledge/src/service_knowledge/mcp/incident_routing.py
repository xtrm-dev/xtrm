"""incident_routing — alert-to-service routing wrapper (research §3.7, PR5a).

Thin, *advisory-only* wrapper over ``knowledge_search`` / ``evidence_for_files`` that accepts an
Alertmanager-shaped payload and returns the top-K candidate services, their runbook probes and a
§3.2 evidence bundle. It never mutates anything — routing stays advisory until the PR5b canary
policy ships. Input is normalized to a hashed query upstream (telemetry never logs raw text).
"""
from __future__ import annotations

from typing import Any

from service_knowledge.mcp._root import resolve_consumer_root

TOOL_NAME = "incident_routing"
DESCRIPTION = (
    "Route an Alertmanager-shaped alert payload to the most likely owning service(s). Returns "
    "top-K candidate services, their runbook probes and a §3.2 evidence bundle. Advisory only — "
    "performs no mutation."
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "payload": {
            "type": "object",
            "description": "Alertmanager webhook payload ({alerts:[{labels,annotations}], commonLabels, ...}).",
        },
        "top_k": {"type": "integer", "minimum": 1, "maximum": 7, "default": 3},
        "consumer_root": {"type": "string"},
    },
    "required": ["payload"],
}

# Label keys that most reliably name the owning service across mercury-infra alert conventions.
_SERVICE_LABEL_KEYS = ("service", "service_id", "job", "container", "component")


def _extract_alerts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    alerts = payload.get("alerts")
    if isinstance(alerts, list) and alerts:
        return [a for a in alerts if isinstance(a, dict)]
    # A bare single-alert shape (labels/annotations at top level) is also accepted.
    if isinstance(payload.get("labels"), dict):
        return [{"labels": payload.get("labels", {}), "annotations": payload.get("annotations", {})}]
    return []


def _candidate_service_ids(alerts: list[dict[str, Any]], common_labels: dict[str, Any]) -> list[str]:
    """Service ids named by the alert labels, in first-seen order (deduped)."""
    ordered: list[str] = []
    sources = [alert.get("labels", {}) for alert in alerts] + [common_labels]
    for labels in sources:
        if not isinstance(labels, dict):
            continue
        for key in _SERVICE_LABEL_KEYS:
            value = str(labels.get(key, "")).strip()
            if value and value not in ordered:
                ordered.append(value)
    return ordered


def _query_text(alerts: list[dict[str, Any]], common: dict[str, Any]) -> str:
    """Assemble a search query from alert names + annotation summary/description text."""
    parts: list[str] = []
    for alert in alerts:
        labels = alert.get("labels", {}) if isinstance(alert.get("labels"), dict) else {}
        annotations = alert.get("annotations", {}) if isinstance(alert.get("annotations"), dict) else {}
        if labels.get("alertname"):
            parts.append(str(labels["alertname"]))
        for key in ("summary", "description"):
            if annotations.get(key):
                parts.append(str(annotations[key]))
    for key in ("alertname", "summary", "description"):
        if common.get(key):
            parts.append(str(common[key]))
    return " ".join(parts).strip()


def run(payload: dict[str, Any], top_k: int = 3, consumer_root: str | None = None, **_: Any) -> dict[str, Any]:
    """Route an alert payload to candidate services + probes + an evidence bundle (advisory)."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be an Alertmanager-shaped object")
    from service_knowledge import index  # lazy: vaultctl-backed, keeps helpers importable standalone

    root = resolve_consumer_root(consumer_root)

    alerts = _extract_alerts(payload)
    common_labels = payload.get("commonLabels", {}) if isinstance(payload.get("commonLabels"), dict) else {}
    common_annotations = (
        payload.get("commonAnnotations", {}) if isinstance(payload.get("commonAnnotations"), dict) else {}
    )
    common = {**common_labels, **common_annotations}

    candidate_services = _candidate_service_ids(alerts, common_labels)
    query = _query_text(alerts, common)

    search_result = index.search(root, query, limit=max(top_k, 1))
    ranked_services = _rank_services(search_result, candidate_services, top_k)

    bundle = index.evidence_for_files(root, _paths_for_services(search_result) or [query], limit=max(top_k, 1))

    return {
        "advisory": True,
        "query_hash": _hash(query),
        "alert_names": _alert_names(alerts, common),
        "candidate_services": candidate_services,
        "routed_services": ranked_services,
        "probes": bundle.get("probes", []),
        "evidence_bundle": bundle,
    }


def _rank_services(search_result: dict[str, Any], label_services: list[str], top_k: int) -> list[dict[str, Any]]:
    """Merge label-named services with retrieval-ranked services; best score first, capped at top_k."""
    scored: dict[str, float] = {}
    for result in search_result.get("results", []):
        service_id = str(result.get("item", {}).get("service_id", ""))
        if service_id:
            scored[service_id] = max(scored.get(service_id, float("-inf")), float(result.get("score", 0.0)))
    # Label-named services get a routing bonus so an explicit service= label outranks a noisy match.
    for service_id in label_services:
        scored[service_id] = scored.get(service_id, 0.0) + 1.0
    ranked = sorted(scored.items(), key=lambda kv: kv[1], reverse=True)
    return [{"service_id": service_id, "score": round(score, 6)} for service_id, score in ranked[:top_k]]


def _paths_for_services(search_result: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for result in search_result.get("results", []):
        for citation in result.get("item", {}).get("citations", []):
            path = str(citation.get("path", ""))
            if path and path not in paths:
                paths.append(path)
    return paths


def _alert_names(alerts: list[dict[str, Any]], common: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for alert in alerts:
        labels = alert.get("labels", {}) if isinstance(alert.get("labels"), dict) else {}
        name = str(labels.get("alertname", ""))
        if name and name not in names:
            names.append(name)
    if common.get("alertname") and str(common["alertname"]) not in names:
        names.append(str(common["alertname"]))
    return names


def _hash(query: str) -> str:
    from service_knowledge.index import telemetry

    return telemetry.query_hash(query)
