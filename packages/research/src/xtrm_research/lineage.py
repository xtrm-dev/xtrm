"""Run lineage: building the relation tree from every run's manifest.lineage."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from xtrm_research.store import list_run_ids, load_manifest, run_exists


def lineage_tree(root: Path, run_id: str) -> dict[str, Any]:
    """Return ``{run_id, children: [{relation, run_id, children: [...]}]}``.

    A run's manifest records its own outgoing lineage relations (e.g. this
    run is ``retry_of`` its parent); the tree for a run is built by finding
    every other run whose lineage points back at it. Raises if ``run_id``
    itself doesn't exist.
    """
    if not run_exists(root, run_id):
        raise ValueError(f"no such run: {run_id!r}")

    manifests = {rid: load_manifest(root, rid) for rid in list_run_ids(root)}
    children_of: dict[str, list[dict[str, str]]] = {}
    for rid, manifest in manifests.items():
        for relation in manifest.get("lineage", []):
            children_of.setdefault(relation["run_id"], []).append(
                {"relation": relation["relation"], "run_id": rid}
            )

    def build(node_id: str, seen: frozenset[str]) -> dict[str, Any]:
        node: dict[str, Any] = {"run_id": node_id, "children": []}
        for child in children_of.get(node_id, []):
            if child["run_id"] in seen:
                continue  # guard against a malformed cycle
            node["children"].append(
                {
                    "relation": child["relation"],
                    **build(child["run_id"], seen | {child["run_id"]}),
                }
            )
        return node

    return build(run_id, frozenset({run_id}))


def format_tree(tree: dict[str, Any], indent: int = 0) -> str:
    """Human-readable indented rendering of :func:`lineage_tree`'s output."""
    prefix = "  " * indent
    relation = f"[{tree['relation']}] " if "relation" in tree else ""
    lines = [f"{prefix}{relation}{tree['run_id']}"]
    for child in tree["children"]:
        lines.append(format_tree(child, indent + 1))
    return "\n".join(lines)
