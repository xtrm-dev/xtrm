"""Jev/TypeSafe backend tests (XTRM-483).

No test here touches the network. Every call goes through a
recorded-response double installed in ``xtrm_research.transports``, so the
suite passes with ``typesafe-sdk`` absent — which is how CI runs. The live
smoke call is a documented local command (README), not a test.
"""

from __future__ import annotations

import ast
import copy
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

import xtrm_research
import xtrm_research.transports as transports_module
from xtrm_research.hashing import compute_content_hash
from xtrm_research.jev import DEFAULT_MODEL, TRANSPORT, JevBackend
from xtrm_research.jsonl import read_lines
from xtrm_research.runner import start_run
from xtrm_research.schemas import _registry, validate
from xtrm_research.store import events_path
from xtrm_research.system_one import SystemOneBackend, UnsupportedQuestionTypeError

from .helpers import make_manifest

PACKAGE_ROOT = Path(xtrm_research.__file__).parent
RUN_ID = "run-jev"

# ---- question specs and a synthetic state ---------------------------------


def _spec(question_id: str, question_type: str, **fields: Any) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "id": question_id,
        "version": "v1",
        "type": question_type,
        **fields,
    }
    spec["content_hash"] = compute_content_hash(spec)
    return spec


NOUL = _spec(
    "board-duplicates.redundant",
    "noul",
    instructions="Completing one ticket would make the other unnecessary.",
)
CHOICE = _spec(
    "board-duplicates.relation",
    "choice",
    instructions="What is the relationship between the two tickets?",
    criteria={
        "same_work": "Both ask for the same change.",
        "one_covers_other": "One fully includes the other's work.",
        "related_distinct": "Same area, separate work.",
        "unrelated": "Different areas.",
    },
    options=["same_work", "one_covers_other", "related_distinct", "unrelated"],
)
SCORE = _spec(
    "contract-quality.completeness",
    "score",
    instructions="How completely does the ticket state its success criteria?",
    criteria=["Missing.", "Partial.", "Complete."],
    legend={"1": "missing", "2": "partial", "3": "complete"},
)

STATE = {
    "issue_a": {"title": "Fix the settle lock race"},
    "issue_b": {"title": "Fix the settle lock race"},
}

#: A recorded TypeSafe ``system_one`` response, already flattened to the
#: transport's neutral shape. The Choice answer selects ``unrelated`` — the
#: *last* option — so the adapter could not pass by reading the option list
#: positionally.
RECORDED: dict[str, Any] = {
    "model": "jev-latest-2026-09-01",
    "sdk_version": "0.6.0",
    "usage": {"input_tokens": 812, "output_tokens": 96},
    "answers": {
        NOUL["id"]: {"type": "noul", "noul": 0.82},
        CHOICE["id"]: {
            "type": "choice",
            "choice": "unrelated",
            "probabilities": {
                "same_work": 0.05,
                "one_covers_other": 0.1,
                "related_distinct": 0.15,
                "unrelated": 0.7,
            },
            "confidence": 0.55,
        },
        SCORE["id"]: {
            "type": "score",
            "score": 2.25,
            "legend": {"1": "missing", "2": "partial", "3": "complete"},
            "probabilities": {"1": 0.25, "2": 0.25, "3": 0.5},
            "confidence": 0.4,
        },
    },
}


def _recorded_double(response: dict[str, Any], captured: list[dict[str, Any]]):
    """A transport double that records the guarded payload and returns a
    copy of ``response`` — the recorded-response double the slice requires."""

    def transport(payload: dict[str, Any]) -> dict[str, Any]:
        captured.append(payload)
        return copy.deepcopy(response)

    return transport


@pytest.fixture
def backend(registry, runs_root, monkeypatch):
    manifest = make_manifest(registry, run_id=RUN_ID)
    handle = start_run(runs_root, RUN_ID, manifest)
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(
        transports_module, TRANSPORT, _recorded_double(RECORDED, captured)
    )
    return JevBackend(handle), captured


def _validate_answer(def_name: str, answer: dict[str, Any]) -> None:
    schema = {"$ref": f"common.schema.json#/$defs/{def_name}"}
    jsonschema.Draft202012Validator(schema, registry=_registry()).validate(answer)


def _sent_event(runs_root: Path, run_id: str) -> dict[str, Any]:
    return [
        event
        for event in read_lines(events_path(runs_root, run_id))
        if event["kind"] == "system_one_call"
    ][-1]


# ---- protocol and declaration ---------------------------------------------


def test_backend_satisfies_the_protocol_and_supports_all_three_types(backend):
    jev, _ = backend
    assert isinstance(jev, SystemOneBackend)
    assert jev.supported_types == frozenset({"noul", "choice", "score"})


def test_refuses_an_unknown_question_type_naming_it(backend):
    jev, captured = backend
    unknown = _spec("weird", "ranking", instructions="Rank these.")
    with pytest.raises(UnsupportedQuestionTypeError) as exc_info:
        jev.system_one(STATE, [unknown])
    assert exc_info.value.question_type == "ranking"
    assert exc_info.value.backend == jev.backend_id
    assert captured == []  # refused before the transport was reached


