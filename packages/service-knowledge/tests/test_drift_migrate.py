"""``drift migrate``: derive a CONSERVATIVE last_sync_ref for legacy registries.

A legacy registry has ``last_sync`` but no resolvable ``last_sync_ref``; ``scan_drift`` refuses it
(fail closed). ``migrate_legacy_refs`` estimates a ref from history, always erring towards an
OLDER commit so a wrong guess over-reports drift instead of hiding it.
"""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from service_knowledge.cli import main
from service_knowledge.scripts import drift_detector

STAMP = datetime(2026, 6, 20, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _git(args: list[str], cwd: Path, when: datetime | None = None) -> str:
    env = dict(os.environ)
    if when is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = _iso(when)
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True, env=env).stdout.strip()


def _commit(repo: Path, message: str, when: datetime) -> str:
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", message], repo, when)
    return _git(["rev-parse", "HEAD"], repo)


class Legacy:
    """c1 init (T-10d) -> c2 schema change (T-5d) -> c3 registry stamp (T) -> c4 new file (T+5d)."""

    def __init__(self, root: Path, c4_date: datetime | None = None, stamp_delay: timedelta = timedelta(0),
                 compact: bool = False) -> None:
        self.compact = compact
        self.repo = root / "repo"
        umb = self.repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
        svc = umb / "services" / "db"
        svc.mkdir(parents=True)
        (svc / "SKILL.md").write_text("# db\n", encoding="utf-8")
        (self.repo / "db").mkdir()
        (self.repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int);\n", encoding="utf-8")
        self.reg_path = umb / "service-registry.json"
        self.registry = {"version": "1.0", "pack": "acme", "services": {"db": {
            "name": "db", "description": "Primary database.",
            "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md", "territory": ["db/**"]}}}
        self._write()
        _git(["init", "-q"], self.repo)
        _git(["config", "user.email", "t@t"], self.repo)
        _git(["config", "user.name", "t"], self.repo)
        self.c1 = _commit(self.repo, "init", STAMP - timedelta(days=10))
        (self.repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, n text);\n", encoding="utf-8")
        self.c2 = _commit(self.repo, "schema change", STAMP - timedelta(days=5))
        self.registry["services"]["db"]["last_sync"] = _iso(STAMP)  # legacy: timestamp only, no ref
        self._write()
        self.c3 = _commit(self.repo, "stamp registry", STAMP + stamp_delay)
        (self.repo / "db" / "new.sql").write_text("-- new\n", encoding="utf-8")
        self.c4 = _commit(self.repo, "add file", c4_date or STAMP + timedelta(days=5))

    def _write(self) -> None:
        text = json.dumps(self.registry, separators=(",", ":")) if self.compact else json.dumps(self.registry, indent=2)
        self.reg_path.write_text(text + "\n", encoding="utf-8")

    def service(self) -> dict:
        return json.loads(self.reg_path.read_text(encoding="utf-8"))["services"]["db"]


def test_scan_refuses_a_legacy_registry_before_migration(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    with pytest.raises(drift_detector.UnverifiableHistory) as raised:
        drift_detector.scan_drift(str(legacy.repo), use_gitnexus=False)
    assert raised.value.service_ids == ["db"]
    assert "service-knowledge drift migrate" in str(raised.value)


def test_migrate_derives_the_older_candidate_and_scan_then_reports_only_later_changes(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)

    assert [(r["service_id"], r["status"]) for r in results] == [("db", "derived")]
    # rev-list --before=T finds the stamp commit c3; the registry-stamp parent is c2. Older wins.
    assert results[0]["candidates"] == {"rev-list-before": legacy.c3, "registry-stamp-parent": legacy.c2}
    service = legacy.service()
    assert service["last_sync_ref"] == legacy.c2
    assert service["last_sync_ref_derived"] is True

    drifted = drift_detector.scan_drift(str(legacy.repo), use_gitnexus=False)
    assert sorted(d["file_path"] for d in drifted) == ["db/new.sql"]  # c4 only; c2's schema change is at the ref


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    before = legacy.reg_path.read_bytes()
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=False)
    assert results[0]["status"] == "derived"
    assert legacy.reg_path.read_bytes() == before


def test_migrate_is_idempotent(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    assert drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)
    assert drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True) == []


