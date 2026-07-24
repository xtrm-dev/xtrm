"""Contract-promotion gate tests (research §3.7 dispatch firing point).

The gate is a pure function over `bd show` text — no bd schema change. A bead whose SCOPE touches
a registered territory cannot leave contract:draft without matched_services; matched_services
without a bundle id is advisory; beads created before the gate's effective cutoff carry over.
"""
from __future__ import annotations

from datetime import datetime

from service_knowledge.dispatch import (
    attach_marker,
    resolve_gate_effective,
    validate_promotion,
)

SERVICES = {
    "api-gateway": {"territory": ["api-gateway/**"]},
    "postgres": {"territory": ["db/**", "postgres/**"]},
}
GATE_EFFECTIVE = datetime(2026, 7, 24)  # injected activation cutoff (no midnight hardcode)
AFTER_CUTOFF = datetime(2026, 8, 1)
BEFORE_CUTOFF = datetime(2026, 7, 1)


def test_scope_touching_territory_without_matched_services_is_refused():
    body = "## SCOPE\napi-gateway/src/main.py\n"
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, gate_effective=GATE_EFFECTIVE)
    assert decision.allowed is False
    assert decision.decision == "block"
    assert "api-gateway" in decision.reason
    assert "OVERRIDE_KNOWLEDGE_BUNDLE" in decision.reason


def test_scope_not_touching_territory_is_allowed():
    body = "## SCOPE\ndocs/readme.md\napps/dashboard/**\n"
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, gate_effective=GATE_EFFECTIVE)
    assert decision.allowed is True
    assert decision.decision == "allow"


def test_inflight_bead_before_cutoff_carries_over():
    body = "## SCOPE\napi-gateway/**\n"
    decision = validate_promotion(body, SERVICES, created_at=BEFORE_CUTOFF, gate_effective=GATE_EFFECTIVE)
    assert decision.allowed is True
    assert decision.advisory is True
    assert "carried over" in decision.reason


def test_created_at_parsed_from_bd_show_text():
    body = "created: 2026-07-01T00:00:00Z\n## SCOPE\napi-gateway/**\n"
    decision = validate_promotion(body, SERVICES, gate_effective=GATE_EFFECTIVE)  # created_at parsed
    assert decision.allowed is True
    assert "carried over" in decision.reason


def test_inactive_gate_carries_everything_over():
    # No gate_effective, no env, no marker file -> gate inactive -> even an un-bundled bead passes.
    body = "## SCOPE\napi-gateway/src/main.py\n"
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, env={})
    assert decision.allowed is True
    assert decision.advisory is True
    assert "not activated" in decision.reason


def test_gate_effective_injected_via_env():
    body = "## SCOPE\napi-gateway/src/main.py\n"
    env = {"SERVICE_KNOWLEDGE_GATE_EFFECTIVE": "2026-07-24T00:00:00"}
    assert resolve_gate_effective(env=env) == datetime(2026, 7, 24)
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, env=env)
    assert decision.allowed is False  # gate active via env -> un-bundled bead refused


def test_gate_effective_injected_via_marker_file(tmp_path):
    marker = tmp_path / ".xtrm" / "state" / "service-knowledge" / "gate-effective"
    marker.parent.mkdir(parents=True)
    marker.write_text("2026-07-24T00:00:00\n", encoding="utf-8")
    assert resolve_gate_effective(tmp_path, env={}) == datetime(2026, 7, 24)
    body = "## SCOPE\napi-gateway/src/main.py\n"
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF,
                                  consumer_root=tmp_path, env={})
    assert decision.allowed is False


def test_evidence_marker_satisfies_gate():
    bundle = {
        "routing": {"matched_services": ["api-gateway"], "source_ref": "abc123"},
        "items": [{"id": "section:x", "score": 1.0, "status": "active"}],
    }
    body = attach_marker("## SCOPE\napi-gateway/**\n", bundle)
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, gate_effective=GATE_EFFECTIVE)
    assert decision.allowed is True
    assert decision.evidence_bundle_id is not None
    assert decision.matched_services == ("api-gateway",)


def test_explicit_matched_services_without_bundle_is_advisory():
    body = "## SCOPE\napi-gateway/**\nmatched_services: [api-gateway]\n"
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, gate_effective=GATE_EFFECTIVE)
    assert decision.allowed is True
    assert decision.advisory is True
    assert decision.decision == "advisory"
    assert decision.evidence_bundle_id is None


def test_multiple_territories_detected():
    body = "## SCOPE\napi-gateway/**\ndb/migrations/001.sql\n"
    decision = validate_promotion(body, SERVICES, created_at=AFTER_CUTOFF, gate_effective=GATE_EFFECTIVE)
    assert set(decision.touched_services) == {"api-gateway", "postgres"}
    assert decision.allowed is False  # no matched_services attached
