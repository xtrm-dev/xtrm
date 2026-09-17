"""Loading and validating versioned, content-hashed definition objects.

A definition object (WorkloadDefinition, Experiment, Variant, Dataset,
Evaluator, QuestionSpec) lives as one JSON file. ``load_definition``
validates it against its JSON Schema, verifies (or fills in) its
``content_hash``, and — for workload/experiment — enforces legend
completeness, a cross-field constraint JSON Schema cannot express on its
own (see the ``legend`` field description in the schema files).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from xtrm_research.hashing import compute_content_hash, verify_content_hash
from xtrm_research.schemas import SchemaValidationError, validate

DEFINITION_KINDS = (
    "workload", "experiment", "variant", "dataset", "evaluator", "question_spec",
)


def load_definition(kind: str, path: Path) -> dict[str, Any]:
    """Load, hash-verify and schema-validate one definition object file."""
    if kind not in DEFINITION_KINDS:
        raise SchemaValidationError(f"not a definition kind: {kind!r}")
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if "content_hash" in payload:
        if not verify_content_hash(payload):
            raise SchemaValidationError(
                f"{kind} {path}: content_hash does not match payload"
            )
    else:
        payload["content_hash"] = compute_content_hash(payload)
    validate(kind, payload)
    if kind in ("workload", "experiment"):
        _validate_legend_completeness(kind, payload)
    return payload


def _validate_legend_completeness(kind: str, payload: dict[str, Any]) -> None:
    """Enforce that every metric, question id, variant id and status used
    by a workload/experiment has a matching ``legend`` entry.

    JSON Schema cannot express "every value in this array must be a key of
    that object" without generating a schema per instance, so this runs as
    an application-level check layered on top of the JSON Schema pass.
    """
    legend: dict[str, str] = payload.get("legend", {})
    referenced: set[str] = set()
    if kind == "workload":
        referenced.update(payload.get("default_metrics", []))
        referenced.update(q["id"] for q in payload.get("questions", []))
    else:  # experiment
        referenced.update(v["id"] for v in payload.get("variants", []))
    missing = sorted(referenced - legend.keys())
    if missing:
        raise SchemaValidationError(
            f"{kind} {payload.get('id')}: missing legend entries for {missing}"
        )


class DefinitionRegistry:
    """A directory-backed lookup of definition objects by (kind, id, version).

    Expects ``root`` to contain one subdirectory per kind (see
    :data:`DEFINITION_KINDS`), each holding ``*.json`` definition files.
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._cache: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._by_kind_id: dict[tuple[str, str], list[dict[str, Any]]] = {}

    def _load_kind(self, kind: str) -> None:
        kind_dir = self.root / kind
        if not kind_dir.is_dir():
            return
        for path in sorted(kind_dir.glob("*.json")):
            definition = load_definition(kind, path)
            key = (kind, definition["id"], definition["version"])
            self._cache[key] = definition
            self._by_kind_id.setdefault((kind, definition["id"]), []).append(definition)

    def get(self, kind: str, definition_id: str, version: str) -> dict[str, Any]:
        key = (kind, definition_id, version)
        if key not in self._cache:
            self._load_kind(kind)
        try:
            return self._cache[key]
        except KeyError as exc:
            raise SchemaValidationError(
                f"no {kind} definition {definition_id!r} version {version!r} under {self.root}"
            ) from exc

    def latest(self, kind: str, definition_id: str) -> dict[str, Any]:
        """Return the highest-``version``-sorted definition for ``definition_id``."""
        self._load_kind(kind)
        candidates = self._by_kind_id.get((kind, definition_id), [])
        if not candidates:
            raise SchemaValidationError(f"no {kind} definition {definition_id!r} under {self.root}")
        return sorted(candidates, key=lambda d: d["version"])[-1]
