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
from pathlib import Path

from service_knowledge.cli import common

# Dual marker names — canonical wins when both present (16118989 semantics).
CANONICAL_MARKER_REL = Path(".xtrm") / ".service-knowledge-drift-pending"
LEGACY_MARKER_REL = Path(".xtrm") / ".service-skills-drift-pending"

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
    """All pending marker files present, canonical first. Empty when none."""
    out: list[Path] = []
    if (root / CANONICAL_MARKER_REL).exists():
        out.append(root / CANONICAL_MARKER_REL)
    if (root / LEGACY_MARKER_REL).exists():
        out.append(root / LEGACY_MARKER_REL)
    return out


def write_marker(root: Path, branch: str, services: list[str], file_count: int) -> Path:
    """Write the canonical pending marker with a per-service inventory. Returns its path."""
    marker = root / CANONICAL_MARKER_REL
    marker.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"service-knowledge drift detected on '{branch or 'default'}'\n",
        f"services: {', '.join(services)}\n",
        f"files: {file_count}\n",
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
    except (ImportError, OSError, RuntimeError, ValueError, TypeError, KeyError):
        return []


def _cmd_drift(args: argparse.Namespace) -> int:
    root = common.resolve_consumer_root(args.path)
    packs = common.find_umbrella_packs(root)
    if not packs:
        print("service-knowledge drift: no service registry found — nothing to scan.")
        return 0

    drift = _scan(root)
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
    marker = write_marker(root, head, services, len(drift))
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
