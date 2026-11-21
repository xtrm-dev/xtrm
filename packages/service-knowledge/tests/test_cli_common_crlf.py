"""XTRM-921: wire_hooks, unwire_hooks and ensure_runtime_gitignored keep the target's line endings."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from service_knowledge.cli import common


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init", "-q", str(root)], check=True)


def _crlf(text: str) -> bytes:
    return text.replace("\n", "\r\n").encode()


def _lone_lf(data: bytes) -> bool:
    return b"\n" in data.replace(b"\r\n", b"")


def _settings(root: Path) -> Path:
    path = root / ".claude" / "settings.json"
    path.parent.mkdir(parents=True)
    return path


def test_wire_hooks_keeps_crlf(tmp_path):
    path = _settings(tmp_path)
    path.write_bytes(_crlf(json.dumps({"model": "x", "hooks": {}}, indent=2) + "\n"))
    assert common.wire_hooks(tmp_path) == [".claude/settings.json"]
    data = path.read_bytes()
    assert b"\r\n" in data and not _lone_lf(data)


def test_wire_hooks_keeps_lf_and_creates_lf(tmp_path):
    path = _settings(tmp_path)
    path.write_bytes((json.dumps({"hooks": {}}, indent=2) + "\n").encode())
    common.wire_hooks(tmp_path)
    assert b"\r" not in path.read_bytes()
    fresh = tmp_path / "fresh"
    common.wire_hooks(fresh)
    assert b"\r" not in (fresh / ".claude" / "settings.json").read_bytes()


def test_unwire_hooks_keeps_crlf(tmp_path):
    path = _settings(tmp_path)
    path.write_bytes(_crlf(json.dumps({"model": "x"}, indent=2) + "\n"))
    common.wire_hooks(tmp_path)
    path.write_bytes(_crlf(path.read_text()))  # normalise to CRLF, as a CRLF consumer repo has it
    assert common.unwire_hooks(tmp_path) == [".claude/settings.json"]
    data = path.read_bytes()
    assert b"\r\n" in data and not _lone_lf(data)


def test_unwire_hooks_keeps_lf(tmp_path):
    path = _settings(tmp_path)
    path.write_bytes(b'{"model": "x"}\n')
    common.wire_hooks(tmp_path)
    common.unwire_hooks(tmp_path)
    assert b"\r" not in path.read_bytes()


def test_gitignore_keeps_crlf(tmp_path):
    _init_repo(tmp_path)
    gi = tmp_path / ".gitignore"
    gi.write_bytes(b"node_modules/\r\ndist/\r\n")
    assert common.ensure_runtime_gitignored(tmp_path) == [".gitignore"]
    data = gi.read_bytes()
    assert data.endswith(b".xtrm/state/service-knowledge/\r\n") and not _lone_lf(data)


def test_gitignore_keeps_lf_and_creates_lf(tmp_path):
    _init_repo(tmp_path)
    gi = tmp_path / ".gitignore"
    gi.write_bytes(b"node_modules/\n")
    common.ensure_runtime_gitignored(tmp_path)
    assert b"\r" not in gi.read_bytes()
    other = tmp_path / "other"
    _init_repo(other)
    common.ensure_runtime_gitignored(other)
    assert b"\r" not in (other / ".gitignore").read_bytes()
