"""Transport backends that POST to an MCP server and return (status, headers, body)."""

from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Mapping

from .protocol import ACCEPT_HEADER, CONTENT_TYPE
from .validation import validate_container_name, validate_url

DEFAULT_TIMEOUT = 30

# Sentinel that the in-container urllib script writes between header-line
# records and the response body, chosen to be impossible in a normal HTTP
# header or body.
_BODY_DELIMITER = "\n---MCPQ-BODY---\n"


class TransportError(RuntimeError):
    """Raised when a transport cannot deliver a request to the MCP server."""


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes

    def header(self, name: str) -> str | None:
        target = name.lower()
        for key, value in self.headers.items():
            if key.lower() == target:
                return value
        return None


class HostTransport:
    """Issue the HTTP POST directly from this process via urllib."""

    def post(self, url: str, headers: Mapping[str, str], body: bytes, *, timeout: int = DEFAULT_TIMEOUT) -> Response:
        validate_url(url)
        merged = {"Content-Type": CONTENT_TYPE, "Accept": ACCEPT_HEADER, **dict(headers)}
        req = urllib.request.Request(url, data=body, headers=merged, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return Response(
                    status=resp.status,
                    headers=dict(resp.headers),
                    body=resp.read(),
                )
        except urllib.error.HTTPError as exc:
            # HTTPError still has headers + body — surface them as a response.
            return Response(
                status=exc.code,
                headers=dict(exc.headers.items() if exc.headers else []),
                body=exc.read() if hasattr(exc, "read") else b"",
            )
        except urllib.error.URLError as exc:
            raise TransportError(f"host POST {url} failed: {exc.reason}") from exc


class DockerTransport:
    """Shell out to `docker exec <container> python3 -c "..."`.

    The embedded urllib script does the POST from inside the named
    container so it can reach MCP sidecars that are only on the docker
    network. It prints response headers as JSON, then the body bytes
    (base64 to survive the text pipe) after a sentinel line.
    """

    def __init__(self, container: str, *, timeout: int = DEFAULT_TIMEOUT) -> None:
        validate_container_name(container)
        self.container = container
        self.timeout = timeout

    def post(self, url: str, headers: Mapping[str, str], body: bytes, *, timeout: int | None = None) -> Response:
        effective_timeout = timeout if timeout is not None else self.timeout
        validate_url(url)
        script = _build_exec_script(url, dict(headers), body, effective_timeout)
        cmd = ["docker", "exec", "-i", "--", self.container, "python3", "-c", script]
        try:
            completed = subprocess.run(
                cmd,
                input=body,
                capture_output=True,
                text=False,
                timeout=effective_timeout + 5,
                check=False,
            )
        except FileNotFoundError as exc:
            raise TransportError("`docker` executable not found on PATH") from exc
        except subprocess.TimeoutExpired as exc:
            raise TransportError(
                f"docker exec {self.container} python3 timed out after {exc.timeout}s"
            ) from exc

        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="replace").strip()
            raise TransportError(
                f"docker exec {self.container} python3 exited {completed.returncode}: {stderr}"
            )

        raw = completed.stdout
        delimiter = _BODY_DELIMITER.encode()
        idx = raw.find(delimiter)
        if idx == -1:
            raise TransportError(
                f"docker exec {self.container} output missing body delimiter "
                f"(first 200 bytes: {raw[:200]!r})"
            )
        header_block = raw[:idx].decode("utf-8", errors="replace")
        body_block = raw[idx + len(delimiter):]
        if not header_block.startswith("{"):
            raise TransportError(
                f"docker exec {self.container} header block not JSON: {header_block[:200]!r}"
            )
        header_record = json.loads(header_block)
        status = int(header_record.get("status", 0))
        headers_out: dict[str, str] = {
            str(k): str(v) for k, v in (header_record.get("headers") or {}).items()
        }
        encoding = header_record.get("body_encoding", "base64")
        if encoding == "base64":
            import base64
            body = base64.b64decode(body_block)
        elif encoding == "raw":
            body = body_block
        else:
            raise TransportError(f"unknown body_encoding from in-container script: {encoding!r}")
        return Response(status=status, headers=headers_out, body=body)


def _build_exec_script(url: str, headers: dict[str, str], body: bytes, timeout: int) -> str:
    """Produce a single-line python `-c` payload that performs the POST.

    The script writes a single JSON object (status, headers, body_encoding)
    then a sentinel newline, then the base64-encoded body.
    """
    header_json = json.dumps(headers, separators=(",", ":"))
    # Build the inner urllib program as a string. It runs on python 3.10+.
    # Headers are shipped as a JSON string; the script does json.loads() so
    # the dict literal stays a dict (not a string-of-a-dict).
    program = (
        "import base64, json, sys, urllib.request, urllib.error\n"
        f"_url = {url!r}\n"
        f"_headers = json.loads({header_json!r})\n"
        f"_body = sys.stdin.buffer.read()\n"
        f"_req = urllib.request.Request(_url, data=_body, headers=_headers, method='POST')\n"
        f"_timeout = {int(timeout)}\n"
        "try:\n"
        "    _resp = urllib.request.urlopen(_req, timeout=_timeout)\n"
        "    _status = _resp.status\n"
        "    _hdrs = dict(_resp.headers)\n"
        "    _data = _resp.read()\n"
        "except urllib.error.HTTPError as _e:\n"
        "    _status = _e.code\n"
        "    _hdrs = dict(_e.headers.items()) if _e.headers else {}\n"
        "    _data = _e.read() if hasattr(_e, 'read') else b''\n"
        "except Exception as _e:\n"
        "    sys.stderr.write('docker-transport error: ' + repr(_e) + '\\n')\n"
        "    sys.exit(2)\n"
        "_record = {'status': _status, 'headers': _hdrs, 'body_encoding': 'base64'}\n"
        "sys.stdout.write(json.dumps(_record))\n"
        f"sys.stdout.write({_BODY_DELIMITER!r})\n"
        "sys.stdout.buffer.write(base64.b64encode(_data))\n"
        "sys.stdout.flush()\n"
    )
    # Use shlex.quote so the single -c argument survives the docker exec argv.
    return program
