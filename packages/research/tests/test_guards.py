"""Guard stage tests (XTRM-428).

Every credential value in this file is synthesized at test time
(``secrets``/``base64`` from the stdlib) — never a value copied from a
real board or from MMD-585.
"""

from __future__ import annotations

import ast
import base64
import json
import re
import secrets
import string
import traceback
from pathlib import Path
from typing import Any

import pytest

import xtrm_research
import xtrm_research.guards as guards_module
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
    remember,
    send_through_run,
    strip_excluded_labels,
)
from xtrm_research.jsonl import read_lines
from xtrm_research.runner import RunSettledError, start_run
from xtrm_research.schemas import validate
from xtrm_research.store import events_path, load_status

from .helpers import make_manifest

PACKAGE_ROOT = Path(xtrm_research.__file__).parent
TESTS_ROOT = Path(__file__).parent
GUARDS_PATH = PACKAGE_ROOT / "guards.py"

# ---- synthetic credential fixtures (generated at run time, never hardcoded) --


def _fake_hex_secret() -> str:
    return secrets.token_hex(16)  # 32 hex chars


def _fake_akia_key() -> str:
    return "AKIA" + "".join(
        secrets.choice(string.ascii_uppercase + string.digits) for _ in range(16)
    )


def _fake_ghp_token() -> str:
    return "ghp_" + "".join(
        secrets.choice(string.ascii_letters + string.digits) for _ in range(36)
    )


def _fake_github_pat() -> str:
    return "github_pat_" + secrets.token_hex(20)


def _fake_slack_token() -> str:
    return "xoxb-" + "-".join(str(secrets.randbelow(10**10)) for _ in range(3))


def _fake_stripe_key() -> str:
    return "sk_live_" + secrets.token_hex(12)


def _fake_google_api_key() -> str:
    return "AIza" + "".join(
        secrets.choice(string.ascii_letters + string.digits + "_-") for _ in range(35)
    )


def _fake_npm_token() -> str:
    return "npm_" + secrets.token_hex(18)


def _fake_gitlab_pat() -> str:
    return "glpat-" + "".join(
        secrets.choice(string.ascii_letters + string.digits + "-_") for _ in range(20)
    )


def _fake_jwt() -> str:
    def seg(payload: dict) -> str:
        return (
            base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        )

    header = "eyJ" + seg({"alg": "HS256", "typ": "JWT"})[3:]
    return f"{header}.{seg({'sub': secrets.token_hex(6)})}.{secrets.token_hex(16)}"


def _fake_url_credential() -> tuple[str, str]:
    password = secrets.token_hex(8)
    return f"https://user:{password}@example.com/path", password


def _fake_auth_header() -> str:
    return f"Authorization: Bearer {secrets.token_hex(16)}"


def _fake_pem() -> str:
    body = "\n".join(secrets.token_hex(30) for _ in range(3))
    return f"-----BEGIN PRIVATE KEY-----\n{body}\n-----END PRIVATE KEY-----"


def _fake_base64_blob_with_symbol() -> str:
    # forced '+' prefix: exercises the lookaround fix for a token that
    # starts on a non-word character, where \b never anchors.
    return "+" + base64.b64encode(secrets.token_bytes(30)).decode()


class _RecordingBackend:
    """Fake remote backend: records every payload it was called with."""

    def __init__(self) -> None:
        self.calls: list[Any] = []

    def __call__(self, payload: Any) -> dict:
        self.calls.append(payload)
        return {"ok": True}


