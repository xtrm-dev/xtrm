"""Assessment sets: evaluation is separate from execution.

Each evaluation writes one new, immutable ``assessment_set.json`` under
``<run>/assessments/<assessment_set_id>/``. Re-evaluation always adds a new
set; execution files (manifest, samples, events) are never touched.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.schemas import validate
from xtrm_research.store import assessments_dir, write_json_atomic

ASSESSMENT_SET_FILE = "assessment_set.json"


def write_assessment_set(
    root: Path,
    run_id: str,
    assessment_set_id: str,
    evaluator: dict[str, Any],
    assessments: list[dict[str, Any]],
    metrics: dict[str, dict[str, Any]],
    now: datetime | None = None,
) -> Path:
    assessment_set = {
        "schema_version": "xtrm-research-assessment-set/v1",
        "assessment_set_id": assessment_set_id,
        "evaluator": {
            "id": evaluator["id"],
            "version": evaluator["version"],
            "content_hash": evaluator["content_hash"],
        },
        "input_run_id": run_id,
        "timestamp": (now or datetime.now(timezone.utc)).isoformat(),
        "assessments": assessments,
        "metrics": metrics,
    }
    validate("assessment_set", assessment_set)
    set_dir = assessments_dir(root, run_id) / assessment_set_id
    path = set_dir / ASSESSMENT_SET_FILE
    write_json_atomic(path, assessment_set)
    return path


def list_assessment_sets(root: Path, run_id: str) -> list[dict[str, Any]]:
    base = assessments_dir(root, run_id)
    if not base.is_dir():
        return []
    sets = []
    for set_dir in sorted(base.iterdir()):
        path = set_dir / ASSESSMENT_SET_FILE
        if path.exists():
            sets.append(json.loads(path.read_text(encoding="utf-8")))
    return sets
