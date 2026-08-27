"""Contract tests for ``service-knowledge drift`` (xtrm-6z6.2).

Ports the mercury/infra ``test_otel_drift.py`` contract shape — drift is
DETECTED, a pending marker is WRITTEN with a per-service inventory, and the
reconcile path CLEARS the marker and rebuilds the evidence index — onto the
package CLI's ``last_sync_ref``-based drift semantics.

Fixture: a real git repo with a service registry whose service territory is a
tracked file; we mutate the file (new commit) to create drift.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from service_knowledge.cli import main
from service_knowledge.cli.drift import (
    CANONICAL_MARKER_REL,
    LEGACY_MARKER_REL,
    marker_paths,
)
from service_knowledge.cli.status import _drift_marker


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def drift_repo(tmp_path: Path) -> Path:
    """Git repo with a service-knowledge umbrella + 1 service whose territory is db/**."""
    repo = tmp_path / "drift-repo"
    umb = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    svc = umb / "services" / "db"
    svc.mkdir(parents=True)
    (svc / "SKILL.md").write_text("# DB\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n", encoding="utf-8")
    (repo / "db").mkdir(parents=True)
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int);\n", encoding="utf-8")
    registry = {
        "version": "1.0",
        "pack": "acme",
        "services": {
            "db": {
                "name": "db",
                "description": "Primary database.",
                "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md",
                "territory": ["db/**"],
            }
        },
    }
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo


def test_no_drift_returns_zero_and_writes_no_marker(drift_repo: Path, capsys) -> None:
    # Stamp a verified sync (as a prior reconcile would) so the territory is not
    # treated as never-synced drift.
    assert main(["drift", "--path", str(drift_repo)]) == 1  # initial catalog = never-synced drift
    assert main(["drift", "clear", "--path", str(drift_repo)]) == 0
    # Reconcile stamps last_sync (simulate the specialist's drift_detector sync).
    from service_knowledge.scripts import drift_detector
    assert drift_detector.update_sync_time("db", project_root=str(drift_repo))

    rc = main(["drift", "--path", str(drift_repo)])
    assert rc == 0
    assert not (drift_repo / CANONICAL_MARKER_REL).exists()
    assert not (drift_repo / LEGACY_MARKER_REL).exists()
    out = capsys.readouterr().out
    assert "none detected" in out.lower()


def test_drift_writes_marker_with_inventory(drift_repo: Path, capsys) -> None:
    # Mutate a territory file in a NEW commit -> mtime drift past last_sync.
    (drift_repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, name text);\n", encoding="utf-8")
    _git(["add", "-A"], drift_repo)
    _git(["commit", "-qm", "add name column"], drift_repo)

    rc = main(["drift", "--path", str(drift_repo)])
    assert rc == 1  # drift detected
    marker = drift_repo / CANONICAL_MARKER_REL
    assert marker.exists()
    content = marker.read_text(encoding="utf-8")
    assert "service-knowledge drift detected" in content
    assert "db" in content            # per-service inventory
    assert "action: run /updating-service-knowledge" in content
    assert "pending" in content.lower()
    # No legacy marker written when canonical is used.
    assert not (drift_repo / LEGACY_MARKER_REL).exists()


def test_drift_clear_removes_marker_and_rebuilds_index(drift_repo: Path) -> None:
    # Create drift first.
    (drift_repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, name text);\n", encoding="utf-8")
    _git(["add", "-A"], drift_repo)
    _git(["commit", "-qm", "add name column"], drift_repo)
    assert main(["drift", "--path", str(drift_repo)]) == 1
    marker = drift_repo / CANONICAL_MARKER_REL
    assert marker.exists()

    # Clear = successful reconcile: marker gone + index rebuilt.
    assert main(["drift", "clear", "--path", str(drift_repo)]) == 0
    assert not marker.exists()
    assert (drift_repo / ".xtrm/cache/service-knowledge.sqlite").exists()


def test_legacy_marker_recognized_and_cleared(drift_repo: Path) -> None:
    # Wave-1 repo: legacy marker only.
    legacy = drift_repo / LEGACY_MARKER_REL
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text("legacy drift\n", encoding="utf-8")

    assert marker_paths(drift_repo) == [legacy]
    # status reports it as PRESENT (canonical semantics).
    assert _drift_marker(drift_repo) == ".xtrm/.service-skills-drift-pending"

    assert main(["drift", "clear", "--path", str(drift_repo)]) == 0
    assert not legacy.exists()


def test_canonical_marker_wins_when_both_present(drift_repo: Path) -> None:
    legacy = drift_repo / LEGACY_MARKER_REL
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text("legacy\n", encoding="utf-8")
    canonical = drift_repo / CANONICAL_MARKER_REL
    canonical.write_text("new\n", encoding="utf-8")

    assert marker_paths(drift_repo) == [canonical, legacy]
    assert _drift_marker(drift_repo) == ".xtrm/.service-knowledge-drift-pending"
    # clear removes both.
    assert main(["drift", "clear", "--path", str(drift_repo)]) == 0
    assert not canonical.exists()
    assert not legacy.exists()


def test_status_reports_drift_marker(drift_repo: Path, capsys) -> None:
    (drift_repo / ".xtrm").mkdir(parents=True, exist_ok=True)
    (drift_repo / CANONICAL_MARKER_REL).write_text("pending\n", encoding="utf-8")
    assert main(["status", "--path", str(drift_repo)]) == 0
    out = capsys.readouterr().out
    assert "drift marker:     PRESENT (.xtrm/.service-knowledge-drift-pending)" in out
    assert "umbrella packs:  1" in out


def test_drift_help_epilog_lists_reconcile_flow(capsys) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["drift", "--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "/updating-service-knowledge" in out
    assert "drift clear" in out
