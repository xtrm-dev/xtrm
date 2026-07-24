"""Evidence marker lifecycle + dispatch smoke test.

Marker block: ``<!-- knowledge:evidence:BUNDLE_ID -->…<!-- /knowledge:evidence -->``. The smoke
test mirrors the specialist-dispatch flow — build a bundle for a SCOPE, attach it to the bead
body, then read it back the way a specialist reads `bd show` and confirm the gate now passes.
"""
from __future__ import annotations

from datetime import datetime

from service_knowledge import index
from service_knowledge.dispatch import (
    attach_marker,
    bundle_identity,
    find_marker,
    render_marker_block,
    strip_marker,
    validate_promotion,
)

SERVICES = {"api-gateway": {"territory": ["api-gateway/**"]}}


def test_bundle_identity_is_deterministic():
    bundle = {"routing": {"matched_services": ["api-gateway"], "source_ref": "abc"},
              "items": [{"id": "x", "score": 1.0, "status": "active"}]}
    assert bundle_identity(bundle) == bundle_identity(bundle)
    bundle_id, evidence_hash = bundle_identity(bundle)
    assert bundle_id.startswith("api-gateway-")
    assert evidence_hash.startswith("sha256:")


def test_render_marker_block_shape():
    bundle = {"routing": {"matched_services": ["api-gateway"], "source_ref": "abc"}, "items": []}
    block = render_marker_block(bundle)
    assert block.startswith("<!-- knowledge:evidence:api-gateway-")
    assert block.rstrip().endswith("<!-- /knowledge:evidence -->")


def test_attach_is_idempotent_rerender():
    bundle = {"routing": {"matched_services": ["api-gateway"], "source_ref": "abc"}, "items": []}
    body = "## SCOPE\napi-gateway/**\n"
    once = attach_marker(body, bundle)
    twice = attach_marker(once, bundle)
    assert once.count("<!-- knowledge:evidence:") == 1
    assert twice.count("<!-- knowledge:evidence:") == 1
    assert once == twice


def test_strip_removes_marker_only():
    bundle = {"routing": {"matched_services": ["api-gateway"], "source_ref": "abc"}, "items": []}
    body = "## SCOPE\napi-gateway/**\n"
    attached = attach_marker(body, bundle)
    assert strip_marker(attached) == body.strip("\n")
    assert find_marker(strip_marker(attached)) is None


def test_find_marker_returns_embedded_bundle():
    bundle = {"routing": {"matched_services": ["api-gateway"], "source_ref": "abc"},
              "items": [{"id": "x", "score": 1.0, "status": "active"}]}
    attached = attach_marker("body", bundle)
    found = find_marker(attached)
    assert found["routing"]["matched_services"] == ["api-gateway"]
    assert found["bundle_id"]
    assert found["evidence_hash"]


def test_dispatch_smoke_create_promote_dispatch(gateway_consumer):
    """create -> attach bundle -> promote (gate passes) -> specialist reads marker from bd show."""
    bundle = index.evidence_for_files(gateway_consumer, ["api-gateway/config.yml"])
    assert bundle["routing"]["matched_services"] == ["api-gateway"]

    # 1. create: bead body with a SCOPE touching the territory, no bundle yet -> gate refuses.
    bead_body = "# Bead: fix rate limiting\n\n## SCOPE\napi-gateway/src/ratelimit.go\n"
    refused = validate_promotion(bead_body, SERVICES, created_at=datetime(2026, 8, 1))
    assert refused.allowed is False

    # 2. dispatch: attach the evidence bundle to the bead body (marker block).
    dispatched_body = attach_marker(bead_body, bundle)

    # 3. promote: gate now passes because matched_services + bundle_id are attached.
    promoted = validate_promotion(dispatched_body, SERVICES, created_at=datetime(2026, 8, 1))
    assert promoted.allowed is True
    assert promoted.evidence_bundle_id

    # 4. specialist reads `bd show": the marker block is present and parseable in the same surface.
    specialist_view = find_marker(dispatched_body)
    assert specialist_view is not None
    assert specialist_view["routing"]["matched_services"] == ["api-gateway"]
    assert specialist_view["items"], "specialist should see real evidence items"
