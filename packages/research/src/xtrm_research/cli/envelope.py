"""The xtrm-research-cli/v1 response envelope, shared by every --json command."""

from __future__ import annotations

from typing import Any

from xtrm_research.schemas import validate

ENVELOPE_SCHEMA = "xtrm-research-cli/v1"


def ok_envelope(command: str, data: Any) -> dict[str, Any]:
    envelope = {
        "schema": ENVELOPE_SCHEMA,
        "command": command,
        "ok": True,
        "data": data,
        "error": None,
    }
    validate("cli_envelope", envelope)
    return envelope


def error_envelope(command: str, error: str) -> dict[str, Any]:
    envelope = {
        "schema": ENVELOPE_SCHEMA,
        "command": command,
        "ok": False,
        "data": None,
        "error": error,
    }
    validate("cli_envelope", envelope)
    return envelope
