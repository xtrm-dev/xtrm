"""Building telemetry_refs and OTel GenAI-named usage records.

The research platform only ever reads and copies closed snapshots from
Specialists/Pi telemetry; it never writes to their observability tables or
to ``~/.xtrm/state.db``.
"""

from __future__ import annotations

from typing import Any

USAGE_SOURCES = (
    "pi_message_usage", "pi_session_stats", "provider_api",
    "specialists_snapshot", "estimate", "unknown",
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
    request_model: str | None = None,
    response_model: str | None = None,
    latency_ms: float | None = None,
    null_reason: str | None = None,
) -> dict[str, Any]:
    if source not in USAGE_SOURCES:
        raise ValueError(f"unknown usage source: {source!r}")
    return {
        "source": source,
        "gen_ai.usage.input_tokens": input_tokens,
        "gen_ai.usage.output_tokens": output_tokens,
        "gen_ai.request.model": request_model,
        "gen_ai.response.model": response_model,
        "latency_ms": latency_ms,
        "null_reason": null_reason,
    }
