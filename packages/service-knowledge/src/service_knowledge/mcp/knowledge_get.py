"""knowledge_get — fetch one item by id, or a full skill by path.

Read-only. ``item_id`` returns the full item (+ citations + skill link); ``skill_path`` returns
the whole SKILL.md via vaultctl's document layer. Exactly one of the two must be supplied.
"""
from __future__ import annotations

from typing import Any

from service_knowledge import index
from service_knowledge.mcp._template import describe
from service_knowledge.mcp._root import NoRegistry, resolve_registry_root

TOOL_NAME = "knowledge_get"
DESCRIPTION = describe(
    purpose="Fetch one knowledge item by id, or one full SKILL.md by path, when a search hit needs its full text. Read-only.",
    parameters="item_id (string): stable item id from a search hit, for example 'section:alertmanager:failure-modes'. skill_path (string): repo-relative SKILL.md path. Pass exactly one of the two. consumer_root (string, optional): repo root to read; must be the session root or one of its ancestors, default: the session root.",
    returns="{item: {...}} with full text, citations and a link to its skill, or {skill: {...}} with the whole SKILL.md, plus consumer_root_resolution. Errors come back as {error: message} alone; there is no consumer_root_resolution field on an error.",
    empty_or_stale="'item not found' or 'skill not found' means the id or path is not in this checkout's index: search again for a current id. When this checkout is a worktree behind the primary checkout, the error message ends with a bracketed hint naming the consumer_root to retry with.",
    example='{"item_id": "section:alertmanager:failure-modes"}',
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "item_id": {"type": "string", "description": "Stable item id, e.g. 'section:alertmanager:failure-modes'."},
        "skill_path": {"type": "string", "description": "Repo-relative SKILL.md path for the full skill."},
        "consumer_root": {"type": "string"},
    },
}


def run(item_id: str | None = None, skill_path: str | None = None,
        consumer_root: str | None = None, **_: Any) -> dict[str, Any]:
    try:
        root = resolve_registry_root(consumer_root)
    except (NoRegistry, ValueError) as exc:
        return {"error": str(exc)}
    if item_id:
        item = index.get_item(root, item_id)
        if item is None:
            return {"error": f"item not found: {item_id}"}
        return {"item": item}
    if skill_path:
        skill = index.get_full_skill(root, skill_path)
        if skill is None:
            return {"error": f"skill not found: {skill_path}"}
        return {"skill": skill}
    return {"error": "knowledge_get requires item_id or skill_path"}
