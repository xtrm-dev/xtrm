"""JSON Schema loading and validation for every xtrm-research data contract.

Each schema file here is the source of truth. Python code must not diverge
from it: validation always goes through :func:`validate`, never through a
parallel hand-written check.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema

_SCHEMA_DIR = Path(__file__).parent

#: Maps a short kind name to its schema filename, for both definition
#: objects and run-directory record types.
SCHEMA_FILES = {
    "workload": "workload.schema.json",
    "experiment": "experiment.schema.json",
    "variant": "variant.schema.json",
    "dataset": "dataset.schema.json",
    "evaluator": "evaluator.schema.json",
    "question_spec": "question_spec.schema.json",
    "manifest": "manifest.schema.json",
    "sample": "sample.schema.json",
    "event": "event.schema.json",
    "assessment_set": "assessment_set.schema.json",
    "annotation": "annotation.schema.json",
    "refs": "refs.schema.json",
    "cli_envelope": "cli_envelope.schema.json",
}


class SchemaValidationError(ValueError):
    """Raised when a payload fails validation against a named schema."""


@lru_cache(maxsize=None)
def load_schema(kind: str) -> dict[str, Any]:
    try:
        filename = SCHEMA_FILES[kind]
    except KeyError as exc:
        raise SchemaValidationError(f"unknown schema kind: {kind!r}") from exc
    return json.loads((_SCHEMA_DIR / filename).read_text(encoding="utf-8"))


def validate(kind: str, payload: dict[str, Any]) -> None:
    """Validate ``payload`` against the named schema.

    Raises :class:`SchemaValidationError` with the underlying jsonschema
    message on failure.
    """
    schema = load_schema(kind)
    try:
        jsonschema.validate(instance=payload, schema=schema)
    except jsonschema.ValidationError as exc:
        raise SchemaValidationError(f"{kind}: {exc.message}") from exc
