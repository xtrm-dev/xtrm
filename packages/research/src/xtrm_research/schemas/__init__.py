"""JSON Schema loading and validation for every xtrm-research data contract.

Each schema file here is the source of truth. Python code must not diverge
from it: validation always goes through :func:`validate`, never through a
parallel hand-written check. A handful of contract rules JSON Schema cannot
express on its own (legend completeness, chart-spec dataset/URL rules —
"for every value in this array, that object must have a matching key")
are layered on top of the JSON Schema pass inside :func:`validate` itself,
so every caller of the public API gets them, not just a designated loader.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema
import jsonschema.exceptions
import jsonschema.validators
from referencing import Registry, Resource

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
    "status": "status.schema.json",
    "sample": "sample.schema.json",
    "event": "event.schema.json",
    "assessment_set": "assessment_set.schema.json",
    "annotation": "annotation.schema.json",
    "refs": "refs.schema.json",
    "cli_envelope": "cli_envelope.schema.json",
}


class SchemaValidationError(ValueError):
    """Raised when a payload fails validation against a named schema, or
    breaks a cross-field contract rule JSON Schema alone cannot express."""


@lru_cache(maxsize=None)
def load_schema(kind: str) -> dict[str, Any]:
    try:
        filename = SCHEMA_FILES[kind]
    except KeyError as exc:
        raise SchemaValidationError(f"unknown schema kind: {kind!r}") from exc
    return json.loads((_SCHEMA_DIR / filename).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _registry() -> Registry:
    """A local $ref registry: every *.schema.json file, keyed by its own
    filename $id, so a same-directory relative $ref (e.g.
    'common.schema.json#/$defs/usage_record') resolves without network
    access or a bundled/pre-resolved copy."""
    resources = []
    for path in sorted(_SCHEMA_DIR.glob("*.schema.json")):
        contents = json.loads(path.read_text(encoding="utf-8"))
        resources.append((contents["$id"], Resource.from_contents(contents)))
    return Registry().with_resources(resources)


def _check_date_time(value: Any) -> bool:
    """Reject naive datetimes: every timestamp in this contract must be
    timezone-aware, per the run-immutability and heartbeat-staleness rules."""
    if not isinstance(value, str):
        return True
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError(f"date-time {value!r} is naive; timestamps must be timezone-aware")
    return True


@lru_cache(maxsize=1)
def _format_checker() -> jsonschema.FormatChecker:
    checker = jsonschema.FormatChecker()
    checker.checks("date-time", raises=ValueError)(_check_date_time)
    return checker


def validate(kind: str, payload: dict[str, Any]) -> None:
    """Validate ``payload`` against the named schema, plus any business
    rule for ``kind`` that JSON Schema cannot express on its own.

    Raises :class:`SchemaValidationError` on either kind of failure.
    """
    schema = load_schema(kind)
    validator_cls = jsonschema.validators.validator_for(schema)
    validator = validator_cls(schema, registry=_registry(), format_checker=_format_checker())
    try:
        validator.validate(payload)
    except jsonschema.exceptions.ValidationError as exc:
        raise SchemaValidationError(f"{kind}: {exc.message}") from exc
    if kind == "workload":
        _check_workload_rules(payload)
    elif kind == "experiment":
        _check_experiment_rules(payload)


def _check_workload_rules(payload: dict[str, Any]) -> None:
    legend: dict[str, str] = payload.get("legend", {})
    referenced: set[str] = set(payload.get("default_metrics", []))
    referenced.update(q["id"] for q in payload.get("questions", []))
    missing = sorted(referenced - legend.keys())
    if missing:
        raise SchemaValidationError(
            f"workload {payload.get('id')}: missing legend entries for {missing}"
        )


_URL_LIKE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://|^//|^data:")


def _scan_for_urls(node: Any, path: str) -> None:
    if isinstance(node, str):
        if _URL_LIKE.match(node):
            raise SchemaValidationError(f"experiment: url-bearing value at {path}: {node!r}")
    elif isinstance(node, dict):
        for key, value in node.items():
            _scan_for_urls(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            _scan_for_urls(value, f"{path}[{i}]")


def _check_experiment_rules(payload: dict[str, Any]) -> None:
    legend: dict[str, str] = payload.get("legend", {})
    named_datasets: set[str] = set(payload.get("named_datasets", []))
    referenced: set[str] = {v["id"] for v in payload.get("variants", [])} | named_datasets
    missing = sorted(referenced - legend.keys())
    if missing:
        raise SchemaValidationError(
            f"experiment {payload.get('id')}: missing legend entries for {missing}"
        )
    for spec in payload.get("chart_specs", []):
        _scan_for_urls(spec, path=f"chart_specs[{spec.get('id')}]")
        undeclared = sorted(set(spec.get("datasets", [])) - named_datasets)
        if undeclared:
            raise SchemaValidationError(
                f"experiment {payload.get('id')}: chart_spec {spec.get('id')} "
                f"references datasets not in named_datasets: {undeclared}"
            )
