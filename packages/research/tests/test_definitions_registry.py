from __future__ import annotations

import json

import pytest

from xtrm_research.definitions import DefinitionRegistry, load_definition
from xtrm_research.hashing import compute_content_hash
from xtrm_research.schemas import SchemaValidationError


def _write(path, payload):
    payload = dict(payload)
    payload["content_hash"] = compute_content_hash(payload)
    path.write_text(json.dumps(payload))


def test_load_definition_missing_content_hash_raises(tmp_path):
    path = tmp_path / "x.json"
    path.write_text(
        json.dumps({"id": "x", "version": "v1", "description": "d", "config": {}})
    )
    with pytest.raises(SchemaValidationError, match="content_hash"):
        load_definition("variant", path)


def test_load_definition_never_fills_hash_silently(tmp_path):
    path = tmp_path / "x.json"
    payload = {"id": "x", "version": "v1", "description": "d", "config": {}}
    path.write_text(json.dumps(payload))  # no content_hash at all
    with pytest.raises(SchemaValidationError):
        load_definition("variant", path)
    # the file on disk must be untouched — no hash was ever written back
    assert json.loads(path.read_text()) == payload


def test_load_definition_content_hash_mismatch_raises(tmp_path):
    path = tmp_path / "x.json"
    payload = {
        "id": "x",
        "version": "v1",
        "description": "d",
        "config": {},
        "content_hash": "sha256:" + "0" * 64,
    }
    path.write_text(json.dumps(payload))
    with pytest.raises(SchemaValidationError, match="does not match"):
        load_definition("variant", path)


def test_registry_duplicate_id_version_different_content_raises(tmp_path):
    (tmp_path / "variant").mkdir()
    _write(
        tmp_path / "variant" / "a.json",
        {"id": "x", "version": "9", "description": "orig", "config": {}},
    )
    _write(
        tmp_path / "variant" / "b.json",
        {"id": "x", "version": "9", "description": "EDITED", "config": {}},
    )
    with pytest.raises(SchemaValidationError, match="duplicate"):
        DefinitionRegistry(tmp_path).get("variant", "x", "9")


def test_registry_latest_compares_versions_numerically(tmp_path):
    (tmp_path / "variant").mkdir()
    for v in ("9", "10"):
        _write(
            tmp_path / "variant" / f"{v}.json",
            {"id": "x", "version": v, "description": "d", "config": {}},
        )
    assert DefinitionRegistry(tmp_path).latest("variant", "x")["version"] == "10"
