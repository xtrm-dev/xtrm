"""B3: touches-gated marker-only post-checkout hook (no mtime scan, no rebuild)."""
from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

_HOOK_PATH = (
    Path(__file__).resolve().parents[3]
    / "service_knowledge"
    / "install"
    / "git-hooks"
    / "post_checkout_drift_sweep.py"
)

NULL_PREV = "0" * 40


@pytest.fixture
def checkout_hook():
    spec = importlib.util.spec_from_file_location("post_checkout_drift_sweep_test", _HOOK_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _make_repo(tmp_path: Path, *, territory=("db/**",), sync_ref: str | None = "abc1234") -> Path:
    repo = tmp_path / "repo"
    umb = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    svc = umb / "services" / "db"
    svc.mkdir(parents=True)
    (svc / "SKILL.md").write_text("# DB\n", encoding="utf-8")
    (repo / "db").mkdir(parents=True)
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int);\n", encoding="utf-8")
    services: dict = {
        "db": {
            "name": "db",
            "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md",
            "territory": list(territory),
        }
    }
    if sync_ref is not None:
        services["db"]["last_sync_ref"] = sync_ref
        services["db"]["last_sync"] = "2026-10-01T00:00:00Z"
    (umb / "service-registry.json").write_text(
        json.dumps({"version": "1.0", "pack": "acme", "services": services}, indent=2) + "\n",
        encoding="utf-8",
    )
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo


def test_no_scan_or_rebuild_imports(checkout_hook) -> None:
    src = _HOOK_PATH.read_text(encoding="utf-8")
    assert "scan_drift" not in src
    assert "drift_detector" not in src
    assert "index.build" not in src
    # No mtime mechanism: no stat calls (registry last_sync* field reads are
    # the reason classifier, not a scan).
    assert "st_mtime" not in src
    assert "os.stat" not in src
    assert not hasattr(checkout_hook, "_rebuild_knowledge_index")


