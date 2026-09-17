"""Guard stage tests (XTRM-428).

Every credential value in this file is synthesized at test time
(``secrets.token_hex`` / ``AKIA`` + a random suffix) — never a value
copied from a real board or from MMD-585.
"""

from __future__ import annotations

import ast
import json
import re
import secrets
from pathlib import Path

import pytest

import xtrm_research
from xtrm_research.guards import (
    ID_TOKEN,
    GuardFailure,
    LabelExclusionRule,
    MaskAbortError,
    cache_key,
    check_mask,
    deep_mask,
    guard_versions,
    guarded_send,
    mask,
    mask_version,
    redact,
    redaction_version,
    send_through_run,
    strip_excluded_labels,
)
from xtrm_research.runner import start_run
from xtrm_research.store import events_path
from xtrm_research.jsonl import read_lines

from .helpers import make_manifest

PACKAGE_ROOT = Path(xtrm_research.__file__).parent


def _fake_akia_key() -> str:
    return "AKIA" + "".join(
        secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(16)
    )


def _fake_hex_secret() -> str:
    return secrets.token_hex(16)  # 32 hex chars


class _RecordingBackend:
    """Fake remote backend: records every payload it was called with."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, payload: dict) -> dict:
        self.calls.append(payload)
        return {"ok": True}


# ---- structural: guarded_send is the only remote-send seam ----------------


_NETWORK_MODULES = {
    "socket",
    "requests",
    "httpx",
    "urllib.request",
    "http.client",
    "aiohttp",
}


def test_guarded_send_is_the_only_remote_seam():
    """No module other than guards.py performs or exposes a remote call:
    guarded_send is the only exported function anywhere in the package
    whose signature takes a parameter named ``send``, and no module
    imports a network client library."""
    send_taking_functions: list[tuple[str, str]] = []
    network_imports: list[tuple[str, str]] = []

    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = (
                    [a.name for a in node.names]
                    if isinstance(node, ast.Import)
                    else [node.module]
                )
                for name in names:
                    if name in _NETWORK_MODULES:
                        network_imports.append((str(path), name))
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                arg_names = {a.arg for a in (*node.args.args, *node.args.kwonlyargs)}
                if "send" in arg_names:
                    send_taking_functions.append((str(path), node.name))

    assert network_imports == []
    guards_path = str(PACKAGE_ROOT / "guards.py")
    assert send_taking_functions == [
        (guards_path, "guarded_send"),
        (guards_path, "send_through_run"),
    ]


# ---- redaction --------------------------------------------------------


def test_redact_masks_assignment_and_bare_secrets():
    hex_secret = _fake_hex_secret()
    akia = _fake_akia_key()
    text = f'aws_secret_access_key: "{hex_secret}" and a bare key {akia} in prose'
    redacted = redact(text)
    assert hex_secret not in redacted
    assert akia not in redacted
    assert "<redacted>" in redacted


def test_deep_mask_operates_per_string_field_not_serialized_json():
    hex_secret = _fake_hex_secret()
    payload = {"contract": {"body": f'token="{hex_secret}"', "n": 3}, "tags": ["x"]}
    guarded = deep_mask(payload, known_ids=frozenset())
    serialized = json.dumps(guarded)
    assert hex_secret not in serialized
    assert json.loads(serialized) == guarded  # still valid JSON, no broken escapes
    assert guarded["contract"]["n"] == 3  # non-string fields untouched


# ---- historical defect 1: over-broad id regex ---------------------------


def test_historical_over_broad_regex_is_caught_by_check_mask():
    """Reproduces the 2026-09-17 defect: an id-masking regex that matched
    ordinary hyphenated words (rather than only known ids) is detected by
    check_mask."""
    original = (
        "The cross-process settle-lock test now exercises torn-line "
        "handling end-to-end, and the schema-sweep validation covers "
        "every run-immutability edge case we found during code-review."
    )
    # The historical bug: substitute *every* id-shaped token, without
    # checking membership against a known-id set.
    bad_masked = ID_TOKEN.sub("<issue>", original)
    with pytest.raises(MaskAbortError):
        check_mask(original, bad_masked)


def test_correct_mask_only_replaces_known_ids():
    original = "The cross-process settle-lock fix references XTRM-428 directly."
    known_ids = frozenset({"xtrm-428"})
    masked = mask(original.lower(), known_ids)
    check_mask(original, masked)  # does not raise: ordinary words survive
    assert "<issue>" in masked
    assert "cross-process" in masked
    assert "settle-lock" in masked


# ---- credential-shaped contract reaches the backend double redacted ------


def test_credential_shaped_contract_reaches_backend_fully_redacted_and_valid_json():
    hex_secret = _fake_hex_secret()
    akia = _fake_akia_key()
    payload = {
        "title": "rotate the market data key",
        "contract": {
            "aws_secret_access_key": hex_secret,
            "note": f"bare token seen in logs: {akia}",
        },
    }
    backend = _RecordingBackend()
    result = guarded_send(payload, backend)

    assert result == {"ok": True}
    assert len(backend.calls) == 1
    sent = backend.calls[0]
    serialized = json.dumps(sent)
    assert hex_secret not in serialized
    assert akia not in serialized
    assert json.loads(serialized) == sent


# ---- label-leak exclusion -----------------------------------------------


def test_excluded_label_is_stripped_by_default():
    payload = {"title": "x", "labels": ["contract:ready", "area:research"]}
    backend = _RecordingBackend()
    guarded_send(payload, backend)
    assert backend.calls[0]["labels"] == ["area:research"]


def test_excluded_label_is_rejected_in_reject_mode():
    payload = {"title": "x", "labels": ["contract:ready"]}
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, label_rule=LabelExclusionRule(mode="reject"))
    assert exc_info.value.guard == "labels"
    assert backend.calls == []


def test_strip_excluded_labels_is_recursive():
    rule = LabelExclusionRule()
    nested = {"items": [{"labels": ["contract:ready", "keep"]}]}
    stripped = strip_excluded_labels(nested, rule)
    assert stripped["items"][0]["labels"] == ["keep"]


# ---- fail closed: guard failure reaches zero calls, run marked invalid --


def test_guard_failure_reaches_backend_zero_calls():
    """An over-aggressive known-id set (matching ordinary words) trips the
    mask abort check before any send happens."""
    payload = {
        "title": "the quick brown fox jumps over the lazy dog near the river",
    }
    over_broad_known_ids = frozenset(
        {"the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "near"}
    )
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=over_broad_known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_guard_stage_fails_closed_on_unexpected_exception(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("xtrm_research.guards.deep_mask", _boom)
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"title": "x"}, backend)
    assert exc_info.value.guard == "guard_stage"
    assert "boom" not in str(exc_info.value)
    assert backend.calls == []


def test_send_through_run_marks_run_invalid_on_guard_failure(registry, runs_root):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    backend = _RecordingBackend()
    over_broad_known_ids = frozenset(
        {"the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "near"}
    )
    payload = {"title": "the quick brown fox jumps over the lazy dog near the river"}

    with pytest.raises(GuardFailure):
        send_through_run(handle, 0, payload, backend, known_ids=over_broad_known_ids)

    assert backend.calls == []
    events = list(read_lines(events_path(runs_root, manifest["run_id"])))
    assert len(events) == 1
    assert events[0]["kind"] == "guard_failure"
    assert events[0]["data"]["guard"] == "mask"
    assert "removed" not in json.dumps(events[0]["data"])  # counts only, no free text
    # a second write attempt on the now-settled run is refused, proving invalid landed
    with pytest.raises(Exception):
        handle.heartbeat()


def test_send_through_run_records_guard_pass_on_success(registry, runs_root):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    backend = _RecordingBackend()
    result = send_through_run(handle, 0, {"title": "ordinary text"}, backend)
    assert result == {"ok": True}
    assert len(backend.calls) == 1
    events = list(read_lines(events_path(runs_root, manifest["run_id"])))
    assert events[0]["kind"] == "guard_pass"
    assert events[0]["data"] == guard_versions()


# ---- guard versions are content hashes, not hand-set strings -----------


def test_guard_versions_are_content_hashes():
    versions = guard_versions()
    assert re.match(r"^sha256:[0-9a-f]{64}$", versions["mask_version"])
    assert re.match(r"^sha256:[0-9a-f]{64}$", versions["redaction_version"])


def test_guard_version_changes_when_rule_changes():
    default_versions = mask_version()
    changed_versions = mask_version(LabelExclusionRule(excluded_prefixes=("secret:",)))
    assert default_versions != changed_versions


def test_redaction_version_is_stable_across_calls():
    assert redaction_version() == redaction_version()


# ---- cache-key helper: guard versions fold into the key ------------------


def test_cache_key_changes_with_guard_version():
    payload = {"title": "same request"}
    key_a = cache_key(payload, {"mask_version": "v1", "redaction_version": "v1"})
    key_b = cache_key(payload, {"mask_version": "v2", "redaction_version": "v1"})
    assert key_a != key_b


def test_cache_key_stable_for_identical_request_and_guards():
    payload = {"title": "same request"}
    guards = {"mask_version": "v1", "redaction_version": "v1"}
    assert cache_key(payload, guards) == cache_key(payload, guards)


# ---- no real credential values ever land in the committed package -------


def test_no_real_credential_literals_in_source_or_tests():
    """Grep-equivalent: no hex/AKIA-shaped literal appears hardcoded in
    guards.py or this test file — every credential used above is
    generated at runtime."""
    suspicious = re.compile(r"(?:AKIA|ASIA)[A-Z0-9]{16}|\b[A-Fa-f0-9]{32}\b")
    for path in (PACKAGE_ROOT / "guards.py", Path(__file__)):
        text = path.read_text(encoding="utf-8")
        assert not suspicious.search(text), f"credential-shaped literal found in {path}"
