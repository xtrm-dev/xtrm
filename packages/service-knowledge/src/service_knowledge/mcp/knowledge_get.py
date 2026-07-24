"""knowledge_get — fetch one item by id, or a full skill by path.

Read-only. ``item_id`` returns the full item (+ citations + skill link); ``skill_path`` returns
the whole SKILL.md via vaultctl's document layer. Exactly one of the two must be supplied.
"""
from __future__ import annotations

from typing import Any

from service_knowledge import index
from service_knowledge.mcp._root import resolve_consumer_root

TOOL_NAME = "knowledge_get"
DESCRIPTION = (
    "Fetch a single knowledge item by id (full text + citations + link to its skill) OR a full "
    "SKILL.md by path. Read-only. Pass exactly one of item_id / skill_path."
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
        root = resolve_consumer_root(consumer_root)
    except ValueError as exc:
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
