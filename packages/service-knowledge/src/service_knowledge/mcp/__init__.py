"""Read-only MCP tools for the service-knowledge index (research §3.8).

Three tools ship in PR3; ``knowledge_probes`` and ``knowledge_conflicts`` are deferred to
follow-up beads (advisory extras, low value at MVP) and are documented as such in the API
surface. There is deliberately no ``answer()`` endpoint — the layer returns evidence only.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from service_knowledge.mcp import (
    incident_routing,
    knowledge_evidence_for_files,
    knowledge_get,
    knowledge_search,
)

# name -> module (each exposes TOOL_NAME, DESCRIPTION, PARAMETERS, run)
TOOL_MODULES = (knowledge_search, knowledge_get, knowledge_evidence_for_files, incident_routing)

DEFERRED_TOOLS = ("knowledge_probes", "knowledge_conflicts")


def tool_registry() -> dict[str, Callable[..., Any]]:
    return {module.TOOL_NAME: module.run for module in TOOL_MODULES}


def tool_specs() -> list[dict[str, Any]]:
    return [
        {"name": module.TOOL_NAME, "description": module.DESCRIPTION, "parameters": module.PARAMETERS}
        for module in TOOL_MODULES
    ]


__all__ = ["DEFERRED_TOOLS", "TOOL_MODULES", "tool_registry", "tool_specs"]
