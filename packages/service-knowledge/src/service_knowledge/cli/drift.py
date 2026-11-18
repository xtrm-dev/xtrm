"""``service-knowledge drift`` — detect + report service-knowledge drift for a consumer repo.

Promotes the mercury/infra-local drift mechanism to the package CLI (xtrm-6z6.2):

  - scans drift over each service's territory since its ``last_sync`` timestamp,
    using the shared ``drift_detector.scan_drift`` engine (mtime pre-filter; the
    gitnexus semantic tiering is the librarian's job — this command stays cheap),
  - on drift, writes a pending marker with a per-service inventory,
  - ``clear`` removes the pending marker(s).

Marker contract (mirrors the pi extension, core commit 16118989): both the
canonical ``.xtrm/.service-knowledge-drift-pending`` and the legacy wave-1
``.xtrm/.service-skills-drift-pending`` names are recognized; the canonical one
wins when both exist, and ``clear`` removes whichever is present.

Read-only by default: the marker write is the ONLY filesystem mutation, and it
is confined to ``<root>/.xtrm/``. Reconcile stays skill-driven
(``/updating-service-knowledge`` → the service-knowledge-sync specialist), which
stamps ``last_sync_ref`` and triggers the index rebuild — see
``service-knowledge help workflow``.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from service_knowledge.cli import common

# Dual marker names — canonical wins when both present (16118989 semantics).
CANONICAL_MARKER_REL = Path(".xtrm") / ".service-knowledge-drift-pending"
LEGACY_MARKER_REL = Path(".xtrm") / ".service-skills-drift-pending"

# Marker reason tags (B2/B3 schema — shared with the drift hooks:
# post-merge, post-checkout, post-rewrite). fresh-cache is written only by
# post-checkout on clone/worktree creation (cold cache, no diff to gate on);
# mtime-heuristic is written only by this drift-CLI fallback, never by hooks.
REASON_REF_RANGE = "ref-range"
REASON_MTIME = "mtime-heuristic"
REASON_INITIAL_SYNC = "initial-sync-needed"
REASON_RANGE_UNKNOWN = "range-unknown"
REASON_FRESH_CACHE = "fresh-cache"

RECONCILE_HINT = (
    "action: run /updating-service-knowledge (service-knowledge-sync) to reconcile + stamp last_sync_ref\n"
)


def _git_head(root: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=root, capture_output=True, text=True, check=True, timeout=5,
        )
        return r.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def _project_root_for_scan(root: Path) -> Path:
    """Resolve the git toplevel so drift_detector's registry/git lookups work."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=root, capture_output=True, text=True, check=True, timeout=5,
        )
        return Path(r.stdout.strip())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return root


def marker_paths(root: Path) -> list[Path]:
    """All pending marker files present, canonical first. Empty when none.

    Live read: checks the filesystem at call time, never a cached snapshot."""
    out: list[Path] = []
    if (root / CANONICAL_MARKER_REL).exists():
        out.append(root / CANONICAL_MARKER_REL)
    if (root / LEGACY_MARKER_REL).exists():
        out.append(root / LEGACY_MARKER_REL)
    return out


def _existing_range_start(root: Path) -> str | None:
    """Live re-read of the canonical marker's range start (preserve-earliest-range)."""
    try:
        text = (root / CANONICAL_MARKER_REL).read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        if line.strip().startswith("range:"):
            val = line.split(":", 1)[1].strip()
            if not val or val == "unknown":
                return None
            return val.split("..")[0].strip() or None
    return None


def read_marker(root: Path) -> dict | None:
    """Live parse of the pending marker at use time (never a session-start snapshot).

    Returns ``{"trigger", "range", "reason", "services", "timestamp", "path"}``
    or None when absent/unparsable. Canonical wins over legacy; legacy markers
    predate the schema and yield reason/timestamp as None."""
    for rel in (CANONICAL_MARKER_REL, LEGACY_MARKER_REL):
        p = root / rel
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        fields: dict = {"path": rel.as_posix(), "raw": text}
        for line in text.splitlines():
            stripped = line.strip()
            for key in ("trigger", "range", "reason", "services", "timestamp", "files"):
                if stripped.startswith(f"{key}:"):
                    fields[key] = stripped.split(":", 1)[1].strip()
        if rel == LEGACY_MARKER_REL and "reason" not in fields:
            fields["reason"] = None
            fields["timestamp"] = fields.get("timestamp")
        return fields
    return None


def write_marker(
    root: Path,
    branch: str,
    services: list[str],
    file_count: int,
    *,
    trigger: str = "drift",
    range_: str = "",
    reason: str = REASON_MTIME,
    timestamp: str | None = None,
) -> Path:
    """Write the canonical pending marker with a per-service inventory.

    B2 schema: ``trigger, range, reason, services, files, timestamp`` plus the
    reconcile hint. Refresh preserves the earliest range start (live re-read
    at write time) so consecutive touches do not overwrite provenance.
    Returns its path."""
    marker = root / CANONICAL_MARKER_REL
    marker.parent.mkdir(parents=True, exist_ok=True)
    range_str = range_.strip() or branch.strip() or "unknown"
    prev_start = _existing_range_start(root)
    if prev_start and range_str != "unknown":
        cur_start = range_str.split("..")[0].strip() if ".." in range_str else range_str
        cur_end = range_str.split("..", 1)[1].strip() if ".." in range_str else ""
        if cur_start and cur_end and prev_start != cur_start:
            range_str = f"{prev_start}..{cur_end}"
        elif cur_start and not cur_end:
            range_str = f"{prev_start}..{cur_start}" if prev_start != cur_start else range_str
    ts = timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    lines = [
        f"service-knowledge drift detected on '{branch or 'default'}'\n",
        f"trigger: {trigger}\n",
        f"range: {range_str}\n",
        f"reason: {reason}\n",
        f"services: {', '.join(services) if services else '(none)'}\n",
        f"files: {file_count}\n",
        f"timestamp: {ts}\n",
    ]
    for svc in services:
        lines.append(f"service {svc}: pending\n")
    lines.append(RECONCILE_HINT)
    marker.write_text("".join(lines), encoding="utf-8")
    return marker


