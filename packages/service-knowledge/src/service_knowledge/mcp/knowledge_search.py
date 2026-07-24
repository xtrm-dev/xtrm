"""knowledge_search — search the per-repo index by query, path, service or intent.

Read-only. Returns a §3.2 evidence bundle (routing header + 3–7 top items + citations +
verification/freshness + probes + full-skill links). No ``answer()`` — evidence only.
"""
from __future__ import annotations

from typing import Any

from service_knowledge import index
from service_knowledge.index import query as query_mod
from service_knowledge.mcp._root import resolve_consumer_root

TOOL_NAME = "knowledge_search"
DESCRIPTION = (
    "Search operational service knowledge (per-repo FTS5 index). Returns an evidence bundle: "
    "routing header, top 3-7 ranked items (service/section/claim/probe) with interpretable "
    "T/L/I/A/F signals, citations, verification + freshness, applicable read-only probes, and "
    "links to the full skills. Read-only; returns evidence, never conclusions."
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Free-text query (alert name, metric, concept, path)."},
        "service_id": {"type": "string", "description": "Restrict/boost to a specific service id."},
        "paths": {"type": "array", "items": {"type": "string"}, "description": "File paths for territory routing."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 7, "default": 7},
        "consumer_root": {"type": "string", "description": "Consumer repo root (default: auto-resolved)."},
    },
    "required": ["query"],
}


def run(query: str, service_id: str | None = None, paths: list[str] | None = None,
        limit: int = 7, consumer_root: str | None = None, **_: Any) -> dict[str, Any]:
    root = resolve_consumer_root(consumer_root)
    ctx = query_mod.QueryContext(query=query, paths=tuple(paths or ()), service_id=service_id, limit=limit)
    result = query_mod.search(root, ctx)
    return index.build_bundle(result, root)
