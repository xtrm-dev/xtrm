"""Every schema validates its own valid fixture and rejects a broken one."""

from __future__ import annotations

import copy

import pytest

from xtrm_research.definitions import load_definition
from xtrm_research.hashing import compute_content_hash
from xtrm_research.schemas import SchemaValidationError, validate

from .conftest import REGISTRY_ROOT


def test_registry_fixtures_load_and_hash(registry):
    workload = registry.latest("workload", "dup-detect")
    experiment = registry.latest("experiment", "dup-detect-baseline")
    assert workload["content_hash"].startswith("sha256:")
    assert experiment["content_hash"].startswith("sha256:")


@pytest.mark.parametrize(
    "kind,filename",
    [
        ("workload", "dup-detect-v1.json"),
        ("experiment", "dup-detect-baseline-v1.json"),
        ("variant", "baseline-v1.json"),
        ("dataset", "synthetic-pairs-v1.json"),
        ("evaluator", "exact-match-v1.json"),
        ("question_spec", "dup-check-v1.json"),
    ],
)
def test_valid_definition_fixtures(kind, filename):
    load_definition(kind, REGISTRY_ROOT / kind / filename)


def test_workload_missing_legend_entry_rejected(raw_definition):
    workload = raw_definition("workload", "dup-detect-v1.json")
    del workload["legend"]["accuracy"]
    workload["content_hash"] = compute_content_hash(workload)
    with pytest.raises(SchemaValidationError, match="legend"):
        validate_and_check_legend(workload)


def test_experiment_missing_legend_entry_rejected(raw_definition):
    experiment = raw_definition("experiment", "dup-detect-baseline-v1.json")
    del experiment["legend"]["baseline"]
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError, match="legend"):
        validate_and_check_legend(experiment, kind="experiment")


def test_experiment_chart_spec_url_dataset_rejected(raw_definition):
    experiment = raw_definition("experiment", "dup-detect-baseline-v1.json")
    experiment["chart_specs"][0]["datasets"] = ["https://example.com/data.csv"]
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError):
        validate("experiment", experiment)


@pytest.mark.parametrize(
    "kind,mutate",
    [
        ("workload", lambda d: d.pop("required_capabilities")),
        ("variant", lambda d: d.pop("config")),
        ("dataset", lambda d: d.pop("source")),
        ("evaluator", lambda d: d.__setitem__("kind", "not-a-kind")),
        ("question_spec", lambda d: d.pop("instructions")),
    ],
)
def test_broken_fixture_rejected(raw_definition, kind, mutate):
    filename = {
        "workload": "dup-detect-v1.json",
        "variant": "baseline-v1.json",
        "dataset": "synthetic-pairs-v1.json",
        "evaluator": "exact-match-v1.json",
        "question_spec": "dup-check-v1.json",
    }[kind]
    payload = copy.deepcopy(raw_definition(kind, filename))
    mutate(payload)
    payload["content_hash"] = compute_content_hash(payload)
    with pytest.raises(SchemaValidationError):
        validate(kind, payload)


def test_question_spec_choice_requires_options():
    payload = {
        "id": "q",
        "version": "v1",
        "type": "choice",
        "instructions": "pick one",
        "criteria": {},
    }
    payload["content_hash"] = compute_content_hash(payload)
    with pytest.raises(SchemaValidationError):
        validate("question_spec", payload)


def validate_and_check_legend(payload, kind="workload"):
    # Reuses the private legend-completeness check exercised by load_definition.
    from xtrm_research.definitions import _validate_legend_completeness

    validate(kind, payload)
    _validate_legend_completeness(kind, payload)


def test_manifest_valid_fixture_passes(registry):
    from .helpers import make_manifest

    manifest = make_manifest(registry)
    validate("manifest", manifest)


def test_manifest_missing_run_id_rejected(registry):
    from .helpers import make_manifest

    manifest = make_manifest(registry)
    del manifest["run_id"]
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_bad_trigger_rejected(registry):
    from .helpers import make_manifest

    manifest = make_manifest(registry)
    manifest["intent"]["trigger"] = "not-a-trigger"
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_sample_valid_and_invalid():
    valid = {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": "s-1",
        "index": 0,
        "input": {"a": 1},
        "status": "ok",
        "created_at": "2026-09-17T12:00:00+00:00",
    }
    validate("sample", valid)
    invalid = dict(valid)
    invalid["status"] = "not-a-status"
    with pytest.raises(SchemaValidationError):
        validate("sample", invalid)


def test_event_valid_and_invalid():
    valid = {
        "schema_version": "xtrm-research-event/v1",
        "seq": 0,
        "ts": "2026-09-17T12:00:00+00:00",
        "kind": "sample_started",
    }
    validate("event", valid)
    invalid = dict(valid)
    del invalid["seq"]
    with pytest.raises(SchemaValidationError):
        validate("event", invalid)


def test_assessment_set_valid_and_invalid():
    valid = {
        "schema_version": "xtrm-research-assessment-set/v1",
        "assessment_set_id": "as-1",
        "evaluator": {
            "id": "exact-match",
            "version": "v1",
            "content_hash": "sha256:" + "0" * 64,
        },
        "input_run_id": "run-0001",
        "timestamp": "2026-09-17T12:00:00+00:00",
        "assessments": [{"sample_id": "s-1", "answer": {"match": True}}],
        "metrics": {"accuracy": {"value": 1.0, "n": 1, "method": "exact_match"}},
    }
    validate("assessment_set", valid)
    invalid = dict(valid)
    invalid["metrics"] = {"accuracy": {"value": 1.0}}  # missing n, method
    with pytest.raises(SchemaValidationError):
        validate("assessment_set", invalid)


def test_annotation_valid_and_invalid():
    valid = {
        "schema_version": "xtrm-research-annotation/v1",
        "author": "me",
        "timestamp": "2026-09-17T12:00:00+00:00",
        "kind": "conclusion",
        "text": "it works",
    }
    validate("annotation", valid)
    invalid = {**valid, "kind": "evidence_status"}  # missing evidence_status field
    with pytest.raises(SchemaValidationError):
        validate("annotation", invalid)


def test_refs_valid_and_invalid():
    valid = {
        "schema_version": "xtrm-research-refs/v1",
        "run_id": "run-0001",
        "experiment_id": "dup-detect-baseline",
        "variant_id": "baseline",
        "lineage": [],
    }
    validate("refs", valid)
    invalid = dict(valid)
    del invalid["run_id"]
    with pytest.raises(SchemaValidationError):
        validate("refs", invalid)


def test_cli_envelope_valid_and_invalid():
    valid = {
        "schema": "xtrm-research-cli/v1",
        "command": "runs",
        "ok": True,
        "data": [],
        "error": None,
    }
    validate("cli_envelope", valid)
    invalid = dict(valid)
    invalid["schema"] = "wrong/v1"
    with pytest.raises(SchemaValidationError):
        validate("cli_envelope", invalid)
