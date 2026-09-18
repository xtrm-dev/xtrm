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
import time
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
    RedactionAbortError,
    cache_key,
    check_mask,
    check_redaction,
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

# ---- J4: the contract's real acceptance check — kept first in the file ---
#
# Five rounds of adding redaction rules produced two failure modes: rules
# that corrupt ordinary state, and a per-field loss check that aborts on
# ordinary state. Every earlier test in this file targeted one narrow
# shape; neither of these two did, which is why they're first, not one
# more case among many.

#: A realistic board-text-shaped payload: ordinary URLs, ids and metrics
#: this package (or a workload built on it) writes into its own state.
#: None of it is credential-shaped by any rule in guards.py.
ORDINARY_BOARD_CORPUS: dict[str, str] = {
    "pr_link": "see https://github.com/jaggerxtrm/xtrm/pull/216",
    "jira_link": "see https://mercuryintel.atlassian.net/browse/XTRM-99",
    "model": "model: claude-opus-5-20260101",
    "otel_semconv_ref": "otel_semconv_ref=gen_ai/v1.28",
    "run_id": "run_id=jev-dupes-2026-09-17",
    "ref": "ref=XTRM-428-guard-stage",
    "path": "path=/home/user/file2.txt",
    "version": "version=1.2.3-alpha.4",
    "commit": "commit sha: a3f9c21",
    "p99": "p99=250ms",
    # K4: bare weak-keyword headings followed by ordinary prose — the
    # exact shape Q1 found the unqualified J1 keyword list destroying.
    "access_heading": "Access: the team needs access to staging before Friday",
    "session_heading": "Session: users stay logged in for 30 minutes",
    "account_heading": "Account: the team lead approved this request",
    "private_heading": "Private: this channel is for the on-call rotation",
    "signature_heading": "Signature: the release notes are signed off",
    "salt_heading": "Salt: season the dataset before the next training run",
    "auth_heading": "Auth: the login flow was refactored last sprint",
    # K8: real first words, not shortened to stay under the old 4-char
    # floor — the corpus should prove the capitalization fix, not avoid
    # exercising it.
    "key_heading": "Key: correct usage is documented in the glossary",
    "token_heading": "Token: economy games use these as a scoring unit",
    "accounts_count": "accounts=3",
    "session_sentence": "the session ran for two hours without incident",
}


def test_ordinary_board_corpus_sends_byte_identical():
    """J4: guarded_send must return this corpus unchanged, field for
    field — the contract's real acceptance check for "does not corrupt
    ordinary state", not a single narrow probe."""
    backend = _RecordingBackend()
    guarded_send(dict(ORDINARY_BOARD_CORPUS), backend)
    assert backend.calls[0] == ORDINARY_BOARD_CORPUS


def _credential_shape_corpus() -> dict[str, str]:
    """The mirror of ORDINARY_BOARD_CORPUS: one field per recognized
    credential shape, generated at call time so nothing here is a
    hardcoded literal. Built lazily (a function, not a module-level
    dict) since it depends on the fixture helpers defined below."""
    return {
        "akia": _fake_akia_key(),
        "hex": _fake_hex_secret(),
        "ghp": _fake_ghp_token(),
        "github_pat": _fake_github_pat(),
        "slack": _fake_slack_token(),
        "stripe": _fake_stripe_key(),
        "google": _fake_google_api_key(),
        "npm": _fake_npm_token(),
        "gitlab": _fake_gitlab_pat(),
        "jwt": _fake_jwt(),
        "url_cred": _fake_url_credential()[0],
        "auth_header": _fake_auth_header(),
        "pem": _fake_pem(),
        "name_matched_assignment": f"password={secrets.token_hex(8)}",
    }


def test_credential_shape_corpus_is_fully_redacted():
    """J4's mirror: every recognized credential shape, each embedded in
    a short realistic sentence (the way a credential actually turns up
    in board text — not fourteen bare secrets with nothing else, which
    would itself look like an over-redacted payload to the aggregate
    loss check), is redacted — the contract's real acceptance check for
    "does catch every credential shape this package claims to catch"."""
    corpus = _credential_shape_corpus()
    payload = {
        field: f"the deploy log recorded this value during rollout: {value}"
        for field, value in corpus.items()
    }
    backend = _RecordingBackend()
    guarded_send(payload, backend)
    sent = json.dumps(backend.calls[0])
    for field, value in corpus.items():
        assert value not in sent, f"{field} leaked unredacted"


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

