#!/usr/bin/env python3
"""Regenerate src/adapters/research/__fixtures__/xtrm-research-fixture.json.

Fixtures are never hand-written: this script drives the real
`xtrm_research` API (packages/research) to build two real runs in a temp
root — a baseline and a `retry_of` child with a different terminal status —
plus a deliberately corrupted third run directory, then shells out to the
installed `xtrm-research --json` CLI (the documented, versioned contract;
see packages/research/README.md) to capture its actual output for every
read verb the bridge exposes. Nothing here re-derives the JSON by hand.

Prerequisite (not installed by this script):
    python3 -m venv .venv && .venv/bin/pip install -e ../research[dev]
    source .venv/bin/activate

Run from packages/xtrm-app:
    python3 scripts/generate-research-fixtures.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

RESEARCH_ROOT = Path(__file__).resolve().parents[2] / "research"
REGISTRY_ROOT = RESEARCH_ROOT / "tests" / "fixtures" / "registry"
FIXTURE_OUT = Path(__file__).resolve().parent.parent / "src" / "adapters" / "research" / "__fixtures__" / "xtrm-research-fixture.json"
FIXED_NOW = datetime(2026, 9, 17, 12, 0, 0, tzinfo=timezone.utc)

sys.path.insert(0, str(RESEARCH_ROOT / "src"))

from xtrm_research.annotations import append_annotation  # noqa: E402
from xtrm_research.assessments import write_assessment_set  # noqa: E402
from xtrm_research.definitions import DefinitionRegistry  # noqa: E402
from xtrm_research.manifest import build_intent, build_manifest  # noqa: E402
from xtrm_research.runner import retry_run, start_run  # noqa: E402


def _manifest(registry: DefinitionRegistry, run_id: str, trigger: str) -> dict:
    return build_manifest(
        run_id=run_id,
        experiment=registry.latest("experiment", "dup-detect-baseline"),
        workload=registry.latest("workload", "dup-detect"),
        dataset=registry.latest("dataset", "synthetic-pairs"),
        variant=registry.latest("variant", "baseline"),
        evaluators=[registry.latest("evaluator", "exact-match")],
        question_specs=[registry.latest("question_spec", "dup-check")],
        backend={"provider": "deterministic", "model": "always-no-1", "model_version": "v1"},
        code={"repo": "xtrm", "commit": "deadbeef", "dirty": False},
        guards={"mask_version": "v1", "redaction_version": "v1"},
        accounting={"price_table_version": "v1", "telemetry_schema_version": "v1", "otel_semconv_ref": "gen_ai/v1.28"},
        environment={"platform": "fixture"},
        seed=1,
        intent=build_intent(purpose="illustrate the xtrm-app research bridge", trigger=trigger, requested_by="xtrm-app fixture generator"),
        now=FIXED_NOW,
    )


def _sample(i: int) -> dict:
    return {"schema_version": "xtrm-research-sample/v1", "sample_id": f"s-{i}", "index": i, "input": {"pair": [f"a-{i}", f"b-{i}"]}, "status": "ok", "created_at": FIXED_NOW.isoformat()}


def _event(seq: int, kind: str, sample_id: str | None = None, usage: dict | None = None) -> dict:
    event = {"schema_version": "xtrm-research-event/v1", "seq": seq, "ts": FIXED_NOW.isoformat(), "kind": kind}
    if sample_id is not None:
        event["sample_id"] = sample_id
    if usage is not None:
        event["usage"] = usage
    return event


def _cli_envelope(root: Path, *argv: str) -> dict:
    """Raw envelope, `ok` either way — `compare` against a broken run fails as a whole
    (packages/research views.compare_runs has no per-run tolerance) and that failing
    envelope is itself a fixture shape the comparison surface must render."""
    # `check=False`: a CLI-level failure still exits 1 (main.py) but prints its ok:false
    # envelope on stdout, which is exactly the shape this helper exists to capture.
    cmd = [sys.executable, "-m", "xtrm_research.cli.main", "--root", str(root), "--json", *argv]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return json.loads(result.stdout)


def _cli(root: Path, *argv: str) -> dict:
    envelope = _cli_envelope(root, *argv)
    assert envelope["ok"], envelope
    return envelope["data"]


def build(root: Path) -> dict:
    registry = DefinitionRegistry(REGISTRY_ROOT)

    baseline = start_run(root, "run-a", _manifest(registry, "run-a", "baseline"))
    # s-0's completion event carries real usage; s-1's carries a null value paired with its
    # required null_reason — the run analysis sample table (built from `tail`, the only verb
    # exposing per-sample rows; see map-433.md §B7 "no CLI verb exposes samples.jsonl")
    # needs both to render the "usage recorded but unavailable" state honestly.
    usage_ok = {"source": "provider_api", "gen_ai.usage.input_tokens": 42, "gen_ai.usage.output_tokens": 7, "gen_ai.request.model": "always-no-1", "gen_ai.response.model": "always-no-1", "latency_ms": 118.5, "null_reason": None}
    usage_unavailable = {"source": "unknown", "gen_ai.usage.input_tokens": None, "gen_ai.usage.output_tokens": None, "gen_ai.request.model": None, "gen_ai.response.model": None, "latency_ms": None, "null_reason": "not_exposed_by_provider", "null_detail": "usage telemetry unavailable for this backend"}
    baseline.write_event(_event(0, "started"))
    baseline.write_event(_event(1, "sample_completed", sample_id="s-0", usage=usage_ok))
    baseline.write_event(_event(2, "sample_completed", sample_id="s-1", usage=usage_unavailable))
    baseline.write_sample(_sample(0))
    baseline.write_sample(_sample(1))
    write_assessment_set(
        root,
        "run-a",
        "eval-1",
        registry.latest("evaluator", "exact-match"),
        [{"sample_id": "s-0", "answer": {"noul": 0.1}}, {"sample_id": "s-1", "answer": {"noul": 0.9}}],
        {
            "accuracy": {"value": 0.5, "se": 0.5, "ci95": [0.0, 1.0], "n": 2, "method": "binomial-proportion"},
            # A metric with no variance to estimate: se/ci95 are null and method states why,
            # covering "metrics render value/se/ci95/n/method together, method explains a null".
            "latency_ms": {"value": 118.5, "se": None, "ci95": None, "n": 1, "method": "single-sample-no-variance"},
        },
        now=FIXED_NOW,
    )
    baseline.finish("success", now=FIXED_NOW)
    append_annotation(root, "run-a", "xtrm-app fixture generator", "conclusion", "Baseline lands at chance accuracy, as hypothesised.", evidence_status="reproducible", now=FIXED_NOW)

    retry = retry_run(root, "run-a", "run-b", _manifest(registry, "run-b", "baseline"), retried_sample_ids=["s-0"])
    retry.write_event(_event(0, "started"))
    retry.finish("error", now=FIXED_NOW)
    append_annotation(root, "run-b", "xtrm-app fixture generator", "invalid_reason", "Retried sample raised in the deterministic backend.", now=FIXED_NOW)

    # `runs --lineage` and bare `run show`/`tail`/`metrics`/`compare` only ever touch the
    # run(s) they name, but `runs --lineage` also loads *every* manifest on disk to find
    # backward references, with no per-row tolerance — capture it before corrupting run-c.
    fixture = {
        "runsLineage": _cli(root, "runs", "--lineage", "run-a"),
        "runShowA": _cli(root, "run", "show", "run-a"),
        "runShowB": _cli(root, "run", "show", "run-b"),
        "experimentShow": _cli(root, "experiment", "show", "dup-detect-baseline", "--registry-root", str(REGISTRY_ROOT)),
        "workloadShow": _cli(root, "workload", "show", "dup-detect", "--registry-root", str(REGISTRY_ROOT)),
        "questionSpecShow": _cli(root, "question-spec", "show", "dup-check", "--registry-root", str(REGISTRY_ROOT)),
        "tailA": _cli(root, "tail", "run-a"),
        "metricsA": _cli(root, "metrics", "run-a"),
        "compareAB": _cli(root, "compare", "run-a", "run-b"),
        "chartAccuracyAB": _cli(root, "chart-data", "run-a", "run-b", "--metric", "accuracy"),
    }

    # A run whose manifest.json cannot be parsed: exercises the `invalid_manifest`
    # listing-row path (main.py `_runs_row`), not reachable through the public API.
    # `runs` (no --lineage) degrades this to a row instead of failing, so it is captured last.
    (root / "run-c").mkdir(parents=True)
    (root / "run-c" / "manifest.json").write_text("{not json", encoding="utf-8")
    fixture["runs"] = _cli(root, "runs")
    # `compare` has no per-run tolerance: `run_summary` only checks a run directory exists
    # (unlike `runs`, it never parses the manifest), so a run whose id is entirely absent —
    # not merely unreadable — is what actually fails the whole call as one `ok:false`
    # envelope. Captured verbatim for the comparison surface's failure state.
    fixture["compareInvalidEnvelope"] = _cli_envelope(root, "compare", "run-a", "run-missing")
    return fixture


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="xtrm-research-fixture-"))
    try:
        fixture = build(tmp / "runs")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    FIXTURE_OUT.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_OUT.write_text(json.dumps(fixture, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE_OUT}")


if __name__ == "__main__":
    main()