# A corpus long enough (36 plain words) that check_mask's ratio path
# applies (>= MASK_MIN_WORD_COUNT_FOR_RATIO), with a known-id set that
# removes 19/36 words (53%) — an over-aggressive match, well past the 2%
# budget, reproducing the historical defect at a realistic field size.
OVER_BROAD_TEXT = (
    "the quick brown fox jumps over the lazy dog near the river while "
    "the quiet town watches the slow tide turn and the old bridge creaks "
    "under the weight of the morning traffic crossing the river banks"
)
OVER_BROAD_KNOWN_IDS = frozenset(
    {"the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "near", "river"}
)


def _contains_substring(obj: Any, needle: str) -> bool:
    if isinstance(obj, str):
        return needle in obj
    if isinstance(obj, dict):
        return any(
            _contains_substring(k, needle) or _contains_substring(v, needle)
            for k, v in obj.items()
        )
    if isinstance(obj, (list, tuple, set, frozenset)):
        return any(_contains_substring(item, needle) for item in obj)
    return False


# ---- structural: guarded_send is the only remote-send seam ------------------


_TRANSPORT_MODULES = {
    "subprocess",
    "urllib",
    "http",
    "socket",
    "requests",
    "httpx",
    "httpcore",
    "aiohttp",
    "boto3",
    "anthropic",
    "openai",
}
#: guards.py is the only module allowed to import a transport.
_TRANSPORT_IMPORT_ALLOWLIST = {"guards.py"}
#: pre-existing, out-of-scope subprocess users (git plumbing, environment
#: probing) — not a remote-send path, exempted by name rather than folded
#: into the allowlist above.
_SUBPROCESS_EXEMPT = {"code_state.py", "environment.py"}


def _top_level_module(name: str | None) -> str:
    return (name or "").split(".")[0]


def _is_callable_annotation(annotation: ast.expr | None) -> bool:
    return annotation is not None and "Callable" in ast.dump(annotation)


def _scan_module(path: Path, source: str) -> tuple[list, list, list, list]:
    """Walk one module's AST for remote-seam violations. Shared by the
    structural test (real package files) and the bypass-detection tests
    below (synthetic snippets with a decoy path)."""
    tree = ast.parse(source, filename=str(path))
    send_taking: list[tuple[str, str]] = []
    callable_params: list[tuple[str, str, str]] = []
    transport_imports: list[tuple[str, str]] = []
    dynamic_imports: list[tuple[str, int]] = []

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = (
                [_top_level_module(a.name) for a in node.names]
                if isinstance(node, ast.Import)
                else [_top_level_module(node.module)]
            )
            for name in names:
                if name not in _TRANSPORT_MODULES:
                    continue
                if path.name in _TRANSPORT_IMPORT_ALLOWLIST:
                    continue
                if name == "subprocess" and path.name in _SUBPROCESS_EXEMPT:
                    continue
                transport_imports.append((str(path), name))
        if isinstance(node, ast.Call):
            func = node.func
            if (isinstance(func, ast.Attribute) and func.attr == "import_module") or (
                isinstance(func, ast.Name) and func.id == "import_module"
            ):
                dynamic_imports.append((str(path), node.lineno))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            positional_and_keyword = (
                *node.args.posonlyargs,
                *node.args.args,
                *node.args.kwonlyargs,
            )
            arg_names = {a.arg for a in positional_and_keyword}
            if "send" in arg_names:
                send_taking.append((str(path), node.name))
                continue
            if node.name.startswith("_"):
                continue
            callable_args = list(positional_and_keyword)
            if node.args.vararg is not None:
                callable_args.append(node.args.vararg)
            if node.args.kwarg is not None:
                callable_args.append(node.args.kwarg)
            for a in callable_args:
                if _is_callable_annotation(a.annotation):
                    callable_params.append((str(path), node.name, a.arg))

    return send_taking, callable_params, transport_imports, dynamic_imports


def test_guarded_send_is_the_only_remote_seam():
    """No module other than guards.py performs or exposes a remote call:
    guarded_send/send_through_run are the only exported functions
    anywhere in the package taking a ``send`` parameter, no public
    function takes a Callable-annotated parameter under any other name,
    no module imports a transport library, and nothing dynamically
    imports one either."""
    send_taking: list = []
    callable_params: list = []
    transport_imports: list = []
    dynamic_imports: list = []

    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        s, c, t, d = _scan_module(path, path.read_text(encoding="utf-8"))
        send_taking += s
        callable_params += c
        transport_imports += t
        dynamic_imports += d

    assert transport_imports == []
    assert dynamic_imports == []
    assert callable_params == []
    assert send_taking == [
        (str(GUARDS_PATH), "guarded_send"),
        (str(GUARDS_PATH), "send_through_run"),
    ]


@pytest.mark.parametrize(
    "source",
    [
        "def push(transport: Callable[[dict], Any]) -> None:\n    pass\n",
        "def push(client: Callable) -> None:\n    pass\n",
    ],
)
def test_scan_detects_callable_annotated_parameter_regardless_of_name(source):
    _send, callable_params, _t, _d = _scan_module(Path("decoy.py"), source)
    assert callable_params == [
        ("decoy.py", "push", "transport" if "transport" in source else "client")
    ]


def test_scan_detects_positional_only_send_parameter():
    send_taking, *_ = _scan_module(
        Path("decoy.py"), "def push(send, /, payload):\n    pass\n"
    )
    assert send_taking == [("decoy.py", "push")]


def test_scan_detects_kwargs_callable_annotation():
    _s, callable_params, *_ = _scan_module(
        Path("decoy.py"), "def push(**kwargs: Callable) -> None:\n    pass\n"
    )
    assert callable_params == [("decoy.py", "push", "kwargs")]


@pytest.mark.parametrize(
    "source",
    [
        "import subprocess\n",
        "from urllib import request\n",
        "from http import client\n",
        "import boto3\n",
        "import anthropic\n",
        "import openai\n",
        "import requests\n",
        "import httpx\n",
        "import httpcore\n",
        "import aiohttp\n",
        "import socket\n",
    ],
)
def test_scan_detects_transport_module_imports(source):
    _s, _c, transport_imports, _d = _scan_module(Path("decoy.py"), source)
    assert len(transport_imports) == 1


def test_scan_detects_dynamic_import_module_call():
    _s, _c, _t, dynamic_imports = _scan_module(
        Path("decoy.py"), "import importlib\nimportlib.import_module('requests')\n"
    )
    assert len(dynamic_imports) == 1


def test_scan_allows_guards_py_to_import_a_transport():
    _s, _c, transport_imports, _d = _scan_module(Path("guards.py"), "import socket\n")
    assert transport_imports == []


def test_scan_exempts_code_state_and_environment_subprocess_imports():
    for filename in ("code_state.py", "environment.py"):
        _s, _c, transport_imports, _d = _scan_module(
            Path(filename), "import subprocess\n"
        )
        assert transport_imports == [], filename


# ---- redaction --------------------------------------------------------


def test_redact_masks_assignment_and_bare_secrets():
    hex_secret = _fake_hex_secret()
    akia = _fake_akia_key()
    text = f'aws_secret_access_key: "{hex_secret}" and a bare key {akia} in prose'
    redacted = redact(text)
    assert hex_secret not in redacted
    assert akia not in redacted
    assert "<redacted>" in redacted


def test_redact_accepts_a_quoted_value_containing_spaces():
    secret = f"this has spaces {secrets.token_hex(6)}"
    text = f'token: "{secret}"'
    redacted = redact(text)
    assert secret not in redacted


@pytest.mark.parametrize(
    "make_secret",
    [
        _fake_ghp_token,
        _fake_github_pat,
        _fake_slack_token,
        _fake_stripe_key,
        _fake_google_api_key,
        _fake_npm_token,
        _fake_gitlab_pat,
        _fake_jwt,
        _fake_base64_blob_with_symbol,
    ],
)
def test_redact_covers_provider_token_formats(make_secret):
    secret = make_secret()
    text = f"here is a token: {secret} embedded in prose"
    redacted = redact(text)
    assert secret not in redacted, (
        f"a no-op redact would leave {make_secret.__name__} untouched"
    )
    assert "<redacted>" in redacted


def test_redact_masks_url_credential_password_only():
    url, password = _fake_url_credential()
    redacted = redact(url)
    assert password not in redacted
    assert "user" in redacted  # only the password is redacted, not the username


def test_redact_masks_authorization_header():
    header = _fake_auth_header()
    token = header.rsplit(" ", 1)[-1]
    redacted = redact(header)
    assert token not in redacted


def test_redact_masks_pem_block_markers_included():
    pem = _fake_pem()
    redacted = redact(pem)
    assert "BEGIN" not in redacted
    assert "END" not in redacted
    for line in pem.splitlines()[1:-1]:
        assert line not in redacted


def test_deep_mask_operates_per_string_field_not_serialized_json():
    hex_secret = _fake_hex_secret()
    payload = {"contract": {"body": f'token="{hex_secret}"', "n": 3}, "tags": ["x"]}
    guarded = deep_mask(payload, known_ids=frozenset())
    serialized = json.dumps(guarded)
    assert hex_secret not in serialized
    assert json.loads(serialized) == guarded  # still valid JSON, no broken escapes
    assert guarded["contract"]["n"] == 3  # non-string fields untouched


# ---- G1: deep_mask/_collect_strings type coverage ------------------------


def test_deep_mask_masks_dict_keys():
    hex_secret = _fake_hex_secret()
    payload = {f"token-{hex_secret}": "value"}
    guarded = deep_mask(payload, known_ids=frozenset())
    assert not any(hex_secret in str(k) for k in guarded)


def test_deep_mask_traverses_tuples():
    hex_secret = _fake_hex_secret()
    payload = {"pair": (f"secret is {hex_secret}", "ok")}
    guarded = deep_mask(payload, known_ids=frozenset())
    assert isinstance(guarded["pair"], tuple)
    assert not _contains_substring(guarded, hex_secret)


def test_deep_mask_traverses_sets():
    hex_secret = _fake_hex_secret()
    payload = {"values": {f"secret is {hex_secret}"}}
    guarded = deep_mask(payload, known_ids=frozenset())
    assert not _contains_substring(guarded, hex_secret)


def test_deep_mask_fails_closed_on_bytes():
    payload = {"blob": _fake_hex_secret().encode()}
    with pytest.raises(TypeError):
        deep_mask(payload, known_ids=frozenset())


def test_deep_mask_fails_closed_on_arbitrary_object():
    class Opaque:
        pass

    payload = {"weird": Opaque()}
    with pytest.raises(TypeError):
        deep_mask(payload, known_ids=frozenset())


def test_guarded_send_zero_calls_for_bytes_payload():
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"blob": _fake_hex_secret().encode()}, backend)
    assert exc_info.value.guard == "type"
    assert backend.calls == []


