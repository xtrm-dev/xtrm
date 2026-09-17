"""Runner API: refuses to start without intent, refuses to execute samples
before the manifest with resolved versions is written.

A caller can only obtain a :class:`RunHandle` through :func:`start_run` or
:func:`retry_run`, both of which write ``manifest.json`` before returning
it — the invariant holds by construction. ``RunHandle`` re-checks
``manifest.json`` exists on every write as defense in depth.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.jsonl import append_line
from xtrm_research.schemas import validate
from xtrm_research.store import (
    events_path,
    manifest_path,
    refs_path,
    run_dir,
    samples_path,
    write_json_atomic,
)


class RunNotStartedError(RuntimeError):
    """Raised when a write is attempted before manifest.json exists on disk."""


class RunHandle:
    def __init__(self, root: Path, run_id: str) -> None:
        self.root = Path(root)
        self.run_id = run_id

    def _require_started(self) -> None:
        if not manifest_path(self.root, self.run_id).exists():
            raise RunNotStartedError(
                f"run {self.run_id!r} has no manifest.json yet; cannot execute samples"
            )

    def write_sample(self, sample: dict[str, Any]) -> None:
        self._require_started()
        validate("sample", sample)
        append_line(samples_path(self.root, self.run_id), sample)

    def write_event(self, event: dict[str, Any]) -> None:
        self._require_started()
        validate("event", event)
        append_line(events_path(self.root, self.run_id), event)

    def heartbeat(self, now: datetime | None = None) -> None:
        self._require_started()
        manifest = _load(manifest_path(self.root, self.run_id))
        manifest["status"]["last_heartbeat"] = (now or datetime.now(timezone.utc)).isoformat()
        validate("manifest", manifest)
        write_json_atomic(manifest_path(self.root, self.run_id), manifest)

    def finish(self, state: str, now: datetime | None = None) -> None:
        if state not in ("success", "error", "invalid"):
            raise ValueError(f"finish() requires a terminal state, got {state!r}")
        self._require_started()
        manifest = _load(manifest_path(self.root, self.run_id))
        manifest["status"] = {
            "state": state,
            "last_heartbeat": (now or datetime.now(timezone.utc)).isoformat(),
        }
        validate("manifest", manifest)
        write_json_atomic(manifest_path(self.root, self.run_id), manifest)


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def start_run(root: Path, run_id: str, manifest: dict[str, Any]) -> RunHandle:
    """Write ``manifest.json`` (and its derived ``refs.json``) and return a
    handle. This is the only way sample/event writes become possible."""
    validate("manifest", manifest)
    run_dir(root, run_id).mkdir(parents=True, exist_ok=False)
    write_json_atomic(manifest_path(root, run_id), manifest)
    write_json_atomic(refs_path(root, run_id), _derive_refs(manifest))
    return RunHandle(root, run_id)


def retry_run(
    root: Path,
    parent_run_id: str,
    new_run_id: str,
    manifest: dict[str, Any],
    retried_sample_ids: list[str],
) -> RunHandle:
    """Start a new run lineaged ``retry_of`` the parent. Never touches the
    parent's files — the parent directory is not opened for writing."""
    lineage = list(manifest.get("lineage", []))
    lineage.append({"relation": "retry_of", "run_id": parent_run_id})
    manifest = {**manifest, "lineage": lineage, "retried_sample_ids": retried_sample_ids}
    return start_run(root, new_run_id, manifest)


def _derive_refs(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "xtrm-research-refs/v1",
        "run_id": manifest["run_id"],
        "experiment_id": manifest["experiment"]["id"],
        "variant_id": manifest["variant"]["id"],
        "lineage": manifest.get("lineage", []),
    }
