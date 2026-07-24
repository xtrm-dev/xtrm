"""Dispatch integration: evidence bundles attached to bead bodies (research §3.7).

The retrieval surface (PR3) is passive unless something *demands* it. This module is the
demand side: it renders a §3.2 evidence bundle into a well-defined marker block that lives in
the bead body (so a specialist reads it via ``bd show`` in the same surface as the rest of the
contract), and it provides the contract-promotion gate that refuses to promote a bead touching a
registered territory unless the bundle is attached.

Public surface:

* :func:`render_marker_block` / :func:`attach_marker` / :func:`strip_marker` / :func:`find_marker`
  — the ``<!-- knowledge:evidence:BUNDLE_ID -->…<!-- /knowledge:evidence -->`` marker lifecycle.
* :func:`bundle_identity` — deterministic ``(bundle_id, evidence_hash)`` for a bundle.
* :func:`validate_promotion` — the contract:draft → contract:ready gate (regex on ``bd show``
  output; NO bd schema change).
"""
from __future__ import annotations

from service_knowledge.dispatch.evidence import (
    MARKER_CLOSE,
    MARKER_OPEN_PREFIX,
    attach_marker,
    bundle_identity,
    find_marker,
    render_marker_block,
    strip_marker,
)
from service_knowledge.dispatch.promotion import (
    GATE_EFFECTIVE_ENV,
    GATE_EFFECTIVE_FILE_REL,
    PROMOTION_GATE_COMPONENT,
    PromotionDecision,
    ensure_gate_activated,
    extract_section,
    resolve_gate_effective,
    scope_matched_services,
    scope_path_tokens,
    validate_promotion,
)

__all__ = [
    "GATE_EFFECTIVE_ENV",
    "GATE_EFFECTIVE_FILE_REL",
    "MARKER_CLOSE",
    "MARKER_OPEN_PREFIX",
    "PROMOTION_GATE_COMPONENT",
    "PromotionDecision",
    "attach_marker",
    "bundle_identity",
    "ensure_gate_activated",
    "extract_section",
    "find_marker",
    "render_marker_block",
    "resolve_gate_effective",
    "scope_matched_services",
    "scope_path_tokens",
    "strip_marker",
    "validate_promotion",
]
