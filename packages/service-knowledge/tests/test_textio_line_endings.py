"""XTRM-850 — every write path preserves the target's line-ending convention.

Reads in this package go through Python text mode, so ``\\r\\n`` arrives in memory as
``\\n``. Writing that buffer back without care silently rewrote CRLF files as LF. These
tests pin the behaviour of the shared helper and of each production write path:

* ``_textio.write_text`` / ``_textio.atomic_write`` — the helper itself
* ``reconcile.atomic_write`` — SKILL.md and the YAML registry
* ``reconcile.gated_write`` — the only sanctioned SKILL.md write, on a CRLF target
* ``umbrella_generator.write_umbrella`` — the per-repo umbrella
* ``skill_migrator.migrate_skill_file`` — heading migration
* ``bootstrap.save_registry`` — the JSON registry (+ trailing newline)
* ``cli.common.rewrite_registry_paths`` — the umbrella rename rewriter

Each test drives a REAL content change: a round trip that does not change the file is
not evidence (the old code also preserved CRLF when ``existing == content`` skipped the
write).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from service_knowledge.cli import common as cli_common
from service_knowledge.scripts import _textio, bootstrap, reconcile as reconcile_mod
from service_knowledge.scripts import skill_migrator, umbrella_generator
from service_knowledge.scripts.verifier.gate import GateDecision, GateVerdict

CRLF = b"\r\n"
SKILL_BODY = "# DB\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n"
CRLF_SKILL_BODY = SKILL_BODY.replace("\n", "\r\n")


def _write_crlf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))


def _write_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace("\r\n", "\n").encode("utf-8"))


def _has_only_crlf(path: Path) -> bool:
    data = path.read_bytes()
    return CRLF in data and b"\n" not in data.replace(CRLF, b"")


def _has_only_lf(path: Path) -> bool:
    data = path.read_bytes()
    return CRLF not in data


def _registry(*service_ids: str) -> dict:
    return {
        "version": "1.0",
        "pack": "acme",
        "services": {
            sid: {
                "name": sid,
                "description": f"{sid} service.",
                "skill_path": f".xtrm/skills/acme/service-knowledge/services/{sid}/SKILL.md",
                "territory": [f"{sid}/**"],
            }
            for sid in service_ids
        },
    }


# --- the helper ---------------------------------------------------------------
def test_write_text_creates_lf_for_a_new_file(tmp_path: Path) -> None:
    target = tmp_path / "new" / "file.md"
    _textio.write_text(target, "a\nb\n")
    assert target.read_bytes() == b"a\nb\n"


def test_write_text_preserves_crlf(tmp_path: Path) -> None:
    target = tmp_path / "file.md"
    _write_crlf(target, "old\n")
    _textio.write_text(target, "new one\nnew two\n")
    assert target.read_bytes() == b"new one\r\nnew two\r\n"
    assert _has_only_crlf(target)


def test_write_text_preserves_lf(tmp_path: Path) -> None:
    target = tmp_path / "file.md"
    _write_lf(target, "old\n")
    _textio.write_text(target, "new\n")
    assert _has_only_lf(target)


def test_write_text_does_not_double_translate_already_crlf_content(tmp_path: Path) -> None:
    target = tmp_path / "file.md"
    _write_crlf(target, "old\n")
    _textio.write_text(target, "already\r\ncrlf\r\n")
    assert target.read_bytes() == b"already\r\ncrlf\r\n"


def test_atomic_write_preserves_crlf_and_lf(tmp_path: Path) -> None:
    crlf_target = tmp_path / "crlf.md"
    lf_target = tmp_path / "lf.md"
    _write_crlf(crlf_target, "a\nb\n")
    _write_lf(lf_target, "a\nb\n")

    _textio.atomic_write(crlf_target, "x\ny\n")
    _textio.atomic_write(lf_target, "x\ny\n")

    assert _has_only_crlf(crlf_target)
    assert _has_only_lf(lf_target)
    assert crlf_target.read_bytes() == b"x\r\ny\r\n"


def test_atomic_write_leaves_no_temp_files_behind(tmp_path: Path) -> None:
    target = tmp_path / "file.md"
    _write_lf(target, "a\n")
    _textio.atomic_write(target, "b\n")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["file.md"]


def test_atomic_write_failure_leaves_target_untouched(tmp_path: Path, monkeypatch) -> None:
    target = tmp_path / "file.md"
    _write_lf(target, "original\n")

    def _boom(*_args, **_kwargs):
        raise OSError("replace failed")

    monkeypatch.setattr(_textio.os, "replace", _boom)
    with pytest.raises(OSError):
        _textio.atomic_write(target, "candidate\n")
    assert target.read_bytes() == b"original\n"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["file.md"]


# --- reconcile.atomic_write (SKILL.md + YAML registry) ------------------------
def test_reconcile_atomic_write_preserves_crlf(tmp_path: Path) -> None:
    target = tmp_path / "SKILL.md"
    _write_crlf(target, SKILL_BODY.replace("\r\n", "\n"))
    reconcile_mod.atomic_write(target, "## New\nbody\n")
    assert _has_only_crlf(target)


def test_reconcile_atomic_write_preserves_lf(tmp_path: Path) -> None:
    target = tmp_path / "SKILL.md"
    _write_lf(target, SKILL_BODY)
    reconcile_mod.atomic_write(target, "## New\nbody\n")
    assert _has_only_lf(target)


def test_update_yaml_registry_preserves_crlf(tmp_path: Path) -> None:
    registry = tmp_path / "service-registry.yml"
    _write_crlf(registry, "version: '1.0'\nlast_sync_ref: old\nlast_sync: 2020-01-01\n")
    reconcile_mod.update_yaml_registry(tmp_path, "newsha", "2026-01-01T00:00:00Z")
    text = registry.read_bytes()
    assert b"newsha" in text and b"2026-01-01T00:00:00Z" in text
    assert _has_only_crlf(registry)


# --- reconcile.gated_write (the only sanctioned SKILL.md write) ---------------
def _stub_gate(monkeypatch) -> None:
    monkeypatch.setattr(
        reconcile_mod,
        "compute_gate",
        lambda *_a, **_kw: GateDecision(verdict=GateVerdict.PASS),
    )
    monkeypatch.setattr(
        reconcile_mod, "_canary_evaluate", lambda *_a, **_kw: (False, "test", {"enabled": False})
    )


def test_gated_write_preserves_crlf_on_a_real_change(tmp_path: Path, monkeypatch) -> None:
    _stub_gate(monkeypatch)
    skill = tmp_path / "services" / "db" / "SKILL.md"
    _write_crlf(skill, CRLF_SKILL_BODY)
    before = skill.read_bytes()

    result = reconcile_mod.gated_write(
        skill,
        "# DB\n<!-- SEMANTIC_START -->\nrewritten notes\n<!-- SEMANTIC_END -->\n",
        service_id="db",
        territory=[],
        source_root=tmp_path,
        dry_run=False,
        emit_telemetry=False,
    )

    assert result["written"] is True
    after = skill.read_bytes()
    assert after != before
    assert b"rewritten notes" in after
    assert _has_only_crlf(skill)


def test_gated_write_preserves_lf_on_a_real_change(tmp_path: Path, monkeypatch) -> None:
    _stub_gate(monkeypatch)
    skill = tmp_path / "services" / "db" / "SKILL.md"
    _write_lf(skill, SKILL_BODY)

    reconcile_mod.gated_write(
        skill,
        "# DB\n<!-- SEMANTIC_START -->\nrewritten notes\n<!-- SEMANTIC_END -->\n",
        service_id="db",
        territory=[],
        source_root=tmp_path,
        dry_run=False,
        emit_telemetry=False,
    )

    assert _has_only_lf(skill)


# --- umbrella_generator.write_umbrella ---------------------------------------
def test_write_umbrella_preserves_crlf(tmp_path: Path) -> None:
    umbrella = tmp_path / "service-knowledge" / "SKILL.md"
    _write_crlf(umbrella, "# acme-service-knowledge\n\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n")
    before = umbrella.read_bytes()

    changed = umbrella_generator.write_umbrella(umbrella, _registry("db"), "acme")

    assert changed is True
    after = umbrella.read_bytes()
    assert after != before
    assert b"db" in after
    assert _has_only_crlf(umbrella)


def test_write_umbrella_preserves_lf(tmp_path: Path) -> None:
    umbrella = tmp_path / "service-knowledge" / "SKILL.md"
    _write_lf(umbrella, "# acme-service-knowledge\n\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n")

    umbrella_generator.write_umbrella(umbrella, _registry("db"), "acme")

    assert _has_only_lf(umbrella)


def test_write_umbrella_still_a_noop_when_normalised_content_matches(tmp_path: Path) -> None:
    umbrella = tmp_path / "service-knowledge" / "SKILL.md"
    _write_crlf(umbrella, "# acme-service-knowledge\n\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n")
    umbrella_generator.write_umbrella(umbrella, _registry("db"), "acme")
    first = umbrella.read_bytes()

    assert umbrella_generator.write_umbrella(umbrella, _registry("db"), "acme") is False
    assert umbrella.read_bytes() == first


# --- skill_migrator.migrate_skill_file --------------------------------------
def test_migrate_skill_file_preserves_crlf(tmp_path: Path) -> None:
    skill = tmp_path / "SKILL.md"
    _write_crlf(skill, "# DB\n\nbody line\n")
    before = skill.read_bytes()

    changed = skill_migrator.migrate_skill_file(skill)

    assert changed is True
    after = skill.read_bytes()
    assert after != before
    assert b"## " in after
    assert _has_only_crlf(skill)


def test_migrate_skill_file_preserves_lf(tmp_path: Path) -> None:
    skill = tmp_path / "SKILL.md"
    _write_lf(skill, "# DB\n\nbody line\n")

    skill_migrator.migrate_skill_file(skill)

    assert _has_only_lf(skill)


# --- bootstrap.save_registry ------------------------------------------------
def test_save_registry_preserves_crlf_and_keeps_trailing_newline(tmp_path: Path, monkeypatch) -> None:
    registry_path = tmp_path / "pack" / "service-registry.json"
    _write_crlf(registry_path, json.dumps(_registry("db"), indent=2) + "\n")
    monkeypatch.setenv("SERVICE_REGISTRY_PATH", str(registry_path))

    data = _registry("db", "cache")
    bootstrap.save_registry(data, str(tmp_path))

    raw = registry_path.read_bytes()
    assert _has_only_crlf(registry_path)
    assert raw.endswith(b"\r\n")
    assert json.loads(raw.decode("utf-8")) == data


def test_save_registry_writes_lf_and_trailing_newline_for_a_new_file(tmp_path: Path, monkeypatch) -> None:
    registry_path = tmp_path / "pack" / "service-registry.json"
    monkeypatch.setenv("SERVICE_REGISTRY_PATH", str(registry_path))

    bootstrap.save_registry(_registry("db"), str(tmp_path))

    raw = registry_path.read_bytes()
    assert _has_only_lf(registry_path)
    assert raw.endswith(b"\n")


# --- cli.common.rewrite_registry_paths --------------------------------------
def test_rewrite_registry_paths_preserves_crlf(tmp_path: Path) -> None:
    registry_path = tmp_path / "service-registry.json"
    legacy = {
        "version": "1.0",
        "services": {"db": {"skill_path": ".xtrm/skills/acme/service-skills/services/db/SKILL.md"}},
    }
    _write_crlf(registry_path, json.dumps(legacy, indent=2) + "\n")

    assert cli_common.rewrite_registry_paths(registry_path) is True

    raw = registry_path.read_bytes()
    assert b"service-knowledge/services/db" in raw
    assert _has_only_crlf(registry_path)


def test_rewrite_registry_paths_preserves_lf(tmp_path: Path) -> None:
    registry_path = tmp_path / "service-registry.json"
    legacy = {
        "version": "1.0",
        "services": {"db": {"skill_path": ".xtrm/skills/acme/service-skills/services/db/SKILL.md"}},
    }
    _write_lf(registry_path, json.dumps(legacy, indent=2) + "\n")

    assert cli_common.rewrite_registry_paths(registry_path) is True
    assert _has_only_lf(registry_path)
