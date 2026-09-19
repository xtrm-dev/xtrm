"""Building a fully version-resolved RunManifest before any sample executes.

manifest.json is write-once: this module only ever produces one, complete,
schema-valid manifest dict. Lifecycle state and heartbeat live in a
separate, mutable status.json (see :mod:`xtrm_research.runner`), never here.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from xtrm_research import __version__ as research_version
from xtrm_research.aliases import ResolvedAlias, UnresolvedAlias, is_probable_alias
from xtrm_research.schemas import validate

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
    rationale: str = "",
) -> dict[str, Any]:
    """Validate and assemble the mandatory ``intent`` block.

    Raises ``ValueError`` if ``purpose`` or ``trigger`` is missing — the
    runner must refuse to start a run without them. ``rationale`` (why
    this run happened now, relative to a prior run or a changed
    methodology) is optional: scientific meaning belongs to the
    Experiment definition, not here.
    """
    if not purpose:
        raise ValueError("run intent requires a non-empty purpose")
    if not trigger:
        raise ValueError("run intent requires a non-empty trigger")
    intent: dict[str, Any] = {
        "purpose": purpose,
        "trigger": trigger,
        "refs": refs or [],
        "requested_by": requested_by,
        "tags": tags or [],
    }
    if rationale:
        intent["rationale"] = rationale
    return intent


def _resolve_backend_aliases(
    backend: dict[str, str], alias_resolver: dict[str, str]
) -> tuple[dict[str, str], list[ResolvedAlias], list[UnresolvedAlias]]:
    """Resolve ``backend.model`` and ``backend.model_version`` if either
    looks like a mutable alias; a pinned id is left unchanged with no
    alias record. Every alias-shaped value ends up recorded resolved or
    unresolved — never silently accepted."""
    resolved: list[ResolvedAlias] = []
    unresolved: list[UnresolvedAlias] = []
    backend = dict(backend)
    for field in ("model", "model_version"):
        value = backend.get(field, "")
        if not is_probable_alias(value, alias_resolver):
            continue
        if value in alias_resolver:
            resolved_value = alias_resolver[value]
            backend[field] = resolved_value
            resolved.append(ResolvedAlias(value, resolved_value))
        else:
            unresolved.append(
                UnresolvedAlias(value, f"no resolver entry for alias {value!r}")
            )
    return backend, resolved, unresolved


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
    alias_resolver: dict[str, str] | None = None,
    pi_version: str | None = None,
    specialists_version: str | None = None,
    retried_sample_ids: list[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Assemble and schema-validate a RunManifest. Raises on missing intent."""
    for field in MANDATORY_INTENT_FIELDS:
        if not intent.get(field):
            raise ValueError(f"run intent requires a non-empty {field!r}")

    backend, resolved, unresolved = _resolve_backend_aliases(
        backend, alias_resolver or {}
    )

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
        "aliases": {
            "resolved": [a._asdict() for a in resolved],
            "unresolved": [a._asdict() for a in unresolved],
        },
        "created_at": now_iso,
    }
    if retried_sample_ids is not None:
        manifest["retried_sample_ids"] = retried_sample_ids

    validate("manifest", manifest)
    return manifest
