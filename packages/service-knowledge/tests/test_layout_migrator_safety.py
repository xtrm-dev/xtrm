"""XTRM-849 — the layout migrator must never delete or overwrite data it has not proven redundant.

The pre-#334 non-goal: ``migrate_pack`` compared only the two ``SKILL.md`` files and then
``shutil.rmtree``d the flat directory, so any flat-only or differing file (``scripts/``,
``references/``, a probe) vanished. Two missing ``SKILL.md`` files compared ``None == None``
and counted as equal. The registry was overwritten without comparison and ``PACK.json`` was
deleted unconditionally.

These tests pin the fixed contract:

* a read-only preflight over EVERY service, refusing ONCE before any mutation and listing
  every offending path of every service;
* an equal tree is moved aside (``<svc>.legacy-<UTC stamp>``), never deleted;
* two registries must agree (ignoring ``skill_path``) or the pack is refused; agreeing
  registries merge by service id;
* ``PACK.json`` is kept and reported;
* ``--preflight`` prints the offending paths and leaves the tree byte-identical.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from service_knowledge.scripts import layout_migrator
from service_knowledge.scripts.layout_migrator import MigrationRefused, migrate_pack, preflight_pack

SKILL_BODY = "# DB service\n\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n"


# --- fixtures -----------------------------------------------------------------
def _pack(tmp_path: Path) -> tuple[Path, Path]:
    project = tmp_path / "acme-infra"
    pack = project / ".xtrm" / "skills" / "acme"
    pack.mkdir(parents=True)
    return project, pack


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _service(service_id: str, **overrides) -> dict:
    entry = {
        "name": service_id,
        "description": f"{service_id} service.",
        "skill_path": f".xtrm/skills/acme/service-skills/services/{service_id}/SKILL.md",
        "territory": [f"{service_id}/**"],
    }
    entry.update(overrides)
    return entry


def _registry(pack: Path, services: dict[str, dict], name: str = "service-registry.json", pack_name: str = "acme") -> Path:
    path = pack / name
    _write(path, json.dumps({"version": "1.0", "pack": pack_name, "services": services}, indent=2) + "\n")
    return path


def _snapshot(root: Path) -> tuple[list[str], dict[str, bytes]]:
    """Every relative path under ``root`` plus the bytes of every file."""
    entries = sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))
    blobs = {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and not p.is_symlink()
    }
    return entries, blobs


# --- preflight refuses before any mutation ------------------------------------
def test_flat_only_file_refuses_and_lists_the_path(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "db" / "scripts" / "health_probe.py", "print('ok')\n")
    _write(pack / "service-skills" / "services" / "db" / "SKILL.md", SKILL_BODY)
    before = _snapshot(pack)

    with pytest.raises(MigrationRefused) as excinfo:
        migrate_pack(project, pack, "acme")

    message = str(excinfo.value)
    assert "scripts/health_probe.py" in message
    assert "flat-only" in message
    assert _snapshot(pack) == before


def test_differing_file_refuses(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "db" / "references" / "schema.md", "flat version\n")
    _write(pack / "service-skills" / "services" / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "service-skills" / "services" / "db" / "references" / "schema.md", "umbrella version\n")
    before = _snapshot(pack)

    with pytest.raises(MigrationRefused) as excinfo:
        migrate_pack(project, pack, "acme")

    assert "references/schema.md" in str(excinfo.value)
    assert "differs" in str(excinfo.value)
    assert _snapshot(pack) == before


def test_refusal_covers_every_offending_service_and_mutates_nothing(tmp_path: Path) -> None:
    """One refusal naming every service: no service is migrated before the verdict."""
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db"), "cache": _service("cache")})
    # db is healthy and would migrate; cache carries a flat-only file and must block the pack.
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "cache" / "SKILL.md", SKILL_BODY)
    _write(pack / "cache" / "scripts" / "probe.sh", "#!/bin/sh\n")
    _write(pack / "service-skills" / "services" / "cache" / "SKILL.md", SKILL_BODY)
    before = _snapshot(pack)

    with pytest.raises(MigrationRefused) as excinfo:
        migrate_pack(project, pack, "acme")

    message = str(excinfo.value)
    assert "probe.sh" in message
    assert "cache" in message
    # db was NOT migrated: its flat directory is still there and no umbrella copy appeared.
    assert (pack / "db" / "SKILL.md").exists()
    assert not (pack / "service-skills" / "services" / "db").exists()
    assert _snapshot(pack) == before


def test_two_missing_skill_md_does_not_count_as_equal(tmp_path: Path) -> None:
    """``None == None`` used to pass the old SKILL.md-only comparison."""
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _write(pack / "db" / "references" / "schema.md", "only here\n")
    (pack / "service-skills" / "services" / "db").mkdir(parents=True)
    before = _snapshot(pack)

    with pytest.raises(MigrationRefused) as excinfo:
        migrate_pack(project, pack, "acme")

    assert "references/schema.md" in str(excinfo.value)
    assert _snapshot(pack) == before


def test_preflight_pack_is_read_only(tmp_path: Path) -> None:
    _project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "db" / "scripts" / "probe.sh", "#!/bin/sh\n")
    _write(pack / "service-skills" / "services" / "db" / "SKILL.md", SKILL_BODY)
    before = _snapshot(pack)

    problems = preflight_pack(pack)

    assert len(problems) == 1 and "scripts/probe.sh" in problems[0]
    assert _snapshot(pack) == before


# --- equal trees are moved aside, never deleted -------------------------------
def test_equal_tree_is_moved_aside_not_deleted(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    for base in (pack / "db", pack / "service-skills" / "services" / "db"):
        _write(base / "SKILL.md", SKILL_BODY)
        _write(base / "scripts" / "health_probe.py", "print('ok')\n")
        _write(base / "references" / "schema.md", "same bytes\n")

    result = migrate_pack(project, pack, "acme")

    assert result["services"]["db"] == "deduped"
    assert not (pack / "db").exists()
    aside = result["moved_aside"]["db"]
    assert aside.startswith("db.legacy-")
    recovered = pack / aside
    assert (recovered / "SKILL.md").read_text(encoding="utf-8") == SKILL_BODY
    assert (recovered / "scripts" / "health_probe.py").read_text(encoding="utf-8") == "print('ok')\n"
    assert (recovered / "references" / "schema.md").read_text(encoding="utf-8") == "same bytes\n"


def test_move_aside_timestamps_are_unique(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    for base in (pack / "db", pack / "service-skills" / "services" / "db"):
        _write(base / "SKILL.md", SKILL_BODY)
    first = migrate_pack(project, pack, "acme")["moved_aside"]["db"]

    # A stale flat copy reappears (e.g. restored from git) and is deduped again.
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    second = migrate_pack(project, pack, "acme")["moved_aside"]["db"]

    assert first != second
    assert (pack / first).exists() and (pack / second).exists()


# --- registry safety ----------------------------------------------------------
def test_divergent_registries_refuse(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _registry(pack / "service-skills", {"db": _service("db", description="different description")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    before = _snapshot(pack)

    with pytest.raises(MigrationRefused) as excinfo:
        migrate_pack(project, pack, "acme")

    message = str(excinfo.value)
    assert "registry" in message and "'db'" in message
    assert _snapshot(pack) == before


def test_registries_merge_by_service_id(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _registry(pack / "service-skills", {"cache": _service("cache")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)

    result = migrate_pack(project, pack, "acme")

    assert result["status"] == "ok"
    merged = json.loads((pack / "service-skills" / "service-registry.json").read_text(encoding="utf-8"))
    assert sorted(merged["services"]) == ["cache", "db"]
    assert merged["services"]["db"]["skill_path"].endswith("service-skills/services/db/SKILL.md")
    assert merged["services"]["cache"]["skill_path"].endswith("service-skills/services/cache/SKILL.md")
    assert not (pack / "service-registry.json").exists()


def test_skill_path_difference_alone_does_not_refuse(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db", skill_path=".xtrm/skills/acme/db/SKILL.md")})
    _registry(pack / "service-skills", {"db": _service("db")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)

    result = migrate_pack(project, pack, "acme")

    assert result["services"]["db"] == "migrated"


# --- PACK.json ----------------------------------------------------------------
def test_pack_json_is_kept_and_reported(tmp_path: Path) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "PACK.json", json.dumps({"name": "acme", "version": "1"}) + "\n")

    result = migrate_pack(project, pack, "acme")

    assert result["pack_json_kept"] is True
    assert (pack / "PACK.json").exists()


# --- CLI ----------------------------------------------------------------------
def test_cli_preflight_prints_every_offending_path_and_changes_nothing(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    project, pack = _pack(tmp_path)
    _registry(pack, {"db": _service("db")})
    _write(pack / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "db" / "scripts" / "probe.sh", "#!/bin/sh\n")
    _write(pack / "service-skills" / "services" / "db" / "SKILL.md", SKILL_BODY)
    _write(pack / "service-skills" / "services" / "db" / "scripts" / "other.sh", "#!/bin/sh\n")
    before = _snapshot(pack)

    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(project))
    monkeypatch.delenv("XTRM_PACK", raising=False)
    monkeypatch.setattr(sys, "argv", ["layout_migrator.py", "--preflight"])

    with pytest.raises(SystemExit) as excinfo:
        layout_migrator.main()

    assert excinfo.value.code == 2
    captured = capsys.readouterr()
    assert "scripts/probe.sh" in captured.err
    assert "nothing would be changed" in captured.err
    assert _snapshot(pack) == before