# H10: a dedicated corpus under MASK_MIN_WORD_COUNT_FOR_RATIO (20), so
# the short-field path (not the ratio path OVER_BROAD_TEXT always takes)
# is what a test using this fixture actually exercises.
SUB_FLOOR_TEXT = "alpha beta gamma delta epsilon zeta eta theta iota kappa"
SUB_FLOOR_KNOWN_IDS = frozenset(
    {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"}
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
    "os",
    "urllib3",
    "pycurl",
    "websockets",
    "grpc",
    "smtplib",
    "paramiko",
    "litellm",
    "ollama",
    "cohere",
    "google",
    "typesafe_sdk",
}
#: guards.py and transports.py are the only modules allowed to import a
#: transport: guards.py is the send seam, transports.py holds the concrete
#: provider SDK call. Matched on the path *relative to the package root*
#: (H16): a hypothetical backends/guards.py must not inherit this
#: allowlisting just because it shares a basename with the real, top-level
#: guards.py.
_TRANSPORT_IMPORT_ALLOWLIST = {"guards.py", "transports.py"}
#: Exact relative paths only — never a directory prefix or a glob — so
#: a new file cannot join this list by accident (e.g. a XTRM-427
#: backend module living elsewhere in the package). Each entry:
#:   code_state.py  — git plumbing (subprocess.run(["git", ...])) for
#:                     the code state's commit/dirty hash.
#:   environment.py — subprocess.run([node, "--version"]) for Node
#:                     version detection.
#: Both are pre-existing, reviewed, argument-list (never shell=True)
#: calls, out of scope for this issue to touch. A new entry needs the
#: same review before being added — this list does not grow quietly.
_SUBPROCESS_EXEMPT = {"code_state.py", "environment.py"}
#: pre-existing, out-of-scope os users: runner.py/store.py use os.open,
#: os.replace, os.close, os.unlink for the run-directory write path (out
#: of scope for this issue to touch — see runner.py's own docstring on
#: immutability/locking) — not a remote-send path.
_OS_EXEMPT = {"runner.py", "store.py"}


def _top_level_module(name: str | None) -> str:
    return (name or "").split(".")[0]


def _is_callable_annotation(annotation: ast.expr | None) -> bool:
    return annotation is not None and "Callable" in ast.dump(annotation)


def _relative_identity(path: Path) -> str:
    """The string a real file is matched against the allowlists with: its
    path relative to the package root when it has one, or itself
    unchanged for a synthetic (already relative-shaped) test path."""
    try:
        return str(path.relative_to(PACKAGE_ROOT))
    except ValueError:
        return str(path)


#: J7: the import-level exemptions for code_state.py/environment.py
#: (subprocess) and runner.py/store.py (os) only cover *importing* the
#: module — they say nothing about what an already-imported os or
#: subprocess is then used for. A dangerous os.system/popen/exec*/
#: spawn* call is flagged regardless of the os import exemption,
#: everywhere except guards.py — runner.py/store.py use only os.open/
#: os.replace/os.close/os.unlink today, none of them dangerous, so this
#: has no effect on the current tree and a future os.popen("curl ...")
#: added to either file still fails the scan, exactly per J7's example.
#:
#: subprocess.* is narrower: code_state.py and environment.py each
#: already call ``subprocess.run(...)`` (git plumbing for the code
#: state's commit/dirty hash; ``node --version`` detection) — pre-
#: existing, reviewed, argument-list (never ``shell=True``) calls, out
#: of scope for this issue to touch. Flagging subprocess.* unexempted
#: there would fail on today's tree, not just a future bypass, so those
#: two files keep the same call-site exemption as their import
#: exemption. Every other file, including one that newly imports
#: subprocess through neither exemption, is unexempted.
_OS_DANGEROUS_ATTRS = frozenset({"system", "popen"})
_OS_DANGEROUS_PREFIXES = ("exec", "spawn")


def _is_dangerous_os_or_subprocess_call(func: ast.expr, identity: str) -> bool:
    if not isinstance(func, ast.Attribute) or not isinstance(func.value, ast.Name):
        return False
    if func.value.id == "subprocess":
        return identity not in _SUBPROCESS_EXEMPT
    if func.value.id == "os":
        return func.attr in _OS_DANGEROUS_ATTRS or func.attr.startswith(
            _OS_DANGEROUS_PREFIXES
        )
    return False


def _scan_module(path: Path, source: str) -> tuple[list, list, list, list, list, list]:
    """Walk one module's AST for remote-seam violations. Shared by the
    structural test (real package files) and the bypass-detection tests
    below (synthetic snippets with a decoy path)."""
    identity = _relative_identity(path)
    tree = ast.parse(source, filename=str(path))
    send_taking: list[tuple[str, str]] = []
    callable_params: list[tuple[str, str, str]] = []
    unannotated_params: list[tuple[str, str, str]] = []
    transport_imports: list[tuple[str, str]] = []
    dynamic_imports: list[tuple[str, int]] = []
    dangerous_calls: list[tuple[str, int]] = []

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
                if identity in _TRANSPORT_IMPORT_ALLOWLIST:
                    continue
                if name == "subprocess" and identity in _SUBPROCESS_EXEMPT:
                    continue
                if name == "os" and identity in _OS_EXEMPT:
                    continue
                transport_imports.append((identity, name))
        if isinstance(node, ast.Call):
            func = node.func
            is_import_module = (
                isinstance(func, ast.Attribute) and func.attr == "import_module"
            ) or (isinstance(func, ast.Name) and func.id == "import_module")
            is_dunder_import = isinstance(func, ast.Name) and func.id == "__import__"
            if is_import_module or is_dunder_import:
                dynamic_imports.append((identity, node.lineno))
            if (
                identity not in _TRANSPORT_IMPORT_ALLOWLIST
                and _is_dangerous_os_or_subprocess_call(func, identity)
            ):
                dangerous_calls.append((identity, node.lineno))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            positional_and_keyword = (
                *node.args.posonlyargs,
                *node.args.args,
                *node.args.kwonlyargs,
            )
            arg_names = {a.arg for a in positional_and_keyword}
            if "send" in arg_names:
                send_taking.append((identity, node.name))
                continue
            variadic_args = list(positional_and_keyword)
            if node.args.vararg is not None:
                variadic_args.append(node.args.vararg)
            if node.args.kwarg is not None:
                variadic_args.append(node.args.kwarg)
            # Callable-annotation check covers private helpers too (H9):
            # a transport smuggled through a helper is just as much a
            # bypass as one through a public function.
            for a in variadic_args:
                if _is_callable_annotation(a.annotation):
                    callable_params.append((identity, node.name, a.arg))
            # Unannotated-parameter check is scoped to public functions:
            # an argument with no annotation at all could be smuggling a
            # callable without even declaring it, evading the check
            # above by omission rather than by a wrong annotation.
            if not node.name.startswith("_"):
                non_self = [
                    a for a in positional_and_keyword if a.arg not in ("self", "cls")
                ]
                for a in non_self:
                    if a.annotation is None:
                        unannotated_params.append((identity, node.name, a.arg))

    return (
        send_taking,
        callable_params,
        unannotated_params,
        transport_imports,
        dynamic_imports,
        dangerous_calls,
    )


def test_guarded_send_is_the_only_remote_seam():
    """No module other than guards.py performs or exposes a remote call:
    guarded_send/send_through_run are the only exported functions
    anywhere in the package taking a ``send`` parameter, no function
    (public or private) takes a Callable-annotated parameter under any
    other name, no public function takes an unannotated parameter, no
    module imports a transport library, nothing dynamically imports one
    (including a bare ``__import__`` call), and no os/subprocess
    dangerous-call site (system/popen/exec*/spawn*/subprocess.*) exists
    outside guards.py, regardless of the import-level exemptions (J7)."""
    send_taking: list = []
    callable_params: list = []
    unannotated_params: list = []
    transport_imports: list = []
    dynamic_imports: list = []
    dangerous_calls: list = []

    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        s, c, u, t, d, x = _scan_module(path, path.read_text(encoding="utf-8"))
        send_taking += s
        callable_params += c
        unannotated_params += u
        transport_imports += t
        dynamic_imports += d
        dangerous_calls += x

    assert transport_imports == []
    assert dynamic_imports == []
    assert callable_params == []
    assert unannotated_params == []
    assert dangerous_calls == []
    assert send_taking == [
        ("guards.py", "guarded_send"),
        ("guards.py", "send_through_run"),
    ]


@pytest.mark.parametrize(
    "source",
    [
        "def push(transport: Callable[[dict], Any]) -> None:\n    pass\n",
        "def push(client: Callable) -> None:\n    pass\n",
    ],
)
def test_scan_detects_callable_annotated_parameter_regardless_of_name(source):
    _send, callable_params, _u, _t, _d, _x = _scan_module(Path("decoy.py"), source)
    assert callable_params == [
        ("decoy.py", "push", "transport" if "transport" in source else "client")
    ]


def test_scan_detects_callable_annotated_parameter_in_a_private_helper():
    """H9: the Callable-annotation check covers private helpers too, not
    just public functions."""
    source = "def _push(transport: Callable) -> None:\n    pass\n"
    _send, callable_params, *_ = _scan_module(Path("decoy.py"), source)
    assert callable_params == [("decoy.py", "_push", "transport")]


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


def test_scan_detects_unannotated_parameter_in_a_public_function():
    """H9: an argument with no annotation at all could smuggle a
    callable by omission, evading the Callable-annotation check."""
    _s, _c, unannotated, *_ = _scan_module(
        Path("decoy.py"), "def push(payload, transport):\n    pass\n"
    )
    assert ("decoy.py", "push", "transport") in unannotated


def test_scan_ignores_self_and_cls_for_unannotated_parameter_check():
    _s, _c, unannotated, *_ = _scan_module(
        Path("decoy.py"),
        "class C:\n    def push(self, transport: Callable) -> None:\n        pass\n",
    )
    assert unannotated == []


def test_scan_does_not_flag_unannotated_parameters_in_private_helpers():
    """The unannotated-parameter check is scoped to public functions
    (H9's own wording); private-helper coverage for a bypass attempt is
    the Callable-annotation check above, which does cover them."""
    _s, _c, unannotated, *_ = _scan_module(
        Path("decoy.py"), "def _push(payload, transport):\n    pass\n"
    )
    assert unannotated == []


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
        "import os\n",
        "import urllib3\n",
        "import pycurl\n",
        "import websockets\n",
        "import grpc\n",
        "import smtplib\n",
        "import paramiko\n",
        "import litellm\n",
        "import ollama\n",
        "import cohere\n",
        "import google\n",
    ],
)
def test_scan_detects_transport_module_imports(source):
    _s, _c, _u, transport_imports, _d, _x = _scan_module(Path("decoy.py"), source)
    assert len(transport_imports) == 1