def test_guarded_send_zero_calls_for_arbitrary_object_payload():
    class Opaque:
        pass

    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"weird": Opaque()}, backend)
    assert exc_info.value.guard == "type"
    assert backend.calls == []


def test_guarded_send_masks_secret_in_dict_key():
    hex_secret = _fake_hex_secret()
    payload = {f"note-{hex_secret}": "ok"}
    backend = _RecordingBackend()
    guarded_send(payload, backend)
    assert not any(hex_secret in str(k) for k in backend.calls[0])


def test_guarded_send_masks_secret_in_tuple():
    hex_secret = _fake_hex_secret()
    payload = {"pair": (f"secret is {hex_secret}", "ok")}
    backend = _RecordingBackend()
    guarded_send(payload, backend)
    assert not _contains_substring(backend.calls[0], hex_secret)


def test_guarded_send_masks_secret_in_set():
    hex_secret = _fake_hex_secret()
    payload = {"values": {f"secret is {hex_secret}"}}
    backend = _RecordingBackend()
    guarded_send(payload, backend)
    assert not _contains_substring(backend.calls[0], hex_secret)


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
    # a realistically sized corpus: masking the one known id must stay
    # well within the 2% removal budget, unlike the historical bug.
    original = (
        "The cross-process settle-lock fix references XTRM-428 directly, and "
        "closes out the torn-line handling review, the schema hardening pass, "
        "the manifest immutability audit, the heartbeat staleness check, the "
        "retry lineage validation, the assessment set write-once guarantee, "
        "the annotation append-only contract, and the derived metrics view "
        "recomputation path, each covered by its own regression test suite."
    )
    known_ids = frozenset({"xtrm-428"})
    masked = mask(original, known_ids)
    check_mask(original, masked)  # does not raise: ordinary words survive
    assert "<issue>" in masked
    assert "cross-process" in masked
    assert "settle-lock" in masked


