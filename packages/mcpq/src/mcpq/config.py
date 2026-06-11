"""Discover and parse `.mcpq.json` configuration files."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from .validation import validate_container_name, validate_header_value, validate_url

CONFIG_FILENAME = ".mcpq.json"
DEFAULT_TRANSPORT = "streamable-http"
DEFAULT_PROTOCOL_VERSION = "2024-11-05"


@dataclass(frozen=True)
class ServerSpec:
    """One MCP server entry from `.mcpq.json`."""

    name: str
    url: str
    via: str = "host"
    headers: Mapping[str, str] = field(default_factory=dict)
    transport: str = DEFAULT_TRANSPORT
    protocol_version: str = DEFAULT_PROTOCOL_VERSION

    @property
    def proxy_container(self) -> str:
        """For `docker:<container>` via mode, return the container name."""
        if not self.via.startswith("docker:"):
            raise ValueError(f"server {self.name!r} via={self.via!r} is not a docker:<container> mode")
        return self.via.split(":", 1)[1]


def discover_config(start: Path | None = None, *, stop_at: Path | None = None) -> Path:
    """Walk upward from `start` (default: cwd) looking for `.mcpq.json`.

    The walk is bounded by `stop_at` (default: the user's home directory) —
    we never look above the caller's home. Raises FileNotFoundError if no
    config is found within the bounded range.
    """
    here = Path(start or Path.cwd()).resolve()
    ceiling = Path(stop_at or Path.home()).resolve()
    if ceiling not in here.parents and here != ceiling:
        # Start is already above the ceiling; nothing to search.
        raise FileNotFoundError(
            f"no {CONFIG_FILENAME} found at {here} (above configured ceiling {ceiling})"
        )
    for candidate in (here, *here.parents):
        path = candidate / CONFIG_FILENAME
        if path.is_file():
            return path
        if candidate == ceiling:
            break
    raise FileNotFoundError(
        f"no {CONFIG_FILENAME} found at or below {ceiling} (searched from {here})"
    )


def _coerce_server(name: str, raw: object) -> ServerSpec:
    if not isinstance(raw, Mapping):
        raise ValueError(f"server {name!r} must be a JSON object, got {type(raw).__name__}")
    if "url" not in raw:
        raise ValueError(f"server {name!r} missing required field 'url'")

    url = validate_url(str(raw["url"]))
    via = str(raw.get("via", "host"))
    if via.startswith("docker:"):
        validate_container_name(via.split(":", 1)[1])

    raw_headers = raw.get("headers", {}) or {}
    if not isinstance(raw_headers, Mapping):
        raise ValueError(f"server {name!r} 'headers' must be a JSON object")
    headers = {str(k): validate_header_value(str(k), str(v)) for k, v in raw_headers.items()}

    return ServerSpec(
        name=name,
        url=url,
        via=via,
        headers=headers,
        transport=str(raw.get("transport", DEFAULT_TRANSPORT)),
        protocol_version=str(raw.get("protocol_version", DEFAULT_PROTOCOL_VERSION)),
    )


def load_config(path: Path | None = None) -> dict[str, ServerSpec]:
    """Load `.mcpq.json` and return a `{name: ServerSpec}` mapping.

    Pass `path` to bypass discovery (e.g. when the CLI was invoked with
    `--config FILE`).
    """
    config_path = Path(path) if path is not None else discover_config()
    with config_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, Mapping):
        raise ValueError(f"{config_path}: top-level must be an object of server entries")
    servers = raw.get("servers")
    if not isinstance(servers, Mapping):
        raise ValueError(f"{config_path}: missing 'servers' object")
    return {name: _coerce_server(name, entry) for name, entry in servers.items()}
