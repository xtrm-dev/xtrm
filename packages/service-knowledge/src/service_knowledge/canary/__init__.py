"""Canary policy module (bead xtrm-56flm.7, package v0.7.0).

Ships the mechanism to enable per-class auto-merge of `PASS`-verdict skill diffs
without enabling it. See ``docs/devops/service-knowledge-canary.md`` for the
ratified policy the module enforces. `v1.0.0` is reserved for the operator-
authorised enable moment.

Fail-closed by design: any doubt (missing state, malformed JSON, non-allowed
claim class, non-PASS verdict) suppresses auto-merge and falls back to the
normal PR path.
"""
from __future__ import annotations

from service_knowledge.canary.state import (
    ALLOWED_CLASSES,
    FORBIDDEN_CLASSES,
    CanaryState,
    read_state,
    state_file_path,
    write_state,
)

__all__ = [
    "ALLOWED_CLASSES",
    "FORBIDDEN_CLASSES",
    "CanaryState",
    "read_state",
    "state_file_path",
    "write_state",
]
