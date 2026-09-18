"""System One backends: ``system_one(state, questions) -> answers`` (XTRM-427).

A System One model evaluates ``state`` (facts and content) against
``questions`` (judgments) and returns ``answers``, keyed by question id. A
question is a QuestionSpec dict (``question_spec.schema.json``): ``id``,
``version``, ``content_hash``, ``type`` in {choice, score, noul},
``instructions``, ``criteria``, ``options`` for choice and ``legend`` for
score. An answer validates against ``common.schema.json``'s
``$defs.choice_answer`` / ``$defs.score_answer`` / ``$defs.noul_answer``:

* choice — ``choice``, ``probabilities`` over options, ``confidence``.
* score  — ``score`` (the probability-weighted position over level numbers,
  fractional allowed), ``legend``, ``probabilities`` over levels,
  ``confidence``.
* noul   — ``noul`` = P(yes), and **no** ``confidence`` field at all: 0.5
  means yes and no are equally likely, not medium intensity. ``confidence``
  is a statistic of the distribution shape, not a probability, so it only
  exists for choice/score.

A backend declares its ``supported_types`` and raises
:class:`UnsupportedQuestionTypeError` naming the type it was asked and
cannot answer — it never degrades to a plausible-looking answer for a type
it does not support. Every completed call writes exactly one
``system_one_call`` event through the run's :class:`~xtrm_research.runner.RunHandle`;
token/cost fields live in that event's ``usage`` record.

This module is library code: no transport, no remote call. The package's
only remote-send seam remains ``guards.guarded_send``.
"""

from __future__ import annotations

import difflib
import re
import time
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable

from xtrm_research.hashing import compute_content_hash
from xtrm_research.jsonl import read_lines
from xtrm_research.runner import RunHandle
from xtrm_research.store import events_path
from xtrm_research.telemetry import usage_record

#: The one event kind a System One call emits.
EVENT_KIND = "system_one_call"
EVENT_SCHEMA_VERSION = "xtrm-research-event/v1"


class UnsupportedQuestionTypeError(ValueError):
    """Raised when a backend is asked a question type it does not support.

    Carries the backend identifier and the offending ``question_type`` as
    attributes, so a caller can branch on the type instead of parsing the
    message. ``detail`` names a finer reason (e.g. a choice question whose
    option set has the wrong arity).
    """

    def __init__(self, backend: str, question_type: str, detail: str = "") -> None:
        self.backend = backend
        self.question_type = question_type
        self.detail = detail
        message = (
            f"backend {backend!r} does not support question type {question_type!r}"
        )
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


