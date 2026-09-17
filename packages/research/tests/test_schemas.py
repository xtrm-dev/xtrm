"""Every schema validates its own valid fixture and rejects a broken one."""

from __future__ import annotations

import copy

import pytest

from xtrm_research.definitions import load_definition
from xtrm_research.hashing import compute_content_hash
from xtrm_research.schemas import SchemaValidationError, validate

from .conftest import REGISTRY_ROOT
from .helpers import make_manifest


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


def test_workload_missing_legend_entry_rejected_via_public_validate(raw_definition):
    workload = raw_definition("workload", "dup-detect-v1.json")
    del workload["legend"]["accuracy"]
    workload["content_hash"] = compute_content_hash(workload)
    with pytest.raises(SchemaValidationError, match="legend"):
        validate("workload", workload)


def test_experiment_missing_legend_entry_rejected_via_public_validate(raw_definition):
    experiment = raw_definition("experiment", "dup-detect-baseline-v1.json")
    del experiment["legend"]["baseline"]
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError, match="legend"):
        validate("experiment", experiment)


def test_workload_legend_covers_declared_statuses_and_label_values(raw_definition):
    workload = dict(raw_definition("workload", "dup-detect-v1.json"))
    workload["statuses"] = ["flagged"]
    workload["content_hash"] = compute_content_hash(workload)
    with pytest.raises(SchemaValidationError, match="legend"):
        validate("workload", workload)
    workload["legend"] = {**workload["legend"], "flagged": "marked for manual review"}
    workload["content_hash"] = compute_content_hash(workload)
    validate("workload", workload)  # now covered, must not raise


def test_experiment_legend_covers_declared_label_values(raw_definition):
    experiment = dict(raw_definition("experiment", "dup-detect-baseline-v1.json"))
    experiment["label_values"] = ["duplicate", "not-a-duplicate"]
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError, match="legend"):
        validate("experiment", experiment)


def test_experiment_schema_only_empty_legend_still_rejected(raw_definition):
    # load_definition AND the bare validate() path must both enforce this.
    experiment = raw_definition("experiment", "dup-detect-baseline-v1.json")
    experiment["legend"] = {}
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError):
        validate("experiment", experiment)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda e: e["chart_specs"][0].update(data={"url": "https://evil/x.csv"}),
        lambda e: e["chart_specs"][0].update(
            spec={"data": {"url": "https://evil/x.csv"}}
        ),
        lambda e: e["chart_specs"][0].__setitem__("datasets", ["//evil.com/x.csv"]),
        lambda e: e["chart_specs"][0].__setitem__("datasets", ["data:text/csv,a,b"]),
        lambda e: e["chart_specs"][0].__setitem__("datasets", ["https://x/y"]),
        lambda e: e["chart_specs"][0].__setitem__("datasets", ["file:/etc/passwd"]),
        lambda e: e["chart_specs"][0].__setitem__(
            "datasets", [" https://x/y"]
        ),  # leading-space evasion
        lambda e: e["chart_specs"][0].update(
            data={"url": "data/x.csv"}
        ),  # relative path, key alone is forbidden
        lambda e: e["chart_specs"][0].update(
            data={"values": [{"url": "x"}], "name": "accuracy", "src": "/etc/passwd"}
        ),
    ],
)
def test_experiment_chart_spec_url_anywhere_rejected(raw_definition, mutate):
    experiment = copy.deepcopy(
        raw_definition("experiment", "dup-detect-baseline-v1.json")
    )
    mutate(experiment)
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError):
        validate("experiment", experiment)


def test_experiment_chart_spec_title_and_description_may_mention_urls(raw_definition):
    experiment = copy.deepcopy(
        raw_definition("experiment", "dup-detect-baseline-v1.json")
    )
    experiment["chart_specs"][0]["title"] = "see https://docs.example.com"
    experiment["chart_specs"][0]["description"] = "docs at https://docs.example.com/x"
    experiment["content_hash"] = compute_content_hash(experiment)
    validate("experiment", experiment)  # must not raise: not a data-source position