@pytest.mark.parametrize(
    "source",
    [
        "import importlib\nimportlib.import_module('requests')\n",
        "__import__('requests')\n",
    ],
)
def test_scan_detects_dynamic_import_calls(source):
    _s, _c, _u, _t, dynamic_imports, _x = _scan_module(Path("decoy.py"), source)
    assert len(dynamic_imports) == 1


def test_scan_allows_guards_py_to_import_a_transport():
    _s, _c, _u, transport_imports, _d, _x = _scan_module(
        Path("guards.py"), "import socket\n"
    )
    assert transport_imports == []


def test_scan_exempts_code_state_and_environment_subprocess_imports():
    for filename in ("code_state.py", "environment.py"):
        _s, _c, _u, transport_imports, _d, _x = _scan_module(
            Path(filename), "import subprocess\n"
        )
        assert transport_imports == [], filename


def test_scan_exempts_runner_and_store_os_imports():
    for filename in ("runner.py", "store.py"):
        _s, _c, _u, transport_imports, _d, _x = _scan_module(
            Path(filename), "import os\n"
        )
        assert transport_imports == [], filename


def test_scan_allowlist_matches_relative_path_not_basename():
    """H16: a *different* file that happens to share guards.py's
    basename (e.g. a hypothetical backends/guards.py) must not inherit
    the top-level guards.py's transport-import allowlisting."""
    nested = Path("backends") / "guards.py"
    _s, _c, _u, transport_imports, _d, _x = _scan_module(nested, "import socket\n")
    assert len(transport_imports) == 1


# ---- J7: a dangerous os/subprocess call is flagged regardless of the ----
# ---- import-level exemption ---------------------------------------------


@pytest.mark.parametrize(
    "source",
    [
        "os.system('curl http://example.com')\n",
        "os.popen('curl http://example.com')\n",
        "os.execv('/bin/sh', ['/bin/sh'])\n",
        "os.execvpe('sh', ['sh'], {})\n",
        "os.spawnv(0, '/bin/sh', ['/bin/sh'])\n",
        "os.spawnlp(0, 'sh', 'sh')\n",
        "subprocess.run(['curl', 'http://example.com'])\n",
        "subprocess.Popen(['curl'])\n",
        "subprocess.call(['curl'])\n",
        "subprocess.check_output(['curl'])\n",
    ],
)
def test_scan_detects_dangerous_os_or_subprocess_call(source):
    _s, _c, _u, _t, _d, dangerous_calls = _scan_module(Path("decoy.py"), source)
    assert len(dangerous_calls) == 1


def test_scan_allows_guards_py_a_dangerous_call():
    _s, _c, _u, _t, _d, dangerous_calls = _scan_module(
        Path("guards.py"), "os.system('x')\n"
    )
    assert dangerous_calls == []


def test_scan_flags_os_popen_in_runner_despite_the_os_import_exemption():
    """J7's own example: runner.py is exempted from the *import*-level
    os check (it needs os.open/os.replace/...), but a dangerous call
    there must still fail the scan."""
    _s, _c, _u, _t, _d, dangerous_calls = _scan_module(
        Path("runner.py"), "os.popen('curl http://example.com')\n"
    )
    assert len(dangerous_calls) == 1


def test_scan_exempts_the_existing_subprocess_run_calls_in_code_state_and_environment():
    """code_state.py and environment.py each already call
    subprocess.run(...) for git plumbing and node --version detection —
    pre-existing, reviewed, non-shell calls out of scope for this issue.
    Flagging them unexempted would fail on today's tree, not just a
    future bypass, so these two keep the same exemption as their import
    check (unlike the os check above, which has no such carve-out)."""
    for filename in ("code_state.py", "environment.py"):
        _s, _c, _u, _t, _d, dangerous_calls = _scan_module(
            Path(filename), "subprocess.run(['git', 'status'])\n"
        )
        assert dangerous_calls == [], filename


def test_scan_does_not_exempt_a_new_subprocess_call_in_an_unrelated_file():
    _s, _c, _u, _t, _d, dangerous_calls = _scan_module(
        Path("definitions.py"), "subprocess.run(['curl'])\n"
    )
    assert len(dangerous_calls) == 1


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


# ---- J6: PEM banner is case-insensitive and tolerates 4+ dashes ---------


def test_redact_masks_a_lowercase_pem_banner():
    body = "\n".join(secrets.token_hex(30) for _ in range(3))
    pem = f"-----begin private key-----\n{body}\n-----end private key-----"
    redacted = redact(pem)
    assert "begin" not in redacted
    assert "end" not in redacted
    for line in body.splitlines():
        assert line not in redacted


def test_redact_masks_a_four_dash_pem_banner():
    body = "\n".join(secrets.token_hex(30) for _ in range(3))
    pem = f"----BEGIN PRIVATE KEY----\n{body}\n----END PRIVATE KEY----"
    redacted = redact(pem)
    assert "BEGIN" not in redacted
    assert "END" not in redacted
    for line in body.splitlines():
        assert line not in redacted


# ---- H8/H14/J1: credential shapes the original patterns missed -----------


