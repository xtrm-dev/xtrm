"""Per-repo FTS5 evidence index (research §3; shipped in v0.3.0).

Public surface:

* :func:`build` — full rebuild of the derived index (registry + SKILL sections + claims + probes).
* :func:`search` / :func:`get_item` / :func:`get_full_skill` — read-only retrieval.
* :func:`evidence_for_files` — bundle for a list of paths (dispatch / incident routing).
* :func:`build_bundle` — assemble a §3.2 evidence bundle from a search result.

The SQLite/FTS5/BM25 substrate is vaultctl (reused); this package adds the ``sk_`` domain
extension, the interpretable T/I/A/F ranking overlay and the evidence-bundle assembly.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from service_knowledge.index import (
    _compat,  # noqa: F401  (must initialize script imports first)
    schema,
)
from service_knowledge.index import bundle as _bundle
from service_knowledge.index import query as _query
from service_knowledge.index.builder import BuildStats, build
from service_knowledge.index.query import QueryContext, RankedItem

__all__ = [
    "BuildStats",
    "QueryContext",
    "RankedItem",
    "build",
    "build_bundle",
    "connect",
    "evidence_for_files",
    "get_full_skill",
    "get_item",
    "search",
]


def connect(consumer_root: Path):
    return schema.connect(consumer_root)


def search(consumer_root: Path, query: str, *, service_id: str | None = None,
           paths: list[str] | None = None, limit: int = 7, include_inactive: bool = False) -> dict[str, Any]:
    ctx = QueryContext(query=query, paths=tuple(paths or ()), service_id=service_id,
                       include_inactive=include_inactive, limit=limit)
    return _query.search(consumer_root, ctx)


def get_item(consumer_root: Path, item_id: str) -> dict[str, Any] | None:
    return _query.get_item(consumer_root, item_id)


def get_full_skill(consumer_root: Path, skill_rel_path: str) -> dict[str, Any] | None:
    return _query.get_full_skill(consumer_root, skill_rel_path)


def evidence_for_files(consumer_root: Path, paths: list[str], *, limit: int = 7) -> dict[str, Any]:
    """Build a §3.2 evidence bundle for a list of file paths (routing by territory ownership)."""
    ctx = QueryContext(query=" ".join(paths), paths=tuple(paths), limit=limit)
    result = _query.search(consumer_root, ctx)
    return _bundle.build_bundle(result, consumer_root)


def build_bundle(search_result: dict[str, Any], consumer_root: Path) -> dict[str, Any]:
    return _bundle.build_bundle(search_result, consumer_root)
