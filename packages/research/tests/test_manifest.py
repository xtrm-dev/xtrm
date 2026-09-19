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
        backend={"provider": "typesafe", "model": "jev-latest", "model_version": "v1"},
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
        backend={"provider": "typesafe", "model": "main", "model_version": "v1"},
        alias_resolver={},
    )
    assert manifest["backend"]["model"] == "main"
    assert manifest["aliases"]["resolved"] == []
    unresolved = manifest["aliases"]["unresolved"]
    assert unresolved == [
        {"input": "main", "reason": "no resolver entry for alias 'main'"}
    ]


def test_backend_model_version_alias_resolved_and_recorded(registry):
    manifest = make_manifest(
        registry,
        backend={
            "provider": "typesafe",
            "model": "jev-2026",
            "model_version": "latest",
        },
        alias_resolver={"latest": "2026-09-01"},
    )
    assert manifest["backend"]["model_version"] == "2026-09-01"
    assert manifest["aliases"]["resolved"] == [
        {"input": "latest", "resolved": "2026-09-01"}
    ]


def test_backend_alias_resolver_key_treated_as_alias_regardless_of_shape(registry):
    # "jev-stable" doesn't match the shape heuristic, but it IS a key in
    # alias_resolver, which is definitive evidence it's a mutable pointer.
    manifest = make_manifest(
        registry,
        backend={"provider": "typesafe", "model": "jev-stable", "model_version": "v1"},
        alias_resolver={"jev-stable": "jev-2026-08-15"},
    )
    assert manifest["backend"]["model"] == "jev-2026-08-15"
    assert manifest["aliases"]["resolved"] == [
        {"input": "jev-stable", "resolved": "jev-2026-08-15"}
    ]


@pytest.mark.parametrize("alias", ["HEAD", "jev@latest", "jev:latest", "jev-latest"])
def test_backend_model_alias_heuristic_shapes(registry, alias):
    manifest = make_manifest(
        registry,
        backend={"provider": "typesafe", "model": alias, "model_version": "v1"},
        alias_resolver={},
    )
    assert manifest["aliases"]["unresolved"] == [
        {"input": alias, "reason": f"no resolver entry for alias {alias!r}"}
    ]


def test_backend_model_pinned_id_leaves_no_alias_record(registry):
    manifest = make_manifest(
        registry
    )  # default backend.model="always-no-1", not alias-shaped
    assert manifest["aliases"]["resolved"] == []
    assert manifest["aliases"]["unresolved"] == []


def test_intent_rationale_optional_and_recorded():
    plain = build_intent(purpose="p", trigger="baseline")
    assert "rationale" not in plain
    with_rationale = build_intent(
        purpose="p", trigger="change_test", rationale="first rerun after migration"
    )
    assert with_rationale["rationale"] == "first rerun after migration"