def test_redact_catches_the_mmd_585_shape_by_extended_keyword():
    """J1: the MMD-585 shape (R2_ACCOUNT=...) is caught because ACCOUNT
    is now one of SECRET_ASSIGN's recognized keywords — not by a
    name-agnostic heuristic, which J1 deleted after it redacted ordinary
    URLs, model ids and version strings (round 5 probes)."""
    text = "R2_ACCOUNT=abc123def456"
    redacted = redact(text)
    assert "abc123def456" not in redacted
    assert "<redacted>" in redacted


@pytest.mark.parametrize(
    "keyword",
    ["ACCESS", "AUTH", "PRIVATE", "SIGNATURE", "SALT", "PASSPHRASE", "SESSION"],
)
def test_redact_catches_each_new_j1_keyword_in_a_compound_name(keyword):
    """K1: the weak keywords only count in a compound name (containing
    ``_`` or ``-``) — a bare, single-word name is prose, not a
    credential field name."""
    text = f"x_{keyword.lower()}=abcdefgh12345678"
    redacted = redact(text)
    assert "abcdefgh12345678" not in redacted


@pytest.mark.parametrize(
    "keyword",
    ["ACCESS", "AUTH", "PRIVATE", "SIGNATURE", "SALT", "PASSPHRASE", "SESSION"],
)
def test_redact_does_not_catch_a_bare_weak_keyword_heading(keyword):
    """K1 regression: a bare (non-compound) weak-keyword heading
    followed by ordinary prose must survive untouched."""
    text = (
        f"{keyword.title()}: the team needs {keyword.lower()} to staging before Friday"
    )
    assert redact(text) == text


def test_redact_does_not_catch_a_credential_under_a_truly_unrecognized_name():
    """J1's accepted residual gap, stated in SECRET_ASSIGN's own
    docstring: a credential assigned to a name with no recognizable
    keyword is not caught by the assignment rules. This is the
    deliberate trade for not reintroducing a name-agnostic rule."""
    text = "R2_INSTANCE=abc123def456opaque"
    assert redact(text) == text


def test_redact_assignment_rule_refuses_a_url_shaped_value():
    """J1: a *weak*-keyword assignment must never swallow a URL —
    that's SECRET_URL_CRED's job. A name that happens to match a weak
    keyword (AUTH, compound) with a URL value stays untouched by
    SECRET_ASSIGN; the URL rule only fires when the URL itself carries
    credentials."""
    text = "auth_endpoint=https://example.com/oauth/token"
    assert redact(text) == text


def test_k7_url_value_with_embedded_url_credential_is_caught():
    """K7 (supersedes K3): a Sentry-DSN-style URL credential embedded in
    an assignment value is caught, whichever keyword tier matched —
    handed to SECRET_URL_CRED rather than blanket-redacted or refused."""
    password = secrets.token_hex(8)
    text = f"dsn=https://user:{password}@sentry.example.com/1"
    redacted = redact(text)
    assert password not in redacted
    assert "sentry.example.com" in redacted  # only the credential is redacted


def test_k7_url_value_with_embedded_bare_token_is_caught():
    token = "ghp_" + "".join(
        secrets.choice(string.ascii_letters + string.digits) for _ in range(36)
    )
    text = f"api_key=https://x.com/tok/{token}"
    redacted = redact(text)
    assert token not in redacted
    assert "https://x.com/tok/" in redacted  # only the token is redacted


def test_k7_url_value_with_no_embedded_credential_is_left_alone():
    """The property K7 explicitly preserves: a value that merely
    mentions an ordinary link, with nothing SECRET_URL_CRED or
    SECRET_BARE would itself catch, is unaffected — regardless of
    keyword tier."""
    text = "api_key=https://x.com/tok/abc123def456"
    assert redact(text) == text


def test_k7_quoted_multi_word_value_merely_mentioning_a_link_is_unaffected():
    text = 'PASSWORD = "see https://example.com for details"'
    assert redact(text) == text


def test_redact_catches_creds_abbreviation():
    text = 'MY_CREDS="abcdefghijk"'
    redacted = redact(text)
    assert "abcdefghijk" not in redacted


def test_redact_catches_short_password_under_old_eight_char_floor():
    text = "password=hunter2"
    redacted = redact(text)
    assert "hunter2" not in redacted


def test_redact_catches_quoted_multi_word_password_value():
    text = 'PASSWORD = "correct horse battery staple"'
    redacted = redact(text)
    assert "correct horse battery staple" not in redacted


def test_redact_withdraws_unquoted_multi_word_value_acceptance():
    """K1 withdraws H8's unquoted-multi-word acceptance: an unquoted
    value may not contain whitespace. Only the first word-shaped token
    after the separator is ever eligible for the unquoted alternative,
    and a short (<4 char) first word means no match at all."""
    text = "key: my opaque secret phrase"
    redacted = redact(text)
    # "my" is under the 4-character floor, so the unquoted alternative
    # never matches at all here — the whole line survives untouched.
    assert redacted == text


def test_k1_probe_strong_keyword_prose_with_short_first_word_survives():
    """K1 item 3: "a line beginning Key: or Token: followed by prose
    must survive." This one does: the first word after the separator
    ("the") is under the 4-char floor, so nothing in the unquoted
    alternative matches and the whole sentence is left alone."""
    text = "Key: the team needs access to staging before Friday"
    assert redact(text) == text
    text = "Token: the team needs access to staging before Friday"
    assert redact(text) == text


def test_k8_strong_keyword_sentence_case_prose_survives_even_with_a_long_first_word():
    """K8 closes the K1-item-3 residual: a sentence-case heading
    ("Token:", not "token:"/"TOKEN:"/a compound name) is never treated
    as a configuration key, regardless of the first word's length. This
    used to redact just "correct" ("Token: <redacted> horse battery
    staple") before K8's capitalization discriminator."""
    text = "Token: correct horse battery staple"
    assert redact(text) == text


@pytest.mark.parametrize(
    "text,expect_redacted",
    [
        ("Token: correct horse battery staple", False),
        ("Key: the main insight", False),
        ("token: abc123def456", True),
        ("TOKEN=abc123def456", True),
        ("password=hunter2", True),
        ("Password=hunter2", False),  # accepted cost: sentence case, not compound
    ],
)
def test_k8_strong_keyword_capitalization_discriminator(text, expect_redacted):
    """K8's exact required outcomes: a configuration key is lowercase,
    uppercase or compound; a prose heading is sentence case."""
    redacted = redact(text)
    assert (redacted != text) == expect_redacted, redacted


def test_redact_catches_redis_style_empty_username_url_credential():
    """H14: the userinfo is optional (``*``, not ``+``) — Redis and
    Sentry DSNs commonly omit the username entirely."""
    password = secrets.token_hex(8)
    text = f"redis://:{password}@cache:6379"
    redacted = redact(text)
    assert password not in redacted


