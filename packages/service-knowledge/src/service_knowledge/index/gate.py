"""Read-time source_ref-vs-HEAD freshness gate (Layer 1, B1).

Neither hooks nor advisory markers self-heal: a consumer can sit unreconciled for weeks
(index ``source_ref`` far behind git HEAD) because every landing path that mutates HEAD
(merge, rebase, reset, checkout, amend, ``--no-verify`` commits) can bypass hooks. This
module is the authoritative freshness layer: every read path compares
``sk_index_state.source_ref`` to HEAD up front and self-heals.

Gated read paths (all four funnel through :func:`ensure_fresh`):

* ``query.search`` — the index-search read path (MCP ``knowledge_search``, CLI ``query``).
* ``bundle.build_bundle`` — gated directly so hand-built search results are covered too.
* ``index.evidence_for_files`` — gated explicitly; its inner ``search`` + ``build_bundle``
  calls re-gate cheaply (fast path is one sqlite read + one ``git rev-parse``).
* the activator (``skill_activator.retrieve_evidence``) — covered *transitively* via
  ``index.evidence_for_files``; deliberately NO hook-file change (B2/B3 own hooks).

Semantics:

* Absent cache (no sqlite file, no ``sk_index_state`` row) counts as mismatch.
* Uncommitted skill edits count as mismatch: the gate also compares a stat-sweep
  fingerprint of the indexed inputs (registry + SKILL.md files, recorded at
  build time) against the live tree. ``source_ref`` alone is blind to those;
  the fingerprint is not. Same-size+same-mtime_ns content swaps are the
  documented residual (git operations always bump mtime).
* On mismatch the index rebuilds under a cross-session single-flight lock — a sidecar
  file next to the sqlite cache (see :mod:`service_knowledge.index.paths`) — so
  concurrent sessions do not stampede the rebuild. The lock is re-checked after
  acquisition (another session may have rebuilt while we waited).
* The whole gate (lock wait + rebuild) runs inside a measured budget
  (:data:`GATE_BUDGET_SECONDS`, env-overridable for tests). On exhaustion the read
  serves the stale cache plus a one-line notice and a
  ``retrieval_event{stale_served=1}`` telemetry record — it never blocks past budget
  and never raises into the caller.

Budget datum: 90s provisional. Measured: platform full rebuild (71 items) took 152ms
wall; 17-service fixture (119 items) rebuilds in ~170ms wall locally — ~500x headroom.
Measure the largest consumer (darth-feedor, 12 services) before finalizing.
"""
from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from service_knowledge.index import _compat  # noqa: F401  (scripts/ on sys.path first)
from service_knowledge.index import freshness as freshness_mod
from service_knowledge.index import inputs as inputs_mod
from service_knowledge.index import paths, telemetry

try:
    import fcntl
except ImportError:  # Windows: fall back to an exclusive-create sentinel
    fcntl = None  # type: ignore[assignment]

# Provisional read-time budget (seconds); retune from measured data, not guesswork.
GATE_BUDGET_SECONDS = 90.0
GATE_BUDGET_ENV = "SERVICE_KNOWLEDGE_GATE_BUDGET_SECONDS"


@dataclass(frozen=True)
class GateOutcome:
    """Result of a freshness-gate check. Never raises; read paths use it additively."""

    rebuilt: bool
    stale_served: bool
    source_ref: str
    head: str
    duration_ms: float
    notice: str | None = None

    @property
    def fresh(self) -> bool:
        return not self.rebuilt and not self.stale_served


def resolve_budget(override: float | None = None) -> float:
    """Effective gate budget: explicit override → env → provisional constant."""
    if override is not None:
        return max(0.0, float(override))
    raw = os.environ.get(GATE_BUDGET_ENV, "")
    if raw.strip():
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return GATE_BUDGET_SECONDS


def _short(ref: str) -> str:
    return ref[:12] if ref else "(none)"


def read_index_source_ref(consumer_root: Path) -> str | None:
    """Cached ``sk_index_state.source_ref``; ``None`` when the cache is absent.

    Read-only open (never creates the file) so an absent cache stays absent until the
    rebuild path runs. ``None`` covers: no sqlite file, no ``sk_`` tables, no state row.
    """
    db = paths.db_path(Path(consumer_root))
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        try:
            row = conn.execute("SELECT source_ref FROM sk_index_state WHERE id=1").fetchone()
        except sqlite3.Error:
            return None
    finally:
        conn.close()
    if row is None:
        return None
    return str(row[0])