def test_no_registry_silent_no_marker(checkout_hook, monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(checkout_hook, "_load_registries", lambda root: [])
    argv = ["post-checkout", "aaa0000", "bbb0001", "1"]
    assert checkout_hook.main(argv) == 0
    assert capsys.readouterr().out == ""
    assert not (tmp_path / checkout_hook.MARKER_REL).exists()


def test_missing_argv_writes_range_unknown(checkout_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    assert checkout_hook.main(["post-checkout"]) == 0
    content = (repo / checkout_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "trigger: post-checkout" in content
    assert "reason: range-unknown" in content
    assert "range: unknown" in content


def test_null_prev_writes_fresh_cache_no_services(checkout_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    argv = ["post-checkout", NULL_PREV, "b" * 40, "1"]
    assert checkout_hook.main(argv) == 0
    content = (repo / checkout_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "trigger: post-checkout" in content
    assert "reason: fresh-cache" in content
    assert "services: (none)" in content
    out = capsys.readouterr().out
    assert "cold" in out.lower() or "fresh" in out.lower()
    # Fresh-cache is not a touch: no service attribution, no files count.
    assert "files: 0" in content


def test_same_ref_silent_file_checkout(checkout_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    argv = ["post-checkout", "a" * 40, "a" * 40, "0"]
    assert checkout_hook.main(argv) == 0
    assert capsys.readouterr().out == ""
    assert not (repo / checkout_hook.MARKER_REL).exists()


def test_no_touch_silent_no_marker_change(checkout_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(checkout_hook, "_checkout_range", lambda argv: ("aaa0000", "bbb0001", "1", "range"))
    monkeypatch.setattr(checkout_hook, "_tracked_files", lambda root: {"db/schema.sql", "README.md"})
    monkeypatch.setattr(checkout_hook, "_diff_files", lambda root, o, h: ["README.md"])
    assert checkout_hook.main(["post-checkout", "aaa0000", "bbb0001", "1"]) == 0
    assert capsys.readouterr().out == ""
    assert not (repo / checkout_hook.MARKER_REL).exists()


def test_untracked_scratch_never_matches(checkout_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(checkout_hook, "_checkout_range", lambda argv: ("aaa0000", "bbb0001", "1", "range"))
    monkeypatch.setattr(checkout_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(
        checkout_hook, "_diff_files",
        lambda root, o, h: [".pi/structured-returns/out.json", ".specialists/settlements/x.json"],
    )
    assert checkout_hook.main(["post-checkout", "aaa0000", "bbb0001", "1"]) == 0
    assert not (repo / checkout_hook.MARKER_REL).exists()


def test_touching_territory_writes_marker_only(checkout_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(checkout_hook, "_checkout_range", lambda argv: ("aaa0000" * 2, "bbb0001" * 2, "1", "range"))
    monkeypatch.setattr(checkout_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(checkout_hook, "_diff_files", lambda root, o, h: ["db/schema.sql"])
    assert checkout_hook.main(["post-checkout", "aaa0000" * 2, "bbb0001" * 2, "1"]) == 0
    marker = repo / checkout_hook.MARKER_REL
    content = marker.read_text(encoding="utf-8")
    assert "trigger: post-checkout" in content
    assert "reason: ref-range" in content
    assert "services: db" in content
    assert "range: aaa0000..bbb0001" in content
    out = capsys.readouterr().out
    assert "service-knowledge" in out.lower()
    assert len([ln for ln in out.splitlines() if ln.strip()]) <= 7  # one paragraph


def test_never_synced_reason_initial_sync_needed(checkout_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path, sync_ref=None)
    reg = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    data = json.loads(reg.read_text(encoding="utf-8"))
    data["services"]["db"].pop("last_sync", None)
    reg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(checkout_hook, "_checkout_range", lambda argv: ("aaa0000" * 2, "bbb0001" * 2, "1", "range"))
    monkeypatch.setattr(checkout_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(checkout_hook, "_diff_files", lambda root, o, h: ["db/schema.sql"])
    assert checkout_hook.main(["post-checkout", "aaa0000" * 2, "bbb0001" * 2, "1"]) == 0
    content = (repo / checkout_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "reason: initial-sync-needed" in content


def test_existing_marker_preserves_earliest_range(checkout_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    marker = repo / checkout_hook.MARKER_REL
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        "service-knowledge drift detected post-checkout (range aaa0000..bbb0001)\n"
        "trigger: post-checkout\nrange: aaa0000..bbb0001\nreason: ref-range\n"
        "services: db\nfiles: 1\ntimestamp: 2026-01-01T00:00:00Z\n"
        "action: run /updating-service-knowledge (service-knowledge-sync) to reconcile + stamp last_sync_ref\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(checkout_hook, "_checkout_range", lambda argv: ("bbb0001" * 2, "ccc0002" * 2, "1", "range"))
    monkeypatch.setattr(checkout_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(checkout_hook, "_diff_files", lambda root, o, h: ["db/schema.sql"])
    assert checkout_hook.main(["post-checkout", "x", "y", "1"]) == 0
    content = marker.read_text(encoding="utf-8")
    assert "range: aaa0000..ccc0002" in content


def test_exceptions_always_exit_zero(checkout_hook, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert checkout_hook.main(["post-checkout", "a", "b", "1"]) == 0
    monkeypatch.setattr(checkout_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(
        checkout_hook, "_load_registries", lambda root: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    assert checkout_hook.main(["post-checkout", "a", "b", "1"]) == 0



def test_no_auto_reconcile_subprocess_path(checkout_hook) -> None:
    """B7 cut: no hook subprocess invocation; marker + next-session only."""
    src = _HOOK_PATH.read_text(encoding="utf-8")
    for token in (
        "_auto_reconcile",
        "_run_sp_subprocess",
        "_append_runlog",
        "_resolve_pack",
        "AUTO_RECONCILE",
        "RUNLOG_REL",
        "allow-write-capable",
        "service-knowledge-auto-reconcile",
    ):
        assert token not in src
    assert "shutil" not in src
    assert not hasattr(checkout_hook, "_auto_reconcile")
    assert not hasattr(checkout_hook, "_run_sp_subprocess")
    assert not hasattr(checkout_hook, "_append_runlog")
    assert not hasattr(checkout_hook, "_resolve_pack")
    assert not hasattr(checkout_hook, "AUTO_RECONCILE_ENV")
    assert not hasattr(checkout_hook, "RUNLOG_REL")
    assert checkout_hook.TRIGGER == "post-checkout"
    assert checkout_hook.MARKER_REL == Path(".xtrm/.service-knowledge-drift-pending")