def test_redact_catches_bare_bearer_token_without_header_name():
    token = "sk-" + secrets.token_hex(10)
    text = f"the request used Bearer {token} for auth"
    redacted = redact(text)
    assert token not in redacted


def test_redact_catches_authorization_token_scheme():
    token = secrets.token_hex(10)
    text = f"Authorization: Token {token}"
    redacted = redact(text)
    assert token not in redacted


def test_redact_catches_xapp_prefixed_token():
    token = "xapp-" + secrets.token_hex(12)
    text = f"slack app token: {token}"
    redacted = redact(text)
    assert token not in redacted


# ---- H8: false-positive guard — ordinary prose and pairs are untouched --


@pytest.mark.parametrize(
    "text",
    [
        "name=John and type=video",
        "the password policy requires special characters",
        "count=42",
        "city=Springfield",
        "please review this ticket before merging",
        # H17/J1: a realistic false-positive sweep (deploy notes) — none
        # of these has a SECRET_ASSIGN keyword in its name, so none is
        # touched now that the name-agnostic rule is gone.
        "version=v2.3.1",
        "build=4821",
        "p99=250ms",
        "status=degraded",
        "host=web-02",
        "python3.13",
        "commit=a3f9c21",
        # J4-adjacent: this package's own manifest-shaped fields.
        "otel_semconv_ref=gen_ai/v1.28",
        "run_id=jev-dupes-2026-09-17",
    ],
)
def test_redact_does_not_touch_ordinary_prose_or_plain_pairs(text):
    assert redact(text) == text


# ---- H13: SECRET_URL_CRED must not catastrophically backtrack -----------


def _redact_seconds(text: str) -> float:
    start = time.perf_counter()
    redact(text)
    return time.perf_counter() - start


def test_secret_url_cred_stays_fast_on_adversarial_input():
    """Every rule stays near-linear on adversarial input.

    XTRM-482: this used to assert an absolute wall-clock bound
    (``elapsed < 0.1``). That is calibrated to ~10ms while the defect it
    guards — the J6 ``-{4,}`` banner without K5's ``(?<!-)`` anchor —
    took about 17 SECONDS on the hyphen run. The bound was therefore
    three orders of magnitude tighter than the signature it detects, and
    on a shared CI runner it flaked: the same commit (607a5e6) passed one
    run and failed the next at 0.111s.

    So compare each adversarial input against a benign string of the
    SAME length, measured in the same process on the same run. A busy
    runner slows both and the ratio holds; catastrophic backtracking
    blows the ratio out by orders of magnitude. RATIO_CEILING of 50x
    leaves a wide margin over the ~1x a linear scan costs, and still
    fails the pre-K5 regex by a factor of thousands.
    """
    blob = base64.b64encode(secrets.token_bytes(15000)).decode()  # ~20KB
    adversarial = "ab-" * 7000
    # K5: a long hyphen run (a pasted table separator, diff banner or
    # horizontal rule) with no PEM banner in it — SECRET_PEM's -{4,}
    # banner let the engine attempt a match start at every position.
    hyphen_run = "-" * 40000
    ratio_ceiling = 50.0
    for candidate in (blob, adversarial, hyphen_run):
        # A same-length benign twin: the cost of scanning this many
        # characters with no rule matching and no backtracking.
        baseline = max(_redact_seconds("x" * len(candidate)), 1e-6)
        elapsed = _redact_seconds(candidate)
        assert elapsed < ratio_ceiling * baseline, (
            f"redact took {elapsed:.3f}s on a {len(candidate)}-char input, "
            f"{elapsed / baseline:.1f}x its {baseline:.6f}s benign baseline "
            f"(ceiling {ratio_ceiling:.0f}x)"
        )


# ---- H12: PEM narrowing, and the missing redaction-loss check -----------


def test_pem_pattern_no_longer_matches_a_non_private_key_banner_pair():
    """H12 probe: the old ``[^-]+`` banner pattern matched *any* pair of
    banners, e.g. a CHANGELOG block, and destroyed the prose between
    them. The narrowed pattern only matches PRIVATE KEY banners, so
    ordinary release notes between a CHANGELOG banner pair are left
    completely intact."""
    prose = (
        "This release improves startup latency, fixes a race in the "
        "connection pool, and adds retry backoff for transient network "
        "errors across the client."
    ) * 3
    text = f"-----BEGIN CHANGELOG-----\n{prose}\n-----END CHANGELOG-----"
    assert redact(text) == text


def test_k6_terminated_pem_banner_stuffed_with_prose_now_sends():
    """K6 changes this from H12 part 2's original behavior, deliberately:
    a *terminated* PRIVATE KEY banner pair (BEGIN and END both present)
    is trusted as key material by construction — team-lead's decision is
    that a match this well-formed is, by definition, the key, and its
    span is exempt from the word count entirely, regardless of what is
    actually inside it. Prose stuffed inside a genuine banner pair (not
    a real key) is the accepted cost of that trust: it now sends,
    redacted to "<redacted>", rather than aborting. The unbounded
    variant right below (an *unterminated* banner) is not exempt and
    still catches exactly this shape."""
    prose = (
        "This release improves startup latency, fixes a race in the "
        "connection pool, and adds retry backoff for transient network "
        "errors across the client, and updates the dependency graph "
        "resolver to handle circular imports more gracefully."
    ) * 3
    text = f"-----BEGIN RSA PRIVATE KEY-----\n{prose}\n-----END RSA PRIVATE KEY-----"
    backend = _RecordingBackend()
    guarded_send({"notes": text}, backend)
    assert backend.calls[0]["notes"] == "<redacted>"


# ---- K6: short-field total-loss trigger fires past an absolute count ----
# ---- even when the loss is attributed to an anchored rule ---------------


@pytest.mark.parametrize("word_count", [12, 15])
def test_k6_unterminated_pem_eating_a_short_sentence_now_aborts(word_count):
    """K6 regression (security audit probe): an unterminated PEM marker
    followed by a short sentence of ordinary prose used to send as
    exactly "<redacted>", no abort — PEM's attribution disarmed the
    short-field trigger regardless of how many real words it ate. The
    absolute-count trigger now fires past ~5 removed words regardless
    of attribution."""
    words = _distinct_alpha_words("word", word_count)
    text = f"-----BEGIN RSA PRIVATE KEY----- {' '.join(words)}"
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"notes": text}, backend)
    assert exc_info.value.guard == "redaction"
    assert backend.calls == []


def test_k6_short_field_absolute_threshold_boundary():
    """Below the threshold, attribution still protects a genuinely
    small loss (mirrors check_redaction's own short-field exemption for
    a field with only a couple of real words next to a credential)."""
    check_redaction(
        "alpha beta gamma delta",  # 4 words, well under the threshold
        "<redacted>",
        matched_rules=frozenset({"bare_credential_format"}),
    )  # does not raise


