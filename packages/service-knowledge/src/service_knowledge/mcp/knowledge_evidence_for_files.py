"""knowledge_evidence_for_files — build an evidence bundle for a list of file paths.

Read-only. Routes by territory ownership: the paths determine which services' evidence is
assembled (dispatch / incident routing entry point, research §3.7). Returns a §3.2 bundle.
"""
from __future__ import annotations

from typing import Any

from service_knowledge import index
from service_knowledge.mcp._root import resolve_consumer_root

TOOL_NAME = "knowledge_evidence_for_files"
DESCRIPTION = (
    "Produce a §3.2 evidence bundle for a list of file paths. Routes by service territory "
    "ownership and returns routing header, top items, citations, verification + freshness, "
    "applicable read-only probes and full-skill links. Read-only."
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "paths": {"type": "array", "items": {"type": "string"}, "description": "File paths to build evidence for."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 7, "default": 7},
        "consumer_root": {"type": "string"},
    },
    "required": ["paths"],
}


def run(paths: list[str], limit: int = 7, consumer_root: str | None = None, **_: Any) -> dict[str, Any]:
    root = resolve_consumer_root(consumer_root)
    return index.evidence_for_files(root, list(paths), limit=limit)
