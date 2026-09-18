"""Jev, the TypeSafe System One backend (XTRM-483).

The adapter *names* the transport it wants (``JevBackend.TRANSPORT``) and
never imports one: ``guards.guarded_send`` / ``guards.send_through_run``
remain the package's only remote-send seam and resolve the name inside
:mod:`xtrm_research.transports`. This module imports nothing from the
optional ``typesafe-sdk`` — the neutral question dicts it builds are
exactly what ``TypeSafeClient.system_one`` accepts — so the package and
its suite import and pass with the SDK absent.

A Choice answer's selected label is taken *by name* from the SDK response;
the adapter never reads the option list positionally (XTRM-427 journal
seq 2). A Noul answer carries no ``confidence``: the SDK does not expose
one, and the abstraction does not fabricate one.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from typing import Any

from xtrm_research.guards import send_through_run
from xtrm_research.runner import RunHandle
from xtrm_research.system_one import (
    UnsupportedQuestionTypeError,
    _next_event_seq,
    emit_system_one_call,
)
from xtrm_research.telemetry import usage_record

#: The transport this backend names; ``guards`` resolves it from
#: :mod:`xtrm_research.transports`.
TRANSPORT = "typesafe_system_one"
#: The mutable model alias the original scripts passed to
#: ``TypeSafeClient`` (a6e55215).
DEFAULT_MODEL = "jev-latest"


class JevBackend:
    """System One over TypeSafe/Jev.

    Supports every System One question type: ``noul``, ``choice`` and
    ``score``. Token counts come from the provider's own ``usage`` record;
    cost is always null with ``null_reason`` ``no_price_entry`` until a
    versioned price entry exists (XTRM-432 owns the price table). A field
    the provider response does not expose is null with ``null_reason``
    ``not_exposed_by_provider`` — never zero and never omitted.
    """

    backend_id = "jev-typesafe-v1"
    supported_types = frozenset({"noul", "choice", "score"})

    def __init__(self, handle: RunHandle, model: str = DEFAULT_MODEL) -> None:
        self._handle = handle
        self._model = model

    def system_one(
        self, state: Mapping[str, Any], questions: Sequence[Mapping[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        for question in questions:
            question_type = question["type"]
            if question_type not in self.supported_types:
                raise UnsupportedQuestionTypeError(self.backend_id, question_type)
        payload = {
            "model": self._model,
            "state": dict(state),
            "questions": {
                question["id"]: _question_body(question) for question in questions
            },
        }
        started = time.perf_counter()
        response = send_through_run(
            self._handle,
            _next_event_seq(self._handle),
            payload,
            TRANSPORT,
        )
        latency_ms = (time.perf_counter() - started) * 1000.0
        answers = {
            question["id"]: _answer(question, response["answers"][question["id"]])
            for question in questions
        }
        emit_system_one_call(
            self._handle,
            self.backend_id,
            state,
            questions,
            latency_ms,
            usage=_usage(response, self._model, latency_ms),
            extra_data={"sdk_version": response["sdk_version"]},
        )
        return answers


def _question_body(question: Mapping[str, Any]) -> dict[str, Any]:
    """Map one QuestionSpec to the SDK's neutral question dict.

    Only the fields the SDK defines are sent: ``type``, ``instructions``
    and — for choice (a label→description mapping) and score (an ordered
    rubric list) — ``criteria``. A noul criterion is forwarded only when
    the spec carries one.
    """
    body: dict[str, Any] = {"type": question["type"]}
    if "instructions" in question:
        body["instructions"] = question["instructions"]
    if "criteria" in question:
        body["criteria"] = question["criteria"]
    return body


def _answer(question: Mapping[str, Any], raw: Mapping[str, Any]) -> dict[str, Any]:
    """Map one transport answer onto the shape ``common.schema.json``
    defines for its question type. The transport's ``type`` tag is checked
    against the question before the answer-shape fields are copied, so a
    remote answer of the wrong kind is refused rather than reshaped."""
    question_type = question["type"]
    if raw.get("type") != question_type:
        raise ValueError(
            f"question {question['id']!r} is {question_type!r} but the provider "
            f"returned a {raw.get('type')!r} answer"
        )
    if question_type == "noul":
        return {"noul": raw["noul"]}
    if question_type == "choice":
        return {
            "choice": raw["choice"],
            "probabilities": dict(raw["probabilities"]),
            "confidence": raw["confidence"],
        }
    return {
        "score": raw["score"],
        "legend": dict(raw["legend"]),
        "probabilities": dict(raw["probabilities"]),
        "confidence": raw["confidence"],
    }


def _usage(
    response: Mapping[str, Any], request_model: str, latency_ms: float
) -> dict[str, Any]:
    """Build the ``system_one_call`` usage record from the provider response.

    Token counts are copied verbatim from the response ``usage`` — a
    missing count stays null, never zero. Cost is null: this package has no
    price entry for any model yet (XTRM-432 owns the price table). The
    record carries one ``null_reason``, so a field the provider did not
    expose takes precedence over the always-null cost; otherwise the reason
    is ``no_price_entry``.
    """
    provider_usage = response["usage"]
    input_tokens = provider_usage.get("input_tokens")
    output_tokens = provider_usage.get("output_tokens")
    exposed = input_tokens is not None and output_tokens is not None
    return usage_record(
        source="provider_api",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        request_model=request_model,
        response_model=response["model"],
        latency_ms=latency_ms,
        cost=None,
        cost_currency=None,
        null_reason="no_price_entry" if exposed else "not_exposed_by_provider",
        null_detail=(
            "no price entry for this model; the price table is XTRM-432"
            if exposed
            else "the provider response did not expose input/output tokens"
        ),
    )
