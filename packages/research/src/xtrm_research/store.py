"""Run directory layout: manifest.json, status.json, samples.jsonl,
events.jsonl, refs.json, artifacts/ (created lazily on first artifact
write, not eagerly).

Default run root is ``~/.xtrm/research/runs``; every function here takes
the root explicitly so tests always point at a tmp dir and never touch
``~/.xtrm``.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_RUNS_ROOT = Path.home() / ".xtrm" / "research" / "runs"

MANIFEST_FILE = "manifest.json"
STATUS_FILE = "status.json"
LOCK_FILE = ".lock"
SAMPLES_FILE = "samples.jsonl"
EVENTS_FILE = "events.jsonl"
REFS_FILE = "refs.json"
ANNOTATIONS_FILE = "annotations.jsonl"
ARTIFACTS_DIR = "artifacts"
ASSESSMENTS_DIR = "assessments"

#: run_id, assessment_set_id and every definition object id must match
#: this allowlist: an alnum first character, then up to 127 more of
#: alnum/dot/underscore/at/colon/hyphen. No separators, no leading dot, no
#: unicode, no control characters, no unbounded length.
SAFE_SEGMENT_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$"
_SAFE_SEGMENT_RE = re.compile(SAFE_SEGMENT_PATTERN)


def safe_segment(name: str, what: str = "path segment") -> str:
    """Reject anything that isn't a single, allowlisted path segment.

    Used for every operator-supplied identifier that becomes part of a
    filesystem path (run_id, assessment_set_id).
    """
    if not _SAFE_SEGMENT_RE.match(name):
        raise ValueError(f"unsafe {what}: {name!r}")
    return name


def run_dir(root: Path, run_id: str) -> Path:
    return Path(root) / safe_segment(run_id, "run_id")


def lock_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / LOCK_FILE


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    """Write ``payload`` as pretty, sorted-key JSON via a tmp-file rename.

    Uses a unique tmp filename (``tempfile.mkstemp`` in the same
    directory), not a fixed ``<name>.tmp``, so two concurrent writers never
    collide on the same tmp path. The rename is atomic on POSIX, so a
    reader never observes a partially-written file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=path.name + ".", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload, sort_keys=True, indent=2) + "\n")
        os.replace(tmp_name, path)
    except BaseException:
        os.unlink(tmp_name)
        raise


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def manifest_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / MANIFEST_FILE


def status_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / STATUS_FILE


def samples_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / SAMPLES_FILE


def events_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / EVENTS_FILE


def refs_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / REFS_FILE


def annotations_path(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / ANNOTATIONS_FILE


def artifacts_dir(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / ARTIFACTS_DIR


def assessments_dir(root: Path, run_id: str) -> Path:
    return run_dir(root, run_id) / ASSESSMENTS_DIR


def run_exists(root: Path, run_id: str) -> bool:
    return manifest_path(root, run_id).exists()


def list_run_ids(root: Path) -> list[str]:
    root = Path(root)
    if not root.is_dir():
        return []
    return sorted(
        p.name for p in root.iterdir() if p.is_dir() and (p / MANIFEST_FILE).exists()
    )


def load_manifest(root: Path, run_id: str) -> dict[str, Any]:
    path = manifest_path(root, run_id)
    if not path.exists():
        raise FileNotFoundError(f"no such run: {run_id!r}")
    return read_json(path)


def load_status(root: Path, run_id: str) -> dict[str, Any]:
    path = status_path(root, run_id)
    if not path.exists():
        raise FileNotFoundError(f"run {run_id!r} has no status.json")
    return read_json(path)
