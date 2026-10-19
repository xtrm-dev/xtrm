"""B2: marker-only touches-gated post-merge hook (no rebuild, no mtime scan)."""
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
    / "post_merge_drift_sweep.py"
)


@pytest.fixture
def post_merge_hook():
    spec = importlib.util.spec_from_file_location("post_merge_drift_sweep_test", _HOOK_PATH)
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


def test_no_rebuild_or_scan_imports(post_merge_hook) -> None:
    src = _HOOK_PATH.read_text(encoding="utf-8")
    assert "_rebuild_knowledge_index" not in src
    assert "scan_drift" not in src
    assert "drift_detector" not in src
    assert "index.build" not in src
    assert not hasattr(post_merge_hook, "_rebuild_knowledge_index")
    assert not hasattr(post_merge_hook, "_current_branch")
    assert not hasattr(post_merge_hook, "_default_branch")


def test_no_registry_silent_no_marker(post_merge_hook, monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(post_merge_hook, "_load_registries", lambda root: [])
    assert post_merge_hook.main() == 0
    assert capsys.readouterr().out == ""
    assert not (tmp_path / post_merge_hook.MARKER_REL).exists()


def test_no_touch_silent_no_marker_change(post_merge_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: ("aaa0000", "bbb0001"))
    monkeypatch.setattr(post_merge_hook, "_tracked_files", lambda root: {"db/schema.sql", "README.md"})
    monkeypatch.setattr(post_merge_hook, "_diff_files", lambda root, o, h: ["README.md"])
    assert post_merge_hook.main() == 0
    assert capsys.readouterr().out == ""
    assert not (repo / post_merge_hook.MARKER_REL).exists()


def test_untracked_scratch_never_matches(post_merge_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: ("aaa0000", "bbb0001"))
    # diff lists only tracked files in reality; simulate a scratch path leaking
    # into the diff and assert the ls-files filter drops it.
    monkeypatch.setattr(
        post_merge_hook, "_tracked_files", lambda root: {"db/schema.sql"}
    )
    monkeypatch.setattr(
        post_merge_hook, "_diff_files",
        lambda root, o, h: [".pi/structured-returns/out.json", ".specialists/settlements/x.json"],
    )
    assert post_merge_hook.main() == 0
    assert capsys.readouterr().out == ""
    assert not (repo / post_merge_hook.MARKER_REL).exists()


def test_touching_territory_writes_marker_only(post_merge_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: ("aaa0000" * 2, "bbb0001" * 2))
    monkeypatch.setattr(post_merge_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(post_merge_hook, "_diff_files", lambda root, o, h: ["db/schema.sql"])
    assert post_merge_hook.main() == 0
    marker = repo / post_merge_hook.MARKER_REL
    assert marker.exists()
    content = marker.read_text(encoding="utf-8")
    assert "trigger: post-merge" in content
    assert "reason: ref-range" in content
    assert "services: db" in content
    assert "timestamp:" in content
    assert "range: aaa0000..bbb0001" in content
    out = capsys.readouterr().out
    assert "service-knowledge" in out.lower()
    assert len([ln for ln in out.splitlines() if ln.strip()]) <= 7  # one paragraph


def test_registry_path_touch_attributes_all_services(post_merge_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    reg_rel = ".xtrm/skills/acme/service-knowledge/service-registry.json"
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: ("aaa0000" * 2, "bbb0001" * 2))
    monkeypatch.setattr(post_merge_hook, "_tracked_files", lambda root: {reg_rel})
    monkeypatch.setattr(post_merge_hook, "_diff_files", lambda root, o, h: [reg_rel])
    assert post_merge_hook.main() == 0
    content = (repo / post_merge_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "services: db" in content


def test_never_synced_reason_initial_sync_needed(post_merge_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path, sync_ref=None)
    # Strip last_sync too so the service counts as never verified-synced.
    reg = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    data = json.loads(reg.read_text(encoding="utf-8"))
    data["services"]["db"].pop("last_sync", None)
    reg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: ("aaa0000" * 2, "bbb0001" * 2))
    monkeypatch.setattr(post_merge_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(post_merge_hook, "_diff_files", lambda root, o, h: ["db/schema.sql"])
    assert post_merge_hook.main() == 0
    content = (repo / post_merge_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "reason: initial-sync-needed" in content


def test_range_unknown_writes_marker_exit_zero(post_merge_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: (None, None))
    assert post_merge_hook.main() == 0
    content = (repo / post_merge_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "reason: range-unknown" in content
    assert "range: unknown" in content


def test_existing_marker_preserves_earliest_range(post_merge_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    marker = repo / post_merge_hook.MARKER_REL
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        "service-knowledge drift detected post-merge (range aaa0000..bbb0001)\n"
        "trigger: post-merge\nrange: aaa0000..bbb0001\nreason: ref-range\n"
        "services: db\nfiles: 1\ntimestamp: 2026-01-01T00:00:00Z\n"
        "action: run /updating-service-knowledge (service-knowledge-sync) to reconcile + stamp last_sync_ref\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(post_merge_hook, "_resolve_range", lambda root: ("bbb0001" * 2, "ccc0002" * 2))
    monkeypatch.setattr(post_merge_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(post_merge_hook, "_diff_files", lambda root, o, h: ["db/schema.sql"])
    assert post_merge_hook.main() == 0
    content = marker.read_text(encoding="utf-8")
    assert "range: aaa0000..ccc0002" in content


def test_exceptions_always_exit_zero(post_merge_hook, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert post_merge_hook.main() == 0
    monkeypatch.setattr(post_merge_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(
        post_merge_hook, "_load_registries", lambda root: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    assert post_merge_hook.main() == 0



def test_no_auto_reconcile_subprocess_path(post_merge_hook) -> None:
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
    assert not hasattr(post_merge_hook, "_auto_reconcile")
    assert not hasattr(post_merge_hook, "_run_sp_subprocess")
    assert not hasattr(post_merge_hook, "_append_runlog")
    assert not hasattr(post_merge_hook, "_resolve_pack")
    assert not hasattr(post_merge_hook, "AUTO_RECONCILE_ENV")
    assert not hasattr(post_merge_hook, "RUNLOG_REL")
    assert post_merge_hook.TRIGGER == "post-merge"
    assert post_merge_hook.MARKER_REL == Path(".xtrm/.service-knowledge-drift-pending")
