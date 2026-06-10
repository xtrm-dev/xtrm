"""Security validation helpers for URLs, headers, and container names."""

from __future__ import annotations

import re
from urllib.parse import urlparse

# RFC 7230 forbids CR / LF / NUL in field values. We mirror that to keep
# header values from being able to inject extra header lines or break the
# HTTP parser downstream.
_FORBIDDEN_HEADER_BYTES = frozenset({0x00, 0x0A, 0x0D})

# Container names: must start with [A-Za-z0-9], then any number of
# [A-Za-z0-9_.-]. Matches Docker's own naming rules closely enough for
# our purposes (we do not need full RFC 1123 compliance, just enough to
# keep the docker exec argv safe).
_CONTAINER_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")

# Optional allow-list of hostnames (comma-separated) via env var.
ALLOWED_HOSTS_ENV = "MCPQ_ALLOWED_HOSTS"


def validate_url(url: str) -> str:
    """Return `url` unchanged if it parses as a safe http/https URL.

    Raises ValueError on disallowed scheme, missing host, or non-http(s).
    Honours the MCPQ_ALLOWED_HOSTS env var when set (comma-separated).
    """
    if not url:
        raise ValueError("url must be non-empty")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(
            f"url scheme {parsed.scheme!r} not allowed; expected http or https"
        )
    if not parsed.hostname:
        raise ValueError(f"url {url!r} has no host")
    import os

    allowed_env = os.environ.get(ALLOWED_HOSTS_ENV, "").strip()
    if allowed_env:
        allowed = {h.strip().lower() for h in allowed_env.split(",") if h.strip()}
        if allowed and parsed.hostname.lower() not in allowed:
            raise ValueError(
                f"url host {parsed.hostname!r} not in {ALLOWED_HOSTS_ENV} allow-list"
            )
    return url


def validate_header_value(name: str, value: str) -> str:
    """Reject CR / LF / NUL in header values per RFC 7230."""
    if not isinstance(value, str):
        raise ValueError(f"header {name!r}: value must be str, got {type(value).__name__}")
    for ch in value:
        if ord(ch) in _FORBIDDEN_HEADER_BYTES:
            raise ValueError(
                f"header {name!r}: contains forbidden byte 0x{ord(ch):02x}"
            )
    return value


def validate_container_name(name: str) -> str:
    """Reject anything that wouldn't be a safe `docker exec` argv element."""
    if not name:
        raise ValueError("container name must be non-empty")
    if not _CONTAINER_NAME_RE.match(name):
        raise ValueError(
            f"container name {name!r} is not a valid identifier "
            f"(must match {_CONTAINER_NAME_RE.pattern})"
        )
    return name
