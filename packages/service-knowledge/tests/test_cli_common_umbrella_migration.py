"""XTRM-849 — the umbrella rename must not nest one layout inside another.

``_git_mv_or_rename`` used ``git mv <pack>/service-skills <pack>/service-knowledge``. When
the destination already existed, ``git mv``/``shutil.move`` moved the legacy umbrella
INSIDE it (``service-knowledge/service-skills``), producing a silently mis-nested pack with
no registry where the resolver looks. These tests pin both halves of the fix:

* an existing destination is refused by the primitive, never nested into;
* ``migrate_umbrellas`` removes a provably empty destination and proceeds, and refuses a
  non-empty one with a message while leaving both trees untouched.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from service_knowledge.cli import common as cli_common
from service_knowledge.cli import migrate as migrate_cmd


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _repo(tmp_path: Path, name: str = "acme") -> tuple[Path, Path]:
    repo = tmp_path / name
    repo.mkdir(parents=True)
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    pack = repo / ".xtrm" / "skills" / "acme"
    legacy = pack / "service-skills"
    (legacy / "services" / "db").mkdir(parents=True)
    (legacy / "services" / "db" / "SKILL.md").write_text("# DB\n", encoding="utf-8")
    registry = {
        "version": "1.0",
        "pack": "acme",
        "services": {
            "db": {
                "name": "db",
                "skill_path": ".xtrm/skills/acme/service-skills/services/db/SKILL.md",
                "territory": ["db/**"],
            }
        },
    }
    (legacy / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo, pack


def test_git_mv_or_rename_refuses_an_existing_destination(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    src = repo / "service-skills"
    dst = repo / "service-knowledge"
    src.mkdir(parents=True)
    (src / "service-registry.json").write_text("{}", encoding="utf-8")
    dst.mkdir()
    (dst / "keep.txt").write_text("keep\n", encoding="utf-8")

    with pytest.raises(FileExistsError):
        cli_common._git_mv_or_rename(src, dst, repo)

    assert src.exists()
    assert not (dst / "service-skills").exists()
    assert (dst / "keep.txt").read_text(encoding="utf-8") == "keep\n"


def test_migrate_umbrellas_moves_into_an_empty_destination(tmp_path: Path) -> None:
    repo, pack = _repo(tmp_path)
    (pack / "service-knowledge").mkdir()  # empty leftover: provably nothing to lose

    touched = cli_common.migrate_umbrellas(repo)

    assert any(t.startswith(".xtrm/skills/acme/service-knowledge") for t in touched)
    assert (pack / "service-knowledge" / "service-registry.json").exists()
    assert not (pack / "service-knowledge" / "service-skills").exists()
    assert not (pack / "service-skills").exists()


def test_migrate_umbrellas_refuses_a_non_empty_destination_without_registry(
    tmp_path: Path, capsys
) -> None:
    repo, pack = _repo(tmp_path)
    new_umb = pack / "service-knowledge"
    (new_umb / "services" / "stale").mkdir(parents=True)
    (new_umb / "services" / "stale" / "SKILL.md").write_text("# stale\n", encoding="utf-8")

    touched = cli_common.migrate_umbrellas(repo)

    captured = capsys.readouterr()
    assert "refusing to migrate" in captured.err
    assert "service-knowledge/service-skills" in captured.err
    # Neither tree was touched: no nesting, no deletion, no path rewrite.
    assert (pack / "service-skills" / "service-registry.json").exists()
    assert not (new_umb / "service-registry.json").exists()
    assert not (new_umb / "service-skills").exists()
    assert (new_umb / "services" / "stale" / "SKILL.md").exists()
    assert not any("service-knowledge" in t for t in touched)


def test_find_umbrella_packs_prefers_the_new_name(tmp_path: Path) -> None:
    """A pack whose umbrella registry already lives under service-knowledge is never renamed."""
    repo, pack = _repo(tmp_path)
    cli_common.migrate_umbrellas(repo)

    found = cli_common.find_umbrella_packs(repo)

    assert [(p.name, u.name) for p, u in found] == [("acme", "service-knowledge")]


def test_migrate_command_does_not_report_a_refused_rename_as_already_migrated(
    tmp_path: Path, capsys
) -> None:
    """A refused rename returns non-zero instead of printing "already migrated"."""
    import argparse

    repo, pack = _repo(tmp_path)
    (pack / "service-knowledge" / "stray").mkdir(parents=True)
    (pack / "service-knowledge" / "stray" / "file.md").write_text("keep\n", encoding="utf-8")

    code = migrate_cmd.run(argparse.Namespace(path=str(repo)))

    captured = capsys.readouterr()
    assert code == 1
    assert "already migrated" not in captured.out
    assert "legacy umbrella left in place" in captured.out
