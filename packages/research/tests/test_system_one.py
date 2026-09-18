"""System One protocol and deterministic backend (XTRM-427 / XTRM-475).

Question wording is the original ``experiments/jev-dupes/dupes.py`` wording
(commit a6e55215) — this slice only adds backends, it does not reword the
judgment.
"""

from __future__ import annotations

import copy
import difflib
import json
import re

import jsonschema
import pytest

from xtrm_research.hashing import compute_content_hash
from xtrm_research.jsonl import read_lines
from xtrm_research.runner import start_run
from xtrm_research.schemas import _registry, validate
from xtrm_research.store import events_path
from xtrm_research.system_one import (
    DeterministicDupeBackend,
    SystemOneBackend,
    UnsupportedQuestionTypeError,
    duplicate_similarity,
    score_answer,
    state_hash,
)

from .helpers import make_manifest

RUN_ID = "run-system-one"

#: The original ``questions()["redundant"]`` Noul instruction (a6e55215).
NOUL_INSTRUCTIONS = (
    "`issue_a` and `issue_b` are two tickets from the same software project tracker. "
    "Completing one of them would make the other unnecessary: they ask for the same work, "
    "or one fully covers or replaces the other."
)
#: The original ``questions()["relation"]`` Choice instruction (a6e55215).
CHOICE_INSTRUCTIONS = (
    "What is the relationship between the work described in `issue_a` and `issue_b`?"
)


@pytest.fixture
def handle(registry, runs_root):
    manifest = make_manifest(registry, run_id=RUN_ID)
    return start_run(runs_root, RUN_ID, manifest)


def _backend(handle) -> DeterministicDupeBackend:
    return DeterministicDupeBackend(handle)


def _noul_spec(instructions: str = NOUL_INSTRUCTIONS) -> dict:
    spec = {
        "id": "redundant",
        "version": "v1",
        "type": "noul",
        "instructions": instructions,
    }
    spec["content_hash"] = compute_content_hash(spec)
    return spec


def _choice_spec(options: list[str]) -> dict:
    spec = {
        "id": "relation",
        "version": "v1",
        "type": "choice",
        "instructions": CHOICE_INSTRUCTIONS,
        "criteria": {option: f"the {option} case" for option in options},
        "options": options,
    }
    spec["content_hash"] = compute_content_hash(spec)
    return spec


def _score_spec() -> dict:
    spec = {
        "id": "completeness",
        "version": "v1",
        "type": "score",
        "instructions": "How completely does the ticket state its SUCCESS section?",
        "criteria": {"basis": "coverage"},
        "legend": {"1": "missing", "2": "partial", "3": "complete"},
    }
    spec["content_hash"] = compute_content_hash(spec)
    return spec


def _state(issue_a: dict, issue_b: dict) -> dict:
    return {"issue_a": issue_a, "issue_b": issue_b}


IDENTICAL_STATE = _state(
    {"title": "Fix the settle lock race", "description": "the runner run lock"},
    {"title": "Fix the settle lock race", "description": "the runner run lock"},
)
DIFFERENT_STATE = _state(
    {"title": "Fix the settle lock race", "description": "the runner run lock"},
    {"title": "Charts render wrong colours", "description": "the palette mapping"},
)
#: Two titles with no shared characters and no descriptions: similarity 0.0.
UNRELATED_STATE = _state({"title": "aaaa"}, {"title": "zzzz"})


def _validate_answer(def_name: str, answer: dict) -> None:
    """Validate one answer against common.schema.json's named $def directly."""
    schema = {"$ref": f"common.schema.json#/$defs/{def_name}"}
    jsonschema.Draft202012Validator(schema, registry=_registry()).validate(answer)


def _reference_similarity(issue_a: dict, issue_b: dict) -> float:
    """The a6e55215 ``sim`` re-derived independently of the module under test."""

    def words(issue: dict) -> set[str]:
        text = issue["title"] + " " + (issue.get("description") or "")[:800]
        return set(re.findall(r"[a-z0-9]{3,}", text.lower()))

    words_a, words_b = words(issue_a), words(issue_b)
    jaccard = len(words_a & words_b) / max(1, len(words_a | words_b))
    ratio = difflib.SequenceMatcher(
        None, issue_a["title"].lower(), issue_b["title"].lower()
    ).ratio()
    return 0.5 * ratio + 0.5 * jaccard


# ---- declaration and refusal ------------------------------------------------


def test_backend_declares_supported_types_and_satisfies_the_protocol(handle):
    backend = _backend(handle)
    assert isinstance(backend, SystemOneBackend)
    assert backend.supported_types == frozenset({"noul", "choice"})
    assert "score" not in backend.supported_types


def test_refuses_score_with_a_typed_error_naming_score(handle, runs_root):
    backend = _backend(handle)
    with pytest.raises(UnsupportedQuestionTypeError) as exc_info:
        backend.system_one(DIFFERENT_STATE, [_score_spec()])
    assert exc_info.value.question_type == "score"
    assert exc_info.value.backend == backend.backend_id
    assert "score" in str(exc_info.value)
    # a refused question leaves no event behind: the call produced no answer
    assert list(read_lines(events_path(runs_root, RUN_ID))) == []


def test_refuses_choice_with_other_than_two_options(handle):
    backend = _backend(handle)
    four_options = _choice_spec(
        ["same_work", "one_covers_other", "related_distinct", "unrelated"]
    )
    with pytest.raises(UnsupportedQuestionTypeError) as exc_info:
        backend.system_one(IDENTICAL_STATE, [four_options])
    assert exc_info.value.question_type == "choice"
    assert "two options" in str(exc_info.value)


