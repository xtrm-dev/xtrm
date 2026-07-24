"""Contract-promotion gate: refuse draft → ready without an evidence bundle (research §3.7).

The gate is a pure function over ``bd show`` text — there is deliberately NO bd schema change.
A bead whose SCOPE references a registered service territory must carry ``matched_services``
(attached via the evidence marker block or an explicit field) before it may leave
``contract:draft``. Missing ``evidence_bundle_id`` with ``matched_services`` present is advisory
(the index may not be built for that service yet).

Backward compat: beads created before the gate's effective cutoff are carried over — the gate
applies to draft → ready transitions from the moment PR4 merges, not retroactively.
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from service_knowledge.dispatch.evidence import find_marker

PROMOTION_GATE_COMPONENT = "bead-validator"

# PR4 merge cutoff (UTC). Beads created strictly before this are in-flight and carried over.
PROMOTION_GATE_EFFECTIVE = datetime(2026, 7, 24)

_PATH_TOKEN_RE = re.compile(r"[A-Za-z0-9_./\-*]+/[A-Za-z0-9_./\-*]+")
_SECTION_RE_TEMPLATE = r"(?ims)^\s*(?:##\s*)?{name}\b[^\n]*\n(?P<body>.*?)(?=^\s*(?:##\s*)?[A-Z][A-Z_ ]{{2,}}\s*:?\s*$|\Z)"


@dataclass(frozen=True)
class PromotionDecision:
    """Outcome of a promotion-gate check."""

    allowed: bool
    reason: str
    touched_services: tuple[str, ...] = ()
    matched_services: tuple[str, ...] = ()
    evidence_bundle_id: str | None = None
    advisory: bool = False
    decision: str = "allow"  # allow | block | advisory | override
    extra: dict[str, Any] = field(default_factory=dict)


def _territory_base(pattern: str) -> str:
    return pattern.replace("/**/*", "").replace("/**", "").replace("/*", "").rstrip("/")


def _token_touches_pattern(token: str, pattern: str) -> bool:
    if fnmatch.fnmatch(token, pattern):
        return True
    token_base = _territory_base(token)
    pattern_base = _territory_base(pattern)
    if not token_base or not pattern_base:
        return False
    return (
        token_base == pattern_base
        or token_base.startswith(pattern_base + "/")
        or pattern_base.startswith(token_base + "/")
    )


def extract_section(body: str, name: str) -> str:
    """Return the text of a ``## NAME`` / ``NAME:`` section, or ``""`` if absent."""
    pattern = re.compile(_SECTION_RE_TEMPLATE.format(name=re.escape(name)))
    match = pattern.search(body or "")
    return match.group("body").strip() if match else ""


def scope_matched_services(scope_text: str, services: dict[str, Any]) -> list[str]:
    """Registered service_ids whose territory overlaps any path-like token in ``scope_text``."""
    tokens = _PATH_TOKEN_RE.findall(scope_text or "")
    matched: list[str] = []
    for service_id, data in services.items():
        territory = (data or {}).get("territory", []) or []
        if any(_token_touches_pattern(token, pattern) for token in tokens for pattern in territory):
            matched.append(service_id)
    return sorted(matched)


def _attached_matched_services(body: str) -> list[str]:
    """matched_services from the evidence marker block, else an explicit ``matched_services:`` field."""
    bundle = find_marker(body)
    if bundle:
        routing = bundle.get("routing", {}) or {}
        services = routing.get("matched_services", []) or []
        if services:
            return sorted(str(s) for s in services)
    explicit = re.search(r"(?im)^\s*matched_services\s*:\s*(?P<value>.+?)\s*$", body or "")
    if explicit:
        raw = explicit.group("value")
        items = re.findall(r"[A-Za-z0-9_.\-]+", raw.strip("[]"))
        return sorted(items)
    return []


def _attached_bundle_id(body: str) -> str | None:
    bundle = find_marker(body)
    if bundle and bundle.get("bundle_id"):
        return str(bundle["bundle_id"])
    explicit = re.search(r"(?im)^\s*evidence_bundle_id\s*:\s*(?P<value>\S+)", body or "")
    return explicit.group("value") if explicit else None


def _parse_created_at(body: str) -> datetime | None:
    match = re.search(r"(?im)^\s*created(?:_at)?\s*:\s*(?P<value>.+?)\s*$", body or "")
    if not match:
        return None
    raw = match.group("value").strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def validate_promotion(
    bd_show_text: str,
    services: dict[str, Any],
    *,
    created_at: datetime | None = None,
    gate_effective: datetime | None = None,
) -> PromotionDecision:
    """Decide whether a bead may leave ``contract:draft``.

    Refuse when SCOPE touches a registered territory but no ``matched_services`` is attached.
    Advisory when ``matched_services`` is attached but ``evidence_bundle_id`` is absent.
    Beads created before ``gate_effective`` (default: PR4 cutoff) are carried over.
    """
    body = bd_show_text or ""
    scope_text = extract_section(body, "SCOPE") or body
    touched = tuple(scope_matched_services(scope_text, services))

    if not touched:
        return PromotionDecision(
            allowed=True,
            reason="SCOPE does not reference any registered service territory",
            decision="allow",
        )

    effective = gate_effective if gate_effective is not None else PROMOTION_GATE_EFFECTIVE
    stamp = created_at if created_at is not None else _parse_created_at(body)
    if stamp is not None and stamp < effective:
        return PromotionDecision(
            allowed=True,
            reason=f"in-flight bead (created {stamp.isoformat()} before gate effective "
            f"{effective.isoformat()}); carried over",
            touched_services=touched,
            advisory=True,
            decision="allow",
        )

    matched = tuple(_attached_matched_services(body))
    bundle_id = _attached_bundle_id(body)

    if not matched:
        return PromotionDecision(
            allowed=False,
            reason=(
                "SCOPE references registered territory "
                f"{', '.join(touched)} but no matched_services attached. "
                "Run knowledge_evidence_for_files for the touched paths and attach the "
                "evidence bundle (marker block) before promoting contract:draft -> contract:ready. "
                "Operator override: set OVERRIDE_KNOWLEDGE_BUNDLE=1."
            ),
            touched_services=touched,
            decision="block",
        )

    if bundle_id is None:
        return PromotionDecision(
            allowed=True,
            reason=(
                f"matched_services attached ({', '.join(matched)}) but no evidence_bundle_id; "
                "index may not be built for this service yet"
            ),
            touched_services=touched,
            matched_services=matched,
            advisory=True,
            decision="advisory",
        )

    return PromotionDecision(
        allowed=True,
        reason=f"evidence bundle {bundle_id} attached for {', '.join(matched)}",
        touched_services=touched,
        matched_services=matched,
        evidence_bundle_id=bundle_id,
        decision="allow",
    )
