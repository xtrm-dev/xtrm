"""Alert → service routing (advisory only).

Takes an Alertmanager-shape payload → calls ``knowledge_search`` → returns the
top-K services + their probes as a §3.2 evidence bundle.

Advisory only: no mutation, no auto-remediation. The PR5b canary policy will
build on this surface once operator ratifies thresholds.

Alertmanager payload shape reference (v4):
    {
      "receiver": "...", "status": "firing",
      "alerts": [
        {"labels": {"alertname": "...", "service": "...", "severity": "..."},
         "annotations": {"summary": "...", "description": "..."},
         "startsAt": "...", "endsAt": "...", "generatorURL": "..."},
        ...
      ]
    }
"""
from __future__ import annotations

from pathlib import Path
from typing import Any


def _extract_query(payload: dict[str, Any]) -> tuple[str, list[str]]:
    """Return (search_query, hinted_service_ids) from an Alertmanager payload."""
    alerts = payload.get("alerts") or []
    tokens: list[str] = []
    hinted: list[str] = []
    for alert in alerts:
        labels = alert.get("labels", {}) or {}
        anns = alert.get("annotations", {}) or {}
        for key in ("alertname", "service", "job", "instance", "namespace"):
            v = labels.get(key)
            if v:
                tokens.append(str(v))
                if key == "service":
                    hinted.append(str(v))
        for key in ("summary", "description"):
            v = anns.get(key)
            if v:
                tokens.append(str(v))
    return " ".join(tokens), hinted


def route(
    payload: dict[str, Any],
    consumer_root: Path | None = None,
    top_k: int = 5,
) -> dict[str, Any]:
    """Route an alert payload → evidence bundle. Advisory only, never mutates."""
    query, hinted = _extract_query(payload)
    root = Path(consumer_root or Path.cwd())
    result: dict[str, Any] = {
        "advisory_only": True,
        "query": query,
        "hinted_services": hinted,
        "services": [],
        "probes": [],
        "bundle": None,
    }
    if not query:
        return result
    try:
        from service_knowledge.index import query as query_mod
    except ImportError:
        return result
    ctx = query_mod.QueryContext(query=query, limit=top_k)
    try:
        bundle = query_mod.search(root, ctx)
    except Exception:
        return result
    services: list[str] = []
    probes: list[dict[str, Any]] = []
    for r in (bundle.get("results") or [])[:top_k]:
        item = r.get("item", {})
        svc = item.get("service_id")
        if svc and svc not in services:
            services.append(svc)
        for probe in (item.get("probes") or []):
            probes.append({"service_id": svc, "probe": probe})
    result["services"] = services
    result["probes"] = probes[: top_k * 2]
    result["bundle"] = bundle
    return result
