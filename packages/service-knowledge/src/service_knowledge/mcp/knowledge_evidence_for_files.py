"""knowledge_evidence_for_files — build an evidence bundle for a list of file paths.

Read-only. Routes by territory ownership: the paths determine which services' evidence is
assembled (dispatch / incident routing entry point, research §3.7). Returns a §3.2 bundle.
"""
from __future__ import annotations

from typing import Any

from service_knowledge import index
from service_knowledge.mcp._template import describe
from service_knowledge.mcp._root import NoRegistry, resolve_registry_root

TOOL_NAME = "knowledge_evidence_for_files"
DESCRIPTION = describe(
    purpose="Find the service knowledge that owns a set of files, before reading their source. Routes by service territory ownership. Read-only.",
    parameters="paths (string[], required): repo-relative file paths. limit (integer 1-7, default 7): maximum items. consumer_root (string, optional): repo root to read; must be the session root or one of its ancestors, default: the session root.",
    returns="An evidence bundle: routing, items (with section_sync_ref, section_date, superseded_candidate), citations, verification, probes, skill_links, truncated and totals, consumer_root_resolution. Items, citations, probes and item text are trimmed to fit about 8000 tokens (conflicts_and_caveats is never trimmed), so a service with many citations returns the first ones: truncated=true and totals give the full counts.",
    empty_or_stale="items=[] means no registered service territory covers these paths, or this checkout's index is older than the primary checkout: read consumer_root_resolution.stale before treating the files as unowned. superseded_candidate=true marks a section older than the newest sync section of that service.",
    example='{"paths": ["src/market_data/backfill/swap.py"], "limit": 3}',
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
    try:
        root = resolve_registry_root(consumer_root)
    except (NoRegistry, ValueError) as exc:
        # See knowledge_search.run: refuse before the gate writes .xtrm/ into a non-consumer repo.
        return {"error": str(exc)}
    return index.evidence_for_files(root, list(paths), limit=limit)
