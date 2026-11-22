"""One template for every MCP tool description.

Agents choose and call a tool from its description alone, so each one states the same five
things in the same order: what it is for, its parameters (defaults and limits), the shape it
returns, what an empty or stale answer means, and one example call. ``SECTIONS`` is pinned by a
test so a new tool cannot ship a shorter description.
"""
from __future__ import annotations

SECTIONS = ("PURPOSE", "PARAMETERS", "RETURNS", "EMPTY OR STALE", "EXAMPLE")


def describe(*, purpose: str, parameters: str, returns: str, empty_or_stale: str, example: str) -> str:
    parts = (purpose, parameters, returns, empty_or_stale, example)
    return "\n".join(f"{name}: {text.strip()}" for name, text in zip(SECTIONS, parts))