def test_experiment_chart_spec_undeclared_dataset_rejected(raw_definition):
    experiment = copy.deepcopy(
        raw_definition("experiment", "dup-detect-baseline-v1.json")
    )
    experiment["chart_specs"][0]["datasets"] = ["not-a-named-dataset"]
    experiment["content_hash"] = compute_content_hash(experiment)
    with pytest.raises(SchemaValidationError, match="named_datasets"):
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
        "instructions": "pick",
        "criteria": {},
    }
    payload["content_hash"] = compute_content_hash(payload)
    with pytest.raises(SchemaValidationError):
        validate("question_spec", payload)


def test_question_spec_choice_requires_at_least_one_option():
    payload = {
        "id": "q",
        "version": "1",
        "type": "choice",
        "instructions": "pick",
        "criteria": {},
        "options": [],
    }
    payload["content_hash"] = compute_content_hash(payload)
    with pytest.raises(SchemaValidationError):
        validate("question_spec", payload)


def test_question_spec_score_requires_nonempty_legend():
    payload = {
        "id": "q",
        "version": "1",
        "type": "score",
        "instructions": "rate",
        "criteria": {},
        "legend": {},
    }
    payload["content_hash"] = compute_content_hash(payload)
    with pytest.raises(SchemaValidationError):
        validate("question_spec", payload)


def test_question_spec_noul_criteria_optional():
    payload = {"id": "q", "version": "1", "type": "noul", "instructions": "yes?"}
    payload["content_hash"] = compute_content_hash(payload)
    validate("question_spec", payload)  # must not raise


def test_manifest_valid_fixture_passes(registry):
    manifest = make_manifest(registry)
    validate("manifest", manifest)


def test_manifest_has_no_status_field(registry):
    # status/last_heartbeat moved to the separate, mutable status.json (R1).
    manifest = make_manifest(registry)
    assert "status" not in manifest


def test_manifest_missing_run_id_rejected(registry):
    manifest = make_manifest(registry)
    del manifest["run_id"]
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_bad_trigger_rejected(registry):
    manifest = make_manifest(registry)
    manifest["intent"]["trigger"] = "not-a-trigger"
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_naive_timestamp_rejected(registry):
    manifest = make_manifest(registry)
    manifest["created_at"] = "2026-09-17T12:00:00"  # no tz offset
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_garbage_timestamp_rejected(registry):
    manifest = make_manifest(registry)
    manifest["created_at"] = "not a date"
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_non_rfc3339_basic_format_rejected(registry):
    # datetime.fromisoformat accepts this since 3.11; strict RFC 3339 must not.
    manifest = make_manifest(registry)
    manifest["created_at"] = "20260917T120000+0000"
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_rejects_unknown_top_level_key(registry):
    manifest = make_manifest(registry)
    manifest["junk"] = 1
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_manifest_run_id_pattern_rejects_unsafe_ids(registry):
    manifest = make_manifest(registry)
    manifest["run_id"] = "../escape"
    with pytest.raises(SchemaValidationError):
        validate("manifest", manifest)


def test_status_valid_and_naive_heartbeat_rejected():
    valid = {
        "schema_version": "xtrm-research-status/v1",
        "run_id": "run-0001",
        "state": "started",
        "last_heartbeat": "2026-09-17T12:00:00+00:00",
        "manifest_content_hash": "sha256:" + "0" * 64,
    }
    validate("status", valid)
    naive = {**valid, "last_heartbeat": "2026-09-17T12:00:00"}
    with pytest.raises(SchemaValidationError):
        validate("status", naive)


def test_status_rejects_unknown_top_level_key():
    valid = {
        "schema_version": "xtrm-research-status/v1",
        "run_id": "run-0001",
        "state": "started",
        "last_heartbeat": "2026-09-17T12:00:00+00:00",
        "manifest_content_hash": "sha256:" + "0" * 64,
    }
    with pytest.raises(SchemaValidationError):
        validate("status", {**valid, "junk": 1})


