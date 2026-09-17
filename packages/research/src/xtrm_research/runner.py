"""Runner API: refuses to start without intent, refuses to execute samples
before the manifest with resolved versions is written, and refuses any
write once a run is settled.

manifest.json is write-once and is never rewritten after :func:`start_run`.
Lifecycle state and heartbeat live in the separate, mutable status.json,
which also stores the manifest's content_hash at start time — every write
re-checks manifest.json against that hash, so an out-of-band edit to
manifest.json is caught rather than silently trusted.

A caller can only obtain a working :class:`RunHandle` through
:func:`start_run` or :func:`retry_run`, both of which write manifest.json
and status.json before returning it. Constructing a bare ``RunHandle`` on
an already-settled run raises immediately; constructing one on a run with
no manifest yet is allowed (mirrors "not started"), but every write method
re-checks the gate regardless of how the handle was obtained.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.hashing import compute_content_hash
from xtrm_research.jsonl import append_line, read_lines
from xtrm_research.schemas import validate
from xtrm_research.status import TERMINAL_STATES
from xtrm_research.store import (
    events_path,
    manifest_path,
    refs_path,
    run_dir,
    safe_segment,
    samples_path,
    status_path,
    write_json_atomic,
)


class RunNotStartedError(RuntimeError):
    """Raised when a write is attempted before manifest.json exists on disk."""


class RunSettledError(RuntimeError):
    """Raised when a write is attempted on a run whose status is terminal."""


class ManifestMutatedError(RuntimeError):
    """Raised when manifest.json no longer matches the hash recorded at start."""


class RunHandle:
    def __init__(self, root: Path, run_id: str) -> None:
        self.root = Path(root)
        self.run_id = run_id
        if (
            manifest_path(self.root, run_id).exists()
            and status_path(self.root, run_id).exists()
        ):
            status = _load(status_path(self.root, run_id))
            if status["state"] in TERMINAL_STATES:
                raise RunSettledError(
                    f"run {run_id!r} is settled ({status['state']}); no further writes allowed"
                )

    def _gate(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """Load and re-validate manifest + status; raise if the run isn't
        writable. Returns them so callers don't reload."""
        mpath = manifest_path(self.root, self.run_id)
        if not mpath.exists():
            raise RunNotStartedError(
                f"run {self.run_id!r} has no manifest.json yet; cannot execute samples"
            )
        manifest = _load(mpath)
        validate("manifest", manifest)
        if manifest["run_id"] != self.run_id:
            raise ValueError(
                f"manifest run_id {manifest['run_id']!r} does not match run directory {self.run_id!r}"
            )

        spath = status_path(self.root, self.run_id)
        if not spath.exists():
            raise RunNotStartedError(
                f"run {self.run_id!r} has manifest.json but no status.json"
            )
        status = _load(spath)
        validate("status", status)
        if status["state"] in TERMINAL_STATES:
            raise RunSettledError(f"run {self.run_id!r} is settled ({status['state']})")

        current_hash = compute_content_hash(manifest)
        if current_hash != status["manifest_content_hash"]:
            raise ManifestMutatedError(
                f"manifest.json for {self.run_id!r} was mutated after start "
                f"(expected {status['manifest_content_hash']}, got {current_hash})"
            )
        return manifest, status

    def write_sample(self, sample: dict[str, Any]) -> None:
        self._gate()
        validate("sample", sample)
        append_line(samples_path(self.root, self.run_id), sample)

    def write_event(self, event: dict[str, Any]) -> None:
        self._gate()
        validate("event", event)
        last_seq = _last_event_seq(self.root, self.run_id)
        if last_seq is not None and event["seq"] <= last_seq:
            raise ValueError(
                f"event seq must be strictly monotonic: {event['seq']} is not > last seq {last_seq}"
            )
        append_line(events_path(self.root, self.run_id), event)

    def heartbeat(self, now: datetime | None = None) -> None:
        _, status = self._gate()
        status["last_heartbeat"] = (now or datetime.now(timezone.utc)).isoformat()
        validate("status", status)
        write_json_atomic(status_path(self.root, self.run_id), status)

    def finish(self, state: str, now: datetime | None = None) -> None:
        if state not in TERMINAL_STATES:
            raise ValueError(f"finish() requires a terminal state, got {state!r}")
        _, status = self._gate()
        status["state"] = state
        status["last_heartbeat"] = (now or datetime.now(timezone.utc)).isoformat()
        validate("status", status)
        write_json_atomic(status_path(self.root, self.run_id), status)


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _last_event_seq(root: Path, run_id: str) -> int | None:
    last: int | None = None
    for event in read_lines(events_path(root, run_id)):
        last = event["seq"]
    return last


def start_run(root: Path, run_id: str, manifest: dict[str, Any]) -> RunHandle:
    """Write manifest.json (write-once) and status.json, and return a
    handle. This is the only way sample/event writes become possible."""
    safe_segment(run_id, "run_id")
    if manifest["run_id"] != run_id:
        raise ValueError(
            f"manifest run_id {manifest['run_id']!r} does not match run_id {run_id!r}"
        )
    validate("manifest", manifest)

    run_dir(root, run_id).mkdir(parents=True, exist_ok=False)
    write_json_atomic(manifest_path(root, run_id), manifest)

    now_iso = datetime.now(timezone.utc).isoformat()
    status = {
        "schema_version": "xtrm-research-status/v1",
        "run_id": run_id,
        "state": "started",
        "last_heartbeat": now_iso,
        "manifest_content_hash": compute_content_hash(manifest),
    }
    validate("status", status)
    write_json_atomic(status_path(root, run_id), status)
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
    if not manifest_path(root, parent_run_id).exists():
        raise ValueError(f"retry_of parent run {parent_run_id!r} does not exist")
    lineage = list(manifest.get("lineage", []))
    lineage.append({"relation": "retry_of", "run_id": parent_run_id})
    manifest = {
        **manifest,
        "lineage": lineage,
        "retried_sample_ids": retried_sample_ids,
    }
    return start_run(root, new_run_id, manifest)


def _derive_refs(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "xtrm-research-refs/v1",
        "run_id": manifest["run_id"],
        "experiment_id": manifest["experiment"]["id"],
        "variant_id": manifest["variant"]["id"],
        "lineage": manifest.get("lineage", []),
    }
