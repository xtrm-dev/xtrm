"""Research-side mirror of Substrate's *derived* readiness.

``packages/substrate/src/domain/readiness.ts`` ``deriveReadiness`` computes
readiness as a pure projection over stored state: deterministic structural
findings, attestation currency, blockers, claims, lifecycle. Nothing in it is
persisted, so the dataset builder reproduces it here from the frozen snapshot
instead of shelling out — the research package's only remote seam is
``guards.guarded_send``, and reading a database snapshot is not a remote send.

The reproduction is verified independently against the ``sb`` CLI by
``packages/research/scripts/verify_planning_ready_mirror.py``; the recorded
agreement is evidence in the dataset manifest, and the verification script sits
outside the package precisely so the mirror itself stays subprocess-free.
"""

from __future__ import annotations

from typing import Any, Iterable

from xtrm_research.planning_ready import contracts

#: Mirrors TERMINAL_LIFECYCLE in readiness.ts.
TERMINAL_LIFECYCLE = ("done", "cancelled", "archived")

#: Mirrors the default scrutiny policy: every level allowed. An unknown policy
#: ref denies (fail closed), exactly as the incumbent does.
SCRUTINY_LEVELS = contracts.SCRUTINY_LEVELS


def is_attestation_current(
    attestation: dict[str, Any] | None, revision: int, contract_hash: str
) -> bool:
    """Mirrors isAttestationCurrent: a ready attestation for exactly this
    revision and contract hash. Any contract edit invalidates it."""
    return bool(
        attestation
        and attestation.get("outcome") == "ready"
        and attestation.get("issue_revision") == revision
        and attestation.get("contract_hash") == contract_hash
    )


def is_blocker_satisfied(blocker_lifecycle_state: str) -> bool:
    """Mirrors isBlockerSatisfied: a cancelled prerequisite stays unsatisfied."""
    return blocker_lifecycle_state in ("done", "archived")


def derive_readiness(
    *,
    contract: Any,
    scrutiny: Any,
    ownership: Any,
    context_refs: Any,
    lifecycle_state: str,
    defer_until: int | None,
    revision: int,
    contract_hash: str,
    attestation: dict[str, Any] | None,
    unsatisfied_blockers: Iterable[str],
    has_active_claim: bool,
    now: int,
    scrutiny_policy_ref: str = "default",
) -> dict[str, Any]:
    """The incumbent readiness projection: state, dispatchable and reasons."""
    findings = contracts.structural_findings(
        contract,
        scrutiny=scrutiny,
        ownership=ownership,
        context_refs=context_refs,
        lifecycle_state=lifecycle_state,
    )
    structurally_valid = len(findings) == 0
    attestation_current = is_attestation_current(attestation, revision, contract_hash)
    blockers = list(unsatisfied_blockers)
    reasons: list[str] = []
    if lifecycle_state in TERMINAL_LIFECYCLE:
        state = "terminal"
        reasons.append(f"lifecycle is terminal ({lifecycle_state})")
    elif defer_until is not None and defer_until > now:
        state = "deferred"
        reasons.append("deferred until a future time")
    elif not structurally_valid:
        state = "draft"
        for finding in findings:
            reasons.append(f"{finding['field']}: {finding['message']}")
    elif not attestation_current:
        state = "draft"
        reasons.append("no current semantic attestation for this revision + contract hash")
    elif blockers:
        state = "blocked"
        reasons.append(f"unsatisfied blockers: {', '.join(blockers)}")
    elif has_active_claim:
        state = "claimed"
        reasons.append("an active claim holds this issue")
    else:
        state = "ready"

    if state == "ready" and attestation:
        # Only the registered default policy exists in the research mirror;
        # any other ref denies, because the incumbent fails closed on unknown
        # policy refs and a research mirror must not widen authority.
        allowed = (
            scrutiny_policy_ref == "default"
            and isinstance(scrutiny, str)
            and scrutiny in SCRUTINY_LEVELS
        )
        if not allowed:
            state = "draft"
            reasons.append(
                f'scrutiny policy "{scrutiny_policy_ref}" denies level "{scrutiny}"'
            )
    return {
        "state": state,
        "dispatchable": state == "ready",
        "reasons": reasons,
        "structurally_valid": structurally_valid,
        "attestation_current": attestation_current,
        "unsatisfied_blockers": blockers,
    }
