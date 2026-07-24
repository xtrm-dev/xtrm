"""Evidence-bundle → bead-body marker block (research §3.7 dispatch firing point).

A bead touching a registered territory must carry (or reference) that territory's evidence
bundle. Rather than change the bd schema, the bundle is rendered into a well-defined marker
block embedded in the bead body::

    <!-- knowledge:evidence:BUNDLE_ID -->
    ```json
    { …§3.2 bundle… }
    <!-- /knowledge:evidence -->

Downstream tooling (specialists, validators, re-renderers) can find, replace or strip the block
by its markers. ``BUNDLE_ID`` and the embedded ``evidence_hash`` are deterministic so a re-render
against an unchanged index is a no-op and a validator can detect drift.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

MARKER_OPEN_PREFIX = "<!-- knowledge:evidence:"
MARKER_CLOSE = "<!-- /knowledge:evidence -->"

# Captures the BUNDLE_ID in the opening marker and the JSON body between the markers.
_MARKER_RE = re.compile(
    re.escape(MARKER_OPEN_PREFIX)
    + r"(?P<bundle_id>[^>\s]+)"
    + r"\s*-->\n(?P<body>.*?)\n"
    + re.escape(MARKER_CLOSE),
    re.DOTALL,
)


def bundle_identity(bundle: dict[str, Any]) -> tuple[str, str]:
    """Deterministic ``(bundle_id, evidence_hash)`` for a §3.2 bundle.

    ``evidence_hash`` covers the ranked items + routing services (the evidence itself), NOT the
    token estimate or ordering metadata, so cosmetically-different-but-equal bundles hash equal.
    ``bundle_id`` is a short human-greppable handle: ``<services>-<hash12>``.
    """
    routing = bundle.get("routing", {}) or {}
    services = sorted(routing.get("matched_services", []) or [])
    evidence_payload = {
        "matched_services": services,
        "source_ref": routing.get("source_ref", ""),
        "items": [
            {"id": item.get("id"), "score": item.get("score"), "status": item.get("status")}
            for item in bundle.get("items", []) or []
        ],
    }
    canonical = json.dumps(evidence_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    evidence_hash = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]
    service_handle = "+".join(services) if services else "unmatched"
    bundle_id = f"{service_handle}-{evidence_hash[len('sha256:'):len('sha256:') + 12]}"
    return bundle_id, evidence_hash


def render_marker_block(bundle: dict[str, Any]) -> str:
    """Render a bundle into its marker block, stamping ``bundle_id`` + ``evidence_hash``."""
    bundle_id, evidence_hash = bundle_identity(bundle)
    stamped = dict(bundle)
    stamped["bundle_id"] = bundle_id
    stamped["evidence_hash"] = evidence_hash
    body = json.dumps(stamped, ensure_ascii=False, indent=2, sort_keys=True)
    return f"{MARKER_OPEN_PREFIX}{bundle_id} -->\n{body}\n{MARKER_CLOSE}"


def strip_marker(body: str) -> str:
    """Remove any existing evidence marker block (and a single trailing blank line)."""
    stripped = _MARKER_RE.sub("", body)
    return re.sub(r"\n{3,}", "\n\n", stripped).strip("\n")


def find_marker(body: str) -> dict[str, Any] | None:
    """Return the embedded bundle (with ``bundle_id``/``evidence_hash``) or ``None``."""
    match = _MARKER_RE.search(body or "")
    if match is None:
        return None
    try:
        bundle = json.loads(match.group("body"))
    except json.JSONDecodeError:
        return None
    if isinstance(bundle, dict):
        bundle.setdefault("bundle_id", match.group("bundle_id"))
        return bundle
    return None


def attach_marker(body: str, bundle: dict[str, Any]) -> str:
    """Attach ``bundle`` to ``body``, replacing any prior marker block (idempotent re-render)."""
    block = render_marker_block(bundle)
    base = strip_marker(body)
    if not base.strip():
        return block + "\n"
    return f"{base}\n\n{block}\n"
