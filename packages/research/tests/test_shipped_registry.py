"""Tests for the definitions shipped in ``packages/research/registry/``.

These tests walk the shipped registry directory rather than a hard-coded
file list, so a definition added by hand later is covered automatically and
cannot land broken: every file must load through :class:`DefinitionRegistry`
and validate against its kind's schema, carry a self-consistent
``content_hash``, and every experiment's legend must cover its named
datasets, variant ids and declared status/label vocabularies.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from xtrm_research.cli.main import main
from xtrm_research.definitions import DEFINITION_KINDS, DefinitionRegistry
from xtrm_research.hashing import compute_content_hash
from xtrm_research.schemas import SchemaValidationError, validate

SHIPPED_REGISTRY = Path(__file__).resolve().parent.parent / "registry"

SHIPPED_FILES = sorted(SHIPPED_REGISTRY.glob("*/*.json"))


def _payload(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _shipped_experiments() -> list[Path]:
    return sorted((SHIPPED_REGISTRY / "experiment").glob("*.json"))


def test_shipped_registry_is_not_empty():
    assert SHIPPED_FILES, f"no definition files under {SHIPPED_REGISTRY}"
    experiment_ids = {_payload(path)["id"] for path in _shipped_experiments()}
    assert {"board-duplicates-v1", "contract-quality-v3"} <= experiment_ids


def test_every_subdirectory_is_a_definition_kind():
    # A file placed under an unknown kind must fail loudly rather than be
    # silently ignored by the walk below.
    for kind_dir in sorted(p for p in SHIPPED_REGISTRY.iterdir() if p.is_dir()):
        assert kind_dir.name in DEFINITION_KINDS, f"unknown kind dir: {kind_dir.name}"


def test_every_shipped_file_loads_and_validates_through_registry():
    registry = DefinitionRegistry(SHIPPED_REGISTRY)
    seen = 0
    for path in SHIPPED_FILES:
        kind = path.parent.name
        assert kind in DEFINITION_KINDS, f"{path}: unknown kind {kind!r}"
        payload = _payload(path)
        # DefinitionRegistry.get() loads, hash-verifies and schema-validates.
        loaded = registry.get(kind, payload["id"], payload["version"])
        assert loaded == payload, f"{path}: registry returned a different payload"
        seen += 1
    assert seen == len(SHIPPED_FILES) > 0


def test_every_shipped_definition_content_hash_matches_its_content():
    for path in SHIPPED_FILES:
        payload = _payload(path)
        assert payload["content_hash"] == compute_content_hash(payload), (
            f"{path}: stored content_hash does not match its payload"
        )


def _referenced_legend_keys(experiment: dict) -> set[str]:
    return (
        set(experiment.get("named_datasets", []))
        | {variant["id"] for variant in experiment.get("variants", [])}
        | set(experiment.get("statuses", []))
        | set(experiment.get("label_values", []))
    )


def test_every_shipped_experiment_legend_is_complete():
    for path in _shipped_experiments():
        experiment = _payload(path)
        missing = sorted(
            _referenced_legend_keys(experiment) - experiment["legend"].keys()
        )
        assert not missing, f"{path}: missing legend entries for {missing}"
        # validate() enforces the same rule beyond the schema, so the
        # shipped object must satisfy both the explicit check and the rule.
        validate("experiment", experiment)


def test_removing_any_referenced_legend_entry_is_rejected():
    # The completeness test above must not pass vacuously: drop each
    # referenced key in turn and prove validate() rejects the result.
    for path in _shipped_experiments():
        experiment = _payload(path)
        for key in sorted(_referenced_legend_keys(experiment)):
            broken = copy.deepcopy(experiment)
            del broken["legend"][key]
            broken["content_hash"] = compute_content_hash(broken)
            with pytest.raises(SchemaValidationError, match="legend"):
                validate("experiment", broken)


@pytest.mark.parametrize(
    "experiment_id", ["board-duplicates-v1", "contract-quality-v3"]
)
def test_shipped_experiments_resolve_through_experiment_show(experiment_id, capsys):
    code = main(
        [
            "--json",
            "experiment",
            "show",
            experiment_id,
            "--registry-root",
            str(SHIPPED_REGISTRY),
        ]
    )
    envelope = json.loads(capsys.readouterr().out.strip())
    assert code == 0
    assert envelope["schema"] == "xtrm-research-cli/v1"
    assert envelope["command"] == "experiment show"
    assert envelope["ok"] is True
    assert envelope["data"]["id"] == experiment_id
