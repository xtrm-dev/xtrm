"""Tests for the security-hardening validators."""

import pytest

from mcpq.validation import (
    validate_container_name,
    validate_header_value,
    validate_url,
)


# ---------- validate_url ----------

@pytest.mark.parametrize("url", [
    "http://localhost:8090/mcp",
    "https://example.com/mcp",
    "http://infra-prometheus-mcp:8091/mcp",
])
def test_valid_urls(url):
    validate_url(url)  # should not raise


@pytest.mark.parametrize("url,match", [
    ("ftp://example.com/x", "scheme"),
    ("file:///etc/passwd", "scheme"),
    ("gopher://x", "scheme"),
    ("javascript:alert(1)", "scheme"),
])
def test_invalid_scheme(url, match):
    with pytest.raises(ValueError, match=match):
        validate_url(url)


def test_empty_url_rejected():
    with pytest.raises(ValueError):
        validate_url("")


def test_missing_host():
    with pytest.raises(ValueError, match="host"):
        validate_url("http:///path")


def test_allowed_hosts_env(monkeypatch):
    monkeypatch.setenv("MCPQ_ALLOWED_HOSTS", "good.example,localhost")
    validate_url("http://localhost:8000/mcp")
    validate_url("http://good.example/mcp")
    with pytest.raises(ValueError, match="MCPQ_ALLOWED_HOSTS"):
        validate_url("http://evil.example/mcp")


def test_allowed_hosts_case_insensitive(monkeypatch):
    monkeypatch.setenv("MCPQ_ALLOWED_HOSTS", "GOOD.example")
    validate_url("http://good.EXAMPLE/mcp")


def test_allowed_hosts_empty_entries_ignored(monkeypatch):
    monkeypatch.setenv("MCPQ_ALLOWED_HOSTS", ",foo, ,bar,")
    validate_url("http://foo/mcp")
    validate_url("http://bar/mcp")
    with pytest.raises(ValueError):
        validate_url("http://baz/mcp")


# ---------- validate_header_value ----------

@pytest.mark.parametrize("val", ["Bearer token", "abc123", "application/json"])
def test_valid_header(val):
    assert validate_header_value("X-Test", val) == val


@pytest.mark.parametrize("val", [
    "value\r\nX-Evil: x",
    "value\nX-Evil: x",
    "value\rX-Evil: x",
    "value\x00null",
])
def test_invalid_header_crlf_nul(val):
    with pytest.raises(ValueError):
        validate_header_value("X-Test", val)


def test_non_string_header_raises():
    with pytest.raises((ValueError, TypeError)):
        validate_header_value("X-Test", 42)  # type: ignore[arg-type]


# ---------- validate_container_name ----------

@pytest.mark.parametrize("name", [
    "infra-prometheus-mcp",
    "foo.bar_baz-1",
    "A1",
    "container-with-dots.and_underscores",
])
def test_valid_container(name):
    validate_container_name(name)


@pytest.mark.parametrize("name", [
    "foo;bar",
    "--rm",
    "../etc",
    "name with space",
    "",
    "-leading-dash",
])
def test_invalid_container(name):
    with pytest.raises(ValueError):
        validate_container_name(name)
