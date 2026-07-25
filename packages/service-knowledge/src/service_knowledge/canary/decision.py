"""Runtime canary decision — shared by ``reconcile.py`` and the tests.

Extracted from ``scripts/reconcile.py`` so unit tests can exercise the decision
logic without importing the vendored ``verifier`` package (which transitively
pulls in ``markdown_it`` and other third-party deps).

Fail-closed defaults, in this order:
  * ``SERVICE_KNOWLEDGE_CANARY=off`` in env -> off (per-run operator override).
  * verdict is anything other than plain ``PASS`` -> off.
  * state file missing / malformed -> off (handled by :func:`state.read_state`).
  * any claim class outside the enabled allow-list -> off for the whole diff.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable, Protocol

from service_knowledge.canary import state as state_mod


class _HasValue(Protocol):
    value: str


class _HasClaimType(Protocol):
    claim_type: _HasValue


class _HasVerdict(Protocol):
    verdict: _HasValue


DISABLED_SNAPSHOT: dict[str, Any] = {"enabled": False, "classes": []}


def evaluate(manifest, decision, *, state_root: Path) -> tuple[bool, str, dict[str, Any]]:  # type: ignore[no-untyped-def]
    """Return ``(auto_merge, reason, state_snapshot)``.

    ``manifest`` must expose ``.claims`` where each claim has ``.claim_type.value``.
    ``decision`` must expose ``.verdict.value``.
    """
    if os.environ.get("SERVICE_KNOWLEDGE_CANARY", "").lower() == "off":
        return False, "env_override_off", DISABLED_SNAPSHOT
    verdict = getattr(getattr(decision, "verdict", None), "value", None)
    if verdict != "PASS":
        return False, f"verdict_not_pass:{verdict}", DISABLED_SNAPSHOT
    st = state_mod.read_state(Path(state_root))
    snapshot = st.to_dict()
    if not st.is_active:
        return False, "canary_off", snapshot
    claim_type_values = _claim_type_values(getattr(manifest, "claims", []) or [])
    eligible, reason = state_mod.is_diff_class_eligible(claim_type_values, st.classes)
    return eligible, reason, snapshot


def _claim_type_values(claims: Iterable[_HasClaimType]) -> list[str]:
    out: list[str] = []
    for c in claims:
        ct = getattr(c, "claim_type", None)
        v = getattr(ct, "value", None)
        if isinstance(v, str):
            out.append(v)
    return out