def test_minimal_pem_banner_alone_removes_six_plain_words():
    """Why SECRET_PEM's matched span is exempt from the word count
    entirely (K6), rather than merely raising the absolute threshold:
    even a bare banner with no algorithm name and no body
    (``BEGIN``/``PRIVATE``/``KEY`` x2) is 6 plain words by itself — at
    or above the ~5-word threshold before a single word of real key
    content or an algorithm name is added. No fixed threshold above 5
    could both stay tight enough to catch the K6 probe (an unterminated
    banner eating a short sentence) and stay loose enough to tolerate
    every real key's banner overhead plus its body's incidental
    letter-only runs — hence exempting the bounded span outright."""
    banner_only = "-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----"
    assert guards_module._PLAIN_WORD.findall(banner_only) == [
        "BEGIN",
        "PRIVATE",
        "KEY",
        "END",
        "PRIVATE",
        "KEY",
    ]


def test_a_real_pem_is_still_redacted_and_sent():
    """K6: resolved by exempting a *terminated* SECRET_PEM match's own
    span from the word count entirely — the banner and body are, by
    construction, exactly the key, never counted as lost prose."""
    body = base64.b64encode(secrets.token_bytes(600)).decode()
    lines = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    pem = f"-----BEGIN RSA PRIVATE KEY-----\n{lines}\n-----END RSA PRIVATE KEY-----"
    backend = _RecordingBackend()
    guarded_send({"key": pem}, backend)
    assert backend.calls[0]["key"] == "<redacted>"
    assert body not in json.dumps(backend.calls[0])


def test_unterminated_private_key_marker_is_redacted_to_end_of_field():
    body = base64.b64encode(secrets.token_bytes(300)).decode()
    text = f"-----BEGIN RSA PRIVATE KEY-----\n{body}"  # no END marker
    redacted = redact(text)
    assert body not in redacted
    assert "<redacted>" in redacted


def test_check_redaction_does_not_abort_a_short_bare_credential_field():
    """Unlike check_mask, a short field losing all of its (near-zero)
    plain-word content to redaction never aborts by itself — that is
    exactly what redaction legitimately does to a real credential."""
    check_redaction("AKIA" + "ABCDEFGHIJKLMNOP", "<redacted>")  # does not raise


def test_check_redaction_ratio_path_still_fires_on_a_large_prose_loss():
    prose = " ".join(_distinct_alpha_words("realword", 100))
    with pytest.raises(RedactionAbortError):
        check_redaction(prose, "<redacted>")  # 100 real words all gone -> abort


# ---- J3: short-field redaction loss is exempt only when attributable ----


def test_check_redaction_short_field_total_loss_exempt_when_attributable():
    """A short field (several words, not one token) that empties because
    an anchored rule matched is presumed a legitimate credential and
    does not abort."""
    original = "alpha beta gamma"  # 3 words: not a single-token exemption case
    check_redaction(
        original, "<issue>", matched_rules=frozenset({"bare_credential_format"})
    )  # does not raise


def test_check_redaction_short_field_total_loss_aborts_when_not_attributable():
    """The same total loss, with no rule attribution on record, aborts —
    text vanished without a recognized credential shape causing it."""
    original = "alpha beta gamma"
    with pytest.raises(RedactionAbortError):
        check_redaction(original, "", matched_rules=frozenset())


def test_redact_with_rules_reports_the_matched_rule_names():
    _text, matched, _baseline = guards_module._redact_with_rules(_fake_pem())
    assert "pem" in matched

    _text, matched, _baseline = guards_module._redact_with_rules(_fake_hex_secret())
    assert "bare_credential_format" in matched

    _text, matched, _baseline = guards_module._redact_with_rules(
        "ordinary prose, nothing here"
    )
    assert matched == frozenset()


def test_redact_with_rules_counting_baseline_exempts_a_terminated_pem_span():
    """K6: the counting baseline has a bounded SECRET_PEM match's own
    span removed entirely, so a real key's length is never counted as
    lost prose."""
    pem = _fake_pem()
    _text, _matched, baseline = guards_module._redact_with_rules(pem)
    assert baseline == ""


def test_redact_with_rules_counting_baseline_keeps_an_unterminated_pem_span():
    """The unbounded rule's span is left in the counting baseline —
    its words still count toward the removed total (K6)."""
    text = "-----BEGIN RSA PRIVATE KEY----- some words here"
    _text, _matched, baseline = guards_module._redact_with_rules(text)
    assert baseline == text


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


def test_type_policy_error_message_names_the_type_not_the_value():
    """H10: the fail-closed TypeError's message must be safe to log —
    it should name the offending type, and never contain the value that
    tripped it (here, the secret bytes themselves)."""
    secret_bytes = _fake_hex_secret().encode()
    with pytest.raises(TypeError) as exc_info:
        deep_mask({"blob": secret_bytes}, known_ids=frozenset())
    message = str(exc_info.value)
    assert "bytes" in message
    assert secret_bytes.decode() not in message
    assert repr(secret_bytes) not in message


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


# ---- H1: whole-payload aggregate check, alongside the per-field one -----

#: 18 plain words a known-id set will mask, none of which is by itself
#: >= MASK_MIN_WORD_COUNT_FOR_RATIO, so a single field never trips the
#: per-leaf rule (18 != 19 total once the field's own unique word is
#: added) — only the aggregate check across many such fields can catch
#: this (H1).
_H1_KNOWN_WORDS = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
    "iota",
    "kappa",
    "lambda",
    "muword",
    "nuword",
    "xiword",
    "omega",
    "sigma",
    "tauword",
    "upsilon",
]


def test_sub_floor_fixture_tolerates_partial_loss_at_guarded_send_level():
    """H10: using SUB_FLOOR_TEXT (10 words, well under the 20-word
    floor) end-to-end through guarded_send — 9 of 10 words masked, one
    survives, so the short-field path (not the ratio path) applies and
    tolerates the partial loss."""
    backend = _RecordingBackend()
    guarded_send({"a": SUB_FLOOR_TEXT}, backend, known_ids=SUB_FLOOR_KNOWN_IDS)
    assert len(backend.calls) == 1


def test_sub_floor_fixture_aborts_on_full_loss_at_guarded_send_level():
    all_known = SUB_FLOOR_KNOWN_IDS | {"kappa"}
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"a": SUB_FLOOR_TEXT}, backend, known_ids=all_known)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_single_19_word_field_stays_under_the_per_leaf_floor():
    """H10: a dedicated single-field, exactly-19-word fixture at the
    floor boundary (MASK_MIN_WORD_COUNT_FOR_RATIO is 20) — 18 of 19
    words masked, one field, per-leaf path only. This is the base case
    the 10-field aggregate test below builds on; kept separate so the
    floor boundary itself is tested in isolation."""
    known_ids = frozenset(_H1_KNOWN_WORDS)
    # a single-char key: doesn't itself match _PLAIN_WORD, so it can't
    # push the aggregate word count up to the floor by accident.
    payload = {"a": " ".join(_H1_KNOWN_WORDS + ["uniquewordx"])}
    backend = _RecordingBackend()
    guarded_send(
        payload, backend, known_ids=known_ids
    )  # under the floor: does not abort
    assert len(backend.calls) == 1


