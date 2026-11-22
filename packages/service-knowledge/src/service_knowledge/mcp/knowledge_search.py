"""knowledge_search — search the per-repo index by query, path, service or intent.

Read-only. Returns a §3.2 evidence bundle (routing header + 3–7 top items + citations +
verification/freshness + probes + full-skill links). No ``answer()`` — evidence only.
"""
from __future__ import annotations

from typing import Any

from service_knowledge import index
from service_knowledge.index import query as query_mod
from service_knowledge.mcp._template import describe
from service_knowledge.mcp._root import NoRegistry, resolve_registry_root

TOOL_NAME = "knowledge_search"
DESCRIPTION = describe(
    purpose="Search this repo's operational service knowledge (architecture, failure modes, runbooks, probes). Call it before grep when the symptom-to-service mapping is unclear. Read-only; returns evidence, never conclusions.",
    parameters="query (string, required): symptom, alert, metric or concept. service_id (string): restrict or boost one service. paths (string[]): file paths for territory routing. limit (integer 1-7, default 7): maximum items. consumer_root (string, optional): repo root to read; must be the session root or one of its ancestors, default: the session root.",
    returns="An evidence bundle: routing, items (id, service_id, title, section_path, text, score, signals, status, risk, section_sync_ref, section_date, superseded_candidate), citations, verification, probes, skill_links, truncated and totals, consumer_root_resolution. Output is capped near 8000 tokens: truncated=true means items, citations, probes or an item text were cut, and totals holds the full counts.",
    empty_or_stale="items=[] means nothing in this checkout's index matched; it is not proof the knowledge base has no answer, so read consumer_root_resolution first: stale=true means a newer primary checkout exists (retry with the consumer_root in its hint). superseded_candidate=true means a newer sync section of the same service exists; prefer that section. stale_served=true means the index could not be refreshed within its time budget and an older cache was served; routing.freshness_notice says so.",
    example='{"query": "bar backfill swap", "service_id": "ingest", "limit": 5}',
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
    try:
        root = resolve_registry_root(consumer_root)
    except (NoRegistry, ValueError) as exc:
        # Refuse before the freshness gate runs: it would create .xtrm/cache and .xtrm/state in
        # a repository that never adopted service-knowledge, and answer "nothing found" as a
        # success that an agent reads as "the knowledge base says no".
        return {"error": str(exc)}
    ctx = query_mod.QueryContext(query=query, paths=tuple(paths or ()), service_id=service_id, limit=limit)
    result = query_mod.search(root, ctx)
    return index.build_bundle(result, root)
