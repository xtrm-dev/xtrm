"""B4 — reconcile stamps converge registry + umbrella; ref beats timestamp.

Covers the task SUCCESS/SCOPE/VALIDATION without touching hooks or canary:

* ``scan_drift`` tags catalogued-but-never-synced items ``reason=initial-sync-needed``.
* When a valid ``last_sync_ref`` exists, committed drift is decided by
  ``ref..HEAD`` — never by wall-clock (clock-skew + cherry-pick precedence).
* A clean ref suppresses spurious mtime touches (no content change → no drift).
* ``reconcile.regenerate_umbrella_for_project`` refreshes the umbrella table from
  the just-stamped registry while preserving the SEMANTIC block byte-identically.
* Envelope regeneration heals toward the registry (deleted release-flow envelope
  is restored — the safety cite).
"""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from service_knowledge.scripts import bootstrap, drift_detector, reconcile as reconcile_mod
from service_knowledge.scripts import umbrella_generator as ug


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True)


def _head(repo: Path) -> str:
    proc = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                          check=True, capture_output=True, text=True)
    return proc.stdout.strip()


def _make_repo(root: Path, name: str = "repo") -> tuple[Path, Path]:
    """Git repo with a single-pack umbrella layout + services db + release-flow."""
    repo = root / name
    umb = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    for sid in ("db", "release-flow"):
        svc = umb / "services" / sid
        svc.mkdir(parents=True)
        (svc / "SKILL.md").write_text(f"# {sid}\n", encoding="utf-8")
    (repo / "db").mkdir(parents=True)
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int);\n", encoding="utf-8")
    (repo / "release-flow").mkdir(parents=True)
    (repo / "release-flow" / "pipeline.yml").write_text("steps: []\n", encoding="utf-8")
    registry = {
        "version": "1.0",
        "pack": "acme",
        "services": {
            "db": {
                "name": "db",
                "description": "Primary database.",
                "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md",
                "territory": ["db/**"],
            },
            "release-flow": {
                "name": "release-flow",
                "description": "Release pipeline.",
                "skill_path": ".xtrm/skills/acme/service-knowledge/services/release-flow/SKILL.md",
                "territory": ["release-flow/**"],
            },
        },
    }
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo, umb / "service-registry.json"


def _set_sync(registry_path: Path, service_id: str, last_sync: str, last_sync_ref: str) -> None:
    data = json.loads(registry_path.read_text(encoding="utf-8"))
    data["services"][service_id]["last_sync"] = last_sync
    data["services"][service_id]["last_sync_ref"] = last_sync_ref
    registry_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _future_iso(days: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat().replace("+00:00", "Z")


# --- never_synced reason -----------------------------------------------------

def test_never_synced_items_carry_initial_sync_needed(tmp_path: Path) -> None:
    repo, _ = _make_repo(tmp_path, "never-synced")
    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)
    assert drifted, "catalogued-but-never-synced territory must surface as drift"
    assert all(item.get("never_synced") for item in drifted)
    assert all(item.get("reason") == drift_detector.REASON_INITIAL_SYNC for item in drifted)


# --- ref-vs-timestamp precedence ---------------------------------------------

def test_ref_precedence_clock_skew_reports_drift(tmp_path: Path) -> None:
    """Future last_sync + old ref + committed territory change must still drift.

    mtime alone would miss this (file mtime predates the skewed stamp); the ref
    range is the source of truth.
    """
    repo, reg_path = _make_repo(tmp_path, "skew")
    base = _head(repo)
    # Skew the wall-clock stamp a day into the future while the ref stays at base.
    _set_sync(reg_path, "db", _future_iso(1), base)
    _set_sync(reg_path, "release-flow", _future_iso(1), base)
    # Commit a real territory change, then backdate the file mtime to simulate skew.
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, name text);\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "add column"], repo)
    old = datetime.now(timezone.utc) - timedelta(days=2)
    os.utime(repo / "db" / "schema.sql", (old.timestamp(), old.timestamp()))

    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)
    db_items = [d for d in drifted if d["service_id"] == "db"]
    assert db_items, "ref range touches db territory — must drift despite skewed timestamp"
    assert all(d.get("reason") == drift_detector.REASON_REF_RANGE for d in db_items)


