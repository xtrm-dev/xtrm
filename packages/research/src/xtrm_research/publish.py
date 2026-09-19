"""Publish research evidence the app can show and retrieve (XTRM-509).

The app (packages/xtrm-app, through the ``xtrm-research --json`` CLI)
reads four things; a result missing any of them is not evidence it can
show:

1. registry definitions — experiment (hypothesis, legend, chart_specs),
   workload, variant, dataset, question specs — resolvable by the ids and
   hashes the run manifest records (:func:`register`);
2. a run — write-once manifest, ``samples.jsonl`` and ``events.jsonl``;
   the sample table is built from events grouped by ``sample_id``;
3. assessment sets — the metrics (``value``, ``se``, ``ci95``, ``n``,
   ``method``) that ``metrics`` and ``compare`` return;
4. annotations — ``conclusion``, ``caveat``, ``evidence_status``,
   ``superseded_by``; the runs list shows the latest conclusion and status.

:func:`publish_run` writes 2-4 in one go and removes the run directory if
any write fails, so a half-published run never reaches a reader.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.annotations import append_annotation
from xtrm_research.assessments import write_assessment_set
from xtrm_research.code_state import capture_code_state
from xtrm_research.environment import capture_environment
from xtrm_research.guards import guard_versions
from xtrm_research.hashing import compute_content_hash, verify_content_hash
from xtrm_research.manifest import build_intent, build_manifest
from xtrm_research.runner import start_run
from xtrm_research.schemas import validate
from xtrm_research.store import run_dir

#: The package's own registry, which the app's bridge is pointed at
#: (``XTRM_RESEARCH_REGISTRY_ROOT``).
REGISTRY_ROOT = Path(__file__).resolve().parents[2] / "registry"

AUTHOR = "claude/hguv"


def define(kind: str, body: dict[str, Any]) -> dict[str, Any]:
    """``body`` with its content hash, schema-validated for ``kind``."""
    payload = {k: v for k, v in body.items() if k != "content_hash"}
    definition = {**payload, "content_hash": compute_content_hash(payload)}
    validate(kind, definition)
    return definition


def question_spec(
    spec_id: str, version: str, body: dict[str, Any], **extra: Any
) -> dict[str, Any]:
    """A question_spec definition body from a System One question body:
    a Choice gets ``options`` (its criteria labels), a Score gets
    ``legend`` (level number -> criterion text, from 0 as Jev numbers
    them)."""
    spec: dict[str, Any] = {"id": spec_id, "version": version, **body, **extra}
    if body["type"] == "choice":
        spec["options"] = list(body["criteria"])
    if body["type"] == "score":
        spec["legend"] = {str(i): str(c) for i, c in enumerate(body["criteria"])}
    return spec


def register(registry_root: Path, kind: str, body: dict[str, Any]) -> dict[str, Any]:
    """Write a definition to ``<root>/<kind>/<id>-<version>.json`` once.
    Re-registering identical content is a no-op; different content under
    the same id and version raises (a definition version is immutable)."""
    definition = define(kind, body)
    path = (
        Path(registry_root) / kind / f"{definition['id']}-{definition['version']}.json"
    )
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing.get("content_hash") != definition[
            "content_hash"
        ] or not verify_content_hash(existing):
            raise FileExistsError(
                f"{kind} {definition['id']} {definition['version']} exists with different content"
            )
        return existing
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(definition, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return definition


def metric(
    value: float | None,
    ci95: list[float] | None,
    n: int,
    method: str,
    se: float | None = None,
) -> dict[str, Any] | None:
    """One assessment-set metric; None when ``value`` is not established
    (the schema has no null value — an absent metric reads 'not
    established' and the reason goes in a caveat)."""
    if value is None:
        return None
    return {
        "value": float(value),
        "se": se,
        "ci95": [float(c) for c in ci95] if ci95 else None,
        "n": n,
        "method": method,
    }


def publish_run(
    root: Path,
    run_id: str,
    *,
    experiment: dict[str, Any],
    workload: dict[str, Any],
    dataset: dict[str, Any],
    variant: dict[str, Any],
    question_specs: list[dict[str, Any]],
    evaluator: dict[str, Any],
    backend: dict[str, str],
    accounting: dict[str, str],
    intent: dict[str, Any],
    samples: list[dict[str, Any]],
    records: list[dict[str, Any]],
    assessments: list[dict[str, Any]],
    metrics: dict[str, dict[str, Any] | None],
    annotations: list[dict[str, str]],
    lineage: list[dict[str, str]] | None = None,
    seed: int = 0,
) -> Path:
    """Write one complete, app-visible run. ``samples``: ``{"sample_id",
    "input", "output"?, "status"?}``. ``records``: the workflow runner's
    ``{"kind", "sample_id", "data", "usage"?}`` in order. ``annotations``:
    ``{"kind", "text", "evidence_status"?, "result_summary"?}``; a
    ``result_summary`` annotation carries the structured companion (supported
    / unsupported claims, caveats, decision). A None metric is dropped."""
    now = datetime.now(timezone.utc)
    rows = [
        {
            "schema_version": "xtrm-research-sample/v1",
            "sample_id": s["sample_id"],
            "index": i,
            "input": s["input"],
            **({"output": s["output"]} if "output" in s else {}),
            "status": s.get("status", "ok"),
            "created_at": now.isoformat(),
        }
        for i, s in enumerate(samples)
    ]
    for row in rows:
        validate("sample", row)
    manifest = build_manifest(
        run_id=run_id,
        experiment=experiment,
        workload=workload,
        dataset=dataset,
        variant=variant,
        evaluators=[evaluator],
        question_specs=question_specs,
        backend=backend,
        code=capture_code_state(Path(__file__).resolve().parents[2]),
        guards=guard_versions(),
        accounting=accounting,
        environment=capture_environment(),
        seed=seed,
        intent=build_intent(**intent),
        lineage=lineage,
        now=now,
    )
    handle = start_run(root, run_id, manifest)
    try:
        for row in rows:
            handle.write_sample(row)
        for seq, rec in enumerate(records):
            event = {
                "schema_version": "xtrm-research-event/v1",
                "seq": seq,
                "ts": now.isoformat(),
                "kind": rec["kind"],
                "sample_id": rec["sample_id"],
                "data": rec["data"],
            }
            if rec.get("usage") is not None:
                event["usage"] = rec["usage"]
            handle.write_event(event)
        write_assessment_set(
            root,
            run_id,
            f"as-{evaluator['id']}",
            evaluator,
            assessments,
            {k: v for k, v in metrics.items() if v is not None},
            now=now,
        )
        for note in annotations:
            append_annotation(
                root,
                run_id,
                AUTHOR,
                note["kind"],
                note["text"],
                note.get("evidence_status"),
                now=now,
                result_summary=note.get("result_summary"),
            )
        handle.finish("success")
    except BaseException:
        shutil.rmtree(run_dir(root, run_id), ignore_errors=True)
        raise
    return run_dir(root, run_id)
