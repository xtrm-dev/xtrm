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

``heartbeat``, ``finish``, ``write_sample`` and ``write_event`` all hold
the run's lock across: the gate check, an authoritative fresh re-read of
status.json, and the write itself — so a concurrent finisher can never
land between another writer's read and its write. The status re-read
happens even when nothing "should" have changed, specifically so it isn't
fooled by a settle that happened during the gate check.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from xtrm_research.aliases import is_probable_alias
from xtrm_research.hashing import compute_content_hash
from xtrm_research.jsonl import append_line, read_lines
from xtrm_research.schemas import validate
from xtrm_research.status import TERMINAL_STATES
from xtrm_research.store import (
    events_path,
    lock_path,
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


class _RunLock:
    """One process-wide, same-thread-reentrant lock per run, backed by an
    fcntl.flock on the outermost acquisition.

    ponytail: single host, advisory lock — not correct over NFS/network
    filesystems, and not a substitute for a real lock service across
    multiple hosts. The reentrant wrapper around flock exists so a
    nested same-thread call (e.g. one write method calling another, or a
    test harness stepping through the gate) doesn't deadlock against
    itself; flock alone has no notion of "the same caller already holds
    this".
    """

    def __init__(self) -> None:
        self._rlock = threading.RLock()
        self._depth = 0
        self._fd: int | None = None

    @contextlib.contextmanager
    def acquire(self, path: Path) -> Iterator[None]:
        with self._rlock:
            if self._depth == 0:
                # ponytail: single host, advisory fcntl.flock — not correct
                # over NFS/network filesystems, not a lock service across hosts.
                path.parent.mkdir(parents=True, exist_ok=True)
                self._fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
                fcntl.flock(self._fd, fcntl.LOCK_EX)
            self._depth += 1
            try:
                yield
            finally:
                self._depth -= 1
                if self._depth == 0:
                    assert self._fd is not None
                    fcntl.flock(self._fd, fcntl.LOCK_UN)
                    os.close(self._fd)
                    self._fd = None


_run_locks: dict[str, _RunLock] = {}
_run_locks_guard = threading.Lock()


@contextlib.contextmanager
def _locked(root: Path, run_id: str) -> Iterator[None]:
    key = str(run_dir(root, run_id))
    with _run_locks_guard:
        run_lock = _run_locks.setdefault(key, _RunLock())
    with run_lock.acquire(lock_path(root, run_id)):
        yield


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
        writable. Returns both, but every write method takes its own fresh
        status re-read via :meth:`_live_status` immediately before writing
        rather than trusting this snapshot, so a settle that happens during
        this call (or during whatever a caller does between this call and
        the write) is never missed. Caller must hold the run's lock across
        this call and whatever write follows it."""
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

    def _live_status(self) -> dict[str, Any]:
        """Authoritative, right-before-write status read: raises if the
        run has settled, no matter when that settlement happened — even if
        it happened during :meth:`_gate` itself, whose returned snapshot
        every write method deliberately ignores for this exact check."""
        status = _load(status_path(self.root, self.run_id))
        validate("status", status)
        if status["state"] in TERMINAL_STATES:
            raise RunSettledError(f"run {self.run_id!r} is settled ({status['state']})")
        return status

    def write_sample(self, sample: dict[str, Any]) -> None:
        validate("sample", sample)
        with _locked(self.root, self.run_id):
            self._gate()
            self._live_status()
            append_line(samples_path(self.root, self.run_id), sample)

    def write_event(self, event: dict[str, Any]) -> None:
        validate("event", event)
        with _locked(self.root, self.run_id):
            self._gate()
            self._live_status()
            last_seq = _last_event_seq(self.root, self.run_id)
            if last_seq is not None and event["seq"] <= last_seq:
                raise ValueError(
                    f"event seq must be strictly monotonic: {event['seq']} is not > last seq {last_seq}"
                )
            append_line(events_path(self.root, self.run_id), event)

    def heartbeat(self, now: datetime | None = None) -> None:
        with _locked(self.root, self.run_id):
            self._gate()
            status = self._live_status()
            status["last_heartbeat"] = (now or datetime.now(timezone.utc)).isoformat()
            validate("status", status)
            write_json_atomic(status_path(self.root, self.run_id), status)

    def finish(self, state: str, now: datetime | None = None) -> None:
        if state not in TERMINAL_STATES:
            raise ValueError(f"finish() requires a terminal state, got {state!r}")
        with _locked(self.root, self.run_id):
            self._gate()
            status = self._live_status()
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


def _check_backend_aliases_recorded(manifest: dict[str, Any]) -> None:
    """Defense in depth against a hand-built manifest that bypassed
    :func:`xtrm_research.manifest.build_manifest`'s own alias resolution:
    an alias-shaped backend.model/model_version must appear in
    manifest.aliases, resolved or unresolved."""
    backend = manifest.get("backend", {})
    aliases = manifest.get("aliases", {"resolved": [], "unresolved": []})
    recorded = {a["input"] for a in aliases.get("resolved", [])} | {
        a["input"] for a in aliases.get("unresolved", [])
    }
    for field in ("model", "model_version"):
        value = backend.get(field, "")
        if is_probable_alias(value) and value not in recorded:
            raise ValueError(
                f"backend.{field} {value!r} looks like a mutable alias but is not "
                f"recorded in manifest.aliases"
            )


def start_run(root: Path, run_id: str, manifest: dict[str, Any]) -> RunHandle:
    """Write manifest.json (write-once) and status.json, and return a
    handle. This is the only way sample/event writes become possible."""
    safe_segment(run_id, "run_id")
    if manifest["run_id"] != run_id:
        raise ValueError(
            f"manifest run_id {manifest['run_id']!r} does not match run_id {run_id!r}"
        )
    validate("manifest", manifest)
    _check_backend_aliases_recorded(manifest)

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
    """Start a new run lineaged ``retry_of`` the parent, with
    ``intent.trigger`` forced to ``"retry"``. Every id in
    ``retried_sample_ids`` must exist among the parent's samples. Never
    touches the parent's files — the parent directory is not opened for
    writing."""
    if not manifest_path(root, parent_run_id).exists():
        raise ValueError(f"retry_of parent run {parent_run_id!r} does not exist")

    parent_sample_ids = {
        s["sample_id"] for s in read_lines(samples_path(root, parent_run_id))
    }
    unknown = sorted(set(retried_sample_ids) - parent_sample_ids)
    if unknown:
        raise ValueError(
            f"retried_sample_ids not present in parent {parent_run_id!r}: {unknown}"
        )

    lineage = list(manifest.get("lineage", []))
    lineage.append({"relation": "retry_of", "run_id": parent_run_id})
    manifest = {
        **manifest,
        "lineage": lineage,
        "retried_sample_ids": retried_sample_ids,
        "intent": {**manifest["intent"], "trigger": "retry"},
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