def test_ref_precedence_cherry_pick_reports_drift(tmp_path: Path) -> None:
    """A cherry-picked territory change must drift even when the stamp looks newer."""
    repo, reg_path = _make_repo(tmp_path, "cherry")
    base = _head(repo)
    _set_sync(reg_path, "db", _future_iso(1), base)
    _set_sync(reg_path, "release-flow", _future_iso(1), base)
    # Side-branch change cherry-picked onto main (rewritten SHA, same content touch).
    main_branch = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True, text=True, check=True).stdout.strip()
    _git(["checkout", "-qb", "side"], repo)
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, email text);\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "side change"], repo)
    _git(["checkout", "-q", main_branch], repo)
    _git(["cherry-pick", "side"], repo)
    assert _head(repo) != base
    old = datetime.now(timezone.utc) - timedelta(days=2)
    os.utime(repo / "db" / "schema.sql", (old.timestamp(), old.timestamp()))

    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)
    db_items = [d for d in drifted if d["service_id"] == "db"]
    assert db_items, "cherry-picked ref range touches db territory — must drift"
    assert all(d.get("reason") == drift_detector.REASON_REF_RANGE for d in db_items)


def test_ref_clean_suppresses_spurious_mtime_touch(tmp_path: Path) -> None:
    """mtime newer than last_sync but no content change and clean ref → no drift."""
    repo, reg_path = _make_repo(tmp_path, "clean")
    head = _head(repo)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    _set_sync(reg_path, "db", now, head)
    _set_sync(reg_path, "release-flow", now, head)
    # Spurious touch: bump mtime without changing content.
    future = datetime.now(timezone.utc) + timedelta(hours=2)
    os.utime(repo / "db" / "schema.sql", (future.timestamp(), future.timestamp()))

    drifted = drift_detector.scan_drift(str(repo), use_gitnexus=False)
    assert [d for d in drifted if d["service_id"] == "db"] == [], \
        "clean ref + clean working tree must stay fresh despite newer mtime"


# --- reconcile stamp → umbrella regen ----------------------------------------

def test_reconcile_stamp_regenerates_umbrella_and_preserves_semantic(tmp_path: Path) -> None:
    repo, reg_path = _make_repo(tmp_path, "umbrella")
    umb_dir = reg_path.parent
    registry = bootstrap.load_registry(str(repo))
    initial = ug.generate_umbrella(registry, repo.name, None, {})
    (umb_dir / "SKILL.md").write_text(initial, encoding="utf-8")
    # Human edits the protected block.
    edited = initial.replace("<!-- SEMANTIC_START -->\n",
                             "<!-- SEMANTIC_START -->\nHUMAN RUNBOOK NOTES\n")
    (umb_dir / "SKILL.md").write_text(edited, encoding="utf-8")
    before_semantic = ug.extract_semantic_block(edited)

    new_ref = _head(repo)
    reconcile_mod.bump_last_sync_ref(repo, new_ref, dry_run=False)
    regen = reconcile_mod.regenerate_umbrella_for_project(repo)
    assert regen.get("reason") in ("generated", "unchanged"), regen

    stamped = bootstrap.load_registry(str(repo))
    assert stamped["services"]["db"]["last_sync_ref"] == new_ref
    umbrella = (umb_dir / "SKILL.md").read_text(encoding="utf-8")
    # Freshness column agrees with the registry (short ref in the table row).
    assert new_ref[:8] in umbrella
    assert "`db`" in umbrella and "`release-flow`" in umbrella
    # SEMANTIC block byte-identical across regen.
    assert ug.extract_semantic_block(umbrella) == before_semantic
    assert "HUMAN RUNBOOK NOTES" in umbrella
    # Second regen is idempotent.
    again = ug.generate_umbrella(stamped, repo.name, umbrella, {})
    assert ug.extract_semantic_block(again) == before_semantic


def test_umbrella_envelope_healing_restores_deleted_release_flow() -> None:
    """Regeneration heals toward the registry: a deleted envelope comes back."""
    registry = {"services": {
        "db": {"name": "db", "description": "db.", "skill_path": "s/db/SKILL.md",
               "territory": ["db/**"], "last_sync_ref": "abc12345"},
        "release-flow": {"name": "release-flow", "description": "ship it.",
                         "skill_path": "s/release-flow/SKILL.md",
                         "territory": ["release-flow/**"], "last_sync_ref": "def67890"},
    }}
    state = {"source_ref": "abc", "schema_version": "1", "generator_version": "0.3.0",
             "index_hash": "sha256:cafe", "item_count": 12, "built_at": "2026-07-24T00:00:00Z"}
    full = ug.generate_umbrella(registry, "infra", None, state)
    assert '"id": "service:release-flow"' in full
    # Somebody hand-deletes the release-flow envelope line (nobody asked for this).
    damaged = "\n".join(line for line in full.splitlines()
                        if '"id": "service:release-flow"' not in line)
    assert '"id": "service:release-flow"' not in damaged
    healed = ug.generate_umbrella(registry, "infra", damaged, state)
    assert '"id": "service:release-flow"' in healed
