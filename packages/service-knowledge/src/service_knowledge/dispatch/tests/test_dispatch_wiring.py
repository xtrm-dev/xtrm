"""End-to-end wiring tests: the real PreToolUse activator subprocess driving real Bash commands.

Proves the two demand-side gates are actually wired into Bash execution (not just helper logic):

* ``sp``/``specialists … --bead <id>``  -> the activator attaches the §3.2 evidence bundle to the
  bead body (via ``bd show --json`` + ``bd update --body-file -``) BEFORE the dispatch runs.
* ``bd set-state <id> contract=ready``  -> the activator runs the contract-promotion gate and
  REFUSES (deny) when validation fails; ``OVERRIDE_KNOWLEDGE_BUNDLE=1`` proceeds with a warning;
  beads created before the (injectable) activation cutoff carry over.

``bd`` is a faithful boundary stub (see conftest ``fake_bd``) backed by a JSON store, so the real
activator subprocess is exercised end-to-end without touching a real beads database.
"""
from __future__ import annotations

from service_knowledge.dispatch import attach_marker
from service_knowledge.dispatch.tests.conftest import (
    read_bead,
    read_telemetry,
    run_activator,
    write_bead,
)

GATE_ENV = {"SERVICE_KNOWLEDGE_GATE_EFFECTIVE": "2026-07-24T00:00:00"}
AFTER_CUTOFF = "2026-08-01T00:00:00Z"
BEFORE_CUTOFF = "2026-07-01T00:00:00Z"
SCOPE_BODY = "# Bead: fix rate limiting\n\n## SCOPE\napi-gateway/src/ratelimit.go\n"


def _bd_env(fake_bd):
    return {**fake_bd["env"], **GATE_ENV}


def test_sp_dispatch_attaches_evidence_before_specialist_runs(gateway_consumer, fake_bd):
    write_bead(fake_bd, "xtrm-dispatch1", SCOPE_BODY, created_at=AFTER_CUTOFF)
    code, out, err = run_activator(
        gateway_consumer, "Bash", {"command": "sp executor --bead xtrm-dispatch1"},
        extra_env=_bd_env(fake_bd))
    assert code == 0, err

    # The bead body now carries the evidence marker block (attached before sp runs).
    bead = read_bead(fake_bd, "xtrm-dispatch1")
    assert "<!-- knowledge:evidence:" in bead["description"]
    assert "api-gateway" in bead["description"]

    # The dispatching agent also sees the bundle injected as context.
    hook = out["hookSpecificOutput"]
    assert hook.get("permissionDecision") != "deny"
    assert "evidence bundle" in hook["additionalContext"]

    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "dispatch"]
    assert events and events[-1]["decision"] == "attached"
    assert events[-1]["bead_id"] == "xtrm-dispatch1"
    assert events[-1]["bundle_id"]


def test_specialists_dispatch_with_equals_form_attaches(gateway_consumer, fake_bd):
    write_bead(fake_bd, "xtrm-dispatch2", SCOPE_BODY, created_at=AFTER_CUTOFF)
    code, _out, err = run_activator(
        gateway_consumer, "Bash", {"command": "specialists run executor --bead=xtrm-dispatch2"},
        extra_env=_bd_env(fake_bd))
    assert code == 0, err
    assert "<!-- knowledge:evidence:" in read_bead(fake_bd, "xtrm-dispatch2")["description"]


def test_dispatch_is_idempotent_rerender(gateway_consumer, fake_bd):
    write_bead(fake_bd, "xtrm-dispatch3", SCOPE_BODY, created_at=AFTER_CUTOFF)
    for _ in range(2):
        code, _, err = run_activator(
            gateway_consumer, "Bash", {"command": "sp executor --bead xtrm-dispatch3"},
            extra_env=_bd_env(fake_bd))
        assert code == 0, err
    assert read_bead(fake_bd, "xtrm-dispatch3")["description"].count("<!-- knowledge:evidence:") == 1


