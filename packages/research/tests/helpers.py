"""Shared test fixture builders."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from xtrm_research.guards import guard_versions
from xtrm_research.manifest import build_intent, build_manifest

FIXED_NOW = datetime(2026, 9, 17, 12, 0, 0, tzinfo=timezone.utc)


def make_manifest(
    registry, run_id: str = "run-0001", **overrides: Any
) -> dict[str, Any]:
    workload = registry.latest("workload", "dup-detect")
    experiment = registry.latest("experiment", "dup-detect-baseline")
    variant = registry.latest("variant", "baseline")
    dataset = registry.latest("dataset", "synthetic-pairs")
    evaluator = registry.latest("evaluator", "exact-match")
    question_spec = registry.latest("question_spec", "dup-check")

    intent = overrides.pop(
        "intent",
        build_intent(
            purpose="prove the skeleton works", trigger="baseline", requested_by="test"
        ),
    )
    kwargs: dict[str, Any] = dict(
        run_id=run_id,
        experiment=experiment,
        workload=workload,
        dataset=dataset,
        variant=variant,
        evaluators=[evaluator],
        question_specs=[question_spec],
        backend={
            "provider": "deterministic",
            "model": "always-no-1",
            "model_version": "v1",
        },
        code={"repo": "xtrm", "commit": "deadbeef", "dirty": False},
        guards=guard_versions(),
        accounting={
            "price_table_version": "v1",
            "telemetry_schema_version": "v1",
            "otel_semconv_ref": "gen_ai/v1.28",
        },
        environment={"platform": "test"},
        seed=1,
        intent=intent,
        now=FIXED_NOW,
    )
    kwargs.update(overrides)
    return build_manifest(**kwargs)