def test_missing_issue_in_state_is_rejected(handle):
    backend = _backend(handle)
    with pytest.raises(ValueError, match="issue_a"):
        backend.system_one({"issue_a": {"title": "x"}}, [_noul_spec()])


# ---- noul: no confidence, ever ----------------------------------------------


def test_noul_answer_has_no_confidence_before_or_after_serialization(handle):
    backend = _backend(handle)
    question = _noul_spec()
    answers = backend.system_one(IDENTICAL_STATE, [question])

    answer = answers[question["id"]]  # the backend's own return value
    assert "confidence" not in answer
    assert set(answer) == {"noul"}
    assert answer["noul"] == pytest.approx(1.0)
    _validate_answer("noul_answer", answer)
    assert "confidence" not in json.dumps(answer)


# ---- score: probability-weighted mean ---------------------------------------


def test_score_answer_is_the_probability_weighted_mean_not_a_level():
    legend = {"1": "missing", "2": "partial", "3": "complete"}
    probabilities = {"1": 0.25, "2": 0.25, "3": 0.5}
    answer = score_answer(legend, probabilities, confidence=0.4)

    expected = sum(float(level) * p for level, p in probabilities.items())
    assert expected == pytest.approx(2.25)
    assert not float(expected).is_integer()
    assert abs(answer["score"] - expected) < 1e-9
    assert answer["score"] == pytest.approx(2.25)
    _validate_answer("score_answer", answer)


def test_score_answer_rejects_a_level_outside_the_legend():
    with pytest.raises(ValueError, match="legend"):
        score_answer({"1": "missing"}, {"9": 1.0}, confidence=0.9)


# ---- hashes ------------------------------------------------------------------


def test_state_hash_is_stable_across_key_order_and_sensitive_to_values():
    h1 = state_hash(IDENTICAL_STATE)
    permuted = {
        "issue_b": {
            "description": "the runner run lock",
            "title": "Fix the settle lock race",
        },
        "issue_a": {
            "title": "Fix the settle lock race",
            "description": "the runner run lock",
        },
    }
    assert state_hash(permuted) == h1
    assert h1.startswith("sha256:")

    changed = copy.deepcopy(IDENTICAL_STATE)
    changed["issue_b"]["description"] = "something else entirely"
    assert state_hash(changed) != h1


def test_question_content_hash_comes_from_the_spec_and_changes_with_instructions():
    original = _noul_spec()
    amended = _noul_spec(NOUL_INSTRUCTIONS + " Amended wording.")
    assert amended["content_hash"] != original["content_hash"]
    assert original["content_hash"] == compute_content_hash(original)


# ---- events ------------------------------------------------------------------


def test_one_call_writes_exactly_one_system_one_call_event(handle, runs_root):
    backend = _backend(handle)
    question = _noul_spec()
    backend.system_one(IDENTICAL_STATE, [question])

    events_file = events_path(runs_root, RUN_ID)
    rows = list(read_lines(events_file))
    assert len(rows) == 1
    event = rows[0]
    assert event["kind"] == "system_one_call"
    validate("event", event)
    assert event["seq"] == 0
    assert event["data"]["backend"] == backend.backend_id
    assert event["data"]["state_hash"] == state_hash(IDENTICAL_STATE)
    assert event["data"]["latency_ms"] >= 0
    assert event["data"]["questions"] == [
        {
            "id": question["id"],
            "content_hash": question["content_hash"],
            "answer_type": "noul",
        }
    ]
    assert event["usage"]["source"] == "unknown"
    assert event["usage"]["null_reason"] == "not_exposed_by_provider"
    assert event["usage"]["gen_ai.usage.input_tokens"] is None

    backend.system_one(IDENTICAL_STATE, [question])
    second = list(read_lines(events_file))
    assert len(second) == 2  # one call, one row — never more
    assert [row["seq"] for row in second] == [0, 1]


# ---- the similarity formula and the two-option choice -----------------------


def test_duplicate_similarity_matches_the_a6e55215_formula():
    issue_a = {"title": "Fix the settle lock race", "description": "runner run lock"}
    issue_b = {"title": "Fix settle lock race in runner", "description": "the run lock"}
    assert duplicate_similarity(issue_a, issue_b) == pytest.approx(
        _reference_similarity(issue_a, issue_b)
    )
    assert duplicate_similarity(issue_a, issue_a) == pytest.approx(1.0)
    assert duplicate_similarity(issue_a, {"title": "zzzz"}) == pytest.approx(0.0)


def test_duplicate_similarity_reads_only_the_first_800_description_chars():
    issue_a = {"title": "same title", "description": "x" * 800}
    issue_b = {"title": "same title", "description": "x" * 800 + "y" * 400}
    assert duplicate_similarity(issue_a, issue_b) == pytest.approx(1.0)


def test_two_option_choice_uses_the_similarity_as_the_affirmative_probability(handle):
    backend = _backend(handle)
    question = _choice_spec(["same_work", "unrelated"])

    identical = backend.system_one(IDENTICAL_STATE, [question])[question["id"]]
    assert identical["choice"] == "same_work"
    assert identical["probabilities"] == {"same_work": 1.0, "unrelated": 0.0}
    assert identical["confidence"] == pytest.approx(1.0)
    _validate_answer("choice_answer", identical)

    different = backend.system_one(UNRELATED_STATE, [question])[question["id"]]
    assert different["choice"] == "unrelated"
    assert different["probabilities"] == {"same_work": 0.0, "unrelated": 1.0}
    assert different["confidence"] == pytest.approx(1.0)
    _validate_answer("choice_answer", different)