# ---- G7: case-insensitive id masking, digit-bearing bare suffix --------


def test_mask_matches_known_ids_case_insensitively_without_lowercasing_input():
    original = "See MMD-585 for the incident writeup."  # not lowercased by the test
    known_ids = frozenset({"mmd-585"})
    masked = mask(original, known_ids)
    assert "MMD-585" not in masked
    assert "<issue>" in masked


def test_plain_word_check_fires_on_uppercase_corpus():
    original = OVER_BROAD_TEXT.upper()  # not lowercased by the test
    masked = mask(original, OVER_BROAD_KNOWN_IDS)
    with pytest.raises(MaskAbortError):
        check_mask(original, masked)


def test_remember_adds_digit_bearing_bare_suffix():
    known = remember(["mmd-585", "xtrm-428"])
    assert "mmd-585" in known
    assert "585" in known  # digit-bearing bare suffix, per dupes.py remember()
    assert "428" in known


def test_remember_does_not_add_non_digit_bare_suffix():
    known = remember(["board-quarterly"])
    assert "quarterly" not in known


# ---- G8: check_mask must not dilute across a large payload ---------------


def test_check_mask_fires_on_one_fully_replaced_field_in_a_large_payload():
    filler = " ".join(f"word{i} plain text filler content" for i in range(200))
    payload = {
        "background": filler,
        "critical_field": "alpha beta gamma delta epsilon zeta eta theta",
    }
    # simulate an over-aggressive known-id set that only eats the small field
    known_ids = frozenset(
        {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"}
    )
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_check_mask_does_not_count_replacement_tokens_as_survivors():
    # 36-word corpus (>= the ratio-path threshold) with exactly 2 words
    # replaced by the literal tokens: if the tokens themselves counted as
    # surviving plain words, this would under-report the loss.
    original = OVER_BROAD_TEXT
    masked = original.replace("the ", "<issue> ", 1).replace("quick", "<redacted>", 1)
    with pytest.raises(MaskAbortError) as exc_info:
        check_mask(original, masked)
    assert exc_info.value.removed == 2
    assert exc_info.value.total == 36


def test_check_mask_short_field_tolerates_partial_loss():
    """Below the ratio-path word count, losing *some* but not all plain
    words is tolerated — only a fully replaced short field aborts (see
    test_check_mask_short_field_aborts_only_on_full_loss)."""
    original = "alpha beta gamma"
    masked = "<issue> <redacted> gamma"
    check_mask(original, masked)  # does not raise


def test_check_mask_short_field_aborts_only_on_full_loss():
    original = "alpha beta gamma"
    masked = "<issue> <issue> <issue>"
    with pytest.raises(MaskAbortError) as exc_info:
        check_mask(original, masked)
    assert exc_info.value.removed == 3
    assert exc_info.value.total == 3


def test_check_mask_short_field_full_loss_from_redaction_alone_does_not_abort():
    """A field that is *entirely* redacted (no known id involved) must
    not abort: original vs masked are identical once the replacement
    token is stripped, so masking_applied is False. This is the G14
    regression: a credential-shaped field used to abort the whole send."""
    redacted_baseline = "<redacted>"
    check_mask(redacted_baseline, redacted_baseline)  # does not raise


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


# ---- G4: label exclusion beyond dict[field] -> list[str] -----------------


def _label_payload_shapes() -> list[tuple[str, dict]]:
    return [
        ("comma_joined_string", {"labels": "contract:ready, area:research"}),
        (
            "nested_list_of_dicts",
            {"labels": [{"name": "contract:ready"}, {"name": "area:research"}]},
        ),
        ("different_case_field", {"Labels": ["contract:ready"]}),
        ("label_in_free_text", {"labels": ["a note mentioning contract:ready inline"]}),
    ]


@pytest.mark.parametrize("shape_name,payload", _label_payload_shapes())
def test_excluded_label_stripped_regardless_of_shape(shape_name, payload):
    backend = _RecordingBackend()
    guarded_send(payload, backend)
    assert not _contains_substring(backend.calls[0], "contract:ready"), shape_name


@pytest.mark.parametrize("shape_name,payload", _label_payload_shapes())
def test_excluded_label_rejected_regardless_of_shape(shape_name, payload):
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, label_rule=LabelExclusionRule(mode="reject"))
    assert exc_info.value.guard == "labels", shape_name
    assert backend.calls == [], shape_name


