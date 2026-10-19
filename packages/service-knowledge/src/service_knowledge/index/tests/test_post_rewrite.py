"""B3: touches-gated marker-only post-rewrite hook (amend/rebase SHAs, no mtime scan)."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import types
from pathlib import Path

import pytest

_HOOK_PATH = (
    Path(__file__).resolve().parents[3]
    / "service_knowledge"
    / "install"
    / "git-hooks"
    / "post_rewrite_drift_sweep.py"
)


@pytest.fixture
def rewrite_hook():
    spec = importlib.util.spec_from_file_location("post_rewrite_drift_sweep_test", _HOOK_PATH)
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


def _amend_argv() -> list[str]:
    return ["post-rewrite", "amend"]


def test_no_scan_or_rebuild_imports(rewrite_hook) -> None:
    src = _HOOK_PATH.read_text(encoding="utf-8")
    assert "scan_drift" not in src
    assert "drift_detector" not in src
    assert "index.build" not in src
    # No mtime mechanism: no stat calls (registry last_sync* field reads are
    # the reason classifier, not a scan).
    assert "st_mtime" not in src
    assert "os.stat" not in src
    assert not hasattr(rewrite_hook, "_rebuild_knowledge_index")


def test_no_registry_silent_no_marker(rewrite_hook, monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(rewrite_hook, "_load_registries", lambda root: [])
    assert rewrite_hook.main(_amend_argv(), stdin_text="aaa bbb\n") == 0
    assert capsys.readouterr().out == ""
    assert not (tmp_path / rewrite_hook.MARKER_REL).exists()


def test_missing_argv_writes_range_unknown(rewrite_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(rewrite_hook, "_auto_reconcile", lambda root: (False, "opt-in disabled"))
    assert rewrite_hook.main(["post-rewrite"], stdin_text="") == 0
    content = (repo / rewrite_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "trigger: post-rewrite" in content
    assert "reason: range-unknown" in content


def test_bad_command_writes_range_unknown(rewrite_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(rewrite_hook, "_auto_reconcile", lambda root: (False, "opt-in disabled"))
    assert rewrite_hook.main(["post-rewrite", "frobnicate"], stdin_text="aaa bbb\n") == 0
    content = (repo / rewrite_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "reason: range-unknown" in content


def test_empty_stdin_writes_range_unknown(rewrite_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(rewrite_hook, "_auto_reconcile", lambda root: (False, "opt-in disabled"))
    assert rewrite_hook.main(_amend_argv(), stdin_text="") == 0
    content = (repo / rewrite_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "reason: range-unknown" in content


def test_noop_rewrite_silent(rewrite_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    assert rewrite_hook.main(_amend_argv(), stdin_text="aaa0000 aaa0000\n") == 0
    assert capsys.readouterr().out == ""
    assert not (repo / rewrite_hook.MARKER_REL).exists()


def test_amend_touch_writes_marker_only(rewrite_hook, monkeypatch, tmp_path, capsys) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(
        rewrite_hook, "_rewrite_pairs",
        lambda argv, stdin: ([("aaa0000" * 2, "bbb0001" * 2)], "pairs"),
    )
    monkeypatch.setattr(rewrite_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(rewrite_hook, "_union_diff_files", lambda root, pairs: ["db/schema.sql"])
    monkeypatch.setattr(rewrite_hook, "_auto_reconcile", lambda root: (False, "opt-in disabled"))
    assert rewrite_hook.main(_amend_argv(), stdin_text="aaa bbb\n") == 0
    marker = repo / rewrite_hook.MARKER_REL
    content = marker.read_text(encoding="utf-8")
    assert "trigger: post-rewrite" in content
    assert "reason: ref-range" in content
    assert "services: db" in content
    assert "range: aaa0000..bbb0001" in content
    out = capsys.readouterr().out
    assert "service-knowledge" in out.lower()
    assert len([ln for ln in out.splitlines() if ln.strip()]) <= 7  # one paragraph


def test_rebase_union_scopes_all_pairs(rewrite_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    seen: list[list[tuple[str, str]]] = []
    real_union = rewrite_hook._union_diff_files

    def spy_union(root, pairs):
        seen.append(pairs)
        return real_union(root, pairs)

    monkeypatch.setattr(rewrite_hook, "_union_diff_files", spy_union)
    monkeypatch.setattr(
        rewrite_hook, "_tracked_files",
        lambda root: {"db/schema.sql", "README.md"},
    )
    orig_diff = rewrite_hook._diff_files
    monkeypatch.setattr(
        rewrite_hook, "_diff_files",
        lambda root, o, h: ["README.md"] if o.startswith("aaa") else ["db/schema.sql"],
    )
    monkeypatch.setattr(rewrite_hook, "_auto_reconcile", lambda root: (False, "opt-in disabled"))
    stdin_text = f'{"a" * 40} {"b" * 40}\n{"c" * 40} {"d" * 40}\n'
    assert rewrite_hook.main(["post-rewrite", "rebase"], stdin_text=stdin_text) == 0
    assert seen and len(seen[0]) == 2  # union over both rewritten commits
    content = (repo / rewrite_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "services: db" in content
    assert f'range: {"a" * 7}..{"d" * 7}' in content


def test_huge_rebase_uses_bounding_diff(rewrite_hook, monkeypatch, tmp_path) -> None:
    calls: list[tuple[str, str]] = []
    # Deterministic 40-hex pairs, 25 > _MAX_PRECISE_PAIRS.
    pairs = [(f"{i:040d}".replace("0", "a")[:40], f"{i + 1000:040d}".replace("0", "b")[:40]) for i in range(1, 26)]
    monkeypatch.setattr(rewrite_hook, "_diff_files", lambda root, o, h: calls.append((o, h)) or ["db/x"])
    out = rewrite_hook._union_diff_files(tmp_path, pairs)
    assert out == ["db/x"]
    assert len(calls) == 1  # one bounding diff, not 25 per-pair diffs
    assert calls[0] == (pairs[0][0], pairs[-1][1])


def test_unresolvable_shas_write_range_unknown(rewrite_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(
        rewrite_hook, "_rewrite_pairs",
        lambda argv, stdin: ([("deadbee" * 5 + "f", "beef00" * 5 + "d")], "pairs"),
    )
    monkeypatch.setattr(rewrite_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(rewrite_hook, "_union_diff_files", lambda root, pairs: None)
    monkeypatch.setattr(rewrite_hook, "_auto_reconcile", lambda root: (False, "opt-in disabled"))
    assert rewrite_hook.main(_amend_argv(), stdin_text="x y\n") == 0
    content = (repo / rewrite_hook.MARKER_REL).read_text(encoding="utf-8")
    assert "reason: range-unknown" in content


def test_untracked_scratch_never_matches(rewrite_hook, monkeypatch, tmp_path) -> None:
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: repo)
    monkeypatch.setattr(
        rewrite_hook, "_rewrite_pairs", lambda argv, stdin: ([("aaa", "bbb")], "pairs")
    )
    monkeypatch.setattr(rewrite_hook, "_tracked_files", lambda root: {"db/schema.sql"})
    monkeypatch.setattr(
        rewrite_hook, "_union_diff_files",
        lambda root, pairs: [".pi/structured-returns/out.json"],
    )
    assert rewrite_hook.main(_amend_argv(), stdin_text="aaa bbb\n") == 0
    assert not (repo / rewrite_hook.MARKER_REL).exists()


def test_exceptions_always_exit_zero(rewrite_hook, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert rewrite_hook.main(_amend_argv(), stdin_text="a b\n") == 0
    monkeypatch.setattr(rewrite_hook, "_project_root", lambda: tmp_path)
    monkeypatch.setattr(
        rewrite_hook, "_load_registries", lambda root: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    assert rewrite_hook.main(_amend_argv(), stdin_text="a b\n") == 0


def test_auto_reconcile_invokes_service_knowledge_specialist(rewrite_hook, monkeypatch, tmp_path):
    calls: list[list[str]] = []
    monkeypatch.setenv(rewrite_hook.AUTO_RECONCILE_ENV, "1")
    monkeypatch.setattr(rewrite_hook.shutil, "which", lambda command: "/usr/bin/sp")
    monkeypatch.setattr(rewrite_hook, "_resolve_pack", lambda root: "infra")

    def run(cmd, env, timeout_s):
        calls.append(cmd)
        return types.SimpleNamespace(
            returncode=0,
            stdout='{"success": true, "meta": {"trace_id": "trace-1"}}',
            stderr="",
        )

    monkeypatch.setattr(rewrite_hook, "_run_sp_subprocess", run)

    assert rewrite_hook._auto_reconcile(tmp_path) == (True, "sp script success: trace-1")
    assert calls[0][2] == "service-knowledge-sync"
    assert rewrite_hook.TRIGGER == "post-rewrite"
