"""A date-only ``last_sync`` must not crash ``scan_drift`` (XTRM-772, from core#360).

``datetime.fromisoformat("YYYY-MM-DD")`` returns a TZ-NAIVE datetime, while every mtime
comparison in ``scan_drift`` uses ``datetime.fromtimestamp(..., tz=timezone.utc)``. A
registry whose ``last_sync`` is a bare date therefore raised
``TypeError: can't compare offset-naive and offset-aware datetimes`` on every service,
taking the whole drift scan (and the CI gate built on it) down.

The fix normalises a naive ``sync_time`` to UTC. Since the fail-closed change (#334/#408) a
service WITHOUT a resolvable ``last_sync_ref`` is refused outright (RuntimeError naming the
service) instead of being guessed from mtimes, so the two cases are pinned separately:

* date-only ``last_sync`` + valid ref: the scan completes and reports the committed change;
* date-only ``last_sync`` + no ref: the scan refuses with the history RuntimeError, never a
  ``TypeError`` from comparing naive and aware datetimes.
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


def _head(repo: Path) -> str:
    return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()


def _touch_territory(repo: Path) -> None:
    target = repo / "db" / "schema.sql"
    future = time.time() + 86_400
    os.utime(target, (future, future))
    target.write_text("CREATE TABLE t (id int, name text);\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "touch territory"], repo)


def test_date_only_last_sync_with_a_ref_does_not_crash_scan(tmp_path: Path) -> None:
    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync"] = "2026-06-23"  # the bare-date shape reported downstream
    data["services"]["db"]["last_sync_ref"] = _head(repo)
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "stamp"], repo)
    data["services"]["db"]["last_sync_ref"] = _head(repo)
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    _touch_territory(repo)

    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)

    assert any(item["service_id"] == "db" and item["file_path"] == "db/schema.sql" for item in drifted), (
        "a territory change after a date-only last_sync must report drift"
    )


def test_date_only_last_sync_without_a_ref_refuses_instead_of_crashing(tmp_path: Path) -> None:
    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync"] = "2026-06-23"
    data["services"]["db"].pop("last_sync_ref", None)
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    _touch_territory(repo)

    with pytest.raises(RuntimeError, match="history.*'db'"):
        drift_detector.scan_drift(str(repo), use_gitnexus=False)


def test_date_only_last_sync_mtime_fallback_compares_aware_datetimes(tmp_path: Path, monkeypatch) -> None:
    """The naive-vs-aware comparison only happens in the mtime fallback (git cannot report the
    working tree); force that path so the UTC normalisation stays pinned, not just the refusal."""
    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync"] = "2026-06-23"
    data["services"]["db"]["last_sync_ref"] = _head(repo)
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    future = time.time() + 86_400
    os.utime(repo / "db" / "schema.sql", (future, future))  # uncommitted, newer than the date
    monkeypatch.setattr(drift_detector, "_working_tree_changed_files", lambda root: None)

    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)  # TypeError before the fix

    assert any(item["service_id"] == "db" and item["file_path"] == "db/schema.sql" for item in drifted)