@runtime_checkable
class SystemOneBackend(Protocol):
    """The provider-independent System One contract.

    A backend is a class with these members — deliberately not a
    ``Callable`` parameter, which the package's remote-seam guard forbids.
    """

    @property
    def backend_id(self) -> str:
        """Stable identifier recorded on every ``system_one_call`` event."""
        ...

    @property
    def supported_types(self) -> frozenset[str]:
        """The question ``type`` values this backend can answer."""
        ...

    def system_one(
        self, state: Mapping[str, Any], questions: Sequence[Mapping[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """Answer ``questions`` about ``state``, keyed by question id."""
        ...


def state_hash(state: Mapping[str, Any]) -> str:
    """Return the ``sha256:`` hash of the canonically serialised state.

    Reuses :func:`xtrm_research.hashing.compute_content_hash`, so the hash
    is stable across dict key-order permutations and changes when any state
    value changes.
    """
    return compute_content_hash(dict(state))


def score_answer(
    legend: Mapping[str, str],
    probabilities: Mapping[str, float],
    confidence: float,
) -> dict[str, Any]:
    """Build a Score answer from ``probabilities`` over level numbers.

    ``score`` is the probability-weighted mean of the level numbers and may
    be fractional — it is never rounded to, or majority-picked from, a level.
    """
    unknown = sorted(set(probabilities) - set(legend))
    if unknown:
        raise ValueError(
            f"score probabilities reference levels not in the legend: {unknown}"
        )
    score = sum(
        float(level) * probability for level, probability in probabilities.items()
    )
    return {
        "score": score,
        "legend": dict(legend),
        "probabilities": dict(probabilities),
        "confidence": confidence,
    }


def emit_system_one_call(
    handle: RunHandle,
    backend_id: str,
    state: Mapping[str, Any],
    questions: Sequence[Mapping[str, Any]],
    latency_ms: float,
    *,
    usage: dict[str, Any],
    extra_data: Mapping[str, Any] | None = None,
) -> None:
    """Write the one ``system_one_call`` event for a completed backend call.

    ``data`` carries the backend identifier, each question's ``content_hash``
    and ``answer_type``, the state hash and the latency; ``usage`` is the
    caller-built :func:`~xtrm_research.telemetry.usage_record` (real token
    and cost fields for a provider backend, canonical nulls otherwise).
    ``extra_data`` adds provider-specific provenance (the Jev backend records
    its SDK version there) without changing the baseline event shape.
    """
    handle.write_event(
        {
            "schema_version": EVENT_SCHEMA_VERSION,
            "seq": _next_event_seq(handle),
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": EVENT_KIND,
            "data": {
                "backend": backend_id,
                "state_hash": state_hash(state),
                "latency_ms": latency_ms,
                "questions": [
                    {
                        "id": question["id"],
                        "content_hash": question["content_hash"],
                        "answer_type": question["type"],
                    }
                    for question in questions
                ],
                **dict(extra_data or {}),
            },
            "usage": usage,
        }
    )


def _next_event_seq(handle: RunHandle) -> int:
    next_seq = 0
    for event in read_lines(events_path(handle.root, handle.run_id)):
        next_seq = event["seq"] + 1
    return next_seq


#: Token regex from the a6e55215 scripts' ``words()``: lowercase alnum runs
#: of 3+ characters.
_WORD = re.compile(r"[a-z0-9]{3,}")
#: ``sim`` weights the title ratio and the body token Jaccard equally.
_TITLE_WEIGHT = 0.5
#: ``sim`` reads the first 800 characters of the description, like the
#: original ``words()``.
_DESCRIPTION_LIMIT = 800


def _word_set(issue: Mapping[str, Any]) -> set[str]:
    text = issue["title"] + " " + (issue.get("description") or "")[:_DESCRIPTION_LIMIT]
    return set(_WORD.findall(text.lower()))


def duplicate_similarity(
    issue_a: Mapping[str, Any], issue_b: Mapping[str, Any]
) -> float:
    """The deterministic duplicate baseline, verbatim ``sim`` from a6e55215.

    ``0.5 * difflib.SequenceMatcher(None, title_a, title_b).ratio()
    + 0.5 * jaccard(token_set(title + description[:800]))``, both titles
    lowercased. The score is in [0, 1] and is used directly as P(yes).
    """
    words_a, words_b = _word_set(issue_a), _word_set(issue_b)
    jaccard = len(words_a & words_b) / max(1, len(words_a | words_b))
    ratio = difflib.SequenceMatcher(
        None, issue_a["title"].lower(), issue_b["title"].lower()
    ).ratio()
    return _TITLE_WEIGHT * ratio + _TITLE_WEIGHT * jaccard


class DeterministicDupeBackend:
    """No-model baseline for the duplicate-pair judgment (a6e55215 scripts).

    ``system_one`` reads the two items from ``state["issue_a"]`` and
    ``state["issue_b"]`` (each a mapping with a ``title`` and optional
    ``description``, as the original ``view()`` produced) and scores them
    with :func:`duplicate_similarity`.

    Supported question types: ``noul``, whose ``noul`` is that similarity
    (P(yes) = P(duplicate)); and ``choice`` only when the option set is
    exactly two, where the **first option** is read as the affirmative
    (duplicate) outcome and the second as the negative one. ``score`` is
    refused — the deterministic baseline has no probability distribution
    over levels, and inventing one would be a fabricated answer.
    """

    backend_id = "deterministic-dupe-v1"
    supported_types = frozenset({"noul", "choice"})

    def __init__(self, handle: RunHandle) -> None:
        self._handle = handle

    def system_one(
        self, state: Mapping[str, Any], questions: Sequence[Mapping[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        for question in questions:
            question_type = question["type"]
            if question_type not in self.supported_types:
                raise UnsupportedQuestionTypeError(self.backend_id, question_type)
        started = time.perf_counter()
        issue_a, issue_b = _issues(state)
        similarity = duplicate_similarity(issue_a, issue_b)
        answers = {
            question["id"]: self._answer(question, similarity) for question in questions
        }
        latency_ms = (time.perf_counter() - started) * 1000.0
        emit_system_one_call(
            self._handle,
            self.backend_id,
            state,
            questions,
            latency_ms,
            usage=usage_record(
                source="unknown",
                latency_ms=latency_ms,
                null_reason="not_exposed_by_provider",
                null_detail="deterministic backend has no provider response",
            ),
        )
        return answers

    def _answer(self, question: Mapping[str, Any], similarity: float) -> dict[str, Any]:
        if question["type"] == "noul":
            return {"noul": similarity}
        options = question.get("options") or []
        if len(options) != 2:
            raise UnsupportedQuestionTypeError(
                self.backend_id,
                "choice",
                f"expected exactly two options, got {len(options)}",
            )
        affirmative, negative = options
        probabilities = {affirmative: similarity, negative: 1.0 - similarity}
        return {
            "choice": affirmative if similarity >= 0.5 else negative,
            "probabilities": probabilities,
            "confidence": abs(probabilities[affirmative] - probabilities[negative]),
        }


def _issues(
    state: Mapping[str, Any],
) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    try:
        issues = (state["issue_a"], state["issue_b"])
    except (KeyError, TypeError) as exc:
        raise ValueError(
            "deterministic duplicate backend needs state['issue_a'] and "
            "state['issue_b']"
        ) from exc
    for issue in issues:
        if not isinstance(issue, Mapping) or not isinstance(issue.get("title"), str):
            raise ValueError("each state issue needs a 'title' string")
    return issues