def test_strip_excluded_labels_is_recursive():
    rule = LabelExclusionRule()
    nested = {"items": [{"labels": ["contract:ready", "keep"]}]}
    stripped = strip_excluded_labels(nested, rule)
    assert stripped["items"][0]["labels"] == ["keep"]


# ---- fail closed: guard failure reaches zero calls, run marked invalid --


def test_guard_failure_reaches_backend_zero_calls():
    """An over-aggressive known-id set (matching ordinary words) trips the
    mask abort check before any send happens."""
    payload = {"title": OVER_BROAD_TEXT}
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=OVER_BROAD_KNOWN_IDS)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_guarded_send_sends_a_field_that_is_exactly_a_secret_redacted():
    """G14 regression: a field whose entire value is a credential (no
    surrounding prose, no known id involved) must send successfully with
    the value redacted, not abort the run."""
    secret = "AKIA" + "ABCDEFGHIJKLMNOP"  # deterministic, letters-only suffix
    backend = _RecordingBackend()
    guarded_send({"a": secret}, backend)
    assert len(backend.calls) == 1
    assert secret not in json.dumps(backend.calls[0])
    assert backend.calls[0]["a"] == "<redacted>"


@pytest.mark.parametrize(
    "text",
    ["ok", "a short five word field"],
)
def test_guarded_send_sends_short_ordinary_fields(text):
    backend = _RecordingBackend()
    guarded_send({"a": text}, backend)
    assert backend.calls[0]["a"] == text


