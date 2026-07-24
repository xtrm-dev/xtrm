"""Fixtures for the dispatch / activator tests.

Builds a throwaway git consumer repo with an ``api-gateway`` service (the §3.7 canonical
example), builds its FTS5 index, and provides a helper that runs the real PreToolUse activator
script as a subprocess (exactly how the hook fires) so block / inject / override behaviour is
exercised end-to-end.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from service_knowledge import index
from service_knowledge.index.tests.conftest import make_consumer

_ACTIVATOR = Path(__file__).resolve().parent.parent.parent / "scripts" / "skill_activator.py"


@pytest.fixture
def gateway_consumer(tmp_path: Path) -> Path:
    """Consumer repo with one ``api-gateway`` service + a built FTS5 index."""
    repo = make_consumer(
        tmp_path,
        {
            "api-gateway": {
                "description": "Edge API gateway.",
                "territory": ["api-gateway/**"],
                "triggers": ["gateway", "api", "rate limit"],
                "overview": "api-gateway terminates TLS and enforces rate limits.",
            }
        },
    )
    index.build(repo)
    return repo


def run_activator(
    consumer: Path,
    tool_name: str,
    tool_input: dict,
    *,
    override: bool = False,
) -> tuple[int, dict | None, str]:
    """Run the real activator script as the hook would; return (exit_code, parsed_json, stderr)."""
    env = dict(os.environ)
    env["CLAUDE_PROJECT_DIR"] = str(consumer)
    env.pop("SERVICE_KNOWLEDGE_ROOT", None)
    if override:
        env["OVERRIDE_KNOWLEDGE_BUNDLE"] = "1"
    else:
        env.pop("OVERRIDE_KNOWLEDGE_BUNDLE", None)
    payload = json.dumps({"tool_name": tool_name, "tool_input": tool_input})
    proc = subprocess.run(
        [sys.executable, str(_ACTIVATOR)],
        input=payload,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    parsed = json.loads(proc.stdout) if proc.stdout.strip() else None
    return proc.returncode, parsed, proc.stderr


def read_telemetry(consumer: Path) -> list[dict]:
    path = consumer / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
