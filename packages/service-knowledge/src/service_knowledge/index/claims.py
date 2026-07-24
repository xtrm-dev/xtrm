"""Claim-manifest ingestion (PR1 verifier output) — loaded *when present*, skipped otherwise.

PR1 (claim verifier foundations) emits a per-service claim manifest. PR3 indexes those claims
as ``kind=claim`` items with their verification verdict + provenance so retrieval can rank on
authority and surface conflicts. The manifest is optional: a service with no manifest simply
contributes no claim rows (the builder never fails on an absent or malformed manifest).

Manifest shape (research §3.3 envelope, §2.5 claim manifest), tolerant of missing fields::

    {"schema_version": 1, "claims": [
       {"id": "...", "claim_type": "invariant", "text": "...", "authority": "curated",
        "status": "active", "risk": "high",
        "citations": [{"path": "svc/x.py", "line_start": 10, "line_end": 12}],
        "verification": {"verdict": "verified", "verifier_version": "0.2.0",
                          "evidence_digest": "sha256:..."},
        "source": {"path": "svc/SKILL.md", "ref": "<sha>", "hash": "sha256:..."}}
    ]}
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Claim:
    claim_id: str
    claim_type: str
    text: str
    authority: str
    status: str
    risk: str
    citations: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    verification: dict[str, Any] = field(default_factory=dict)
    source: dict[str, Any] = field(default_factory=dict)


def manifest_candidates(service_skill_dir: Path, consumer_root: Path, service_id: str) -> tuple[Path, ...]:
    """Locations a claim manifest may live at, in precedence order."""
    return (
        Path(service_skill_dir) / "claims.json",
        Path(consumer_root) / ".xtrm" / "state" / "service-knowledge" / "claims" / f"{service_id}.json",
    )


def _normalize_claim(raw: dict[str, Any], fallback_id: str) -> Claim | None:
    text = str(raw.get("text") or raw.get("description") or "").strip()
    if not text:
        return None
    citations = raw.get("citations") or []
    if not isinstance(citations, list):
        citations = []
    verification = raw.get("verification") or {}
    if not isinstance(verification, dict):
        verification = {}
    source = raw.get("source") or {}
    if not isinstance(source, dict):
        source = {}
    return Claim(
        claim_id=str(raw.get("id") or fallback_id),
        claim_type=str(raw.get("claim_type") or raw.get("type") or "claim"),
        text=text,
        authority=str(raw.get("authority") or "unverified"),
        status=str(raw.get("status") or "active"),
        risk=str(raw.get("risk") or "low"),
        citations=tuple(c for c in citations if isinstance(c, dict)),
        verification=verification,
        source=source,
    )


def load_claims(service_skill_dir: Path, consumer_root: Path, service_id: str) -> tuple[Claim, ...]:
    """Load + normalize a service's claims; empty tuple when no manifest is present/parseable."""
    for candidate in manifest_candidates(service_skill_dir, consumer_root, service_id):
        if not candidate.exists():
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        raw_claims = data.get("claims") if isinstance(data, dict) else data
        if not isinstance(raw_claims, list):
            continue
        claims: list[Claim] = []
        for idx, raw in enumerate(raw_claims):
            if not isinstance(raw, dict):
                continue
            claim = _normalize_claim(raw, fallback_id=f"{service_id}:claim:{idx}")
            if claim is not None:
                claims.append(claim)
        return tuple(claims)
    return ()