def test_guard_stage_fails_closed_on_unexpected_exception(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise RuntimeError("boom, with a secret leak attempt inside")

    monkeypatch.setattr(guards_module, "deep_mask", _boom)
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"title": "x"}, backend)
    assert exc_info.value.guard == "guard_stage"
    assert "boom" not in str(exc_info.value)
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__context__ is None
    assert "boom" not in traceback.format_exc()
    assert backend.calls == []


def test_send_through_run_marks_run_invalid_on_guard_failure(registry, runs_root):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    backend = _RecordingBackend()
    payload = {"title": OVER_BROAD_TEXT}

    with pytest.raises(GuardFailure):
        send_through_run(handle, 0, payload, backend, known_ids=OVER_BROAD_KNOWN_IDS)

    assert backend.calls == []
    events = list(read_lines(events_path(runs_root, manifest["run_id"])))
    assert len(events) == 1
    assert events[0]["kind"] == "guard_failure"
    assert events[0]["data"]["guard"] == "mask"
    assert events[0]["data"]["counts"]  # G10: non-empty counts
    assert set(events[0]["data"]["counts"]) == {
        "removed",
        "total",
    }  # structured, no free text
    assert "river" not in json.dumps(events[0]["data"])  # no payload text leaked
    status = load_status(runs_root, manifest["run_id"])
    assert status["state"] == "invalid"
    with pytest.raises(RunSettledError):
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


# ---- G9: fail-closed holes in send_through_run ---------------------------


def test_send_through_run_settles_invalid_when_guard_versions_raises(
    registry, runs_root, monkeypatch
):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    backend = _RecordingBackend()

    def _boom(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(guards_module, "guard_versions", _boom)
    with pytest.raises(GuardFailure):
        send_through_run(handle, 0, {"title": "x"}, backend)

    assert backend.calls == []
    status = load_status(runs_root, manifest["run_id"])
    assert status["state"] == "invalid"


def test_send_through_run_settles_invalid_even_when_write_event_raises(
    registry, runs_root, monkeypatch
):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    backend = _RecordingBackend()
    payload = {"title": OVER_BROAD_TEXT}

    original_write_event = handle.write_event
    calls = {"n": 0}

    def _flaky_write_event(event):
        calls["n"] += 1
        raise RuntimeError("disk full")

    monkeypatch.setattr(handle, "write_event", _flaky_write_event)
    with pytest.raises(RuntimeError, match="disk full"):
        send_through_run(handle, 0, payload, backend, known_ids=OVER_BROAD_KNOWN_IDS)

    assert backend.calls == []
    assert calls["n"] == 1
    monkeypatch.setattr(handle, "write_event", original_write_event)
    status = load_status(runs_root, manifest["run_id"])
    assert status["state"] == "invalid"


# ---- G3: exception chain never leaks a secret ----------------------------


def test_mask_guard_failure_leaks_no_secret_in_exception_chain():
    hex_secret = _fake_hex_secret()
    # A field whose masked text still fails check_mask: pad it with
    # known-id words so the removed fraction crosses the threshold, while
    # keeping the raw secret physically present in the *original* string
    # so a leak would be visible if the guard were sloppy about it.
    original = f"alpha beta gamma delta epsilon zeta eta theta ({hex_secret})"
    known_ids = frozenset(
        {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"}
    )
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"body": original}, backend, known_ids=known_ids)
    assert hex_secret not in str(exc_info.value)
    assert hex_secret not in str(exc_info.value.__cause__)
    assert hex_secret not in str(exc_info.value.__context__)
    assert hex_secret not in traceback.format_exc()
    assert backend.calls == []