# ---- the three answer shapes ----------------------------------------------


def test_noul_choice_and_score_answers_validate_against_their_defs(backend):
    jev, _ = backend
    answers = jev.system_one(STATE, [NOUL, CHOICE, SCORE])

    noul = answers[NOUL["id"]]
    assert set(noul) == {"noul"}
    assert noul["noul"] == pytest.approx(0.82)
    assert "confidence" not in noul
    assert "confidence" not in json.dumps(noul)
    _validate_answer("noul_answer", noul)

    choice = answers[CHOICE["id"]]
    assert choice["choice"] == "unrelated"
    assert set(choice) == {"choice", "probabilities", "confidence"}
    assert choice["confidence"] == pytest.approx(0.55)
    _validate_answer("choice_answer", choice)

    score = answers[SCORE["id"]]
    assert score["score"] == pytest.approx(2.25)
    assert score["legend"] == {"1": "missing", "2": "partial", "3": "complete"}
    assert "type" not in score
    _validate_answer("score_answer", score)


def test_payload_keys_questions_by_id_and_sends_criteria_by_name(backend):
    jev, captured = backend
    jev.system_one(STATE, [NOUL, CHOICE, SCORE])
    payload = captured[0]
    assert payload["model"] == DEFAULT_MODEL
    assert payload["state"] == STATE
    assert set(payload["questions"]) == {NOUL["id"], CHOICE["id"], SCORE["id"]}
    assert payload["questions"][CHOICE["id"]]["criteria"] == CHOICE["criteria"]
    assert "options" not in payload["questions"][CHOICE["id"]]
    assert payload["questions"][SCORE["id"]]["criteria"] == SCORE["criteria"]
    assert "legend" not in payload["questions"][SCORE["id"]]


def test_refuses_a_provider_answer_of_the_wrong_type(registry, runs_root, monkeypatch):
    manifest = make_manifest(registry, run_id="run-jev-wrong-type")
    handle = start_run(runs_root, "run-jev-wrong-type", manifest)
    wrong = copy.deepcopy(RECORDED)
    wrong["answers"][NOUL["id"]] = RECORDED["answers"][CHOICE["id"]]
    monkeypatch.setattr(transports_module, TRANSPORT, _recorded_double(wrong, []))
    with pytest.raises(ValueError, match="returned a 'choice' answer"):
        JevBackend(handle).system_one(STATE, [NOUL])


# ---- the call event and its usage record ----------------------------------


def test_call_event_records_model_sdk_version_latency_and_provider_tokens(
    backend, runs_root
):
    jev, _ = backend
    jev.system_one(STATE, [NOUL])

    kinds = [event["kind"] for event in read_lines(events_path(runs_root, RUN_ID))]
    assert "guard_pass" in kinds  # the payload went through the guard seam
    event = _sent_event(runs_root, RUN_ID)
    validate("event", event)

    assert event["data"]["backend"] == jev.backend_id
    assert event["data"]["sdk_version"] == "0.6.0"
    assert event["data"]["latency_ms"] >= 0

    usage = event["usage"]
    assert usage["source"] == "provider_api"
    assert usage["gen_ai.request.model"] == DEFAULT_MODEL
    assert usage["gen_ai.response.model"] == RECORDED["model"]
    assert usage["gen_ai.usage.input_tokens"] == 812
    assert usage["gen_ai.usage.output_tokens"] == 96
    assert usage["cost"] is None
    assert usage["null_reason"] == "no_price_entry"


def test_absent_provider_field_is_null_not_zero_and_never_omitted(
    registry, runs_root, monkeypatch
):
    manifest = make_manifest(registry, run_id="run-jev-absent")
    handle = start_run(runs_root, "run-jev-absent", manifest)
    partial = copy.deepcopy(RECORDED)
    del partial["usage"]["output_tokens"]  # the provider did not expose it
    monkeypatch.setattr(transports_module, TRANSPORT, _recorded_double(partial, []))

    JevBackend(handle).system_one(STATE, [NOUL])
    usage = _sent_event(runs_root, "run-jev-absent")["usage"]

    assert "gen_ai.usage.output_tokens" in usage
    assert usage["gen_ai.usage.output_tokens"] is None
    assert usage["gen_ai.usage.input_tokens"] == 812
    assert usage["null_reason"] == "not_exposed_by_provider"


# ---- the seam: transports is imported by guards only ----------------------


def _imports_transports(node: ast.AST) -> bool:
    if isinstance(node, ast.Import):
        return any(alias.name == "xtrm_research.transports" for alias in node.names)
    if isinstance(node, ast.ImportFrom):
        if node.module == "xtrm_research.transports":
            return True
        return node.module == "xtrm_research" and any(
            alias.name == "transports" for alias in node.names
        )
    return False


def test_only_guards_imports_the_transports_module():
    """No module other than guards.py may import transports.py, so the
    seam's resolution stays the single entry point — asserted by an AST
    scan, not by grep in prose."""
    found: set[str] = set()
    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        identity = str(path.relative_to(PACKAGE_ROOT))
        for node in ast.walk(
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        ):
            if _imports_transports(node):
                found.add(identity)
    assert found == {"guards.py"}
