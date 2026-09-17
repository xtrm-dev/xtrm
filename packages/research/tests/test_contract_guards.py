"""Contract-wide guards: every schema file has a valid and an invalid
fixture, and withdrawn vocabulary never re-enters the package."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import jsonschema
import pytest

from xtrm_research.hashing import compute_content_hash
from xtrm_research.schemas import SchemaValidationError, _registry, validate

from .conftest import REGISTRY_ROOT
from .helpers import make_manifest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = PACKAGE_ROOT / "src" / "xtrm_research" / "schemas"
TS = "2026-09-17T12:00:00+00:00"
HASH = "sha256:" + "0" * 64

_DEFINITION_FILES = {
    "workload": "dup-detect-v1.json",
    "experiment": "dup-detect-baseline-v1.json",
    "variant": "baseline-v1.json",
    "dataset": "synthetic-pairs-v1.json",
    "evaluator": "exact-match-v1.json",
    "question_spec": "dup-check-v1.json",
}


def _definition(kind):
    return json.loads(
        (REGISTRY_ROOT / kind / _DEFINITION_FILES[kind]).read_text(encoding="utf-8")
    )


def _without(payload, key):
    broken = copy.deepcopy(payload)
    del broken[key]
    if "content_hash" in broken:
        broken["content_hash"] = compute_content_hash(broken)
    return broken


def _record_fixtures(registry):
    """kind -> (valid, invalid) for every schema registered in SCHEMA_FILES."""
    fixtures = {
        kind: (_definition(kind), _without(_definition(kind), "id"))
        for kind in _DEFINITION_FILES
    }
    manifest = make_manifest(registry)
    status = {
        "schema_version": "xtrm-research-status/v1",
        "run_id": "run-0001",
        "state": "started",
        "last_heartbeat": TS,
        "manifest_content_hash": HASH,
    }
    sample = {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": "s-1",
        "index": 0,
        "input": {},
        "status": "ok",
        "created_at": TS,
    }
    event = {
        "schema_version": "xtrm-research-event/v1",
        "seq": 0,
        "ts": TS,
        "kind": "x",
    }
    assessment_set = {
        "schema_version": "xtrm-research-assessment-set/v1",
        "assessment_set_id": "as-1",
        "evaluator": {"id": "exact-match", "version": "v1", "content_hash": HASH},
        "input_run_id": "run-0001",
        "timestamp": TS,
        "assessments": [{"sample_id": "s-1", "answer": {"noul": 1.0}}],
        "metrics": {
            "accuracy": {"value": 1.0, "se": None, "ci95": None, "n": 1, "method": "m"}
        },
    }
    annotation = {
        "schema_version": "xtrm-research-annotation/v1",
        "author": "me",
        "timestamp": TS,
        "kind": "conclusion",
        "text": "t",
    }
    refs = {
        "schema_version": "xtrm-research-refs/v1",
        "run_id": "run-0001",
        "experiment_id": "e",
        "variant_id": "v",
        "lineage": [],
    }
    envelope = {
        "schema": "xtrm-research-cli/v1",
        "command": "runs",
        "ok": True,
        "data": [],
        "error": None,
    }
    for kind, valid, missing in [
        ("manifest", manifest, "intent"),
        ("status", status, "state"),
        ("sample", sample, "sample_id"),
        ("event", event, "seq"),
        ("assessment_set", assessment_set, "metrics"),
        ("annotation", annotation, "author"),
        ("refs", refs, "run_id"),
        ("cli_envelope", envelope, "ok"),
    ]:
        fixtures[kind] = (valid, _without(valid, missing))
    return fixtures


def _validate_common(payload):
    """common.schema.json holds only $defs; validate through a $ref to one."""
    schema = {"$ref": "common.schema.json#/$defs/usage_record"}
    try:
        jsonschema.Draft202012Validator(schema, registry=_registry()).validate(payload)
    except jsonschema.ValidationError as exc:
        raise SchemaValidationError(exc.message) from exc


@pytest.mark.parametrize(
    "schema_file", sorted(p.name for p in SCHEMA_DIR.glob("*.schema.json"))
)
def test_every_schema_file_has_valid_and_invalid_fixture(registry, schema_file):
    kind = schema_file.removesuffix(".schema.json")
    if kind == "common":
        _validate_common({"source": "unknown", "gen_ai.usage.input_tokens": 3})
        with pytest.raises(SchemaValidationError):
            _validate_common({"source": "not-a-source"})
        return
    fixtures = _record_fixtures(registry)
    assert kind in fixtures, f"{schema_file} has no fixture pair in this sweep"
    valid, invalid = fixtures[kind]
    validate(kind, valid)
    with pytest.raises(SchemaValidationError):
        validate(kind, invalid)


def test_withdrawn_vocabulary_absent_from_package():
    banned = re.compile(r"rlcd|decisionmodel", re.IGNORECASE)
    targets = [
        *(PACKAGE_ROOT / "src" / "xtrm_research").rglob("*"),
        PACKAGE_ROOT / "README.md",
        PACKAGE_ROOT / "CHANGELOG.md",
    ]
    hits = [
        f"{path.relative_to(PACKAGE_ROOT)}:{lineno}"
        for path in targets
        if path.is_file() and "__pycache__" not in path.parts
        for lineno, line in enumerate(
            path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
        )
        if banned.search(line)
    ]
    assert hits == []