def test_schema_guard_failure_leaks_no_instance_value_in_exception_chain():
    hex_secret = _fake_hex_secret()
    payload = {
        "schema_version": "xtrm-research-event/v1",
        "seq": "not-an-integer",  # invalid: schema requires an integer
        "ts": "2026-09-17T12:00:00+00:00",
        "kind": f"note about {hex_secret}",
    }
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, schema_kind="event")
    assert exc_info.value.guard == "schema"
    assert backend.calls == []
    for text in (
        str(exc_info.value),
        str(exc_info.value.__cause__),
        str(exc_info.value.__context__),
        traceback.format_exc(),
    ):
        assert hex_secret not in text
        assert "not-an-integer" not in text


# ---- D1: schema_kind guard, positive and negative -------------------------


def test_schema_kind_guard_passes_a_valid_payload():
    payload = {
        "schema_version": "xtrm-research-event/v1",
        "seq": 1,
        "ts": "2026-09-17T12:00:00+00:00",
        "kind": "note",
    }
    backend = _RecordingBackend()
    guarded_send(payload, backend, schema_kind="event")
    assert len(backend.calls) == 1


def test_schema_kind_guard_rejects_an_invalid_payload():
    payload = {
        "schema_version": "xtrm-research-event/v1",
        "seq": "bad",
        "ts": "x",
        "kind": "n",
    }
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, schema_kind="event")
    assert exc_info.value.guard == "schema"
    assert backend.calls == []


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


# ---- G5: guard versions fold in guard-function source, not just patterns --


def test_mask_version_changes_when_mask_body_is_monkeypatched(monkeypatch):
    before = guards_module.mask_version()

    def _different_mask(text, known_ids):  # pragma: no cover - never called
        return text

    monkeypatch.setattr(guards_module, "mask", _different_mask)
    after = guards_module.mask_version()
    assert before != after


def test_redaction_version_changes_when_redact_body_is_monkeypatched(monkeypatch):
    before = guards_module.redaction_version()

    def _different_redact(text):  # pragma: no cover - never called
        return text

    monkeypatch.setattr(guards_module, "redact", _different_redact)
    after = guards_module.redaction_version()
    assert before != after


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


# ---- D4: guard_versions() threaded through build_manifest ----------------


def test_guard_versions_integrate_with_build_manifest(registry):
    manifest = make_manifest(registry)  # tests/helpers.py now calls guard_versions()
    assert manifest["guards"] == guard_versions()
    validate("manifest", manifest)  # does not raise


# ---- no real credential values ever land in the committed package -------


def test_no_real_credential_literals_anywhere_in_package_or_tests():
    """Grep-equivalent, walking the whole package and test tree: no
    hex/AKIA-shaped literal appears hardcoded anywhere. Every credential
    used above is generated at runtime."""
    suspicious = re.compile(r"(?:AKIA|ASIA)[A-Z0-9]{16}|\b[A-Fa-f0-9]{32}\b")
    for root in (PACKAGE_ROOT, TESTS_ROOT):
        for path in root.rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            assert not suspicious.search(text), (
                f"credential-shaped literal found in {path}"
            )
