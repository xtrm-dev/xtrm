"""Frontier structured-classifier arm and Jev arm (XTRM-497, XTRM-500 input).

Both arms answer all six v1 questions in one call per candidate, from the
same definitions the reference labelers read (:data:`DEFINITIONS`, cut from
``labels.BRIEF`` so the text is identical): the frontier model gets them as
one system prompt; Jev gets each question's own paragraph as that
question's ``instructions`` and the four authority levels as the Score
``criteria``.

The frontier arm reports probabilities it states itself — not a
calibrated quantity either; calibration treats every arm the same way.
Every call goes through ``guards.guarded_send``.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import jsonschema

from xtrm_research.evidence_gate.labels import BINARY, BRIEF, ORDINAL, QUESTIONS
from xtrm_research.guards import GuardFailure, guarded_send
from xtrm_research.jev import DEFAULT_MODEL as JEV_MODEL

FRONTIER_MODEL = "claude-sonnet-5"
#: Pinned so the arm is a structured classifier, not a deliberating agent.
FRONTIER_EFFORT = "low"
DEFINITIONS = BRIEF.split("\n\nINPUT:")[0]
LEVELS = ("1", "2", "3", "4")


def question_paragraphs() -> dict[str, str]:
    paragraphs = {}
    for block in DEFINITIONS.split("\n\n"):
        match = re.match(r"^([a-z_]+) \(", block)
        if match and match.group(1) in QUESTIONS:
            paragraphs[match.group(1)] = block
    if set(paragraphs) != set(QUESTIONS):
        raise ValueError("labels.BRIEF no longer defines every v1 question")
    return paragraphs


AUTHORITY_LEVELS = [
    level.strip()
    for level in question_paragraphs()[ORDINAL].split("):", 1)[1].split(". ")
    if re.match(r"^\d = ", level.strip())
]

FRONTIER_SYSTEM = (
    DEFINITIONS
    + "\n\nYou are a classifier. For the ONE candidate passage given, report for each"
    " 0/1 question the probability that the correct label is 1, and for"
    " source_authority a probability for each level 1-4 summing to 1. Report"
    " calibrated probabilities: 0.5 means genuinely uncertain."
)

FRONTIER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        **{q: {"type": "number", "minimum": 0, "maximum": 1} for q in BINARY},
        ORDINAL: {
            "type": "object",
            "properties": {
                lv: {"type": "number", "minimum": 0, "maximum": 1} for lv in LEVELS
            },
            "required": list(LEVELS),
            "additionalProperties": False,
        },
    },
    "required": list(QUESTIONS),
    "additionalProperties": False,
}


#: Composed by ``transports.claude_classify`` after the guard stage.
FRONTIER_PROMPT_TEMPLATE = (
    "QUERY: {query}\n\nCANDIDATE (source: {passage_source}):\n{passage}"
)


def frontier_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": FRONTIER_MODEL,
        "reason": "operator_approval",
        "effort": FRONTIER_EFFORT,
        "system": FRONTIER_SYSTEM,
        "prompt_template": FRONTIER_PROMPT_TEMPLATE,
        "input": {k: item["state"][k] for k in ("query", "passage_source", "passage")},
        "json_schema": FRONTIER_SCHEMA,
    }


def jev_payload(item: dict[str, Any]) -> dict[str, Any]:
    state = {k: item["state"][k] for k in ("query", "passage", "passage_source")}
    return {"model": JEV_MODEL, "state": state, "questions": jev_questions()}


def frontier_predict(item: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    row: dict[str, Any] = {
        "item_id": item["item_id"],
        "arm": f"frontier-{FRONTIER_MODEL}",
        "answer_kind": "stated_probability",
    }
    try:
        response = guarded_send(
            frontier_payload(item),
            "claude_classify",
        )
    except GuardFailure as exc:
        return {**row, "status": "guard_failure", "detail": exc.guard}
    row["latency_ms"] = (time.perf_counter() - started) * 1000.0
    out = response.get("structured_output")
    usage = response.get("model_usage") or {}
    row["usage"] = {
        "input_tokens": usage.get("inputTokens"),
        "output_tokens": usage.get("outputTokens"),
        "cached_input_tokens": usage.get("cacheReadInputTokens"),
        "cost_usd": usage.get("costUSD"),
        "cost_basis": usage.get("costBasis"),
        "cost_source": "claude CLI modelUsage[model].costUSD (list-price basis as the CLI reports it)",
        "auxiliary_cost_usd": sum(
            (v.get("costUSD") or 0)
            for v in (response.get("auxiliary_usage") or {}).values()
        ),
        "duration_api_ms": response.get("duration_api_ms"),
        "duration_cli_ms": response.get("duration_ms"),
    }
    if not isinstance(out, dict):
        return {**row, "status": "no_output", "detail": response.get("error")}
    dist = out[ORDINAL]
    total = sum(dist.values())
    row["raw"] = {q: float(out[q]) for q in BINARY}
    row["score_probabilities"] = {
        ORDINAL: {lv: dist[lv] / total for lv in LEVELS} if total > 0 else None
    }
    row["status"] = "answered"
    return row


def jev_questions() -> dict[str, dict[str, Any]]:
    paragraphs = question_paragraphs()
    questions: dict[str, dict[str, Any]] = {
        q: {"type": "noul", "instructions": paragraphs[q]} for q in BINARY
    }
    questions[ORDINAL] = {
        "type": "score",
        "instructions": paragraphs[ORDINAL].split(": 1 = ")[0] + ".",
        "criteria": AUTHORITY_LEVELS,
    }
    return questions


def jev_predict(item: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    row: dict[str, Any] = {
        "item_id": item["item_id"],
        "arm": "jev",
        "answer_kind": "noul",
    }
    try:
        response = guarded_send(
            jev_payload(item),
            "typesafe_system_one",
        )
    except GuardFailure as exc:
        return {**row, "status": "guard_failure", "detail": exc.guard}
    row["latency_ms"] = (time.perf_counter() - started) * 1000.0
    answers = response["answers"]
    row["raw"] = {q: float(answers[q]["noul"]) for q in BINARY}
    # Jev numbers Score levels from 0 and echoes each level's criterion in
    # its legend; the authority level is read from that criterion's own
    # "N = " prefix, never from the position.
    legend = answers[ORDINAL]["legend"]
    level_of = {
        str(k): re.match(r"^(\d) = ", text).group(1) for k, text in legend.items()
    }
    row["score_probabilities"] = {
        ORDINAL: {
            level_of[str(k)]: v for k, v in answers[ORDINAL]["probabilities"].items()
        }
    }
    row["score_legend"] = legend
    row["model"] = response["model"]
    row["request_id"] = response.get("request_id")
    usage = response["usage"]
    row["usage"] = {
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "cost_usd": None,
        "null_reason": "priced_in_comparison",
        "null_detail": "cost is computed from the versioned price table at comparison time",
    }
    row["status"] = "answered"
    return row


#: Sixth arm (operator decision 2026-09-18): a cheap non-Anthropic LLM
#: baseline through pi. Not one of the reference-label models.
LLM_MODEL = "commandcode/deepseek/deepseek-v4.1-flash"
LLM_SYSTEM = (
    FRONTIER_SYSTEM
    + "\n\nReply with ONLY a JSON object, no prose, no code fence, matching this JSON"
    " Schema: " + json.dumps(FRONTIER_SCHEMA)
)


def llm_payload(
    item: dict[str, Any], reason: str = "operator_approval"
) -> dict[str, Any]:
    """``reason``: the budget-policy reason (transports.BUDGET_REASONS). The
    full-set DeepSeek arm ran under operator approval; a cascade escalation
    passes ``uncertainty_band``."""
    return {
        "model": LLM_MODEL,
        "reason": reason,
        "system": LLM_SYSTEM,
        "prompt_template": FRONTIER_PROMPT_TEMPLATE,
        "input": {k: item["state"][k] for k in ("query", "passage_source", "passage")},
    }


def parse_llm_reply(text: str | None) -> dict[str, Any] | None:
    """The reply's JSON object if it validates against FRONTIER_SCHEMA,
    else None — a malformed reply is a failure, never repaired."""
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        out = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if list(jsonschema.Draft202012Validator(FRONTIER_SCHEMA).iter_errors(out)):
        return None
    return out


def llm_predict(item: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    row: dict[str, Any] = {
        "item_id": item["item_id"],
        "arm": "llm-deepseek-v4.1-flash",
        "answer_kind": "stated_probability",
    }
    try:
        response = guarded_send(llm_payload(item), "pi_complete")
    except GuardFailure as exc:
        return {**row, "status": "guard_failure", "detail": exc.guard}
    row["latency_ms"] = (time.perf_counter() - started) * 1000.0
    usage = response.get("usage") or {}
    row["usage"] = {
        **usage,
        "cost_source": "pi-reported provider cost (commandcode) for this call",
    }
    row["model"] = response.get("model")
    out = parse_llm_reply(response.get("text"))
    if out is None:
        return {
            **row,
            "status": "no_output",
            "detail": response.get("error") or "reply failed FRONTIER_SCHEMA",
        }
    dist = out[ORDINAL]
    total = sum(dist.values())
    row["raw"] = {q: float(out[q]) for q in BINARY}
    row["score_probabilities"] = {
        ORDINAL: {lv: dist[lv] / total for lv in LEVELS} if total > 0 else None
    }
    row["status"] = "answered"
    return row