def test_aggregate_check_fires_when_many_short_fields_each_lose_just_under_the_floor():
    """H1 regression: 10 fields of 19 words each, 18 of 19 masked per
    field (180/190 payload words vanish). Each field alone stays under
    the per-leaf floor and survives its own check (1 word out of 19
    isn't "every word gone"), but the payload as a whole loses almost
    everything — exactly what the pre-G8 whole-corpus check existed to
    catch, and what SUCCESS 5 requires stays caught."""
    known_ids = frozenset(_H1_KNOWN_WORDS)
    letters = "abcdefghij"
    payload = {
        f"field_{n}": " ".join(_H1_KNOWN_WORDS + [f"uniqueword{letters[n]}"])
        for n in range(10)
    }
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_aggregate_check_does_not_fire_on_a_single_bare_credential_field():
    """A single field that is nothing but a credential must still send
    (the G14 case), even with the aggregate check re-added: an
    all-redacted field contributes zero real words to the aggregate."""
    secret = "AKIA" + "QRSTUVWXYZABCDEF"  # deterministic, letters-only suffix
    backend = _RecordingBackend()
    guarded_send({"a": secret}, backend)
    assert backend.calls[0]["a"] == "<redacted>"


# ---- J2: a single-token field never trips the per-leaf total-loss rule --


def test_j2_ref_field_that_is_exactly_a_known_id_sends():
    """J2 regression: {"ref": "XTRM-428", ...} — a field whose entire
    value is one known id — used to abort, because the per-leaf
    total-loss trigger didn't distinguish "one token" from "several
    known words filling the whole field" (G8)."""
    # body is large enough that losing the one "ref" word stays inside
    # the 2% mask-loss budget, so only the per-leaf single-token
    # exemption (not the aggregate ratio) is what's under test here.
    payload = {"ref": "XTRM-428", "body": " ".join(_distinct_alpha_words("word", 100))}
    backend = _RecordingBackend()
    guarded_send(payload, backend, known_ids=frozenset({"xtrm-428"}))
    assert len(backend.calls) == 1
    assert backend.calls[0]["ref"] == "<issue>"


def test_j2_dict_keyed_by_a_known_id_sends():
    """J2 regression: {"mmd-585": {...}} — the reference harness's own
    ``{r["id"]: r for r in rows}`` payload shape — used to abort because
    the dict key is itself a single known-id token."""
    payload = {
        "mmd-585": {"title": "an ordinary ticket title with several words in it"}
    }
    backend = _RecordingBackend()
    guarded_send(payload, backend, known_ids=frozenset({"mmd-585"}))
    assert len(backend.calls) == 1
    assert "<issue>" in backend.calls[0]


def test_j2_g8_one_big_field_case_still_aborts():
    """J2 must not weaken G8: a field that is *several* known words
    (not one token) still trips the per-leaf trigger."""
    filler = " ".join(f"filler{i} plain text content" for i in range(200))
    payload = {
        "background": filler,
        "critical_field": "alpha beta gamma delta epsilon zeta eta theta",
    }
    known_ids = frozenset(
        {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"}
    )
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_j2_ten_by_nineteen_field_dilution_case_still_aborts():
    """J2 must not weaken H1: the aggregate check still catches many
    single-token (or few-token) fields collectively diluting the whole
    payload."""
    known_ids = frozenset(_H1_KNOWN_WORDS)
    letters = "abcdefghij"
    payload = {
        f"field_{n}": " ".join(_H1_KNOWN_WORDS + [f"uniqueword{letters[n]}"])
        for n in range(10)
    }
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


# ---- XTRM-462: one real word among many opaque short tokens ------------


def _opaque_short_tokens(count: int) -> str:
    """``count`` whitespace-separated tokens each too short to match
    :data:`_PLAIN_WORD` (no 3+ letter run), so a field built from them
    contributes no plain words of its own."""
    return " ".join(f"q{i}" for i in range(count))


def test_xtrm_462_lone_real_word_among_opaque_tokens_aborts_on_mask_loss():
    """XTRM-462 regression: a field of many opaque short tokens plus one
    real English word is *not* a single-token field, so losing that word
    to an over-broad known-id match must trip the per-leaf trigger. Before
    the fix the plain-word count was 1 and the trigger's ``total > 1``
    guard exempted the field, silently destroying its only real word."""
    text = f"{_opaque_short_tokens(200)} realword"
    known_ids = frozenset({"realword"})
    with pytest.raises(MaskAbortError):
        check_mask(redact(text), guards_module._apply_id_mask(redact(text), known_ids))


def test_xtrm_462_lone_real_word_loss_aborts_end_to_end():
    """The same blind spot through the real send seam: no payload reaches
    the backend when its only real word is masked out of a multi-token
    field."""
    text = f"{_opaque_short_tokens(200)} realword"
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"note": text}, backend, known_ids=frozenset({"realword"}))
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_xtrm_462_genuine_single_token_field_still_exempt():
    """The narrow fix must not widen into the J2/G8 regressions: a field
    whose entire content *is* one id token is still exempt, and a
    multi-token field that keeps its one real word still sends."""
    check_mask("XTRM-428", "<issue>")  # single token: exempt
    check_mask("q0 realword", "<issue> realword")  # word survives: no loss


# ---- K2: single-token leaves excluded from the aggregate corpus, ---------
# ---- with a fallback so an all-single-token payload still aborts ---------


def test_k2_id_field_next_to_an_ordinary_body_sends():
    """K2 regression (team-lead's probe): a payload of one known-id
    field plus one ordinary body must not abort — the id field's full
    substitution must not count against the body's otherwise-clean
    ratio in aggregate."""
    body = " ".join(_distinct_alpha_words("word", 20))
    payload = {"ref": "XTRM-428", "body": body}
    backend = _RecordingBackend()
    guarded_send(payload, backend, known_ids=frozenset({"xtrm-428"}))
    assert len(backend.calls) == 1
    assert backend.calls[0]["ref"] == "<issue>"
    assert backend.calls[0]["body"] == body


