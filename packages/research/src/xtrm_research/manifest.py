"""Building a fully version-resolved RunManifest before any sample executes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from xtrm_research import __version__ as research_version
from xtrm_research.aliases import ResolvedAlias, UnresolvedAlias
from xtrm_research.schemas import SchemaValidationError, validate

MANDATORY_INTENT_FIELDS = ("purpose", "trigger")


def _version_ref(definition: dict[str, Any]) -> dict[str, str]:
    return {
        "id": definition["id"],
        "version": definition["version"],
        "content_hash": definition["content_hash"],
    }


def build_intent(
    purpose: str,
    trigger: str,
    refs: list[str] | None = None,
    requested_by: str = "",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Validate and assemble the mandatory ``intent`` block.

    Raises ``ValueError`` if ``purpose`` or ``trigger`` is missing — the
    runner must refuse to start a run without them.
    """
    if not purpose:
        raise ValueError("run intent requires a non-empty purpose")
    if not trigger:
        raise ValueError("run intent requires a non-empty trigger")
    return {
        "purpose": purpose,
        "trigger": trigger,
        "refs": refs or [],
        "requested_by": requested_by,
        "tags": tags or [],
    }


def build_manifest(
    *,
    run_id: str,
    experiment: dict[str, Any],
    workload: dict[str, Any],
    dataset: dict[str, Any],
    variant: dict[str, Any],
    evaluators: list[dict[str, Any]],
    question_specs: list[dict[str, Any]],
    backend: dict[str, str],
    code: dict[str, Any],
    guards: dict[str, str],
    accounting: dict[str, str],
    environment: dict[str, Any],
    seed: int,
    intent: dict[str, Any],
    lineage: list[dict[str, str]] | None = None,
    resolved_aliases: list[ResolvedAlias] | None = None,
    unresolved_aliases: list[UnresolvedAlias] | None = None,
    pi_version: str | None = None,
    specialists_version: str | None = None,
    retried_sample_ids: list[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Assemble and schema-validate a RunManifest. Raises on missing intent."""
    for field in MANDATORY_INTENT_FIELDS:
        if not intent.get(field):
            raise ValueError(f"run intent requires a non-empty {field!r}")

    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()

    manifest: dict[str, Any] = {
        "schema_version": "xtrm-research-manifest/v1",
        "run_id": run_id,
        "experiment": _version_ref(experiment),
        "workload": _version_ref(workload),
        "dataset": _version_ref(dataset),
        "variant": _version_ref(variant),
        "evaluators": [_version_ref(e) for e in evaluators],
        "question_specs": [_version_ref(q) for q in question_specs],
        "runtime": {
            "research_version": research_version,
            "pi_version": pi_version,
            "specialists_version": specialists_version,
        },
        "backend": backend,
        "code": code,
        "guards": guards,
        "accounting": accounting,
        "environment": environment,
        "seed": seed,
        "intent": intent,
        "lineage": lineage or [],
        "status": {"state": "started", "last_heartbeat": now_iso},
        "aliases": {
            "resolved": [a._asdict() for a in (resolved_aliases or [])],
            "unresolved": [a._asdict() for a in (unresolved_aliases or [])],
        },
        "created_at": now_iso,
    }
    if retried_sample_ids is not None:
        manifest["retried_sample_ids"] = retried_sample_ids

    try:
        validate("manifest", manifest)
    except SchemaValidationError:
        raise
    return manifest
