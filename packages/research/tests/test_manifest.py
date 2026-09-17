from __future__ import annotations

import pytest

from xtrm_research.manifest import build_intent

from .helpers import make_manifest


def test_intent_requires_purpose():
    with pytest.raises(ValueError, match="purpose"):
        build_intent(purpose="", trigger="baseline")


def test_intent_requires_trigger():
    with pytest.raises(ValueError, match="trigger"):
        build_intent(purpose="check", trigger="")


def test_build_manifest_refuses_intent_missing_purpose(registry):
    with pytest.raises(ValueError, match="purpose"):
        make_manifest(
            registry,
            intent={
                "purpose": "",
                "trigger": "baseline",
                "refs": [],
                "requested_by": "x",
                "tags": [],
            },
        )


def test_build_manifest_refuses_intent_missing_trigger(registry):
    with pytest.raises(ValueError, match="trigger"):
        make_manifest(
            registry,
            intent={
                "purpose": "x",
                "trigger": "",
                "refs": [],
                "requested_by": "x",
                "tags": [],
            },
        )


def test_manifest_is_fully_version_resolved(registry):
    manifest = make_manifest(registry)
    for ref_name in ("experiment", "workload", "dataset", "variant"):
        ref = manifest[ref_name]
        assert ref["version"] and ref["content_hash"].startswith("sha256:")
    for evaluator_ref in manifest["evaluators"]:
        assert evaluator_ref["content_hash"].startswith("sha256:")


def test_backend_model_alias_resolved_and_recorded(registry):
    manifest = make_manifest(
        registry,
        backend={
            "provider": "typesafe",
            "model": "jev-latest",
            "model_version": "latest",
        },
        alias_resolver={"jev-latest": "jev-2026-09-01"},
    )
    assert manifest["backend"]["model"] == "jev-2026-09-01"
    assert manifest["aliases"]["resolved"] == [
        {"input": "jev-latest", "resolved": "jev-2026-09-01"}
    ]
    assert manifest["aliases"]["unresolved"] == []


def test_backend_model_alias_unresolved_recorded_with_reason(registry):
    manifest = make_manifest(
        registry,
        backend={"provider": "typesafe", "model": "main", "model_version": "latest"},
        alias_resolver={},
    )
    assert manifest["backend"]["model"] == "main"
    assert manifest["aliases"]["resolved"] == []
    unresolved = manifest["aliases"]["unresolved"]
    assert unresolved == [
        {"input": "main", "reason": "no resolver entry for alias 'main'"}
    ]


def test_backend_model_pinned_id_leaves_no_alias_record(registry):
    manifest = make_manifest(
        registry
    )  # default backend.model="always-no-1", not alias-shaped
    assert manifest["aliases"]["resolved"] == []
    assert manifest["aliases"]["unresolved"] == []
