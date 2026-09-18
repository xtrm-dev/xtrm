"""Building telemetry_refs and OTel GenAI-named usage records.

The research platform only ever reads and copies closed snapshots from
Specialists/Pi telemetry; it never writes to their observability tables or
to ``~/.xtrm/state.db``.
"""

from __future__ import annotations

from typing import Any

USAGE_SOURCES = (
    "pi_message_usage",
    "pi_session_stats",
    "provider_api",
    "specialists_snapshot",
    "estimate",
    "unknown",
)

#: Canonical snake_case vocabulary for ``usage_record`` nulls, pinned
#: against common.schema.json's ``null_reason`` enum by
#: tests/test_enum_parity.py. ``no_price_entry`` is the agreed value for
#: a missing price; the human sentence that used to live in
#: ``null_reason`` now belongs in ``null_detail``.
NULL_REASONS = (
    "no_price_entry",
    "not_exposed_by_provider",
)


def telemetry_refs(
    specialists_job_id: str | None = None,
    specialists_attempt_id: str | None = None,
    specialists_activation_id: str | None = None,
    pi_session_id: str | None = None,
    event_seq: int | None = None,
) -> dict[str, Any]:
    return {
        "specialists_job_id": specialists_job_id,
        "specialists_attempt_id": specialists_attempt_id,
        "specialists_activation_id": specialists_activation_id,
        "pi_session_id": pi_session_id,
        "event_seq": event_seq,
    }


def usage_record(
    source: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cached_input_tokens: int | None = None,
    request_model: str | None = None,
    response_model: str | None = None,
    latency_ms: float | None = None,
    cost: float | None = None,
    cost_currency: str | None = None,
    null_reason: str | None = None,
    null_detail: str | None = None,
) -> dict[str, Any]:
    if source not in USAGE_SOURCES:
        raise ValueError(f"unknown usage source: {source!r}")
    if null_reason is not None and null_reason not in NULL_REASONS:
        raise ValueError(f"unknown null reason: {null_reason!r}")
    return {
        "source": source,
        "gen_ai.usage.input_tokens": input_tokens,
        "gen_ai.usage.output_tokens": output_tokens,
        "cached_input_tokens": cached_input_tokens,
        "gen_ai.request.model": request_model,
        "gen_ai.response.model": response_model,
        "latency_ms": latency_ms,
        "cost": cost,
        "cost_currency": cost_currency,
        "null_reason": null_reason,
        "null_detail": null_detail,
    }