def read_index_fingerprint(consumer_root: Path) -> str | None:
    """Cached ``sk_index_state.inputs_fingerprint``; ``None`` when unknown.

    ``None`` covers: absent DB, v1 caches predating the column (migration
    stamps it on next rebuild), unreadable state. Unknown always counts as
    mismatch — one bounded rebuild stamps it — never as fresh.
    """
    db = paths.db_path(Path(consumer_root))
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        try:
            row = conn.execute("SELECT inputs_fingerprint FROM sk_index_state WHERE id=1").fetchone()
        except sqlite3.Error:
            return None
    finally:
        conn.close()
    if row is None or not row[0]:
        return None
    return str(row[0])


class _HeldLock:
    """An acquired single-flight lock; release via :meth:`release` (never raises)."""

    def __init__(self, kind: str, handle: Any, path: Path) -> None:
        self._kind = kind
        self._handle = handle
        self._path = path

    def release(self) -> None:
        try:
            if self._kind == "flock":
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)  # type: ignore[union-attr]
                self._handle.close()
            else:  # exclusive-create sentinel
                try:
                    self._path.unlink()
                except OSError:
                    pass
        except (OSError, ValueError):
            pass


def _acquire_lock(lock_file: Path, deadline: float, budget: float) -> _HeldLock | None:
    """Acquire the sidecar lock before ``deadline`` (monotonic); ``None`` on exhaustion."""
    try:
        lock_file.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    if fcntl is not None:
        try:
            fh = open(lock_file, "a+b")
        except OSError:
            return None
        while True:
            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return _HeldLock("flock", fh, lock_file)
            except OSError:
                if time.monotonic() >= deadline:
                    try:
                        fh.close()
                    except OSError:
                        pass
                    return None
                time.sleep(0.05)
    # No flock (non-POSIX): exclusive-create sentinel with stale-holder expiry.
    sentinel = lock_file.with_name(lock_file.name + ".excl")
    while True:
        try:
            fd = os.open(sentinel, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return _HeldLock("excl", None, sentinel)
        except FileExistsError:
            try:
                age = time.time() - sentinel.stat().st_mtime
            except OSError:
                age = 0.0
            if age > max(budget, 1.0) and time.monotonic() < deadline:
                try:
                    sentinel.unlink()
                except OSError:
                    pass
                continue
            if time.monotonic() >= deadline:
                return None
            time.sleep(0.05)
        except OSError:
            return None


def _emit_gate(
    consumer_root: Path,
    *,
    reason: str,
    rebuilt: bool,
    stale_served: bool,
    duration_ms: float,
    source_ref: str,
    head: str,
) -> None:
    telemetry.emit(
        consumer_root,
        "gate",
        reason=reason,
        rebuilt=rebuilt,
        stale_served=1 if stale_served else 0,
        duration_ms=round(duration_ms, 2),
        source_ref=source_ref,
        head=head,
    )


def _one_line(text: str, limit: int = 240) -> str:
    return " ".join(str(text).split())[:limit]


def ensure_fresh(
    consumer_root: Path,
    *,
    budget_seconds: float | None = None,
    reason: str = "read",
) -> GateOutcome:
    """Compare cached ``source_ref`` to HEAD; rebuild once under lock on mismatch.

    Absent cache counts as mismatch. Returns a :class:`GateOutcome` describing what
    happened (``rebuilt`` / ``stale_served`` / fresh). Emits exactly one ``gate``
    telemetry record on the slow path (rebuild or stale); the fast path stays silent.
    Never raises: on any failure the caller serves whatever the cache holds.
    """
    started = time.perf_counter()
    root = Path(consumer_root)
    budget = resolve_budget(budget_seconds)
    head = freshness_mod.git_head(str(root))
    current = read_index_source_ref(root)
    stored_fp = read_index_fingerprint(root)
    try:
        live_fp = inputs_mod.fingerprint_inputs(root)
    except Exception:
        live_fp = None
    fp_ok = stored_fp is not None and live_fp is not None and stored_fp == live_fp

    def elapsed() -> float:
        return (time.perf_counter() - started) * 1000.0

    # Fast path: cache matches HEAD *and* the indexed inputs are unchanged.
    # source_ref alone is blind to uncommitted skill edits; the fingerprint
    # covers registry + skill bodies (stat sweep, no content reads).
    if current is not None and head and current == head and fp_ok:
        return GateOutcome(
            rebuilt=False, stale_served=False,
            source_ref=current, head=head, duration_ms=elapsed(),
        )
    # Degradation: HEAD unavailable (not a repo / git broken) but a cache exists.
    # Cannot verify — serve it with a notice, never block, never rebuild-loop.
    if current is not None and not head:
        notice = (
            "service-knowledge index freshness unverified (HEAD unavailable); "
            "serving cached results"
        )
        _emit_gate(root, reason=reason, rebuilt=False, stale_served=True,
                   duration_ms=elapsed(), source_ref=current, head=head)
        return GateOutcome(
            rebuilt=False, stale_served=True,
            source_ref=current, head=head, duration_ms=elapsed(), notice=notice,
        )

    # Slow path: absent cache, source_ref != HEAD, or indexed inputs changed
    # since the build (e.g. uncommitted SKILL.md edits — HEAD alone cannot see
    # those). Single-flight under the sidecar lock.
    if current is not None and head and current == head and not fp_ok:
        stale_why = "indexed skills changed since the build (source_ref matches HEAD)"
    else:
        stale_why = f"{_short(current or '')} != HEAD {_short(head)}"
    deadline = time.monotonic() + budget
    lock = _acquire_lock(paths.lock_path(root), deadline, budget)
    if lock is None:
        notice = (
            f"service-knowledge index stale ({stale_why}); "
            f"rebuild skipped — lock busy past {budget:g}s budget; serving cached results"
        )
        _emit_gate(root, reason=reason, rebuilt=False, stale_served=True,
                   duration_ms=elapsed(), source_ref=current or "", head=head)
        return GateOutcome(
            rebuilt=False, stale_served=True,
            source_ref=current or "", head=head, duration_ms=elapsed(), notice=notice,
        )
    try:
        if time.monotonic() >= deadline:
            notice = (
                f"service-knowledge index stale ({stale_why}); "
                f"rebuild skipped — {budget:g}s budget exhausted waiting for lock; "
                "serving cached results"
            )
            _emit_gate(root, reason=reason, rebuilt=False, stale_served=True,
                       duration_ms=elapsed(), source_ref=current or "", head=head)
            return GateOutcome(
                rebuilt=False, stale_served=True,
                source_ref=current or "", head=head, duration_ms=elapsed(), notice=notice,
            )
        # Double-checked locking: another session may have rebuilt while we waited.
        # Re-verify BOTH signals — a concurrent rebuild stamps ref *and* fingerprint.
        rechecked = read_index_source_ref(root)
        rechecked_fp = read_index_fingerprint(root)
        try:
            live_fp2 = inputs_mod.fingerprint_inputs(root)
        except Exception:
            live_fp2 = None
        if (
            rechecked is not None and head and rechecked == head
            and rechecked_fp is not None and live_fp2 is not None and rechecked_fp == live_fp2
        ):
            return GateOutcome(
                rebuilt=False, stale_served=False,
                source_ref=rechecked, head=head, duration_ms=elapsed(),
            )
        try:
            from service_knowledge.index.builder import build as _build
            stats = _build(root)
            new_ref = stats.source_ref or head
        except Exception as exc:  # rebuild must never break a read
            notice = (
                f"service-knowledge index rebuild failed ({_one_line(type(exc).__name__)}); "
                "serving cached results"
            )
            _emit_gate(root, reason=reason, rebuilt=False, stale_served=True,
                       duration_ms=elapsed(), source_ref=current or "", head=head)
            return GateOutcome(
                rebuilt=False, stale_served=True,
                source_ref=current or "", head=head, duration_ms=elapsed(), notice=notice,
            )
        _emit_gate(root, reason=reason, rebuilt=True, stale_served=False,
                   duration_ms=elapsed(), source_ref=new_ref, head=head)
        return GateOutcome(
            rebuilt=True, stale_served=False,
            source_ref=new_ref, head=head, duration_ms=elapsed(),
        )
    finally:
        lock.release()