def test_clock_skew_never_picks_a_ref_newer_than_the_stamp(tmp_path: Path) -> None:
    """A later commit with a committer date BEFORE last_sync fools `rev-list --before` into
    returning it (too new: would hide the drift). The registry-stamp candidate bounds it."""
    legacy = Legacy(tmp_path, c4_date=STAMP - timedelta(days=1))
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=False)
    assert results[0]["candidates"]["rev-list-before"] == legacy.c4  # the skewed, too-new pick
    assert results[0]["ref"] == legacy.c2  # the conservative choice


def test_migrate_refuses_a_shallow_clone(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    shallow = tmp_path / "shallow"
    subprocess.run(["git", "clone", "-q", "--depth", "1", f"file://{legacy.repo}", str(shallow)], check=True, capture_output=True)
    results = drift_detector.migrate_legacy_refs(str(shallow), apply=True)
    assert results[0]["status"] == "refused" and "shallow" in results[0]["reason"]
    assert "last_sync_ref" not in json.loads((shallow / legacy.reg_path.relative_to(legacy.repo)).read_text())["services"]["db"]


def test_migrate_refuses_a_last_sync_in_the_future(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    legacy.registry["services"]["db"]["last_sync"] = _iso(datetime.now(timezone.utc) + timedelta(days=30))
    legacy._write()
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)
    assert results[0]["status"] == "refused" and "future" in results[0]["reason"]
    assert "last_sync_ref" not in legacy.service()


def test_migrate_refuses_when_nothing_exists_before_last_sync(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    legacy.registry["services"]["db"]["last_sync"] = _iso(STAMP - timedelta(days=60))
    legacy._write()
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)
    assert results[0]["status"] == "refused" and "no commit" in results[0]["reason"]


def test_migrate_skips_never_synced_and_already_verifiable_services(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    legacy.registry["services"]["db"].pop("last_sync")  # never synced: needs an initial sync, not a migration
    legacy._write()
    assert drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True) == []
    legacy.registry["services"]["db"].update(last_sync=_iso(STAMP), last_sync_ref=legacy.c2)
    legacy._write()
    assert drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True) == []


def test_a_real_sync_clears_the_derived_flag(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)
    assert drift_detector.update_sync_time("db", project_root=str(legacy.repo))
    service = legacy.service()
    assert "last_sync_ref_derived" not in service
    assert service["last_sync_ref"] == legacy.c4


def test_cli_migrate_dry_run_then_apply(tmp_path: Path, capsys) -> None:
    legacy = Legacy(tmp_path)
    assert main(["drift", "migrate", "--path", str(legacy.repo)]) == 0
    out = capsys.readouterr().out
    assert "dry run" in out and legacy.c2[:12] in out
    assert "last_sync_ref" not in legacy.service()

    assert main(["drift", "migrate", "--apply", "--path", str(legacy.repo)]) == 0
    assert legacy.service()["last_sync_ref"] == legacy.c2
    assert main(["drift", "--path", str(legacy.repo)]) == 1  # now a real scan: db/new.sql drifted since the ref


def test_cli_migrate_exits_nonzero_when_a_service_is_refused(tmp_path: Path, capsys) -> None:
    legacy = Legacy(tmp_path)
    legacy.registry["services"]["db"]["last_sync"] = _iso(STAMP - timedelta(days=60))
    legacy._write()
    assert main(["drift", "migrate", "--apply", "--path", str(legacy.repo)]) == 1
    assert "REFUSED" in capsys.readouterr().out


def test_ci_check_lists_every_unverifiable_service_even_past_the_message_cap(tmp_path: Path, monkeypatch, capsys) -> None:
    """The prose message is cut by log limits; the service ids are printed one per line and
    written to the step summary, so 80 services are all named."""
    import sys

    sys.path.insert(0, str(Path(drift_detector.__file__).parent))
    from ci_drift_check import main as ci_main  # type: ignore[import-not-found]

    legacy = Legacy(tmp_path)
    base = legacy.registry["services"]["db"]
    ids = [f"service-{n:03d}" for n in range(80)]
    for sid in ids:
        legacy.registry["services"][sid] = {**base, "name": sid}
    legacy._write()
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))

    assert ci_main(["--path", str(legacy.repo)]) == 2

    err = capsys.readouterr().err
    for sid in ["db", *ids]:
        assert f"unverifiable: {sid}\n" in err
    assert "81 service(s)" in err
    assert all(f"`{sid}`" in summary.read_text(encoding="utf-8") for sid in ids)


