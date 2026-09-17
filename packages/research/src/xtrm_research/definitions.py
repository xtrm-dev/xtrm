"""Loading and validating versioned, content-hashed definition objects.

A definition object (WorkloadDefinition, Experiment, Variant, Dataset,
Evaluator, QuestionSpec) lives as one JSON file and must carry its own
``content_hash``: the loader verifies it and raises on any mismatch, it
never computes and fills one in silently — a fixture with a stale hash is a
bug, not something to paper over.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from xtrm_research.hashing import verify_content_hash
from xtrm_research.schemas import SchemaValidationError, validate

DEFINITION_KINDS = (
    "workload",
    "experiment",
    "variant",
    "dataset",
    "evaluator",
    "question_spec",
)

_LEADING_VERSION = re.compile(r"^v?(\d+(?:\.\d+)*)")


def _version_sort_key(version: str) -> tuple[int, tuple[int, ...] | str]:
    """Numeric versions ('v1', 'v2', '9', '10') sort numerically; anything
    else falls back to sorting after all numeric versions, alphabetically."""
    match = _LEADING_VERSION.match(version)
    if match:
        return (0, tuple(int(part) for part in match.group(1).split(".")))
    return (1, version)


def load_definition(kind: str, path: Path) -> dict[str, Any]:
    """Load, hash-verify and schema-validate one definition object file."""
    if kind not in DEFINITION_KINDS:
        raise SchemaValidationError(f"not a definition kind: {kind!r}")
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if "content_hash" not in payload:
        raise SchemaValidationError(
            f"{kind} {path}: missing content_hash — fixtures must carry their own hash"
        )
    if not verify_content_hash(payload):
        raise SchemaValidationError(
            f"{kind} {path}: content_hash does not match payload"
        )
    validate(kind, payload)
    return payload


class DefinitionRegistry:
    """A directory-backed lookup of definition objects by (kind, id, version).

    Expects ``root`` to contain one subdirectory per kind (see
    :data:`DEFINITION_KINDS`), each holding ``*.json`` definition files.
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._cache: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._by_kind_id: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._loaded_kinds: set[str] = set()

    def _load_kind(self, kind: str) -> None:
        if kind in self._loaded_kinds:
            return
        self._loaded_kinds.add(kind)
        kind_dir = self.root / kind
        if not kind_dir.is_dir():
            return
        for path in sorted(kind_dir.glob("*.json")):
            definition = load_definition(kind, path)
            key = (kind, definition["id"], definition["version"])
            existing = self._cache.get(key)
            if (
                existing is not None
                and existing["content_hash"] != definition["content_hash"]
            ):
                raise SchemaValidationError(
                    f"duplicate {kind} {definition['id']} version {definition['version']} "
                    f"with different content_hash across files"
                )
            self._cache[key] = definition
            self._by_kind_id.setdefault((kind, definition["id"]), []).append(definition)

    def get(self, kind: str, definition_id: str, version: str) -> dict[str, Any]:
        self._load_kind(kind)
        key = (kind, definition_id, version)
        try:
            return self._cache[key]
        except KeyError as exc:
            raise SchemaValidationError(
                f"no {kind} definition {definition_id!r} version {version!r} under {self.root}"
            ) from exc

    def latest(self, kind: str, definition_id: str) -> dict[str, Any]:
        """Return the numerically-highest-version definition for ``definition_id``."""
        self._load_kind(kind)
        candidates = self._by_kind_id.get((kind, definition_id), [])
        if not candidates:
            raise SchemaValidationError(
                f"no {kind} definition {definition_id!r} under {self.root}"
            )
        return sorted(candidates, key=lambda d: _version_sort_key(d["version"]))[-1]
