"""Read-only MCP tools for the service-knowledge index (research §3.8).

Five tools ship (three stable since v0.3.0; ``knowledge_status`` and ``knowledge_drift`` added in
v0.9.0, CORE-2714). ``knowledge_probes`` and ``knowledge_conflicts`` remain deferred to follow-up
beads (advisory extras, low value at MVP) and are documented as such in the API surface. There is
deliberately no ``answer()`` endpoint — the layer returns evidence only.

``TOOL_MODULES`` is the single source of truth for tool definitions. Both hosts consume
:func:`tool_specs`: the stdio MCP server (``service-knowledge mcp serve``) and the pi extension,
whose committed ``tool-definitions.json`` a parity test pins against this projection.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from service_knowledge.mcp._root import describe_resolution
from service_knowledge.mcp import (
    knowledge_drift,
    knowledge_evidence_for_files,
    knowledge_get,
    knowledge_search,
    knowledge_status,
)

# name -> module (each exposes TOOL_NAME, DESCRIPTION, PARAMETERS, run)
TOOL_MODULES = (
    knowledge_search,
    knowledge_get,
    knowledge_evidence_for_files,
    knowledge_status,
    knowledge_drift,
)

DEFERRED_TOOLS = ("knowledge_probes", "knowledge_conflicts")


def _with_resolution(run: Callable[..., Any]) -> Callable[..., Any]:
    """Attach ``consumer_root_resolution`` to every dict result: which checkout was read, and
    whether it is behind the primary checkout. A failure to describe never fails the tool."""

    def wrapped(**kwargs: Any) -> Any:
        result = run(**kwargs)
        if not isinstance(result, dict):
            return result
        try:
            resolution = describe_resolution(kwargs.get("consumer_root"))
        except Exception as exc:  # report-only: never turn a good answer into a failure
            if "error" not in result:
                # Say that the report is missing instead of silently dropping the field.
                result["consumer_root_resolution"] = {"unavailable": f"{type(exc).__name__}: {exc}"}
            return result
        if "error" in result:
            # An {"error": ...} payload stays the only key (the protocol layer turns it into
            # isError), so the staleness rides inside the message: "item not found" from a stale
            # worktree is exactly the case the hint exists for.
            if resolution.get("stale") and resolution.get("hint"):
                result["error"] = f"{result['error']} [{resolution['hint']}]"
        else:
            result["consumer_root_resolution"] = resolution
        return result

    wrapped.__name__ = getattr(run, "__name__", "run")
    return wrapped


def tool_registry() -> dict[str, Callable[..., Any]]:
    return {module.TOOL_NAME: _with_resolution(module.run) for module in TOOL_MODULES}


def tool_specs() -> list[dict[str, Any]]:
    return [
        {"name": module.TOOL_NAME, "description": module.DESCRIPTION, "parameters": module.PARAMETERS}
        for module in TOOL_MODULES
    ]


__all__ = ["DEFERRED_TOOLS", "TOOL_MODULES", "tool_registry", "tool_specs"]
