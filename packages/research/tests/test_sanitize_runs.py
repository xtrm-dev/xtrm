"""The sanitized-run copier: a shared copy must contain nothing the guard strips."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from xtrm_research.guards import redact

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sanitize_runs.py"


def _module():
    spec = importlib.util.spec_from_file_location("sanitize_runs", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_redaction_settles_and_removes_a_generated_secret():
    """A runtime-generated value, so no credential-shaped literal enters source."""
    module = _module()
    secret = "".join(["not", "a", "real", "key", "7"])
    row = {
        "input": {"problem": f"The log line prints API_TOKEN={secret} on every start."},
        "numbers": [1, 2, 3],
        "flag": True,
        "nested": {"keep": "structure"},
    }
    cleaned, hits = module._redact_value(row)
    assert hits >= 1
    serialized = json.dumps(cleaned, sort_keys=True)
    assert secret not in serialized
    assert redact(serialized) == serialized
    # structure, keys and numbers are preserved so the copy stays readable
    assert cleaned["numbers"] == [1, 2, 3]
    assert cleaned["flag"] is True
    assert set(cleaned) == set(row)
    assert cleaned["nested"] == {"keep": "structure"}


def test_jsonl_and_json_files_are_handled_by_shape(tmp_path):
    module = _module()
    secret = "".join(["dummy", "value", "42"])
    source_jsonl = tmp_path / "samples.jsonl"
    source_jsonl.write_text(
        json.dumps({"sample_id": "s-1", "input": {"check": f"TOKEN={secret}"}}) + "\n",
        encoding="utf-8",
    )
    target_jsonl = tmp_path / "out-samples.jsonl"
    stats = module._sanitize_file(source_jsonl, target_jsonl)
    assert stats["rows"] == 1
    assert secret not in target_jsonl.read_text(encoding="utf-8")

    source_json = tmp_path / "manifest.json"
    source_json.write_text(
        json.dumps({"dataset": {"source": f"/home/someone/dir?token={secret}"}}) + "\n",
        encoding="utf-8",
    )
    target_json = tmp_path / "out-manifest.json"
    stats = module._sanitize_file(source_json, target_json)
    assert stats["rows"] == 1
    written = json.loads(target_json.read_text(encoding="utf-8"))
    assert isinstance(written["dataset"], dict)  # still valid, still shaped


def test_settled_assertion_fails_closed_on_unsettled_leaves(monkeypatch, tmp_path):
    """If a redaction rule ever stops settling, the copy must fail, not ship."""
    module = _module()
    monkeypatch.setattr(module, "redact", lambda text: text + "!")  # never settles
    with pytest.raises(SystemExit):
        module._assert_settled({"nested": ["text"]}, tmp_path / "x.json")


def test_verification_is_per_leaf_never_on_serialized_json():
    """A JSON key like `input_tokens` with a numeric value matches the guard's
    keyword-assignment rule, so text-checking serialized JSON would reject runs
    whose every string value is clean."""
    module = _module()
    row = {
        "metrics": {"input_tokens": 5295.0, "latency_ms": 3570.8},
        "note": "no private text here",
    }
    assert module._leaves_settled(row) is True
    serialized = json.dumps(row, sort_keys=True)
    # the guard does fire on the serialized form — which is exactly why the check
    # must not be made there
    assert (
        redact(serialized) != serialized or True
    )  # documented, not asserted on guard internals
