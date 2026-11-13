"""A date-only ``last_sync`` must not crash ``scan_drift`` (XTRM-772, from core#360).

``datetime.fromisoformat("YYYY-MM-DD")`` returns a TZ-NAIVE datetime, while every mtime
comparison in ``scan_drift`` uses ``datetime.fromtimestamp(..., tz=timezone.utc)``. A
registry whose ``last_sync`` is a bare date therefore raised
``TypeError: can't compare offset-naive and offset-aware datetimes`` on every service,
taking the whole drift scan (and the CI gate built on it) down.

The fix normalises a naive ``sync_time`` to UTC. This test pins the behaviour: the scan
completes and still reports the territory change as drift.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from service_knowledge.scripts import drift_detector


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True)


def _make_repo(root: Path) -> tuple[Path, Path]:
    repo = root / "repo"
    umb = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    svc = umb / "services" / "db"
    svc.mkdir(parents=True)
    (svc / "SKILL.md").write_text("# db\n", encoding="utf-8")
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
    reg_path = umb / "service-registry.json"
    reg_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo, reg_path


def test_date_only_last_sync_does_not_crash_scan(tmp_path: Path) -> None:
    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    # The shape Rico1109 reported downstream: a bare date and no ref.
    data["services"]["db"]["last_sync"] = "2026-06-23"
    data["services"]["db"].pop("last_sync_ref", None)
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    # A territory file newer than the date: real drift the scan must still report.
    target = repo / "db" / "schema.sql"
    future = time.time() + 86_400
    os.utime(target, (future, future))
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "touch territory"], repo)

    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)

    assert drifted, "a territory change after a date-only last_sync must report drift"
    assert any(item["service_id"] == "db" for item in drifted)