def test_k2_payload_of_only_single_token_id_fields_still_aborts():
    """K2's fallback: a payload built *entirely* of single-token
    fields, each fully substituted (the seconder's Q4 shape — 20 fields
    each holding exactly one known id), must still abort in aggregate.
    Excluding single-token leaves would otherwise leave nothing to
    check against."""
    known_ids = _distinct_alpha_words("known", 20)
    payload = {f"field_{i}": known_ids[i] for i in range(20)}
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=frozenset(known_ids))
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_aggregate_check_still_lets_g8_one_big_field_case_abort():
    filler = " ".join(f"filler{i} plain text content" for i in range(200))
    payload = {
        "background": filler,
        "critical_field": "alpha beta gamma delta epsilon zeta eta theta",
    }
    known_ids = frozenset(
        {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"}
    )
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def test_historical_over_broad_regex_case_still_aborts_end_to_end():
    payload = {"title": OVER_BROAD_TEXT}
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send(payload, backend, known_ids=OVER_BROAD_KNOWN_IDS)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


# ---- H2: the word-count floor must be computed before token-stripping ---


def test_floor_is_computed_before_stripping_literal_replacement_tokens():
    """H2 regression: a field containing 40 literal ``<issue>`` tokens
    (copy-pasted example text, not tokens we injected) plus 15 real
    words, 14 of which get masked. Stripping tokens before computing the
    floor would undercount this as a 15-word (short) field and exempt it
    from the ratio check, letting 14/15 real words vanish silently."""
    real_words = [f"realword{chr(97 + i)}suffix" for i in range(15)]
    text = " ".join(["<issue>"] * 40 + real_words)
    known_ids = frozenset(real_words[:14])
    backend = _RecordingBackend()
    with pytest.raises(GuardFailure) as exc_info:
        guarded_send({"a": text}, backend, known_ids=known_ids)
    assert exc_info.value.guard == "mask"
    assert backend.calls == []


def _distinct_alpha_words(prefix: str, count: int) -> list[str]:
    """``count`` distinct all-alphabetic tokens (no digits, so they stay
    inside one _PLAIN_WORD-matchable run)."""
    alphabet = "abcdefghijklmnopqrstuvwxyz"
    words = []
    for i in range(count):
        suffix = alphabet[i // len(alphabet)] + alphabet[i % len(alphabet)]
        words.append(f"{prefix}{suffix}")
    return words


def test_floor_check_on_literal_tokens_still_allows_a_lightly_masked_large_field():
    """The same literal-``<issue>``-tokens field, but with 100 real words
    and only 1 masked (99% of the real content survives, within the 2%
    budget) — the floor correctly treats this as a large field, and the
    ratio itself is within budget, so it must still send."""
    real_words = _distinct_alpha_words("realword", 100)
    text = " ".join(["<issue>"] * 40 + real_words)
    known_ids = frozenset(real_words[:1])
    backend = _RecordingBackend()
    guarded_send({"a": text}, backend, known_ids=known_ids)
    assert len(backend.calls) == 1


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
        # H4: deep_mask traverses tuples and sets; label traversal must too.
        ("tuple_of_labels", {"labels": ("contract:ready", "area:research")}),
        ("set_of_labels", {"labels": {"contract:ready", "area:research"}}),
        (
            "tuple_of_dicts",
            {"labels": ({"name": "contract:ready"}, {"name": "area:research"})},
        ),
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


def test_label_functions_fail_closed_on_unsupported_type():
    rule = LabelExclusionRule()
    payload = {"labels": [{"blob": _fake_hex_secret().encode()}]}
    with pytest.raises(TypeError):
        strip_excluded_labels(payload, rule)
    with pytest.raises(TypeError):
        guards_module._has_excluded_label(payload, rule)


# ---- H5: a label field holding prose is never comma-joined --------------


def test_strip_label_string_preserves_prose_when_nothing_is_removed():
    prose = "a completely ordinary sentence with no excluded label in it"
    assert strip_excluded_labels({"labels": prose}, LabelExclusionRule()) == {
        "labels": prose
    }


def test_strip_label_string_preserves_prose_structure_around_a_removed_label():
    prose = "please review this before contract:ready is set on the ticket"
    stripped = strip_excluded_labels({"labels": prose}, LabelExclusionRule())
    result = stripped["labels"]
    assert "contract:ready" not in result
    # H5: not comma-joined ("please, review, this, ...") — ordinary
    # spacing is preserved around the removed token.
    assert "," not in result
    assert "please review this before" in result
    assert "is set on the ticket" in result


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


# ---- H3: a send-phase failure is never mislabeled a guard failure -------


def test_send_through_run_records_send_error_not_guard_failure_on_backend_error(
    registry, runs_root
):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)

    class _FailingBackend:
        def __call__(self, payload):
            raise ConnectionError("upstream refused the connection")

    backend = _FailingBackend()
    with pytest.raises(ConnectionError, match="upstream refused"):
        send_through_run(handle, 0, {"title": "ordinary text"}, backend)

    events = list(read_lines(events_path(runs_root, manifest["run_id"])))
    assert len(events) == 1
    assert events[0]["kind"] == "send_error"
    assert events[0]["kind"] != "guard_failure"
    status = load_status(runs_root, manifest["run_id"])
    assert status["state"] == "error"  # not "invalid" — the guards did not reject this


def test_send_through_run_still_records_guard_failure_with_zero_backend_calls(
    registry, runs_root
):
    """Unaffected by the H3 split: a real guard rejection is still a
    guard_failure with the backend never called."""
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    backend = _RecordingBackend()

    with pytest.raises(GuardFailure):
        send_through_run(
            handle,
            0,
            {"title": OVER_BROAD_TEXT},
            backend,
            known_ids=OVER_BROAD_KNOWN_IDS,
        )

    assert backend.calls == []
    events = list(read_lines(events_path(runs_root, manifest["run_id"])))
    assert events[0]["kind"] == "guard_failure"
    status = load_status(runs_root, manifest["run_id"])
    assert status["state"] == "invalid"


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


# ---- H6: cache_key must include known_ids -----------------------------


def test_cache_key_changes_with_known_ids():
    payload = {"title": "same request"}
    guards = {"mask_version": "v1", "redaction_version": "v1"}
    key_a = cache_key(payload, guards, known_ids=frozenset({"xtrm-428"}))
    key_b = cache_key(payload, guards, known_ids=frozenset({"xtrm-432"}))
    assert key_a != key_b


def test_cache_key_known_ids_independent_of_set_ordering():
    payload = {"title": "same request"}
    guards = {"mask_version": "v1", "redaction_version": "v1"}
    key_a = cache_key(payload, guards, known_ids=frozenset({"a", "b", "c"}))
    key_b = cache_key(payload, guards, known_ids=frozenset({"c", "b", "a"}))
    assert key_a == key_b


def test_cache_key_defaults_known_ids_to_empty():
    payload = {"title": "same request"}
    guards = {"mask_version": "v1", "redaction_version": "v1"}
    assert cache_key(payload, guards) == cache_key(
        payload, guards, known_ids=frozenset()
    )


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