def test_bd_promotion_refused_without_evidence_bundle(gateway_consumer, fake_bd):
    write_bead(fake_bd, "xtrm-promo1", SCOPE_BODY, created_at=AFTER_CUTOFF)
    code, out, err = run_activator(
        gateway_consumer, "Bash", {"command": "bd set-state xtrm-promo1 contract=ready"},
        extra_env=_bd_env(fake_bd))
    assert code == 0, err
    hook = out["hookSpecificOutput"]
    assert hook["permissionDecision"] == "deny"
    reason = hook["permissionDecisionReason"]
    assert "xtrm-promo1" in reason
    assert "api-gateway" in reason
    assert "OVERRIDE_KNOWLEDGE_BUNDLE=1" in reason

    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "bead-validator"]
    assert events and events[-1]["decision"] == "block"
    assert events[-1]["bead_id"] == "xtrm-promo1"


def test_bd_promotion_override_proceeds_with_warning(gateway_consumer, fake_bd):
    write_bead(fake_bd, "xtrm-promo2", SCOPE_BODY, created_at=AFTER_CUTOFF)
    code, out, err = run_activator(
        gateway_consumer, "Bash", {"command": "bd set-state xtrm-promo2 contract=ready"},
        override=True, extra_env=_bd_env(fake_bd))
    assert code == 0, err
    hook = out["hookSpecificOutput"]
    assert hook.get("permissionDecision") != "deny"
    assert "[OVERRIDE]" in hook["additionalContext"]

    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "bead-validator"]
    overrides = [e for e in events if e.get("decision") == "override"]
    assert overrides and overrides[-1]["override_reason"]


def test_bd_promotion_pre_activation_bead_carries_over(gateway_consumer, fake_bd):
    # Created before the injectable activation cutoff -> in-flight, carried over (not refused).
    write_bead(fake_bd, "xtrm-promo3", SCOPE_BODY, created_at=BEFORE_CUTOFF)
    code, out, err = run_activator(
        gateway_consumer, "Bash", {"command": "bd set-state xtrm-promo3 contract=ready"},
        extra_env=_bd_env(fake_bd))
    assert code == 0, err
    hook = out["hookSpecificOutput"]
    assert hook.get("permissionDecision") != "deny"
    assert "carried over" in hook["additionalContext"]

    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "bead-validator"]
    assert events and events[-1]["decision"] in ("allow", "advisory")


def test_bd_promotion_with_attached_bundle_is_allowed(gateway_consumer, fake_bd):
    bundle = {
        "routing": {"matched_services": ["api-gateway"], "source_ref": "abc123"},
        "items": [{"id": "section:x", "score": 1.0, "status": "active"}],
    }
    write_bead(fake_bd, "xtrm-promo4", attach_marker(SCOPE_BODY, bundle), created_at=AFTER_CUTOFF)
    code, out, err = run_activator(
        gateway_consumer, "Bash", {"command": "bd set-state xtrm-promo4 contract=ready"},
        extra_env=_bd_env(fake_bd))
    assert code == 0, err
    hook = out["hookSpecificOutput"] if out else {}
    assert hook.get("permissionDecision") != "deny"

    events = [e for e in read_telemetry(gateway_consumer) if e.get("component") == "bead-validator"]
    assert events and events[-1]["decision"] in ("allow", "advisory")
    assert events[-1].get("evidence_bundle_id")


def test_unreadable_bead_does_not_block_promotion(gateway_consumer, fake_bd):
    # No such bead in the store -> bd show fails -> stay advisory, never block on absent evidence.
    code, out, err = run_activator(
        gateway_consumer, "Bash", {"command": "bd set-state xtrm-missing contract=ready"},
        extra_env=_bd_env(fake_bd))
    assert code == 0, err
    hook = out["hookSpecificOutput"] if out else {}
    assert hook.get("permissionDecision") != "deny"
