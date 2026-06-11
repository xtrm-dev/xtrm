"""Tests for .mcpq.json discovery and loading."""

import json
from pathlib import Path

import pytest

from mcpq.config import discover_config, load_config


def _write_config(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test_load_minimal(tmp_path):
    cfg = tmp_path / ".mcpq.json"
    _write_config(cfg, {
        "servers": {
            "p": {"url": "http://example.com/mcp", "via": "host"},
        }
    })
    servers = load_config(cfg)
    assert set(servers) == {"p"}
    assert servers["p"].url == "http://example.com/mcp"
    assert servers["p"].via == "host"


def test_load_docker_via(tmp_path):
    cfg = tmp_path / ".mcpq.json"
    _write_config(cfg, {
        "servers": {
            "p": {
                "url": "http://infra-prometheus-mcp:8091/mcp",
                "via": "docker:infra-prometheus-mcp",
            }
        }
    })
    servers = load_config(cfg)
    assert servers["p"].proxy_container == "infra-prometheus-mcp"


def test_load_rejects_bad_container_name(tmp_path):
    cfg = tmp_path / ".mcpq.json"
    _write_config(cfg, {
        "servers": {
            "p": {"url": "http://x/mcp", "via": "docker:foo;bar"},
        }
    })
    with pytest.raises(ValueError):
        load_config(cfg)


def test_load_rejects_bad_url(tmp_path):
    cfg = tmp_path / ".mcpq.json"
    _write_config(cfg, {
        "servers": {
            "p": {"url": "ftp://example.com/x", "via": "host"},
        }
    })
    with pytest.raises(ValueError):
        load_config(cfg)


def test_load_rejects_crlf_header(tmp_path):
    cfg = tmp_path / ".mcpq.json"
    _write_config(cfg, {
        "servers": {
            "p": {
                "url": "http://x/mcp",
                "via": "host",
                "headers": {"X-Bad": "a\r\nX-Evil: b"},
            }
        }
    })
    with pytest.raises(ValueError):
        load_config(cfg)


def test_load_rejects_missing_url(tmp_path):
    cfg = tmp_path / ".mcpq.json"
    _write_config(cfg, {"servers": {"p": {"via": "host"}}})
    with pytest.raises((ValueError, KeyError)):
        load_config(cfg)


def test_discover_walks_up(tmp_path, monkeypatch):
    deep = tmp_path / "a" / "b" / "c"
    deep.mkdir(parents=True)
    cfg = tmp_path / "a" / ".mcpq.json"
    _write_config(cfg, {"servers": {"p": {"url": "http://x/mcp", "via": "host"}}})
    monkeypatch.chdir(deep)
    found = discover_config(stop_at=tmp_path)
    assert found.resolve() == cfg.resolve()


def test_discover_raises_above_ceiling(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # Ceiling somewhere unrelated; no .mcpq.json anywhere in scope
    with pytest.raises(FileNotFoundError):
        discover_config(stop_at=tmp_path / "nonexistent_ceiling")


def test_explicit_path_bypasses_walk(tmp_path):
    cfg = tmp_path / "custom.json"
    _write_config(cfg, {"servers": {"p": {"url": "http://x/mcp", "via": "host"}}})
    servers = load_config(cfg)
    assert "p" in servers
