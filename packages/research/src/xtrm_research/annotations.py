"""Append-only annotations.jsonl: conclusions, caveats and evidence status."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.jsonl import append_line, read_lines
from xtrm_research.schemas import validate
from xtrm_research.store import annotations_path


def append_annotation(
    root: Path,
    run_id: str,
    author: str,
    kind: str,
    text: str,
    evidence_status: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    annotation: dict[str, Any] = {
        "schema_version": "xtrm-research-annotation/v1",
        "author": author,
        "timestamp": (now or datetime.now(timezone.utc)).isoformat(),
        "kind": kind,
        "text": text,
    }
    if evidence_status is not None:
        annotation["evidence_status"] = evidence_status
    validate("annotation", annotation)
    append_line(annotations_path(root, run_id), annotation)
    return annotation


def list_annotations(root: Path, run_id: str) -> list[dict[str, Any]]:
    return list(read_lines(annotations_path(root, run_id)))


def latest_conclusion(root: Path, run_id: str) -> str | None:
    conclusions = [a for a in list_annotations(root, run_id) if a["kind"] == "conclusion"]
    return conclusions[-1]["text"] if conclusions else None


def latest_evidence_status(root: Path, run_id: str) -> str | None:
    statuses = [a for a in list_annotations(root, run_id) if a["kind"] == "evidence_status"]
    return statuses[-1]["evidence_status"] if statuses else None