@pytest.mark.parametrize("bad_id", ["../escape", "a b", ".hidden", "a\x00b"])
def test_definition_id_pattern_rejects_unsafe_ids(bad_id):
    from xtrm_research.hashing import compute_content_hash as _hash

    payload = {"id": bad_id, "version": "v1", "description": "d", "config": {}}
    payload["content_hash"] = _hash(payload)
    with pytest.raises(SchemaValidationError):
        validate("variant", payload)


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


def test_sample_usage_bad_source_rejected():
    payload = {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": "s-1",
        "index": 0,
        "input": {},
        "status": "ok",
        "created_at": "2026-09-17T12:00:00+00:00",
        "usage": {"source": "nope"},
    }
    with pytest.raises(SchemaValidationError):
        validate("sample", payload)


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


def _event(usage):
    return {
        "schema_version": "xtrm-research-event/v1",
        "seq": 0,
        "ts": "2026-09-17T12:00:00+00:00",
        "kind": "x",
        "usage": usage,
    }


def test_usage_null_value_requires_null_reason():
    with pytest.raises(SchemaValidationError):
        validate(
            "event",
            _event({"source": "provider_api", "gen_ai.usage.input_tokens": None}),
        )
    validate(
        "event",
        _event(
            {
                "source": "provider_api",
                "gen_ai.usage.input_tokens": None,
                "null_reason": "provider omitted usage on this response",
            }
        ),
    )


def test_usage_null_reason_must_be_a_nonempty_string():
    with pytest.raises(SchemaValidationError):
        validate(
            "event",
            _event(
                {
                    "source": "provider_api",
                    "gen_ai.usage.input_tokens": None,
                    "null_reason": None,
                }
            ),
        )
    with pytest.raises(SchemaValidationError):
        validate(
            "event",
            _event(
                {
                    "source": "provider_api",
                    "gen_ai.usage.input_tokens": None,
                    "null_reason": "",
                }
            ),
        )


def test_usage_requires_source():
    with pytest.raises(SchemaValidationError):
        validate("event", _event({"gen_ai.usage.input_tokens": 3}))


def test_usage_rejects_unknown_field_names():
    with pytest.raises(SchemaValidationError):
        validate("event", _event({"source": "unknown", "input_tokens": "lots"}))


def test_usage_source_only_is_valid():
    validate("event", _event({"source": "unknown"}))


def _assessment_set(answer, metric_extra=None):
    metric = {"value": 1.0, "se": None, "ci95": None, "n": 1, "method": "exact_match"}
    if metric_extra:
        metric.update(metric_extra)
    return {
        "schema_version": "xtrm-research-assessment-set/v1",
        "assessment_set_id": "as-1",
        "evaluator": {
            "id": "exact-match",
            "version": "v1",
            "content_hash": "sha256:" + "0" * 64,
        },
        "input_run_id": "run-0001",
        "timestamp": "2026-09-17T12:00:00+00:00",
        "assessments": [{"sample_id": "s-1", "answer": answer}],
        "metrics": {"accuracy": metric},
    }


def test_assessment_set_noul_answer_valid():
    validate("assessment_set", _assessment_set({"noul": 0.9}))


def test_assessment_set_choice_answer_valid():
    validate(
        "assessment_set",
        _assessment_set(
            {"choice": "a", "probabilities": {"a": 0.9, "b": 0.1}, "confidence": 0.8}
        ),
    )


def test_assessment_set_score_answer_valid():
    validate(
        "assessment_set",
        _assessment_set(
            {
                "score": 2.5,
                "legend": {"1": "low", "2": "mid"},
                "probabilities": {"2": 0.6},
                "confidence": 0.7,
            }
        ),
    )


def test_assessment_set_noul_with_confidence_rejected():
    with pytest.raises(SchemaValidationError):
        validate("assessment_set", _assessment_set({"noul": 0.9, "confidence": 0.5}))


def test_assessment_set_nonsystem_one_answer_rejected():
    with pytest.raises(SchemaValidationError):
        validate("assessment_set", _assessment_set({"match": True}))


def test_assessment_set_metric_requires_se_and_ci95_fields():
    invalid = _assessment_set({"noul": 1.0})
    del invalid["metrics"]["accuracy"]["se"]
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