def test_version_prints_package_version_first_then_vaultctl(capsys) -> None:
    """launch.mjs parses the FIRST x.y.z from `--version`; vaultctl's location follows on line 2."""
    import re

    with pytest.raises(SystemExit) as raised:
        main(["--version"])
    assert raised.value.code == 0
    lines = capsys.readouterr().out.strip().splitlines()
    assert re.match(r"service-knowledge \d+\.\d+\.\d+", lines[0])
    assert lines[1].startswith("vaultctl ")


def _merge_late_branch_commit(legacy: Legacy) -> str:
    """F: a branch commit cut from c2 and DATED before last_sync, merged into main AFTER the sync."""
    _git(["checkout", "-q", "-b", "feature", legacy.c2], legacy.repo)
    (legacy.repo / "db" / "feature.sql").write_text("-- feature\n", encoding="utf-8")
    f = _commit(legacy.repo, "feature", STAMP - timedelta(hours=1))
    _git(["checkout", "-q", "-"], legacy.repo)
    _git(["merge", "--no-ff", "-q", "-m", "merge feature", "feature"], legacy.repo, STAMP + timedelta(days=7))
    return f


def test_a_branch_commit_dated_before_the_sync_but_merged_after_it_is_never_hidden(tmp_path: Path) -> None:
    """Regression (review of #427): `rev-list --before` selects by date, so it returned F, and the
    old 'older of' rule kept F, making `ref..HEAD` blind to F's own change. The stamp anchor bounds it."""
    legacy = Legacy(tmp_path, stamp_delay=timedelta(seconds=30), compact=True)
    f = _merge_late_branch_commit(legacy)
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)
    assert results[0]["candidates"]["rev-list-before"] == f  # the date-based pick really is the trap
    assert results[0]["ref"] != f
    files = {d["file_path"] for d in drift_detector.scan_drift(str(legacy.repo), use_gitnexus=False)}
    assert "db/feature.sql" in files and "db/new.sql" in files


def test_compact_registry_formatting_does_not_defeat_the_anchor(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path, compact=True)
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=False)
    assert results[0]["candidates"]["registry-stamp-parent"] == legacy.c2


def test_a_registry_rewritten_after_the_sync_still_anchors_on_the_original_stamp(tmp_path: Path) -> None:
    """The registry file is deleted and re-added later (a layout migration does the same): the
    pickaxe must still find the OLDEST commit that introduced the stamp, not the re-add."""
    legacy = Legacy(tmp_path)
    content = legacy.reg_path.read_bytes()
    legacy.reg_path.unlink()
    _commit(legacy.repo, "drop registry", STAMP + timedelta(days=8))
    legacy.reg_path.write_bytes(content)
    _commit(legacy.repo, "re-add registry", STAMP + timedelta(days=9))
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=False)
    assert results[0]["status"] == "derived" and results[0]["candidates"]["registry-stamp-parent"] == legacy.c2


def test_an_uncommitted_stamp_has_nothing_to_anchor_on_and_is_refused(tmp_path: Path) -> None:
    legacy = Legacy(tmp_path)
    legacy.registry["services"]["db"]["last_sync"] = _iso(STAMP + timedelta(days=1))  # never committed
    legacy._write()
    results = drift_detector.migrate_legacy_refs(str(legacy.repo), apply=True)
    assert results[0]["status"] == "refused" and "anchor" in results[0]["reason"]
    assert "last_sync_ref" not in legacy.service()


def test_a_stamp_in_the_root_commit_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "root"
    umb = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    (umb / "services" / "db").mkdir(parents=True)
    (umb / "services" / "db" / "SKILL.md").write_text("# db\n", encoding="utf-8")
    (repo / "db").mkdir()
    (repo / "db" / "a.sql").write_text("x\n", encoding="utf-8")
    registry = {"version": "1.0", "pack": "acme", "services": {"db": {
        "name": "db", "description": "d", "last_sync": _iso(STAMP),
        "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md", "territory": ["db/**"]}}}
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "t@t"], repo)
    _git(["config", "user.name", "t"], repo)
    _commit(repo, "everything at once", STAMP)
    results = drift_detector.migrate_legacy_refs(str(repo), apply=False)
    assert results[0]["status"] == "refused" and "no parent" in results[0]["reason"]