def _scan(root: Path) -> list[dict]:
    """Run drift_detector.scan_drift (cheap mtime path) for the consumer root."""
    scan_root = _project_root_for_scan(root)
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
        from drift_detector import scan_drift  # type: ignore[import-not-found]
        return scan_drift(project_root=str(scan_root), use_gitnexus=False)
    except (ImportError, OSError, ValueError, TypeError, KeyError):
        return []
    # RuntimeError is deliberately NOT swallowed: scan_drift raises it when sync
    # history is unknown (fail closed). _cmd_drift turns it into a non-zero exit
    # that keeps the pending marker; treating it as "no drift" would erase the signal.


def _cmd_drift(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    packs = common.find_umbrella_packs(root)
    if not packs:
        print("service-knowledge drift: no service registry found — nothing to scan.")
        return 0

    try:
        drift = _scan(root)
    except RuntimeError as exc:
        # Fail closed: drift cannot be determined, so it is NOT reported clean and
        # any pending marker is kept for the operator.
        print(f"service-knowledge drift: cannot determine drift — {exc}", file=sys.stderr)
        print("   Pending marker(s) kept. After verifying each listed service, record a ref with `drift_detector.py sync <service_id>`.", file=sys.stderr)
        return 2
    if not drift:
        # No drift: clear any stale pending marker (a previous run may have left one).
        for marker in marker_paths(root):
            try:
                marker.unlink()
            except OSError:
                pass
        print("service-knowledge drift: none detected.")
        return 0

    services = sorted({str(item.get("service_id", "?")) for item in drift})
    head = _git_head(root)
    # Drift-cause tagging: a never-synced service needs an initial verified sync,
    # not a "merge caused drift" claim.
    never_synced = bool(drift) and all(item.get("never_synced") for item in drift)
    reason = REASON_INITIAL_SYNC if never_synced else REASON_MTIME
    marker = write_marker(root, head, services, len(drift), trigger="drift", range_=head, reason=reason)
    print("⚠  service-knowledge drift detected.")
    print(f"   {len(drift)} drifted file(s) across service(s): {', '.join(services)}")
    print(f"   (pending marker: {marker.relative_to(root).as_posix()})")
    print("   Reconcile with /updating-service-knowledge (the service-knowledge-sync specialist),")
    print("   which syncs the drifted SKILL.md and advances last_sync_ref.")
    return 1


def _cmd_clear(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    removed: list[Path] = []
    for marker in marker_paths(root):
        try:
            marker.unlink()
            removed.append(marker)
        except OSError:
            pass
    if not removed:
        print("service-knowledge drift: no pending marker present.")
        return 0
    for marker in removed:
        print(f"service-knowledge drift: removed {marker.relative_to(root).as_posix()}")
    # Index-rebuild hook: a cleared marker means a successful reconcile — the
    # evidence index must reflect the reconciled SKILL.md state (xtrm-6z6.2).
    try:
        from service_knowledge.index import build as index_build
        stats = index_build(root)
        print(f"service-knowledge drift: evidence index rebuilt ({stats.items} items).")
    except (ImportError, OSError, RuntimeError, ValueError):
        print("service-knowledge drift: evidence index rebuild skipped (index unavailable).")
    return 0


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser(
        "drift",
        help="Detect / clear service-knowledge drift (writes a pending marker).",
        description=(
            "Scan each service's territory for files changed since its last sync "
            "and, on drift, write a pending marker with a per-service inventory. "
            "Read-only except for the marker under <root>/.xtrm/."
        ),
        epilog=(
            "Examples:\n"
            "  service-knowledge drift                   # scan + write marker if drifted\n"
            "  service-knowledge drift --path ~/my/repo  # scan a specific repo\n"
            "  service-knowledge drift clear             # remove the pending marker(s)\n"
            "\n"
            "Reconcile stays skill-driven: run /updating-service-knowledge (the\n"
            "service-knowledge-sync specialist), which syncs the drifted SKILL.md and\n"
            "stamps `last_sync_ref`. After a successful reconcile the marker is removed\n"
            "and the FTS5 evidence index is rebuilt.\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--path", default=None, help="Consumer repo root (default: git toplevel of cwd).")
    p.add_argument(
        "action", nargs="?", choices=["scan", "clear"], default="scan",
        help="'scan' (default) detects drift and writes a marker; 'clear' removes it.",
    )


def run(args: argparse.Namespace) -> int:
    action = getattr(args, "action", "scan")
    return _cmd_clear(args) if action == "clear" else _cmd_drift(args)
